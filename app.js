import { parsePdf, sha256, PARSER_VERSION } from "./pdf-import.js";

import { SUPABASE_URL, SUPABASE_ANON_KEY, YEAR_LABELS, USER_EMAIL_DOMAIN } from "./config.js";

/* ===================================================================== */
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const letters = ["A","B","C","D","E","F","G","H"];
const DOC_COLS="id,sha,title,subject,year,bloc,file_name,pages,parser_version,visibility,owner,updated_at";
const SB = SUPABASE_URL.replace(/\/+$/,""), SB_ON = !!(SB && SUPABASE_ANON_KEY);
const MODES = {
  quick:{label:"QCM rapide",icon:"⚡",desc:"10 questions tirées au hasard."},
  exam:{label:"Examen",icon:"◈",desc:"Toutes les questions, dans un ordre aléatoire."},
  revision:{label:"Révision",icon:"↻",desc:"Les questions pas encore réussies, répétées jusqu'à ce qu'elles soient validées."},
};
const REPORT_REASONS = ["Bonne réponse incorrecte","Énoncé faux ou incomplet","Schéma / formule / code manquant ou illisible","Explication fausse ou peu claire","Faute de frappe","Autre"];

let S = {
  session: loadJSON("cctlSession", null), profile: null,
  docs: [], prog: {}, sessions: [],
  quiz: null, busy: null, errors: [], loaded: false,
  admin: { invites: null, members: null, reports: null },
};

