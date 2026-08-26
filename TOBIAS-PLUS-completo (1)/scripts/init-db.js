import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

const schema = fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');

try {
  await pool.query(schema);
  await pool.query(`
    INSERT INTO plans (name, description, price_cop, duration_days)
    SELECT * FROM (VALUES
      ('Plan Básico', 'Acceso inicial a TOBIAS.PLUS', 29900, 30),
      ('Plan Plus', 'Más beneficios y herramientas', 59900, 30),
      ('Plan Pro', 'Acceso premium a la plataforma', 99900, 30)
    ) AS v(name, description, price_cop, duration_days)
    WHERE NOT EXISTS (SELECT 1 FROM plans);
  `);
  console.log('Base de datos inicializada.');
} finally {
  await pool.end();
}