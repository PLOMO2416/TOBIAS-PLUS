const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const money = n => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(n);

function toast(text){const t=$('#toast');t.textContent=text;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3200)}
function show(view){
  $$('.view').forEach(v=>v.classList.remove('active'));
  const el=$(`#${view}`); if(el) el.classList.add('active');
  if(view==='plans') loadPlans();
  if(view==='dashboard') loadDashboard();
}
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.view)));

async function api(url, options={}){
  const r=await fetch(url,{headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error||'Error de servidor');
  return data;
}

async function loadMe(){
  try{const {user}=await api('/api/me'); $('#logoutBtn').classList.remove('hidden'); $('#dashboardBtn').textContent='Mi cuenta'; return user}
  catch{$('#logoutBtn').classList.add('hidden'); return null}
}

async function loadPlans(){
  try{
    const {plans}=await api('/api/plans');
    $('#plansGrid').innerHTML=plans.map(p=>`
      <article class="plan">
        <p class="eyebrow">TOBIAS.PLUS</p><h3>${escapeHtml(p.name)}</h3>
        <p class="muted">${escapeHtml(p.description)}</p>
        <div class="price">${money(p.price_cop)}</div>
        <p class="muted">${p.duration_days} días</p>
        <button class="primary" onclick="buyPlan(${p.id})">Pagar con Nequi</button>
      </article>`).join('');
  }catch(e){$('#plansGrid').innerHTML=`<p>${e.message}</p>`}
}

window.buyPlan=async function(planId){
  try{
    await loadMe().then(u=>{if(!u) throw new Error('Debes iniciar sesión para pagar.')});
    const r=await api('/api/payments/nequi/start',{method:'POST',body:JSON.stringify({planId})});
    toast(r.mode==='configuration_required'?'Orden creada. Falta conectar las credenciales de Nequi.':'Pago iniciado.');
  }catch(e){toast(e.message)}
}

$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault(); const f=new FormData(e.target);
  try{await api('/api/auth/login',{method:'POST',body:JSON.stringify(Object.fromEntries(f))}); $('#loginMsg').textContent=''; show('dashboard'); toast('Sesión iniciada.')}
  catch(err){$('#loginMsg').textContent=err.message}
});
$('#registerForm').addEventListener('submit',async e=>{
  e.preventDefault(); const f=new FormData(e.target);
  try{await api('/api/auth/register',{method:'POST',body:JSON.stringify({fullName:f.get('fullName'),email:f.get('email'),password:f.get('password')})}); show('dashboard'); toast('Cuenta creada.')}
  catch(err){$('#registerMsg').textContent=err.message}
});
$('#logoutBtn').addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST'});show('home');toast('Sesión cerrada.')}catch(e){toast(e.message)}});

$('#loanForm').addEventListener('submit',async e=>{
  e.preventDefault(); const amount=Number(new FormData(e.target).get('amountCop'));
  try{await api('/api/loans',{method:'POST',body:JSON.stringify({amountCop:amount})});$('#loanMsg').textContent='Solicitud enviada correctamente.';e.target.reset()}
  catch(err){$('#loanMsg').textContent=err.message}
});

async function loadDashboard(){
  try{
    const {user}=await api('/api/me'); const d=await api('/api/dashboard');
    $('#welcome').textContent=`Hola, ${user.full_name}`;
    $('#dashboardContent').innerHTML=`
      <div class="tablebox"><h3>Planes activos</h3><table class="table"><thead><tr><th>Plan</th><th>Estado</th><th>Vence</th></tr></thead><tbody>
      ${d.subscriptions.map(s=>`<tr><td>${escapeHtml(s.plan_name)}</td><td class="good">${s.status}</td><td>${new Date(s.ends_at).toLocaleDateString('es-CO')}</td></tr>`).join('')||'<tr><td colspan="3">No tienes planes activos.</td></tr>'}</tbody></table></div>
      <div class="tablebox"><h3>Pagos</h3><table class="table"><thead><tr><th>Referencia</th><th>Valor</th><th>Estado</th></tr></thead><tbody>
      ${d.transactions.map(t=>`<tr><td>${t.reference}</td><td>${money(t.amount_cop)}</td><td>${t.status}</td></tr>`).join('')||'<tr><td colspan="3">Sin pagos.</td></tr>'}</tbody></table></div>
      <div class="tablebox"><h3>Créditos</h3><table class="table"><thead><tr><th>Monto</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>
      ${d.loans.map(l=>`<tr><td>${money(l.amount_cop)}</td><td>${l.status}</td><td>${new Date(l.created_at).toLocaleDateString('es-CO')}</td></tr>`).join('')||'<tr><td colspan="3">Sin solicitudes.</td></tr>'}</tbody></table></div>`;
  }catch(e){show('login');toast('Inicia sesión para ver tu cuenta.')}
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}

loadMe(); loadPlans();