/* ---------- utilitaires ---------- */
function esc(t){return String(t??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c])}
function txt(t){return esc(t).replace(/\n/g,"<br>")}
function loadJSON(k,d){try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}}
function saveJSON(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}
function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),2800)}
const pct=(a,b)=>b?Math.round(a/b*100):0;
function shuffle(arr){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
const unique=a=>[...new Set(a)];
const fmtDate=d=>new Date(d).toLocaleDateString("fr-FR",{day:"numeric",month:"short",year:"numeric"});
const imgTag=(im,cls,alt="",zoom=1.15)=>im&&im.src?`<img class="${cls}" src="${im.src}" alt="${esc(alt)}" style="width:${im.w?Math.round(im.w*zoom)+"px":"auto"}">`:"";
const isAdmin=()=>S.profile?.role==="admin";
const MAX_YEAR=YEAR_LABELS.length;
const yearLabel=n=>n?(YEAR_LABELS[n-1]||`A${n}`):"Non classé";
const acadStart=(d=new Date())=>d.getMonth()>=8?d.getFullYear():d.getFullYear()-1;   // rentrée : 1er septembre
const curYear=p=>p?.year?Math.min(MAX_YEAR,p.year+Math.max(0,acadStart()-(p.year_set_at||acadStart()))):null;
const myYear=()=>curYear(S.profile);
const yearOptions=(sel,withNone=true)=>`${withNone?`<option value="" ${sel?"":"selected"}>Non classé</option>`:""}${YEAR_LABELS.map((l,i)=>`<option value="${i+1}" ${sel===i+1?"selected":""}>${l}</option>`).join("")}`;
const blocOf=d=>d.bloc||"Autres";
const SUBJECT_STYLE=s=>/math/i.test(s)?["math","∑"]:/num|info/i.test(s)?["num","⌘"]:["other","◆"];
function randCode(n=14){const a="abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789",u=crypto.getRandomValues(new Uint8Array(n));return [...u].map(x=>a[x%a.length]).join("")}
function setBusy(m){S.busy=m;const el=$("#busyBar");if(el){el.textContent=m||"";el.classList.toggle("show",!!m)}}

/* ===================== Supabase : HTTP + Auth ===================== */
async function sbToken(){
  const s=S.session;if(!s)return null;
  if(Date.now()<s.expires_at*1000-60e3)return s.access_token;
  try{
    const r=await fetch(`${SB}/auth/v1/token?grant_type=refresh_token`,{method:"POST",headers:{apikey:SUPABASE_ANON_KEY,"Content-Type":"application/json"},body:JSON.stringify({refresh_token:s.refresh_token})});
    if(!r.ok)throw 0;setSession(await r.json());return S.session.access_token;
  }catch{setSession(null);return null}
}
function setSession(j){
  S.session=j&&j.access_token?{access_token:j.access_token,refresh_token:j.refresh_token,expires_at:j.expires_at||Math.floor(Date.now()/1000)+(j.expires_in||3600),user:j.user}:null;
  if(S.session)saveJSON("cctlSession",S.session);else localStorage.removeItem("cctlSession");
}
async function api(path,opt={},anon=false){
  const headers={apikey:SUPABASE_ANON_KEY,"Content-Type":"application/json",...(opt.headers||{})};
  if(!anon){const t=await sbToken();if(!t){showAuth("Ta session a expiré, reconnecte-toi.");throw new Error("session expirée")}headers.Authorization=`Bearer ${t}`}
  const r=await fetch(SB+path,{...opt,headers});
  if(!r.ok){let m="";try{const j=await r.json();m=j.message||j.msg||j.error_description||j.error||""}catch{}
    const e=new Error(m||("erreur "+r.status));e.status=r.status;throw e}
  if(r.status===204)return null;
  const t=await r.text();return t?JSON.parse(t):null;
}
const rpc=(fn,args,anon=true)=>api(`/rest/v1/rpc/${fn}`,{method:"POST",body:JSON.stringify(args)},anon);
const toEmail=id=>id.includes("@")?id.trim().toLowerCase():`${id.trim().toLowerCase()}@${USER_EMAIL_DOMAIN}`;
const validUsername=u=>/^[a-z0-9_.-]{3,20}$/.test(u);

async function login(identifier,password){
  const r=await fetch(`${SB}/auth/v1/token?grant_type=password`,{method:"POST",headers:{apikey:SUPABASE_ANON_KEY,"Content-Type":"application/json"},body:JSON.stringify({email:toEmail(identifier),password})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(/invalid/i.test(j.error_description||j.msg||j.error_code||"")?"Pseudo ou mot de passe incorrect.":(j.error_description||j.msg||"Connexion impossible."));
  setSession(j);
}
async function signup(username,password,invite,year){
  const r=await fetch(`${SB}/auth/v1/signup`,{method:"POST",headers:{apikey:SUPABASE_ANON_KEY,"Content-Type":"application/json"},body:JSON.stringify({email:toEmail(username),password,data:{username,invite,year:year||null}})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){
    const m=j.msg||j.error_description||j.message||"";
    if(/already registered|already exists/i.test(m))throw new Error("Ce pseudo est déjà pris.");
    if(/database error/i.test(m))throw new Error("Inscription refusée : lien d'invitation invalide ou expiré, ou pseudo déjà pris.");
    if(/password/i.test(m))throw new Error("Mot de passe refusé : "+m);
    throw new Error(m||"Inscription impossible.");
  }
  if(!j.access_token)throw new Error("Compte créé, mais Supabase demande une confirmation par e-mail : désactive « Confirm email » (Authentication → Sign In / Providers → Email).");
  setSession(j);
}
async function logout(){
  try{const t=S.session?.access_token;if(t)await fetch(`${SB}/auth/v1/logout`,{method:"POST",headers:{apikey:SUPABASE_ANON_KEY,Authorization:`Bearer ${t}`}})}catch{}
  setSession(null);S={...S,profile:null,docs:[],prog:{},sessions:[],quiz:null,loaded:false,admin:{invites:null,members:null,reports:null}};
  try{await cacheClear()}catch{}
  history.replaceState(null,"",location.pathname);showAuth();
}

/* ===================== Cache local des questions (IndexedDB) ===================== */
const DB_NAME="cctlTrainer4",STORE="docs";
function idb(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:"id"});r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function tx(mode,fn){const db=await idb();return new Promise((res,rej)=>{const t=db.transaction(STORE,mode),st=t.objectStore(STORE);const out=fn(st);t.oncomplete=()=>res(out?.result);t.onerror=()=>rej(t.error)})}
const cacheGet=id=>tx("readonly",st=>st.get(id)).catch(()=>null);
const cachePut=rec=>tx("readwrite",st=>{st.put(rec)}).catch(()=>{});
const cacheClear=()=>tx("readwrite",st=>{st.clear()});

/* ===================== Chargement des données ===================== */
async function loadAll(){
  setBusy("Chargement…");
  const uid=S.session.user.id;
  const [prof]=await api(`/rest/v1/cctl_profiles?select=id,username,role,created_at,year,year_set_at&id=eq.${uid}`);
  if(!prof){S.profile=null;setBusy(null);showNoAccess();return false}
  S.profile=prof;
  const [rows,prog,sessions]=await Promise.all([
    api(`/rest/v1/cctl_docs?select=${DOC_COLS}&order=created_at`),
    api("/rest/v1/cctl_progress?select=doc_id,qnum,seen,correct,last_correct"),
    api("/rest/v1/cctl_sessions?select=id,doc_id,mode,score,total,created_at&order=created_at.desc&limit=60"),
  ]);
  S.prog={};for(const p of prog)S.prog[`${p.doc_id}:${p.qnum}`]=p;
  S.sessions=sessions;
  const docs=[];
  for(const row of rows){
    let c=await cacheGet(row.id);
    if(!c||c.sha!==row.sha||c.parser_version!==row.parser_version){
      setBusy(`Chargement de « ${row.title} »…`);
      const [full]=await api(`/rest/v1/cctl_docs?select=questions&id=eq.${row.id}`);
      c={id:row.id,sha:row.sha,parser_version:row.parser_version,questions:full.questions};cachePut(c);
    }
    docs.push(makeDoc(row,c.questions));
  }
  S.docs=docs;S.loaded=true;setBusy(null);return true;
}
function makeDoc(row,questions){
  const qs=(questions||[]).filter(q=>q.a?.length).map(q=>({...q,docId:row.id}));
  return {...row,questions:qs,mine:row.visibility==="private"};
}
const docById=id=>S.docs.find(d=>d.id===id);

/* ---------- progression ---------- */
const P=(doc,q)=>S.prog[`${doc.id}:${q.num}`];
function docStats(doc){
  let mastered=0,wrong=0,unseen=0,seen=0,correct=0;
  for(const q of doc.questions){const p=P(doc,q);if(!p||!p.seen)unseen++;else if(p.last_correct)mastered++;else wrong++;if(p){seen+=p.seen;correct+=p.correct}}
  return {total:doc.questions.length,mastered,wrong,unseen,toReview:wrong+unseen,rate:pct(correct,seen),seen};
}
async function recordAnswer(doc,q,ok){
  const k=`${doc.id}:${q.num}`,p=S.prog[k]||{doc_id:doc.id,qnum:q.num,seen:0,correct:0,last_correct:false};
  p.seen++;if(ok)p.correct++;p.last_correct=ok;S.prog[k]=p;
  try{await api("/rest/v1/cctl_progress?on_conflict=user_id,doc_id,qnum",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},
    body:JSON.stringify({doc_id:doc.id,qnum:q.num,seen:p.seen,correct:p.correct,last_correct:ok,updated_at:new Date().toISOString()})})}
  catch(e){console.warn(e);toast("Progression non enregistrée (connexion ?)")}
}
async function resetDocProgress(doc){
  if(!confirm(`Remettre à zéro ta progression sur « ${doc.title} » ?`))return;
  try{await api(`/rest/v1/cctl_progress?doc_id=eq.${doc.id}`,{method:"DELETE"});
    for(const k of Object.keys(S.prog))if(k.startsWith(doc.id+":"))delete S.prog[k];toast("Progression remise à zéro.");render()}
  catch(e){toast("Impossible : "+e.message)}
}

/* ===================== Écrans connexion / inscription ===================== */
function showAuth(message){
  $("#app").hidden=true;const a=$("#auth");a.hidden=false;
  const invite=new URLSearchParams(location.search).get("invite");
  if(!SB_ON){a.innerHTML=authShell(`<h2>Configuration requise</h2><p class="auth-sub">Renseigne <code>SUPABASE_URL</code> et <code>SUPABASE_ANON_KEY</code> dans <code>config.js</code>, puis exécute <code>supabase.sql</code> (voir le README).</p>`);return}
  if(invite)return renderSignup(invite,message);
  a.innerHTML=authShell(`
    <h2>Connexion</h2><p class="auth-sub">Accès réservé aux membres invités.</p>
    ${message?`<div class="auth-msg">${esc(message)}</div>`:""}
    <form id="loginForm" class="auth-form" autocomplete="on">
      <label>Pseudo<input name="id" autocomplete="username" required autofocus></label>
      <label>Mot de passe<input name="pw" type="password" autocomplete="current-password" required></label>
      <div class="auth-err" id="authErr"></div>
      <button class="primary-btn" type="submit">Se connecter <span>→</span></button>
    </form>
    <p class="auth-foot">Pas de compte ? Demande un lien d'invitation à l'administrateur.</p>`);
  $("#loginForm").onsubmit=async e=>{
    e.preventDefault();const f=e.target,btn=$("button",f);btn.disabled=true;$("#authErr").textContent="";
    try{await login(f.id.value,f.pw.value);await boot()}catch(err){$("#authErr").textContent=err.message;btn.disabled=false}
  };
}
async function renderSignup(invite,message){
  const a=$("#auth");a.innerHTML=authShell(`<h2>Invitation</h2><p class="auth-sub">Vérification du lien…</p>`);
  let ok=false;try{ok=await rpc("cctl_check_invite",{p_code:invite})}catch(e){console.warn(e)}
  if(!ok){a.innerHTML=authShell(`<h2>Lien d'invitation invalide</h2><p class="auth-sub">Ce lien a expiré, a déjà été utilisé ou a été révoqué. Demande un nouveau lien à l'administrateur.</p><button class="secondary-btn" id="toLogin">J'ai déjà un compte</button>`);
    $("#toLogin").onclick=()=>{history.replaceState(null,"",location.pathname);showAuth()};return}
  a.innerHTML=authShell(`
    <h2>Créer ton compte</h2><p class="auth-sub">Tu as été invité sur CCTL Trainer. Choisis un pseudo et un mot de passe, aucune adresse e-mail n'est demandée.</p>
    ${message?`<div class="auth-msg">${esc(message)}</div>`:""}
    <form id="signupForm" class="auth-form">
      <label>Pseudo<input name="user" autocomplete="username" required minlength="3" maxlength="20" pattern="[a-zA-Z0-9_.\\-]{3,20}" placeholder="ex. jeremy_j"></label>
      <small class="auth-hint">3 à 20 caractères : lettres, chiffres, point, tiret, tiret bas.</small>
      <label>Ton année<select name="year" required><option value="" disabled selected>Choisis ton année</option>${YEAR_LABELS.map((l,i)=>`<option value="${i+1}">${l}</option>`).join("")}</select></label>
      <small class="auth-hint">Elle passera automatiquement à l'année suivante chaque 1er septembre.</small>
      <label>Mot de passe<input name="pw" type="password" autocomplete="new-password" required minlength="8"></label>
      <label>Confirme le mot de passe<input name="pw2" type="password" autocomplete="new-password" required minlength="8"></label>
      <div class="auth-err" id="authErr"></div>
      <button class="primary-btn" type="submit">Créer mon compte <span>→</span></button>
    </form>
    <p class="auth-foot"><a href="#" id="toLogin">J'ai déjà un compte</a></p>`);
  $("#toLogin").onclick=e=>{e.preventDefault();history.replaceState(null,"",location.pathname);showAuth()};
  $("#signupForm").onsubmit=async e=>{
    e.preventDefault();const f=e.target,err=$("#authErr"),btn=$("button",f);err.textContent="";
    const user=f.user.value.trim().toLowerCase();
    if(!validUsername(user))return err.textContent="Pseudo invalide : 3 à 20 caractères parmi a-z, 0-9, « . », « - », « _ ».";
    if(!f.year.value)return err.textContent="Choisis ton année.";
    if(f.pw.value.length<8)return err.textContent="Le mot de passe doit faire au moins 8 caractères.";
    if(f.pw.value!==f.pw2.value)return err.textContent="Les deux mots de passe ne correspondent pas.";
    btn.disabled=true;
    try{
      if(!(await rpc("cctl_username_free",{p_username:user})))throw new Error("Ce pseudo est déjà pris.");
      await signup(user,f.pw.value,invite,+f.year.value);
      history.replaceState(null,"",location.pathname);toast(`Bienvenue ${user} !`);await boot();
    }catch(x){err.textContent=x.message;btn.disabled=false}
  };
}
function authShell(inner){return `<div class="auth-card"><div class="brand auth-brand"><span class="brand-mark">C</span><span>CCTL<span class="brand-light">TRAINER</span></span></div>${inner}</div>`}
function showNoAccess(){
  $("#app").hidden=true;const a=$("#auth");a.hidden=false;
  a.innerHTML=authShell(`<h2>Accès non autorisé</h2><p class="auth-sub">Ce compte n'a pas (ou plus) accès au site. Demande un lien d'invitation à l'administrateur.</p><button class="secondary-btn" id="outBtn">Se déconnecter</button>`);
  $("#outBtn").onclick=logout;
}

/* ===================== Navigation ===================== */
const NAV={home:"Accueil",cctl:"CCTL",progress:"Ma progression",library:"Mes CCTL",profile:"Profil"};
function route(){const [v,id]=(location.hash.replace(/^#\/?/,"")||"home").split("/");return {view:NAV[v]||v==="doc"?v:"home",id}}
function go(h){if(location.hash==="#/"+h)render();else location.hash="#/"+h}
function render(){
  if(!S.loaded)return;
  const r=route();
  if(S.quiz&&r.view!=="quiz")S.quiz=null;
  const nav=r.view==="doc"?"cctl":r.view;
  $$(".nav-link").forEach(b=>b.classList.toggle("active",b.dataset.view===nav));
  $("#crumb").textContent=r.view==="doc"?(docById(r.id)?.title||"CCTL"):NAV[r.view]||"";
  $("#sidebar").classList.remove("open");
  const views={home:renderHome,cctl:renderCctlList,doc:()=>renderDoc(r.id),progress:renderProgress,library:renderLibrary,profile:renderProfile};
  (views[r.view]||renderHome)();
  window.scrollTo({top:0});
}
function emptyCctl(){
  return `<div class="empty-state import-empty"><div class="empty-ico">⇪</div><h3>Aucun CCTL pour l'instant</h3>
  <p>${isAdmin()?"Importe un PDF de correction et partage-le : les questions seront créées automatiquement.":"L'administrateur n'a pas encore partagé de CCTL. Tu peux importer tes propres PDF dans « Mes CCTL »."}</p>
  <button class="primary-btn" data-go="library">Importer un PDF <span>↗</span></button></div>`;
}

/* ---------- carte CCTL ---------- */
function cctlCard(d){
  const st=docStats(d),[cls,icon]=SUBJECT_STYLE(d.subject);
  return `<button class="cctl-card" data-go="doc/${d.id}">
    <div class="cctl-top"><span class="subject-icon ${cls}">${icon}</span>${d.mine?`<span class="pill">Perso</span>`:""}</div>
    <h3>${esc(d.title)}</h3><p class="cctl-meta">${d.year?`<b class="yr">${esc(yearLabel(d.year))}</b> · `:""}${esc(d.bloc||d.subject)} · ${st.total} questions</p>
    <div class="progress-track slim"><div class="progress-fill" style="width:${pct(st.mastered,st.total)}%"></div></div>
    <div class="cctl-foot"><span><b>${st.mastered}</b>/${st.total} maîtrisées</span>${st.wrong?`<span class="warn">${st.wrong} à revoir</span>`:st.mastered===st.total&&st.total?`<span class="ok">✓ Terminé</span>`:""}</div>
  </button>`;
}

/* ===================== Accueil ===================== */
function renderHome(){
  const totals=S.docs.reduce((t,d)=>{const s=docStats(d);t.q+=s.total;t.m+=s.mastered;t.w+=s.wrong;t.seen+=s.seen;return t},{q:0,m:0,w:0,seen:0});
  const allSeen=Object.values(S.prog).reduce((a,p)=>a+p.seen,0),allOk=Object.values(S.prog).reduce((a,p)=>a+p.correct,0);
  const last=S.sessions.find(s=>docById(s.doc_id));
  const my=myYear(),mine=my?S.docs.filter(d=>d.year===my||(!d.year&&d.mine)):S.docs;
  const review=S.docs.map(d=>({d,s:docStats(d)})).filter(x=>x.s.wrong>0).sort((a,b)=>b.s.wrong-a.s.wrong).slice(0,3);
  $("#appContent").innerHTML=`
  <section class="hero hero-compact"><div class="hero-copy"><div class="eyebrow"><span class="eyebrow-dot"></span> TON ESPACE DE RÉVISION</div>
    <h1>Bonjour <em>${esc(S.profile.username)}</em> 👋</h1>
    <p>${totals.q?`Tu maîtrises <b>${totals.m}</b> question${totals.m>1?"s":""} sur ${totals.q}.${totals.w?` Il t'en reste <b>${totals.w}</b> à revoir.`:""}`:"Commence par choisir un CCTL."}</p>
    ${last?`<button class="primary-btn" data-go="doc/${last.doc_id}">Reprendre « ${esc(docById(last.doc_id).title)} » <span>→</span></button>`:S.docs.length?`<button class="primary-btn" data-go="cctl">Choisir un CCTL <span>→</span></button>`:""}</div>
    <div class="hero-art" aria-hidden="true"><div class="art-ring ring-one"></div><div class="art-ring ring-two"></div><div class="art-card card-back">∑</div><div class="art-card card-front"><span class="art-tick">✓</span><strong>QCM</strong><small>MODE RÉVISION</small><div class="art-bars"><i></i><i></i><i></i><i></i><i></i></div></div><div class="art-orbit">✦</div></div></section>
  <section class="stats-grid">
    ${statCard("CCTL disponibles",S.docs.length,"▤",`${totals.q} questions au total`)}
    ${statCard("Questions maîtrisées",`${pct(totals.m,totals.q)}%`,"✓",`${totals.m} / ${totals.q}`)}
    ${statCard("Taux de réussite",`${pct(allOk,allSeen)}%`,"↗",`${allSeen} réponses données`)}
    ${statCard("Sessions",S.sessions.length,"◷","QCM terminés")}
  </section>
  ${review.length?`<section class="section-block"><div class="section-heading"><div><div class="eyebrow muted">À REVOIR EN PRIORITÉ</div><h2>Tes questions ratées</h2></div></div>
    <div class="review-list">${review.map(({d,s})=>`<div class="review-row"><div><b>${esc(d.title)}</b><small>${s.wrong} question${s.wrong>1?"s":""} ratée${s.wrong>1?"s":""} · ${s.unseen} jamais vue${s.unseen>1?"s":""}</small></div><button class="primary-btn small" data-mode="revision" data-doc="${d.id}">Réviser <span>↻</span></button></div>`).join("")}</div></section>`:""}
  <section class="section-block"><div class="section-heading"><div><div class="eyebrow muted">TES SUJETS</div><h2>${my?`CCTL de ${esc(yearLabel(my))}`:"CCTL"}</h2></div>${S.docs.length?`<button class="text-btn" data-go="cctl">Tous les CCTL <span>→</span></button>`:""}</div>
  ${S.docs.length?(mine.length?`<div class="cctl-grid">${mine.slice(0,9).map(cctlCard).join("")}</div>`:`<div class="recent-empty">Aucun CCTL classé en ${esc(yearLabel(my))} pour l'instant. <a href="#/cctl">Voir tous les CCTL</a>${myYear()?"":" · ou choisis ton année dans ton profil"}.</div>`):emptyCctl()}</section>`;
}
function statCard(label,value,icon,caption){return `<div class="stat-card"><div class="stat-top">${label}<span class="stat-symbol">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-caption">${caption}</div></div>`}

/* ===================== Liste des CCTL ===================== */
function renderCctlList(){
  const years=unique(S.docs.map(d=>d.year||0)).sort((a,b)=>(a||99)-(b||99));
  let f=S.yearFilter??(years.includes(myYear())?myYear():"all");
  if(f!=="all"&&!years.includes(f))f="all";
  const list=S.docs.filter(d=>f==="all"||(d.year||0)===f);
  const blocs=unique(list.map(blocOf)).sort((a,b)=>a==="Autres"?1:b==="Autres"?-1:a.localeCompare(b,"fr"));
  $("#appContent").innerHTML=`<div class="view-title"><div><div class="eyebrow muted">CHOISIS TON SUJET</div><h1>CCTL</h1><p>Organisés par année puis par bloc. ${myYear()?`Tu es en <b>${esc(yearLabel(myYear()))}</b>.`:""}</p></div></div>
  ${S.docs.length?`<div class="year-tabs">${years.map(y=>`<button class="chip ${f===y?"active":""}" data-year="${y}">${esc(yearLabel(y))}${y&&y===myYear()?" · mon année":""}</button>`).join("")}<button class="chip ${f==="all"?"active":""}" data-year="all">Toutes</button></div>
  ${blocs.map(b=>`<div class="eyebrow muted subject-head">${esc(b.toUpperCase())}</div><div class="cctl-grid">${list.filter(d=>blocOf(d)===b).sort((x,y)=>(x.year||99)-(y.year||99)||x.title.localeCompare(y.title,"fr")).map(cctlCard).join("")}</div>`).join("")}`:emptyCctl()}`;
  $$("[data-year]").forEach(b=>b.onclick=()=>{const v=b.dataset.year;S.yearFilter=v==="all"?"all":+v;renderCctlList()});
}
/* ===================== Détail d'un CCTL ===================== */
function renderDoc(id){
  const d=docById(id);if(!d){go("cctl");return}
  const st=docStats(d),[cls,icon]=SUBJECT_STYLE(d.subject);
  const hist=S.sessions.filter(s=>s.doc_id===d.id).slice(0,5);
  $("#appContent").innerHTML=`
  <button class="back-link" data-go="cctl">← Tous les CCTL</button>
  <div class="doc-head"><span class="subject-icon ${cls}">${icon}</span><div><div class="eyebrow muted">${d.year?esc(yearLabel(d.year))+" · ":""}${esc((d.bloc||d.subject).toUpperCase())}${d.mine?" · PERSO":""}</div><h1>${esc(d.title)}</h1><p>${esc(d.subject)} · ${st.total} questions · ${d.pages} pages</p></div>${canEditDoc(d)?`<button class="secondary-btn head-edit" data-edit="${d.id}">✎ Modifier</button>`:""}</div>
  <div class="doc-progress"><div class="progress-track"><div class="progress-fill" style="width:${pct(st.mastered,st.total)}%"></div></div>
    <div class="doc-legend"><span class="lg ok">● ${st.mastered} maîtrisées</span><span class="lg bad">● ${st.wrong} ratées</span><span class="lg none">● ${st.unseen} jamais vues</span>${st.seen?`<span class="lg">Réussite : ${st.rate} %</span>`:""}</div></div>
  <div class="mode-grid">
    ${Object.entries(MODES).map(([k,m])=>{
      const n=k==="quick"?Math.min(10,st.total):k==="exam"?st.total:st.toReview;
      const off=k==="revision"&&!n;
      return `<button class="mode-card ${off?"done":""}" data-mode="${k}" data-doc="${d.id}" ${off?"disabled":""}><div class="mode-ico">${m.icon}</div><h3>${m.label}</h3><p>${off?"Tout est validé 🎉 Rien à réviser.":m.desc}</p><span class="mode-count">${off?"":`${n} question${n>1?"s":""}`}</span></button>`}).join("")}
  </div>
  <div class="section-block"><div class="section-heading"><div><div class="eyebrow muted">CARTE DES QUESTIONS</div><h2>Où tu en es</h2></div><button class="text-btn" id="resetDoc">Remettre à zéro <span>↺</span></button></div>
    <div class="qmap">${d.questions.map(q=>{const p=P(d,q);const c=!p||!p.seen?"none":p.last_correct?"ok":"bad";return `<span class="qcell ${c}" title="Question ${q.num} · ${c==="ok"?"réussie":c==="bad"?"ratée":"jamais vue"}${p?` · ${p.correct}/${p.seen}`:""}">${q.num}</span>`}).join("")}</div></div>
  ${hist.length?`<div class="section-block"><div class="eyebrow muted" style="margin-bottom:10px">DERNIÈRES SESSIONS</div>${hist.map(sessionRow).join("")}</div>`:""}`;
  $("#resetDoc").onclick=()=>resetDocProgress(d);
}
function sessionRow(s){const d=docById(s.doc_id);return `<div class="progress-item"><div class="progress-label"><span>${esc(MODES[s.mode]?.label||s.mode)}${d?` · ${esc(d.title)}`:""}</span><span>${s.score}/${s.total} · ${pct(s.score,s.total)} %</span></div><div class="progress-track slim"><div class="progress-fill" style="width:${pct(s.score,s.total)}%"></div></div><div class="hist-date">${fmtDate(s.created_at)}</div></div>`}

/* ===================== Quiz ===================== */
function startQuiz(docId,mode){
  const d=docById(docId);if(!d)return;
  let qs=d.questions;
  if(mode==="quick")qs=shuffle(qs).slice(0,10);
  else if(mode==="exam")qs=shuffle(qs);
  else qs=shuffle(qs.filter(q=>{const p=P(d,q);return !p||!p.last_correct}));
  if(!qs.length){toast(mode==="revision"?"Tout est validé : rien à réviser !":"Aucune question.");return}
  S.quiz={doc:d,mode,queue:qs,pos:0,unique:qs.length,validated:new Set(),first:new Map(),tries:new Map(),selected:[],checked:false,lastOk:false};
  if(location.hash!=="#/quiz")history.pushState(null,"","#/quiz");
  $$(".nav-link").forEach(b=>b.classList.toggle("active",b.dataset.view==="cctl"));
  $("#crumb").textContent=`${d.title} · ${MODES[mode].label}`;
  renderQuestion();
}
function questionBody(q){
  return (q.blocks||[{t:"p",text:q.q}]).map(b=>b.t==="img"?(b.src?`<figure class="q-figure">${imgTag(b,"q-img",b.alt)}</figure>`:""):b.t==="code"?`<pre class="q-code">${esc(b.text)}</pre>`:`<p class="q-p">${txt(b.text)}</p>`).join("");
}
function renderQuestion(){
  const z=S.quiz,q=z.queue[z.pos],multi=q.a.length>1,rev=z.mode==="revision";
  const done=rev?z.validated.size:z.pos,total=z.unique;
  const again=rev&&(z.tries.get(q.num)||0)>(z.checked?1:0);
  $("#appContent").innerHTML=`<div class="quiz-wrap">
    <div class="view-title"><div><div class="eyebrow muted">${esc(z.doc.title.toUpperCase())} · ${MODES[z.mode].label.toUpperCase()}</div><h1>Question ${q.num}</h1>
      <p>${rev?`${total-done} question${total-done>1?"s":""} à valider${again?" · <span class='warn'>déjà ratée, retente !</span>":""}`:`${z.pos+1} / ${total}`}</p></div><button class="back-btn" id="quitQuiz">✕ Quitter</button></div>
    <div class="quiz-top"><span>${rev?"Validées":"Progression"}</span><span>${rev?`${done} / ${total}`:`${z.pos+1} / ${total}`}</span></div>
    <div class="progress-track"><div class="progress-fill" style="width:${rev?pct(done,total):(z.pos+1)/total*100}%"></div></div>
    <div class="question-card"><div class="question-meta"><span class="tag">Q${q.num}</span><span class="tag green">${multi?"Plusieurs réponses":"Une seule réponse"}</span>
      <button class="report-btn" id="reportBtn" title="Signaler une erreur sur cette question">⚑ Signaler</button></div>
    <div class="q-body">${questionBody(q)}</div><p class="question-hint">${multi?"Sélectionne toutes les bonnes réponses.":"Sélectionne la bonne réponse."}</p>
    <div class="answers">${q.o.map((o,i)=>answerHtml(o,i,z.selected,q,z.checked)).join("")}</div>
    ${z.checked?feedbackHtml(q,z.lastOk,rev):""}
    <div class="quiz-actions"><button class="secondary-btn" id="skipQuestion">${rev?"Plus tard":"Passer"}</button>
    ${z.checked?`<button class="primary-btn small" id="nextQuestion">${isLast()?"Voir mon résultat":"Question suivante"} <span>→</span></button>`:`<button class="primary-btn small" id="validateAnswer" ${z.selected.length?"":"disabled"}>Valider ma réponse <span>→</span></button>`}</div>
    </div></div>`;
  $("#quitQuiz").onclick=()=>{if(z.preview){S.quiz=null;go("profile");return}if(z.pos===0&&!z.checked||confirm("Quitter la session ? Tes réponses déjà données sont enregistrées."))go("doc/"+z.doc.id)};
  $("#skipQuestion").onclick=()=>advance(true);
  $("#reportBtn").onclick=()=>openReport(z.doc,q);
  if(!z.checked){
    $$(".answer").forEach(b=>b.onclick=()=>{const i=+b.dataset.index;z.selected=multi?(z.selected.includes(i)?z.selected.filter(x=>x!==i):[...z.selected,i]):[i];renderQuestion()});
    $("#validateAnswer").onclick=checkAnswer;
  }else $("#nextQuestion").onclick=()=>advance(false);
}
function isLast(){const z=S.quiz;if(z.mode==="revision")return z.lastOk&&z.validated.size===z.unique;return z.pos>=z.queue.length-1}
function answerHtml(o,i,selected,q,checked){
  const isSel=selected.includes(i),isCorrect=q.a.includes(i);
  let cls=isSel?"selected":"";if(checked)cls=isCorrect?"correct":(isSel?"wrong":"");
  const im=q.oImg?.[i];
  const body=im?`<span class="answer-img-wrap">${imgTag(im,"answer-img",o)}</span>`:String(o).includes("\n")?`<pre class="answer-code">${esc(o)}</pre>`:`<span>${esc(o)}</span>`;
  return `<button class="answer ${cls}" data-index="${i}" ${checked?"disabled":""}><span class="answer-key">${letters[i]}</span>${body}${checked&&isCorrect?'<span class="ans-ok">✓</span>':""}</button>`;
}
function feedbackHtml(q,ok,rev){
  const expl=q.eImg?`<div class="feedback-img">${imgTag(q.eImg,"q-img","Commentaire de correction")}</div>`:q.e?`<div class="feedback-text">${esc(q.e)}</div>`:`<div class="feedback-text muted">Pas de commentaire de correction dans le PDF. Bonne(s) réponse(s) : ${q.a.map(i=>letters[i]).join(", ")}.</div>`;
  return `<div class="feedback ${ok?"":"bad"}"><strong>${ok?"✓ Bonne réponse !":"✕ Pas tout à fait."}${rev&&!ok?" Elle reviendra plus tard dans la session.":""}</strong>${expl}<div class="fb-src">Source : ${esc(q.src)}</div></div>`;
}
function checkAnswer(){
  const z=S.quiz,q=z.queue[z.pos];
  const ok=z.selected.length===q.a.length&&q.a.every(a=>z.selected.includes(a));
  z.checked=true;z.lastOk=ok;
  if(!z.first.has(q.num))z.first.set(q.num,ok);
  z.tries.set(q.num,(z.tries.get(q.num)||0)+1);
  if(ok)z.validated.add(q.num);
  recordAnswer(z.doc,q,ok);
  renderQuestion();
}
function advance(skipped){
  const z=S.quiz,q=z.queue[z.pos];
  if(z.preview){S.quiz=null;go("profile");return}
  if(z.mode==="revision"){
    if(skipped||!z.lastOk){                          // remise en fin de file (plus loin si possible)
      const rest=z.queue.length-z.pos-1, at=z.pos+1+Math.min(rest,3+Math.floor(Math.random()*3));
      z.queue.splice(at,0,q);
    }
    if(!skipped&&z.lastOk&&z.validated.size===z.unique)return finishQuiz();
  }else if(skipped&&!z.first.has(q.num))z.first.set(q.num,false);
  z.pos++;z.selected=[];z.checked=false;z.lastOk=false;
  if(z.pos>=z.queue.length)return finishQuiz();
  renderQuestion();window.scrollTo({top:0});
}
async function finishQuiz(){
  const z=S.quiz,total=z.unique,score=[...z.first.values()].filter(Boolean).length;
  const rev=z.mode==="revision";
  const row={doc_id:z.doc.id,mode:z.mode,score,total,created_at:new Date().toISOString()};
  S.sessions.unshift(row);
  api("/rest/v1/cctl_sessions",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({doc_id:row.doc_id,mode:row.mode,score,total})}).catch(e=>console.warn(e));
  const st=docStats(z.doc);
  $("#crumb").textContent="Résultat";
  $("#appContent").innerHTML=`<div class="result-card"><div class="eyebrow muted" style="justify-content:center;margin-bottom:17px">${esc(z.doc.title.toUpperCase())} · ${MODES[z.mode].label.toUpperCase()}</div>
  <div class="result-ring"><strong>${pct(score,total)}%</strong></div>
  <h2>${rev?"Révision terminée 🎉":score===total?"Excellent travail !":score>=total*.7?"Bien joué !":"Continue tes efforts !"}</h2>
  <p>${rev?`Les ${total} question${total>1?"s":""} sont validées. Tu en as réussi <b>${score}</b> du premier coup.`:`Tu as obtenu <b>${score} bonne${score>1?"s":""} réponse${score>1?"s":""} sur ${total}</b>.`}<br>Sur ce CCTL : ${st.mastered}/${st.total} questions maîtrisées.</p>
  <div class="result-actions">
    ${st.toReview?`<button class="primary-btn" data-mode="revision" data-doc="${z.doc.id}">Réviser mes erreurs (${st.toReview}) <span>↻</span></button>`:""}
    <button class="${st.toReview?"secondary-btn":"primary-btn"}" data-mode="${z.mode==="revision"?"quick":z.mode}" data-doc="${z.doc.id}">${rev?"QCM rapide":"Recommencer"}</button>
    <button class="secondary-btn" data-go="doc/${z.doc.id}">Retour au CCTL</button></div></div>`;
  S.quiz=null;history.replaceState(null,"","#/doc/"+z.doc.id+"/done");
}

/* ---------- Signalement ---------- */
function openReport(doc,q){
  ask({title:`Signaler la question ${q.num}`,html:`<p class="ask-p muted">${esc(doc.title)}</p>
    <div class="modal-label">Quel est le problème ?</div>
    <div class="reason-list">${REPORT_REASONS.map((r,i)=>`<label class="reason"><input type="radio" name="reason" value="${esc(r)}" ${i?"":"checked"}><span>${esc(r)}</span></label>`).join("")}</div>
    <div class="modal-label">Précisions <span class="muted">(facultatif)</span></div><textarea id="reportComment" rows="3" placeholder="Ex. : la bonne réponse devrait être C car…"></textarea>`,
    buttons:[{label:"Annuler",value:""},{label:"Envoyer le signalement",value:"send",primary:true}],
    collect:w=>({reason:$("input[name=reason]:checked",w).value,comment:$("#reportComment",w).value.trim()})
  }).then(async r=>{
    if(r?.value!=="send")return;
    try{await api("/rest/v1/cctl_reports",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({doc_id:doc.id,qnum:q.num,reason:r.data.reason,comment:r.data.comment})});toast("Merci ! Le signalement a été envoyé à l'administrateur.")}
    catch(e){toast("Envoi impossible : "+e.message)}
  });
}

/* ---------- Boîte de dialogue générique ---------- */
function ask({title,html,buttons,collect}){
  return new Promise(res=>{
    $("#modal")?.remove();
    const w=document.createElement("div");w.className="modal-backdrop";w.id="modal";
    w.innerHTML=`<div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h3>${esc(title)}</h3><button class="modal-close" data-v="" aria-label="Fermer">✕</button></div>
      <div class="ask-body">${html}</div><div class="modal-actions">${buttons.map(b=>`<button class="${b.primary?"primary-btn small":"secondary-btn"}" data-v="${esc(b.value)}">${b.label}</button>`).join("")}</div></div>`;
    document.body.appendChild(w);
    const end=v=>{const data=collect&&v?collect(w):null;w.remove();document.removeEventListener("keydown",k);res(collect?{value:v,data}:v)};
    const k=e=>{if(e.key==="Escape")end("")};document.addEventListener("keydown",k);
    $$("[data-v]",w).forEach(b=>b.onclick=()=>end(b.dataset.v));
    w.addEventListener("click",e=>{if(e.target===w)end("")});
  });
}

/* ===================== Ma progression ===================== */
function renderProgress(){
  const rows=S.docs.map(d=>({d,s:docStats(d)}));
  const T=rows.reduce((t,{s})=>({q:t.q+s.total,m:t.m+s.mastered,w:t.w+s.wrong}),{q:0,m:0,w:0});
  const allSeen=Object.values(S.prog).reduce((a,p)=>a+p.seen,0),allOk=Object.values(S.prog).reduce((a,p)=>a+p.correct,0);
  $("#appContent").innerHTML=`<div class="view-title"><div><div class="eyebrow muted">TON ÉVOLUTION</div><h1>Ma progression</h1><p>Enregistrée dans ton compte : tu la retrouves sur tous tes appareils.</p></div></div>
  <div class="stats-grid">${statCard("Questions maîtrisées",`${T.m} / ${T.q}`,"✓",`${pct(T.m,T.q)} % de la banque`)}${statCard("À revoir",T.w,"↻","Questions ratées")}${statCard("Taux de réussite",pct(allOk,allSeen)+"%","↗",`${allSeen} réponses`)}${statCard("Sessions",S.sessions.length,"◷","QCM terminés")}</div>
  <div class="stats-panels"><div class="panel"><div class="eyebrow muted">PAR CCTL</div><h3>Maîtrise de chaque sujet</h3>
    ${rows.length?rows.map(({d,s})=>`<button class="progress-item prog-link" data-go="doc/${d.id}"><div class="progress-label"><span>${esc(d.title)}</span><span>${s.mastered}/${s.total}${s.wrong?` · <span class="warn">${s.wrong} à revoir</span>`:""}</span></div><div class="progress-track slim"><div class="progress-fill" style="width:${pct(s.mastered,s.total)}%"></div></div></button>`).join(""):'<div class="recent-empty">Aucun CCTL pour l\'instant.</div>'}</div>
  <div class="panel"><div class="eyebrow muted">HISTORIQUE</div><h3>Dernières sessions</h3>${S.sessions.length?S.sessions.slice(0,12).map(sessionRow).join(""):'<div class="recent-empty">Aucune session pour le moment.</div>'}</div></div>`;
}

/* ===================== Mes CCTL (import) ===================== */
function fpHash(str){let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
const norm=t=>String(t||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,"");
const fingerprints=qs=>new Set(qs.map(q=>fpHash(norm(q.q)+"|"+q.o.map(norm).join("|"))));
function findSimilar(questions){
  const mine=fingerprints(questions);let best=null;
  for(const d of S.docs){
    const other=fingerprints(d.questions);let same=0;for(const f of mine)if(other.has(f))same++;
    const ratio=same/Math.max(1,Math.min(mine.size,other.size));
    if(ratio>=0.6&&(!best||ratio>best.ratio))best={doc:d,same,ratio,total:mine.size};
  }
  return best;
}
const where=d=>d.mine?"dans tes CCTL perso":"partagé avec tout le monde";
async function importFiles(files){
  const pdfs=[...files].filter(f=>/\.pdf$/i.test(f.name)||f.type==="application/pdf");
  if(!pdfs.length){toast("Choisis un ou plusieurs fichiers PDF.");return}
  for(const f of pdfs){
    try{
      const buf=await f.arrayBuffer(),sha=await sha256(buf.slice(0));
      const same=S.docs.find(d=>d.sha===sha);
      if(same){await ask({title:"Déjà importé",html:`<p class="ask-p"><b>${esc(f.name)}</b> est déjà importé : c'est exactement le même fichier que <b>${esc(same.title)}</b>, ${where(same)}.</p>`,buttons:[{label:"OK",value:"",primary:true}]});continue}
      const r=await parsePdf(buf.slice(0),{fileName:f.name,onProgress:({step,page,pages})=>setBusy(`${f.name} : ${step==="texte"?"lecture":step==="schémas"?"recherche des schémas":"découpe des images"} ${page}/${pages}`)});
      setBusy(null);
      const sim=findSimilar(r.questions);
      const warn=sim?`<div class="ask-warn">⚠ Ce CCTL semble <b>déjà présent</b> : ${sim.same} question(s) sur ${sim.total} sont identiques à <b>${esc(sim.doc.title)}</b>, ${where(sim.doc)}. L'importer créerait des questions en double.</div>`:"";
      const res=await ask({title:sim?"CCTL déjà présent ?":"Ajouter ce CCTL",
        html:`${warn}<p class="ask-p">${r.questions.length} questions détectées. Vérifie le classement :</p>${docFields({title:r.title,year:r.year??myYear(),bloc:r.bloc,subject:r.subject})}
          <p class="ask-note">${isAdmin()?"« Partager » le rend disponible pour tous les membres. « Perso » le garde visible pour toi seul.":"Il sera enregistré dans ton compte, visible par toi seul."} Le PDF lui-même (avec le nom et les notes) n'est jamais envoyé, seulement les questions.</p>`,
        buttons:[{label:"Annuler",value:""},{label:sim?"Ajouter quand même (perso)":"Ajouter à mes CCTL perso",value:"private",primary:!isAdmin()},...(isAdmin()?[{label:"Partager avec tous ↗",value:"shared",primary:true}]:[])],
        collect:readDocFields});
      const v=res.value,meta=res.data;
      if(!v){toast("Import annulé.");continue}
      if(!meta.title){toast("Le titre ne peut pas être vide.");continue}
      setBusy(`Enregistrement de « ${meta.title} »…`);
      const [row]=await api(`/rest/v1/cctl_docs?select=${DOC_COLS}`,{method:"POST",headers:{Prefer:"return=representation"},
        body:JSON.stringify({sha,...meta,file_name:f.name,pages:r.pages,questions:r.questions,parser_version:PARSER_VERSION,visibility:v,owner:S.session.user.id})});
      cachePut({id:row.id,sha,parser_version:PARSER_VERSION,questions:r.questions});
      S.docs.push(makeDoc(row,r.questions));
      toast(`${r.questions.length} questions ajoutées${v==="shared"?" pour tout le monde":""} !`);
    }catch(e){console.error(e);const m=e.status===409?"ce PDF est déjà enregistré":e.message;S.errors.push(`${f.name} : ${m}`);toast(`« ${f.name} » : ${m}`)}
  }
  setBusy(null);if(route().view==="library")renderLibrary();
}
const canEditDoc=d=>d&&(d.mine||isAdmin());
function docFields(m){
  const blocs=unique(["Sciences fondamentales",...S.docs.map(d=>d.bloc).filter(Boolean),m.bloc].filter(Boolean));
  const subs=unique(["Mathématiques","Sciences du numérique",...S.docs.map(d=>d.subject),m.subject].filter(Boolean));
  return `<div class="doc-fields">
    <label class="df-wide">Nom du CCTL<input name="df_title" value="${esc(m.title)}" maxlength="120" required></label>
    <label>Année<select name="df_year">${yearOptions(m.year)}</select></label>
    <label>Bloc<input name="df_bloc" value="${esc(m.bloc||"")}" list="dfBlocs" placeholder="ex. Sciences fondamentales" maxlength="80"></label>
    <label class="df-wide">Matière<input name="df_subject" value="${esc(m.subject||"")}" list="dfSubjects" maxlength="80"></label>
    <datalist id="dfBlocs">${blocs.map(b=>`<option value="${esc(b)}">`).join("")}</datalist>
    <datalist id="dfSubjects">${subs.map(b=>`<option value="${esc(b)}">`).join("")}</datalist></div>`;
}
const readDocFields=w=>({title:$("[name=df_title]",w).value.trim(),year:$("[name=df_year]",w).value?+$("[name=df_year]",w).value:null,bloc:$("[name=df_bloc]",w).value.trim(),subject:$("[name=df_subject]",w).value.trim()});
async function editDoc(d){
  const r=await ask({title:"Modifier le CCTL",html:`${docFields(d)}${!d.mine?`<p class="ask-note">Les changements s'appliquent pour tous les membres.</p>`:""}`,
    buttons:[{label:"Annuler",value:""},{label:"Enregistrer",value:"save",primary:true}],collect:readDocFields});
  if(r.value!=="save")return;
  if(!r.data.title)return toast("Le titre ne peut pas être vide.");
  try{
    const [row]=await api(`/rest/v1/cctl_docs?id=eq.${d.id}&select=${DOC_COLS}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(r.data)});
    Object.assign(d,row,{mine:row.visibility==="private"});toast("CCTL mis à jour.");
  }catch(e){toast("Impossible : "+e.message)}
  render();
}
async function docAction(d,action,value){
  try{
    if(action==="delete"){
      if(!confirm(d.mine?`Supprimer « ${d.title} » de tes CCTL ?`:`Retirer « ${d.title} » pour tout le monde ? La progression des membres sur ce CCTL sera perdue.`))return;
      await api(`/rest/v1/cctl_docs?id=eq.${d.id}`,{method:"DELETE"});S.docs=S.docs.filter(x=>x.id!==d.id);toast("CCTL supprimé.");
    }else{
      const patch=action==="share"?{visibility:"shared"}:{subject:value};
      const [row]=await api(`/rest/v1/cctl_docs?id=eq.${d.id}&select=${DOC_COLS}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(patch)});
      Object.assign(d,row,{mine:row.visibility==="private"});toast(action==="share"?"Partagé avec tout le monde !":"Matière modifiée.");
    }
  }catch(e){toast("Impossible : "+(e.status===409?"ce CCTL est déjà partagé":e.message))}
  renderLibrary();
}
function libCard(d){
  const st=docStats(d),canEdit=canEditDoc(d);
  return `<div class="doc-card"><div class="doc-ico">PDF</div>
    <div class="doc-main"><h3>${esc(d.title)}</h3>
      <p><b class="yr">${esc(yearLabel(d.year))}</b> · ${esc(d.bloc||"Sans bloc")} · ${esc(d.subject||"—")}</p>
      <p class="muted">${st.total} questions · ${d.pages} pages · ${esc(d.file_name)}</p></div>
    <div class="doc-actions"><button class="primary-btn small" data-go="doc/${d.id}">Ouvrir <span>→</span></button>
      ${canEdit?`<button class="secondary-btn" data-edit="${d.id}">✎ Modifier</button>`:""}
      ${d.mine&&isAdmin()?`<button class="secondary-btn pub-btn" data-act="share" data-id="${d.id}">Partager avec tous ↗</button>`:""}
      ${canEdit?`<button class="secondary-btn" data-act="delete" data-id="${d.id}">${d.mine?"Supprimer":"Retirer"}</button>`:""}</div></div>`;
}
function renderLibrary(){
  const ord=(a,b)=>(a.year||99)-(b.year||99)||blocOf(a).localeCompare(blocOf(b),"fr")||a.title.localeCompare(b.title,"fr");
  const mine=S.docs.filter(d=>d.mine).sort(ord),shared=S.docs.filter(d=>!d.mine).sort(ord);
  $("#appContent").innerHTML=`<div class="view-title"><div><div class="eyebrow muted">IMPORT</div><h1>Mes CCTL</h1><p>Dépose un PDF de correction : les questions, réponses, explications et schémas sont créés automatiquement.</p></div></div>
  <label class="dropzone" id="dropzone"><input type="file" id="fileInput" accept="application/pdf,.pdf" multiple hidden>
    <div class="drop-ico">⇪</div><strong>Glisse tes PDF ici</strong><span>ou clique pour les choisir</span>
    <small>Le PDF est analysé dans ton navigateur. Seules les questions sont enregistrées dans ton compte${isAdmin()?", ou partagées avec tout le monde":""}.</small></label>
  ${S.errors.length?`<div class="import-errors">${S.errors.slice(-3).map(e=>`<div>⚠ ${esc(e)}</div>`).join("")}</div>`:""}
  <div class="section-block"><div class="eyebrow muted" style="margin-bottom:10px">MES CCTL PERSO · VISIBLES PAR MOI SEUL</div>
    ${mine.length?mine.map(libCard).join(""):'<div class="recent-empty">Aucun CCTL perso pour l\'instant.</div>'}</div>
  <div class="section-block"><div class="eyebrow muted" style="margin-bottom:10px">CCTL PARTAGÉS AVEC TOUT LE MONDE${isAdmin()?" · TU PEUX LES GÉRER":""}</div>
    ${shared.length?shared.map(libCard).join(""):'<div class="recent-empty">Aucun CCTL partagé.</div>'}</div>
`;
  const dz=$("#dropzone"),fi=$("#fileInput");
  fi.onchange=()=>{importFiles(fi.files);fi.value=""};
  ["dragenter","dragover"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add("over")}));
  ["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove("over")}));
  dz.addEventListener("drop",e=>importFiles(e.dataTransfer.files));
  $$("[data-act]").forEach(b=>b.onclick=()=>docAction(docById(b.dataset.id),b.dataset.act));
}

