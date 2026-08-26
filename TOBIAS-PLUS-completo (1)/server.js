import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const app = express();
const PORT = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function signUser(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
}
function auth(req, res, next) {
  try {
    const token = req.cookies.tobias_session;
    if (!token) return res.status(401).json({ error: 'No autenticado' });
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión inválida' });
  }
}
function admin(req, res, next) {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Solo administradores' });
  next();
}
async function audit(userId, action, entityType, entityId, metadata = {}) {
  await pool.query(
    'INSERT INTO audit_logs(user_id, action, entity_type, entity_id, metadata) VALUES($1,$2,$3,$4,$5)',
    [userId, action, entityType, entityId, metadata]
  );
}
function reference(prefix = 'TX') {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

app.get('/api/health', async (_req, res) => {
  const { rows } = await pool.query('SELECT NOW() AS now');
  res.json({ ok: true, service: 'TOBIAS.PLUS', database: !!rows[0] });
});

app.post('/api/auth/register', async (req, res) => {
  const { fullName, email, password } = req.body || {};
  if (!fullName || !email || !password || password.length < 8)
    return res.status(400).json({ error: 'Nombre, correo y contraseña de mínimo 8 caracteres son obligatorios.' });

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users(full_name,email,password_hash) VALUES($1,LOWER($2),$3)
       RETURNING id,full_name,email,role,created_at`,
      [fullName.trim(), email.trim(), passwordHash]
    );
    const user = rows[0];
    res.cookie('tobias_session', signUser(user), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7*24*60*60*1000 });
    await audit(user.id, 'REGISTER', 'USER', user.id);
    res.status(201).json({ user });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ese correo ya está registrado.' });
    console.error(e);
    res.status(500).json({ error: 'No fue posible crear la cuenta.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await pool.query('SELECT * FROM users WHERE email=LOWER($1)', [email || '']);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password || '', user.password_hash)))
    return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });

  res.cookie('tobias_session', signUser(user), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7*24*60*60*1000 });
  await audit(user.id, 'LOGIN', 'USER', user.id);
  res.json({ user: { id:user.id, full_name:user.full_name, email:user.email, role:user.role } });
});

app.post('/api/auth/logout', auth, async (req, res) => {
  res.clearCookie('tobias_session');
  res.json({ ok: true });
});

app.get('/api/me', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT id,full_name,email,role,created_at FROM users WHERE id=$1', [req.user.sub]);
  res.json({ user: rows[0] });
});

app.get('/api/plans', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM plans WHERE active=true ORDER BY price_cop');
  res.json({ plans: rows });
});

app.get('/api/dashboard', auth, async (req, res) => {
  const [tx, loans, subs] = await Promise.all([
    pool.query('SELECT id,reference,amount_cop,status,provider_status,created_at,paid_at FROM transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [req.user.sub]),
    pool.query('SELECT * FROM loans WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [req.user.sub]),
    pool.query(`SELECT s.*,p.name AS plan_name FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.user_id=$1 ORDER BY s.ends_at DESC`, [req.user.sub])
  ]);
  res.json({ transactions: tx.rows, loans: loans.rows, subscriptions: subs.rows });
});

app.post('/api/loans', auth, async (req, res) => {
  const amount = Number(req.body?.amountCop);
  if (!Number.isSafeInteger(amount) || amount <= 0) return res.status(400).json({ error: 'Monto inválido.' });
  const { rows } = await pool.query('INSERT INTO loans(user_id,amount_cop) VALUES($1,$2) RETURNING *', [req.user.sub, amount]);
  await audit(req.user.sub, 'LOAN_REQUESTED', 'LOAN', rows[0].id, { amountCop: amount });
  res.status(201).json({ loan: rows[0] });
});

app.post('/api/payments/nequi/start', auth, async (req, res) => {
  const planId = Number(req.body?.planId);
  const { rows } = await pool.query('SELECT * FROM plans WHERE id=$1 AND active=true', [planId]);
  const plan = rows[0];
  if (!plan) return res.status(404).json({ error: 'Plan no encontrado.' });

  const ref = reference('NEQ');
  const tx = await pool.query(
    `INSERT INTO transactions(user_id,plan_id,provider,reference,amount_cop)
     VALUES($1,$2,'NEQUI',$3,$4) RETURNING *`,
    [req.user.sub, plan.id, ref, plan.price_cop]
  );
  await audit(req.user.sub, 'PAYMENT_CREATED', 'TRANSACTION', tx.rows[0].id, { provider:'NEQUI', reference:ref });

  if (!process.env.NEQUI_CLIENT_ID || !process.env.NEQUI_CLIENT_SECRET || !process.env.NEQUI_API_BASE_URL) {
    return res.status(202).json({
      transaction: tx.rows[0],
      mode: 'configuration_required',
      message: 'Transacción creada. Configura las credenciales oficiales de Nequi para iniciar el cobro real.'
    });
  }

  // IMPORTANTE: aquí no se inventa la llamada a Nequi.
  // Implementa exactamente el flujo y firma indicados por las credenciales/documentación
  // entregadas a TOBIAS.PLUS por Nequi Developer Portal.
  return res.status(501).json({
    transaction: tx.rows[0],
    error: 'Adaptador Nequi pendiente de credenciales/documentación de producción.'
  });
});

app.post('/api/webhooks/nequi', async (req, res) => {
  // Producción: valida autenticidad/firma conforme al contrato oficial de Nequi
  // antes de aceptar cualquier cambio de estado.
  const { reference: ref, status, providerTransactionId, providerStatus } = req.body || {};
  if (!ref || !status) return res.status(400).json({ error: 'Webhook incompleto.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM transactions WHERE reference=$1 FOR UPDATE', [ref]);
    const tx = rows[0];
    if (!tx) { await client.query('ROLLBACK'); return res.status(404).json({ error:'Transacción no encontrada.' }); }
    if (tx.status === 'PAID') { await client.query('COMMIT'); return res.json({ ok:true, idempotent:true }); }

    const normalized = String(status).toUpperCase();
    let newStatus = ['PAID','SUCCESS','APPROVED'].includes(normalized) ? 'PAID'
      : ['FAILED','DECLINED','REJECTED'].includes(normalized) ? 'FAILED'
      : ['EXPIRED','TIMEOUT'].includes(normalized) ? 'EXPIRED'
      : tx.status;

    const paidAt = newStatus === 'PAID' ? new Date() : null;
    await client.query(
      `UPDATE transactions SET status=$1,provider_transaction_id=COALESCE($2,provider_transaction_id),
       provider_status=$3,paid_at=COALESCE($4,paid_at),updated_at=NOW() WHERE id=$5`,
      [newStatus, providerTransactionId || null, providerStatus || normalized, paidAt, tx.id]
    );

    if (newStatus === 'PAID' && tx.plan_id) {
      const { rows: plans } = await client.query('SELECT duration_days FROM plans WHERE id=$1', [tx.plan_id]);
      if (plans[0]) {
        await client.query(
          `INSERT INTO subscriptions(user_id,plan_id,transaction_id,starts_at,ends_at)
           VALUES($1,$2,$3,NOW(),NOW() + ($4::text || ' days')::interval)
           ON CONFLICT (transaction_id) DO NOTHING`,
          [tx.user_id, tx.plan_id, tx.id, plans[0].duration_days]
        );
      }
    }

    await client.query(
      `INSERT INTO audit_logs(user_id,action,entity_type,entity_id,metadata)
       VALUES($1,$2,'TRANSACTION',$3,$4)`,
      [tx.user_id, `PAYMENT_${newStatus}`, tx.id, { reference:ref, providerStatus }]
    );

    await client.query('COMMIT');
    res.json({ ok:true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error:'Error procesando webhook.' });
  } finally { client.release(); }
});

app.get('/api/admin/transactions', auth, admin, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT t.*,u.full_name,u.email,p.name AS plan_name
     FROM transactions t JOIN users u ON u.id=t.user_id
     LEFT JOIN plans p ON p.id=t.plan_id ORDER BY t.created_at DESC LIMIT 200`
  );
  res.json({ transactions: rows });
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`TOBIAS.PLUS escuchando en http://localhost:${PORT}`));