/* ===================== Profil ===================== */
function renderProfile(){
  const p=S.profile;
  $("#appContent").innerHTML=`<div class="view-title"><div><div class="eyebrow muted">TON COMPTE</div><h1>Profil</h1></div></div>
  <div class="profile-card"><div class="profile-avatar">${esc(p.username[0].toUpperCase())}</div><div><h2>${esc(p.username)}</h2><p>${isAdmin()?'<span class="pill admin">Administrateur</span>':'<span class="pill">Membre</span>'} · inscrit le ${fmtDate(p.created_at)}</p></div>
    <button class="secondary-btn" id="logoutBtn">Se déconnecter</button></div>
  <div class="stats-panels"><div class="panel"><div class="eyebrow muted">SÉCURITÉ</div><h3>Changer de mot de passe</h3>
    <form id="pwForm" class="auth-form compact"><input name="pw" type="password" placeholder="Nouveau mot de passe (8 caractères min.)" autocomplete="new-password" minlength="8" required><input name="pw2" type="password" placeholder="Confirmation" autocomplete="new-password" minlength="8" required><button class="primary-btn small" type="submit">Mettre à jour</button></form></div>
  <div class="panel"><div class="eyebrow muted">FORMATION</div><h3>Mon année</h3>
    <div class="year-row"><select id="myYear">${yearOptions(myYear())}</select><button class="primary-btn small" id="saveYear">Enregistrer</button></div>
    <p class="ask-note">${myYear()?(myYear()<MAX_YEAR?`Tu passeras automatiquement en <b>${esc(yearLabel(myYear()+1))}</b> le 1er septembre ${acadStart()+1}.`:"Tu es en dernière année."):"Choisis ton année pour voir en priorité les CCTL qui te concernent."} En cas de redoublement, corrige-la ici.</p>
    <div class="eyebrow muted" style="margin-top:18px">TES CHIFFRES</div>
    <div class="mini-stats"><div><b>${S.docs.length}</b><span>CCTL</span></div><div><b>${Object.values(S.prog).filter(x=>x.last_correct).length}</b><span>maîtrisées</span></div><div><b>${S.sessions.length}</b><span>sessions</span></div></div></div></div>
  ${isAdmin()?`<div id="adminZone"><div class="section-block"><div class="eyebrow muted">ADMINISTRATION</div><div class="recent-empty">Chargement…</div></div></div>`:""}`;
  $("#logoutBtn").onclick=logout;
  $("#saveYear").onclick=async()=>{const v=$("#myYear").value?+$("#myYear").value:null;
    try{await rpc("cctl_set_my_year",{p_year:v},false);S.profile.year=v;S.profile.year_set_at=acadStart();S.yearFilter=undefined;toast(v?`Année enregistrée : ${yearLabel(v)}.`:"Année retirée.");renderProfile()}
    catch(e){toast("Impossible : "+e.message)}};
  $("#pwForm").onsubmit=async e=>{e.preventDefault();const f=e.target;
    if(f.pw.value!==f.pw2.value)return toast("Les deux mots de passe ne correspondent pas.");
    try{await api("/auth/v1/user",{method:"PUT",body:JSON.stringify({password:f.pw.value})});f.reset();toast("Mot de passe mis à jour.")}catch(x){toast("Impossible : "+x.message)}};
  if(isAdmin())loadAdmin();
}
async function loadAdmin(){
  try{
    const [inv,mem,rep]=await Promise.all([
      api("/rest/v1/cctl_invites?select=*&order=created_at.desc"),
      api("/rest/v1/cctl_profiles?select=id,username,role,created_at,invite_code,year,year_set_at&order=created_at"),
      api("/rest/v1/cctl_reports?select=*&resolved=eq.false&order=created_at.desc"),
    ]);
    S.admin={invites:inv,members:mem,reports:rep};renderAdmin();
  }catch(e){$("#adminZone").innerHTML=`<div class="import-errors">⚠ Administration indisponible : ${esc(e.message)}</div>`}
}
const inviteLink=c=>`${location.origin}${location.pathname}?invite=${c}`;
function inviteState(i){if(i.revoked)return ["Révoqué","bad"];if(i.expires_at&&new Date(i.expires_at)<new Date())return ["Expiré","bad"];if(i.max_uses!=null&&i.uses>=i.max_uses)return ["Utilisé","none"];return ["Actif","ok"]}
function renderAdmin(){
  const {invites,members,reports}=S.admin,uname=id=>members.find(m=>m.id===id)?.username||"?";
  $("#adminZone").innerHTML=`
  <div class="section-block"><div class="section-heading"><div><div class="eyebrow muted">ADMINISTRATION</div><h2>Liens d'invitation</h2></div></div>
    <div class="panel"><form id="invForm" class="inv-form">
      <input name="note" placeholder="Pour qui ? (ex. groupe TD, Enzo…)" maxlength="60">
      <select name="uses"><option value="1">1 personne</option><option value="5">5 personnes</option><option value="20">20 personnes</option><option value="">Illimité</option></select>
      <select name="exp"><option value="7">Expire dans 7 jours</option><option value="30">Expire dans 30 jours</option><option value="">N'expire pas</option></select>
      <button class="primary-btn small" type="submit">Créer un lien <span>+</span></button></form>
    <div class="inv-list">${invites.length?invites.map(i=>{const [lab,c]=inviteState(i);return `<div class="inv-row">
      <div class="inv-main"><b>${esc(i.note||"Invitation")}</b><small><span class="lg ${c}">● ${lab}</span> · ${i.uses}${i.max_uses!=null?"/"+i.max_uses:""} utilisation${i.uses>1?"s":""}${i.expires_at?` · jusqu'au ${fmtDate(i.expires_at)}`:""}</small><code class="inv-link">${esc(inviteLink(i.code))}</code></div>
      <div class="inv-actions">${c==="ok"?`<button class="secondary-btn" data-copy="${esc(i.code)}">Copier le lien</button><button class="secondary-btn" data-revoke="${esc(i.code)}">Révoquer</button>`:`<button class="secondary-btn" data-delinv="${esc(i.code)}">Supprimer</button>`}</div></div>`}).join(""):'<div class="recent-empty">Aucun lien pour l\'instant. Crée-en un et envoie-le aux personnes que tu veux inviter.</div>'}</div></div></div>
  <div class="section-block"><div class="eyebrow muted" style="margin-bottom:10px">SIGNALEMENTS EN ATTENTE (${reports.length})</div>
    ${reports.length?reports.map(r=>{const d=docById(r.doc_id);return `<div class="inv-row"><div class="inv-main"><b>${esc(d?.title||"CCTL supprimé ou privé")} · Q${r.qnum}</b><small>${esc(r.reason)} · par ${esc(uname(r.user_id))} · ${fmtDate(r.created_at)}</small>${r.comment?`<p class="rep-comment">« ${esc(r.comment)} »</p>`:""}</div>
      <div class="inv-actions">${d?`<button class="secondary-btn" data-see="${d.id}:${r.qnum}">Voir la question</button>`:""}<button class="primary-btn small" data-resolve="${r.id}">Traité ✓</button></div></div>`}).join(""):'<div class="recent-empty">Aucun signalement en attente.</div>'}</div>
  <div class="section-block"><div class="eyebrow muted" style="margin-bottom:10px">MEMBRES (${members.length})</div>
    ${members.map(m=>`<div class="inv-row"><div class="inv-main"><b>${esc(m.username)}</b> ${m.role==="admin"?'<span class="pill admin">Admin</span>':""}<small>${m.year?esc(yearLabel(curYear(m)))+" · ":""}inscrit le ${fmtDate(m.created_at)}</small></div>
      <div class="inv-actions">${m.id!==S.profile.id?`<button class="secondary-btn" data-kick="${m.id}">Retirer l'accès</button>`:""}</div></div>`).join("")}</div>`;
  $("#invForm").onsubmit=async e=>{e.preventDefault();const f=e.target;
    const days=f.exp.value?+f.exp.value:null,code=randCode();
    try{await api("/rest/v1/cctl_invites",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({code,note:f.note.value.trim(),max_uses:f.uses.value?+f.uses.value:null,expires_at:days?new Date(Date.now()+days*864e5).toISOString():null})});
      try{await navigator.clipboard.writeText(inviteLink(code));toast("Lien créé et copié dans le presse-papiers !")}catch{toast("Lien créé.")}loadAdmin()}
    catch(x){toast("Impossible : "+x.message)}};
  $$("[data-copy]").forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(inviteLink(b.dataset.copy));toast("Lien copié !")}catch{toast("Copie impossible : sélectionne le lien à la main.")}});
  const act=async(fn,msg)=>{try{await fn();toast(msg);loadAdmin()}catch(x){toast("Impossible : "+x.message)}};
  $$("[data-revoke]").forEach(b=>b.onclick=()=>act(()=>api(`/rest/v1/cctl_invites?code=eq.${encodeURIComponent(b.dataset.revoke)}`,{method:"PATCH",body:JSON.stringify({revoked:true})}),"Lien révoqué."));
  $$("[data-delinv]").forEach(b=>b.onclick=()=>act(()=>api(`/rest/v1/cctl_invites?code=eq.${encodeURIComponent(b.dataset.delinv)}`,{method:"DELETE"}),"Lien supprimé."));
  $$("[data-resolve]").forEach(b=>b.onclick=()=>act(()=>api(`/rest/v1/cctl_reports?id=eq.${b.dataset.resolve}`,{method:"PATCH",body:JSON.stringify({resolved:true})}),"Signalement traité."));
  $$("[data-kick]").forEach(b=>b.onclick=()=>{const m=S.admin.members.find(x=>x.id===b.dataset.kick);if(confirm(`Retirer l'accès de ${m.username} ? Il ne pourra plus se connecter au site.`))act(()=>api(`/rest/v1/cctl_profiles?id=eq.${m.id}`,{method:"DELETE"}),"Accès retiré.")});
  $$("[data-see]").forEach(b=>b.onclick=()=>{const [id,n]=b.dataset.see.split(":"),d=docById(id),q=d.questions.find(x=>x.num===+n);if(!q)return;
    S.quiz={doc:d,mode:"exam",queue:[q],pos:0,unique:1,validated:new Set(),first:new Map(),tries:new Map(),selected:[...q.a],checked:true,lastOk:true,preview:true};history.pushState(null,"","#/quiz");renderQuestion()});
}

/* ===================== Démarrage ===================== */
function bind(){
  $$(".nav-link").forEach(b=>b.onclick=()=>go(b.dataset.view));
  $("#menuBtn").onclick=()=>$("#sidebar").classList.toggle("open");
  $(".brand").onclick=e=>{e.preventDefault();go("home")};
  $("#avatarBtn").onclick=()=>go("profile");
  document.addEventListener("click",e=>{
    const g=e.target.closest("[data-go]");if(g){e.preventDefault();go(g.dataset.go);return}
    const ed=e.target.closest("[data-edit]");if(ed){editDoc(docById(ed.dataset.edit));return}
    const m=e.target.closest("[data-mode]");if(m&&!m.disabled){startQuiz(m.dataset.doc,m.dataset.mode)}
  });
  window.addEventListener("hashchange",()=>{if(route().view!=="quiz"||!S.quiz)render()});
  window.addEventListener("popstate",()=>{if(S.quiz&&route().view!=="quiz"){S.quiz=null;render()}});
  document.addEventListener("dragover",e=>{if(S.loaded&&[...e.dataTransfer.types].includes("Files"))e.preventDefault()});
  document.addEventListener("drop",e=>{if(!S.loaded||e.target.closest("#dropzone"))return;if(e.dataTransfer.files.length){e.preventDefault();go("library");importFiles(e.dataTransfer.files)}});
}
async function boot(){
  if(!SB_ON||!S.session)return showAuth();
  $("#auth").hidden=true;$("#app").hidden=false;
  $("#appContent").innerHTML=`<div class="empty-state">Chargement de ton espace…</div>`;
  try{if(!(await loadAll()))return}
  catch(e){console.error(e);if(!S.session)return;
    $("#appContent").innerHTML=`<div class="import-errors">⚠ Impossible de joindre la base (${esc(e.message)}). Si le projet Supabase est en pause, relance-le depuis supabase.com, puis recharge la page.</div>`;setBusy(null);return}
  $("#userChip").innerHTML=`<span class="uc-avatar">${esc(S.profile.username[0].toUpperCase())}</span><span><b>${esc(S.profile.username)}</b><small>${isAdmin()?"Administrateur":"Membre"}</small></span>`;
  $("#avatarBtn").textContent=S.profile.username[0].toUpperCase();
  if(new URLSearchParams(location.search).has("invite"))history.replaceState(null,"",location.pathname+location.hash);
  if(route().view==="quiz")history.replaceState(null,"","#/home");
  render();
}
bind();boot();
