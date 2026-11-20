import { parsePdf, sha256, PARSER_VERSION } from "./pdf-import.js";

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
let DOCS = [];        // documents (PDF convertis)
let QUESTIONS = [];   // questions jouables, toutes sources confondues
let state = {view:"home", quiz:null, stats:loadStats(), siteStatus:"idle", busy:null, errors:[]};
const letters = ["A","B","C","D","E","F","G","H"];

/* ===== Signalement des questions =====
   Les signalements ouvrent une "issue" pré-remplie sur le dépôt GitHub du site.
   Sur GitHub Pages (pseudo.github.io/depot), le dépôt est détecté automatiquement.
   Pour forcer un dépôt, renseigne repo, ex. : "pseudo/cctl-trainer".
   email (facultatif) : adresse utilisée en secours quand aucun dépôt n'est trouvé. */
const REPORT_CONFIG = { repo: "", email: "" };
/* ===== Base partagée Supabase =====
   Colle ici l'URL et la clé « anon public » de ton projet (Project Settings → API).
   La clé anon est faite pour être publique : la sécurité est assurée par les règles (RLS) du script supabase.sql. */
const SUPABASE_URL = "";        // ex. "https://abcdefgh.supabase.co"
const SUPABASE_ANON_KEY = "";   // ex. "eyJhbGciOi..."
/* Dossier du dépôt lu automatiquement : tout PDF déposé dedans devient des questions. */
const PDF_FOLDER = "pdf";
const REPORT_REASONS = ["Bonne réponse incorrecte","Énoncé faux ou incomplet","Schéma / formule / code manquant ou illisible","Explication fausse ou peu claire","Faute de frappe","Autre"];

function esc(t){return String(t??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c])}
function txt(t){return esc(t).replace(/\n/g,"<br>")}
function loadJSON(k,d){try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}}
function saveJSON(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}
const loadReported=()=>loadJSON("cctlTrainerReports",{}), saveReported=r=>saveJSON("cctlTrainerReports",r);
function loadStats(){return loadJSON("cctlTrainerStats",null)||{answered:0,correct:0,sessions:[],topic:{}}}
function saveStats(){saveJSON("cctlTrainerStats",state.stats)}
function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),2600)}
function pct(a,b){return b?Math.round(a/b*100):0}
function shuffle(arr){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function unique(a){return [...new Set(a)]}
const imgTag=(im,cls,alt="",zoom=1.15)=>im&&im.src?`<img class="${cls}" src="${im.src}" alt="${esc(alt)}" style="width:${im.w?Math.round(im.w*zoom)+"px":"auto"}">`:"";

/* ===================== Stockage local (IndexedDB) ===================== */
const DB_NAME="cctlTrainer", STORE="docs";
function idb(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:"key"});r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function dbTx(mode,fn){const db=await idb();return new Promise((res,rej)=>{const tx=db.transaction(STORE,mode),st=tx.objectStore(STORE);const out=fn(st);tx.oncomplete=()=>res(out?.result??out);tx.onerror=()=>rej(tx.error)})}
const dbAll=()=>dbTx("readonly",st=>st.getAll());
const dbPut=rec=>dbTx("readwrite",st=>{st.put(rec)});
const dbDel=key=>dbTx("readwrite",st=>{st.delete(key)});

/* ===================== Banque de questions ===================== */
function subjectOf(doc){return loadJSON("cctlSubjects",{})[doc.key]||doc.subject}
function rebuild(){
  const rank={db:0,site:1,local:2};DOCS.sort((a,b)=>(rank[a.source]-rank[b.source])||a.title.localeCompare(b.title,"fr"));
  const seen=new Set();QUESTIONS=[];
  for(const d of DOCS){
    const subject=subjectOf(d);
    for(const q of d.questions){
      if(!q.a?.length)continue;                       // pas de bonne réponse dans le PDF
      let id=q.id;if(seen.has(id))id=`${q.id}-${d.sha.slice(0,6)}`;seen.add(id);
      QUESTIONS.push({...q,id,subject,docKey:d.key,doc:d.title});
    }
  }
}
function refreshView(){
  if(["home","practice","topics","library"].includes(state.view))setView(state.view,true);
  updateStatus();
}
function updateStatus(){
  const el=$(".status-text"),dot=$(".status-dot");if(!el)return;
  if(state.busy){el.textContent=state.busy;dot.classList.add("busy")}
  else{el.textContent=QUESTIONS.length?`${QUESTIONS.length} questions · progression sauvegardée`:"Aucun PDF importé";dot.classList.remove("busy")}
  const box=$("#importProgress");if(box)box.innerHTML=state.busy?`<div class="import-busy"><span class="spinner"></span>${esc(state.busy)}</div>`:"";
}

/* Analyse d'un PDF, avec cache */
async function convert(buf,fileName,label){
  return parsePdf(buf,{fileName,onProgress:({step,page,pages})=>{
    state.busy=`${label} : ${step==="texte"?"lecture":step==="schémas"?"recherche des schémas":"découpe des images"} ${page}/${pages}`;updateStatus();
  }});
}
/* ---------- Doublons ---------- */
function fpHash(str){let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
const norm=t=>String(t||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,"");
const fingerprints=qs=>new Set(qs.map(q=>fpHash(norm(q.q)+"|"+q.o.map(norm).join("|"))));
function findSimilar(questions,exceptKey){
  const mine=fingerprints(questions);let best=null;
  for(const d of DOCS){
    if(d.key===exceptKey)continue;
    const other=fingerprints(d.questions);let same=0;for(const f of mine)if(other.has(f))same++;
    const ratio=same/Math.max(1,Math.min(mine.size,other.size));
    if(ratio>=0.6&&(!best||ratio>best.ratio))best={doc:d,same,ratio,total:mine.size};
  }
  return best;
}
const where=d=>d.source==="local"?"sur cet appareil":"partagé avec tout le monde";

/* ---------- Boîte de dialogue générique ---------- */
function ask({title,html,buttons}){
  return new Promise(res=>{
    closeReport();
    const wrap=document.createElement("div");wrap.className="modal-backdrop";wrap.id="reportModal";
    wrap.innerHTML=`<div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><div><h3>${esc(title)}</h3></div><button class="modal-close" data-v="" aria-label="Fermer">✕</button></div>
      <div class="ask-body">${html}</div>
      <div class="modal-actions">${buttons.map(b=>`<button class="${b.primary?"primary-btn small":"secondary-btn"}" data-v="${esc(b.value)}">${b.label}</button>`).join("")}</div></div>`;
    document.body.appendChild(wrap);
    const end=v=>{wrap.remove();res(v)};
    $$("[data-v]",wrap).forEach(b=>b.onclick=()=>end(b.dataset.v));
    wrap.addEventListener("click",e=>{if(e.target===wrap)end("")});
  });
}

/* ---------- Import ---------- */
async function importLocalFiles(files){
  const pdfs=[...files].filter(f=>/\.pdf$/i.test(f.name)||f.type==="application/pdf");
  if(!pdfs.length){toast("Choisis un ou plusieurs fichiers PDF.");return}
  for(const f of pdfs){
    try{
      const buf=await f.arrayBuffer(),sha=await sha256(buf.slice(0));
      // 1. exactement le même fichier ?
      const same=DOCS.find(d=>d.sha===sha);
      if(same){
        const canPub=same.source==="local"&&admin.ok;
        const v=await ask({title:"Déjà importé",html:`<p class="ask-p"><b>${esc(f.name)}</b> est déjà importé : c'est exactement le même fichier que <b>${esc(same.title)}</b>, ${where(same)}.</p>`,
          buttons:[...(canPub?[{label:"Partager avec tout le monde ↗",value:"pub",primary:true}]:[]),{label:"OK",value:"",primary:!canPub}]});
        if(v==="pub")await publishDoc(same);
        continue;
      }
      // 2. analyse
      const r=await convert(buf.slice(0),f.name,f.name);state.busy=null;updateStatus();   // copie : PDF.js transfère le buffer au worker
      // 3. même sujet déjà présent (autre fichier) ?
      const sim=findSimilar(r.questions);
      let dest="local";
      if(sim||admin.ok){
        const warn=sim?`<div class="ask-warn">⚠ Ce CCTL semble <b>déjà présent</b> : ${sim.same} question(s) sur ${sim.total} sont identiques à <b>${esc(sim.doc.title)}</b> (${esc(sim.doc.fileName)}), ${where(sim.doc)}.<br>L'importer créerait des questions en double.</div>`:"";
        const v=await ask({title:sim?"CCTL déjà présent ?":"Où enregistrer ce CCTL ?",
          html:`${warn}<p class="ask-p"><b>${esc(r.title)}</b> · ${r.questions.length} questions</p>${admin.ok?`<p class="ask-note">« Partager » enregistre les questions dans la base : tout le monde les a immédiatement. Le PDF lui-même (avec le nom et les notes) n'est pas envoyé.</p>`:""}`,
          buttons:[{label:"Annuler",value:""},{label:sim?"Importer quand même (cet appareil)":"Seulement sur cet appareil",value:"local",primary:!admin.ok},...(admin.ok?[{label:"Partager avec tout le monde ↗",value:"pub",primary:true}]:[])]});
        if(!v){toast("Import annulé.");continue}
        dest=v;
      }
      const rec={key:"local:"+sha,source:"local",sha,fileSig:sha,fileName:f.name,title:r.title,subject:r.subject,pages:r.pages,questions:r.questions,parserVersion:PARSER_VERSION,addedAt:Date.now()};
      if(dest==="pub"){await publishDoc(rec);continue}
      await dbPut(rec);DOCS=DOCS.filter(d=>d.key!==rec.key);DOCS.push(rec);rebuild();
      toast(`${r.questions.length} questions créées depuis « ${r.title} ».`);
    }catch(e){console.error(e);state.errors.push(`${f.name} : ${e.message}`);toast(`Impossible de lire « ${f.name} » : ${e.message}`)}
  }
  state.busy=null;refreshView();
}

/* ---------- Base partagée (Supabase) ----------
   Lecture : tout le monde. Écriture : comptes listés dans la table cctl_admins. */
const SB=SUPABASE_URL.replace(/\/+$/,""),SB_ON=!!(SB&&SUPABASE_ANON_KEY);
let admin={ok:false,email:"",error:"",session:loadJSON("cctlSbSession",null)};
async function sbFetch(path,opt={},auth=false){
  const headers={apikey:SUPABASE_ANON_KEY,"Content-Type":"application/json",...(opt.headers||{})};
  if(auth){const t=await sbToken();if(!t)throw new Error("session expirée, reconnecte-toi");headers.Authorization=`Bearer ${t}`}
  else headers.Authorization=`Bearer ${SUPABASE_ANON_KEY}`;
  const r=await fetch(SB+path,{...opt,headers});
  if(!r.ok){let m="";try{const j=await r.json();m=j.message||j.msg||j.error_description||j.error||""}catch{}
    const err=new Error(m||("erreur "+r.status));err.status=r.status;throw err}
  return r.status===204?null:r.json();
}
async function sbToken(){
  const s=admin.session;if(!s)return null;
  if(Date.now()<s.expires_at*1000-60e3)return s.access_token;
  try{const j=await fetch(`${SB}/auth/v1/token?grant_type=refresh_token`,{method:"POST",headers:{apikey:SUPABASE_ANON_KEY,"Content-Type":"application/json"},body:JSON.stringify({refresh_token:s.refresh_token})}).then(r=>r.ok?r.json():Promise.reject());
    admin.session={access_token:j.access_token,refresh_token:j.refresh_token,expires_at:j.expires_at||Math.floor(Date.now()/1000)+j.expires_in,user:j.user};saveJSON("cctlSbSession",admin.session);return j.access_token}
  catch{admin.session=null;localStorage.removeItem("cctlSbSession");admin.ok=false;return null}
}
async function sbLogin(email,password){
  const r=await fetch(`${SB}/auth/v1/token?grant_type=password`,{method:"POST",headers:{apikey:SUPABASE_ANON_KEY,"Content-Type":"application/json"},body:JSON.stringify({email,password})});
  const j=await r.json();if(!r.ok)throw new Error(j.error_description||j.msg||"identifiants incorrects");
  admin.session={access_token:j.access_token,refresh_token:j.refresh_token,expires_at:j.expires_at||Math.floor(Date.now()/1000)+j.expires_in,user:j.user};
  saveJSON("cctlSbSession",admin.session);
}
async function checkAdmin(){
  admin.ok=false;admin.error="";
  if(!SB_ON||!admin.session)return;
  try{
    const uid=admin.session.user?.id;admin.email=admin.session.user?.email||"";
    const rows=await sbFetch(`/rest/v1/cctl_admins?select=user_id&user_id=eq.${uid}`,{},true);
    admin.ok=rows.length>0;if(!admin.ok)admin.error="ce compte n'est pas administrateur (table cctl_admins)";
  }catch(e){admin.error=e.message}
}
function sbLogout(){admin={ok:false,email:"",error:"",session:null};localStorage.removeItem("cctlSbSession")}

/* Charge les CCTL partagés (liste légère, puis questions des nouveaux seulement) */
async function loadSharedDocs(){
  if(!SB_ON)return;
  try{
    const list=await sbFetch("/rest/v1/cctl_docs?select=id,sha,title,subject,file_name,pages,parser_version,updated_at&order=created_at");
    const keep=new Set(list.map(d=>"db:"+d.id));
    for(const d of DOCS.filter(d=>d.source==="db"&&!keep.has(d.key)))await dbDel(d.key);
    DOCS=DOCS.filter(d=>d.source!=="db"||keep.has(d.key));
    for(const row of list){
      const key="db:"+row.id,old=DOCS.find(d=>d.key===key);
      if(old&&old.fileSig===row.updated_at)continue;
      state.busy=`Chargement de « ${row.title} »`;updateStatus();
      let questions=old?.questions;
      if(!old||old.sha!==row.sha){const [full]=await sbFetch(`/rest/v1/cctl_docs?select=questions&id=eq.${row.id}`);questions=full.questions}
      const rec={key,source:"db",dbId:row.id,sha:row.sha,fileSig:row.updated_at,fileName:row.file_name,title:row.title,subject:row.subject,pages:row.pages,questions,parserVersion:row.parser_version,addedAt:Date.now()};
      await dbPut(rec);DOCS=DOCS.filter(d=>d.key!==key);DOCS.push(rec);
    }
    state.sbError="";
  }catch(e){console.error(e);state.sbError=`Base partagée injoignable (${e.message}). Si le projet Supabase est en pause, relance-le depuis supabase.com. Les CCTL déjà chargés restent disponibles.`}
  state.busy=null;rebuild();refreshView();
}
async function publishDoc(rec){
  if(!admin.ok){toast("Connecte-toi d'abord en administrateur (page Mes CCTL).");return}
  const onSite=DOCS.find(d=>d.source==="db"&&d.sha===rec.sha);
  if(onSite){toast(`Déjà partagé : « ${onSite.title} ».`);return}
  try{
    state.busy=`Partage de « ${rec.title} »…`;updateStatus();
    const [row]=await sbFetch("/rest/v1/cctl_docs",{method:"POST",headers:{Prefer:"return=representation"},
      body:JSON.stringify({sha:rec.sha,title:rec.title,subject:subjectOf(rec),file_name:rec.fileName,pages:rec.pages,questions:rec.questions,parser_version:rec.parserVersion})},true);
    const dbRec={...rec,key:"db:"+row.id,source:"db",dbId:row.id,subject:row.subject,fileSig:row.updated_at,addedAt:Date.now()};
    if(rec.source==="local")await dbDel(rec.key);
    await dbPut(dbRec);DOCS=DOCS.filter(d=>d.key!==rec.key&&d.key!==dbRec.key);DOCS.push(dbRec);
    rebuild();toast(`Partagé ! Tout le monde a maintenant « ${rec.title} ».`);
  }catch(e){console.error(e);const m=e.status===409?"ce PDF est déjà dans la base":e.message;toast("Partage impossible : "+m);state.errors.push(`Partage de ${rec.fileName} : ${m}`)}
  state.busy=null;refreshView();
}
async function unpublishDoc(d){
  if(!admin.ok)return;
  if(!confirm(`Retirer « ${d.title} » de la base partagée ? Plus personne n'aura ces questions.`))return;
  try{await sbFetch(`/rest/v1/cctl_docs?id=eq.${d.dbId}`,{method:"DELETE"},true);await dbDel(d.key);DOCS=DOCS.filter(x=>x.key!==d.key);rebuild();toast("Retiré de la base partagée.")}
  catch(e){toast("Retrait impossible : "+e.message)}
  refreshView();
}
async function saveSubject(d,value){
  if(d.source==="db"&&admin.ok){
    try{const [row]=await sbFetch(`/rest/v1/cctl_docs?id=eq.${d.dbId}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({subject:value})},true);
      d.subject=row.subject;d.fileSig=row.updated_at;await dbPut(d);const m=loadJSON("cctlSubjects",{});delete m[d.key];saveJSON("cctlSubjects",m);rebuild();toast("Matière modifiée pour tout le monde.");return}
    catch(e){toast("Modification impossible : "+e.message);return}
  }
  const m=loadJSON("cctlSubjects",{});if(value)m[d.key]=value;else delete m[d.key];saveJSON("cctlSubjects",m);rebuild();toast("Matière enregistrée sur cet appareil.");
}

/* PDF déposés dans le dossier pdf/ du dépôt */
function detectRepo(){
  if(REPORT_CONFIG.repo)return REPORT_CONFIG.repo;
  const h=location.hostname;
  if(!h.endsWith(".github.io"))return "";
  const owner=h.slice(0,-".github.io".length);
  const seg=location.pathname.split("/").filter(Boolean)[0];
  return owner+"/"+(seg&&!seg.includes(".")?seg:h);
}
async function listSitePdfs(){
  const toEntry=(name,sig,raw)=>({name,url:`${PDF_FOLDER}/${encodeURIComponent(name)}`,sig,raw});
  try{const r=await fetch(`${PDF_FOLDER}/index.json`,{cache:"no-cache"});if(r.ok){const a=await r.json();return a.map(n=>toEntry(typeof n==="string"?n:n.name))}}catch{}
  const repo=detectRepo();
  if(repo){
    const cached=loadJSON("cctlSiteList",null);
    if(cached&&cached.repo===repo&&Date.now()-cached.t<3*60e3)return cached.list;
    try{
      const r=await fetch(`https://api.github.com/repos/${repo}/contents/${PDF_FOLDER}`,{headers:{Accept:"application/vnd.github+json"}});
      if(r.ok){const a=await r.json();const list=a.filter(f=>f.type==="file"&&/\.pdf$/i.test(f.name)).map(f=>toEntry(f.name,f.sha,f.download_url));saveJSON("cctlSiteList",{repo,t:Date.now(),list});return list}
      if(r.status===404){saveJSON("cctlSiteList",{repo,t:Date.now(),list:[]});return []}
    }catch{}
    if(cached)return cached.list;
  }
  try{const r=await fetch(`${PDF_FOLDER}/`);if(r.ok&&/html/.test(r.headers.get("content-type")||"")){const t=await r.text();return unique([...t.matchAll(/href="([^"?#]+\.pdf)"/gi)].map(m=>decodeURIComponent(m[1].split("/").pop()))).map(n=>toEntry(n))}}catch{}
  return [];
}
async function loadSitePdfs(){
  state.siteStatus="loading";updateStatus();
  const list=await listSitePdfs();
  const keep=new Set(list.map(e=>"site:"+e.name));
  for(const d of DOCS.filter(d=>d.source==="site"&&!keep.has(d.key))){await dbDel(d.key);}
  DOCS=DOCS.filter(d=>d.source!=="site"||keep.has(d.key));rebuild();refreshView();
  for(const e of list){
    const key="site:"+e.name,old=DOCS.find(d=>d.key===key);
    if(old&&e.sig&&old.fileSig===e.sig&&old.parserVersion===PARSER_VERSION)continue;
    try{
      state.busy=`Téléchargement de ${e.name}`;updateStatus();
      let r=await fetch(e.url);
      if(!r.ok&&e.raw)r=await fetch(e.raw);   // PDF tout juste publié : le site n'est pas encore redéployé
      if(!r.ok)throw new Error("fichier introuvable ("+r.status+")");
      const buf=await r.arrayBuffer(),sha=await sha256(buf.slice(0)),sig=e.sig||sha;
      if(old&&old.fileSig===sig&&old.parserVersion===PARSER_VERSION)continue;
      const res=await convert(buf,e.name,e.name);
      const rec={key,source:"site",sha,fileSig:sig,fileName:e.name,title:res.title,subject:res.subject,pages:res.pages,questions:res.questions,parserVersion:PARSER_VERSION,addedAt:Date.now()};
      await dbPut(rec);DOCS=DOCS.filter(d=>d.key!==key);DOCS.push(rec);rebuild();
      state.busy=null;refreshView();
    }catch(err){console.error(err);state.errors.push(`${e.name} : ${err.message}`)}
  }
  state.busy=null;state.siteStatus="done";refreshView();
}

/* ===================== Navigation ===================== */
const CRUMBS={home:"Vue d'ensemble",practice:"Entraînement",topics:"Par matière",stats:"Ma progression",library:"Mes CCTL"};
function setView(v,soft){
  if(state.view==="quiz"&&soft)return;
  state.view=v;state.quiz=null;
  $$(".nav-link").forEach(b=>b.classList.toggle("active",b.dataset.view===v));
  $("#crumb").textContent=CRUMBS[v]||"Entraînement";
  $("#sidebar").classList.remove("open");
  ({home:renderHome,practice:renderPractice,topics:renderTopics,stats:renderStats,library:renderLibrary}[v]||renderHome)();
  updateStatus();
}
function startQuiz({pool=QUESTIONS,count=10,mode="Entraînement",topic="Toutes",ordered=false}={}){
  const chosen=(ordered?[...pool].sort((a,b)=>a.num-b.num):shuffle(pool)).slice(0,Math.min(count,pool.length));
  if(!chosen.length){toast(QUESTIONS.length?"Aucune question dans cette sélection.":"Importe d'abord un PDF de CCTL.");if(!QUESTIONS.length)setView("library");return}
  state.quiz={items:chosen,pool,count,ordered,index:0,answers:[],selected:[],checked:false,mode,topic,score:0};
  state.view="quiz";$("#crumb").textContent=mode;
  renderQuestion();
}
const subjects=()=>unique(QUESTIONS.map(q=>q.subject));
const SUBJECT_STYLE=s=>/math/i.test(s)?["math","∑"]:/num|info/i.test(s)?["num","⌘"]:["other","◆"];
function subjectDesc(s){const t=unique(QUESTIONS.filter(q=>q.subject===s).map(q=>q.topic)).filter(x=>x!=="Divers").slice(0,4);return `${QUESTIONS.filter(q=>q.subject===s).length} questions${t.length?" · "+t.join(", "):""}`}

function emptyCard(){
  const loading=state.siteStatus==="loading";
  return `<div class="empty-state import-empty"><div class="empty-ico">⇪</div><h3>${loading?"Chargement des CCTL du site…":"Aucune question pour l'instant"}</h3>
  <p>${loading?"Les PDF du site sont en cours d'analyse. Ça ne prend que quelques secondes la première fois.":"Importe un PDF de correction de CCTL : les questions, réponses, explications et schémas sont créés automatiquement."}</p>
  ${loading?"":`<button class="primary-btn" data-go="library">Importer un PDF <span>↗</span></button>`}</div>`;
}
function renderHome(){
  const total=QUESTIONS.length,answered=state.stats.answered,correct=state.stats.correct;
  $("#appContent").innerHTML=`
  <section class="hero"><div class="hero-copy"><div class="eyebrow"><span class="eyebrow-dot"></span> TON ESPACE DE RÉVISION</div>
  <h1>Prêt à faire<br><em>la différence ?</em></h1><p>Importe tes PDF de CCTL, entraîne-toi sur leurs questions, identifie tes points faibles et progresse à ton rythme.</p>
  ${total?`<button class="primary-btn" id="heroStart">Commencer un entraînement <span>↗</span></button>`:`<button class="primary-btn" data-go="library">Importer mes PDF <span>↗</span></button>`}</div>
  <div class="hero-art" aria-hidden="true"><div class="art-ring ring-one"></div><div class="art-ring ring-two"></div><div class="art-card card-back">∑</div><div class="art-card card-front"><span class="art-tick">✓</span><strong>QCM</strong><small>MODE RÉVISION</small><div class="art-bars"><i></i><i></i><i></i><i></i><i></i></div></div><div class="art-orbit">✦</div></div></section>
  <section class="stats-grid">
    ${statCard("Questions dans la banque",total,"▤",`${DOCS.length} PDF importé${DOCS.length>1?"s":""}`)}
    ${statCard("Questions répondues",answered,"✓","Toutes sessions confondues")}
    ${statCard("Bonnes réponses",pct(correct,answered)+"%","↗","Taux de réussite")}
    ${statCard("Sessions terminées",state.stats.sessions.length,"◷","Continue sur ta lancée")}
  </section>
  <section class="section-block"><div class="section-heading"><div><div class="eyebrow muted">CHOISIS TON PARCOURS</div><h2>Que veux-tu travailler ?</h2></div>${total?`<button class="text-btn" data-go="topics">Voir toutes les matières <span>→</span></button>`:""}</div>
  ${total?`<div class="subject-grid">${subjects().map(s=>subjectCard(s)).join("")}</div>`:emptyCard()}</section>
  <section class="section-block bottom-grid"><div class="panel recent-panel"><div class="panel-head"><div><div class="eyebrow muted">REPRENDRE</div><h3>Dernière activité</h3></div><span class="panel-icon">◷</span></div>
  ${state.stats.sessions.length?recentHtml(state.stats.sessions[0]):'<div class="recent-empty">Pas encore de session. Lance un premier QCM pour voir tes résultats ici.</div>'}</div>
  <div class="panel tip-panel"><div class="tip-icon">✧</div><div class="eyebrow muted">LE CONSEIL DU JOUR</div><h3>Comprendre vaut mieux que mémoriser.</h3><p>Après chaque réponse, prends quelques secondes pour lire l'explication. C'est là que tu consolides tes connaissances.</p></div></section>`;
  $("#heroStart")&&($("#heroStart").onclick=()=>setView("practice"));
}
function statCard(label,value,icon,caption){return `<div class="stat-card"><div class="stat-top">${label}<span class="stat-symbol">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-caption">${caption}</div></div>`}
function subjectCard(s){const [cls,icon]=SUBJECT_STYLE(s);return `<button class="subject-card" data-subject="${esc(s)}"><span class="subject-icon ${cls}">${icon}</span><span><h3>${esc(s)}</h3><p>${esc(subjectDesc(s))}</p></span><span class="subject-arrow">↗</span></button>`}
function recentHtml(s){return `<div class="recent-empty"><strong style="color:#e6ebf2">${esc(s.mode)}</strong><br>${s.date} · ${s.score}/${s.total} bonnes réponses (${pct(s.score,s.total)} %)<br><span style="color:var(--accent)">→ Continue avec un nouveau QCM</span></div>`}
function renderPractice(){
  if(!QUESTIONS.length){$("#appContent").innerHTML=`<div class="view-title"><div><div class="eyebrow muted">À TOI DE JOUER</div><h1>Entraînement</h1><p>Il faut d'abord des questions.</p></div></div>${emptyCard()}`;return}
  $("#appContent").innerHTML=`<div class="view-title"><div><div class="eyebrow muted">À TOI DE JOUER</div><h1>Entraînement</h1><p>Choisis un format de révision selon le temps dont tu disposes.</p></div></div>
  <div class="mode-grid">
    <button class="mode-card" id="quickMode"><div class="mode-ico">⚡</div><h3>QCM rapide</h3><p>10 questions aléatoires pour réviser en quelques minutes.</p></button>
    <button class="mode-card" id="fullMode"><div class="mode-ico">◈</div><h3>Mode examen</h3><p>20 questions mélangées. Découvre ton score à la fin.</p></button>
    <button class="mode-card" id="allMode"><div class="mode-ico">∞</div><h3>Révision complète</h3><p>Parcours les ${QUESTIONS.length} questions de la banque.</p></button>
    ${subjects().map(s=>{const [,icon]=SUBJECT_STYLE(s);return `<button class="mode-card" data-subject="${esc(s)}"><div class="mode-ico">${icon}</div><h3>${esc(s)}</h3><p>${esc(subjectDesc(s))}</p></button>`}).join("")}
    <button class="mode-card" data-go="topics"><div class="mode-ico">▦</div><h3>Choisir un thème ou un CCTL</h3><p>Travaille précisément une notion ou refais un sujet dans l'ordre.</p></button>
  </div>`;
  $("#quickMode").onclick=()=>startQuiz({count:10,mode:"QCM rapide"});
  $("#fullMode").onclick=()=>startQuiz({count:20,mode:"Mode examen"});
  $("#allMode").onclick=()=>startQuiz({count:QUESTIONS.length,mode:"Révision complète"});
}
function renderTopics(){
  if(!QUESTIONS.length){$("#appContent").innerHTML=`<div class="view-title"><div><div class="eyebrow muted">RÉVISER À LA CARTE</div><h1>Par matière</h1><p>Il faut d'abord des questions.</p></div></div>${emptyCard()}`;return}
  const topics=unique(QUESTIONS.map(q=>q.topic)).sort((a,b)=>a.localeCompare(b,"fr"));
  const docs=DOCS.filter(d=>QUESTIONS.some(q=>q.docKey===d.key));
  $("#appContent").innerHTML=`<div class="view-title"><div><div class="eyebrow muted">RÉVISER À LA CARTE</div><h1>Par matière</h1><p>Sélectionne un thème ou un CCTL pour lancer un QCM ciblé.</p></div></div>
  <div class="eyebrow muted" style="margin-bottom:10px">PAR CCTL</div>
  <div class="topic-list" style="margin-bottom:26px">${docs.map(d=>`<button class="topic-row" data-doc="${esc(d.key)}"><span><b>${esc(d.title)}</b><small>${QUESTIONS.filter(q=>q.docKey===d.key).length} questions · dans l'ordre du sujet</small></span><span>↗</span></button>`).join("")}</div>
  <div class="eyebrow muted" style="margin-bottom:10px">PAR THÈME <span class="hint-inline">(détecté automatiquement)</span></div>
  <div class="topic-list">${topics.map(t=>`<button class="topic-row" data-topic="${esc(t)}"><span><b>${esc(t)}</b><small>${QUESTIONS.filter(q=>q.topic===t).length} questions · ${esc(unique(QUESTIONS.filter(q=>q.topic===t).map(q=>q.subject)).join(" / "))}</small></span><span>↗</span></button>`).join("")}</div>`;
  $$("[data-topic]").forEach(b=>b.onclick=()=>{const t=b.dataset.topic,pool=QUESTIONS.filter(q=>q.topic===t);startQuiz({pool,count:pool.length,mode:t,topic:t})});
  $$("[data-doc]").forEach(b=>b.onclick=()=>{const d=DOCS.find(x=>x.key===b.dataset.doc),pool=QUESTIONS.filter(q=>q.docKey===d.key);startQuiz({pool,count:pool.length,mode:d.title,topic:d.title,ordered:true})});
}

/* ===================== Mes CCTL (import) ===================== */
function docCard(d){
  const n=d.questions.length,ok=d.questions.filter(q=>q.a?.length).length,figs=d.questions.filter(q=>q.hasFigure||q.oImg?.some(Boolean)).length;
  const subs=unique([...DOCS.map(subjectOf),"Mathématiques","Sciences du numérique"]);
  return `<div class="doc-card" data-key="${esc(d.key)}">
    <div class="doc-ico">PDF</div>
    <div class="doc-main"><h3>${esc(d.title)}</h3>
      <p>${ok} questions${figs?` · ${figs} avec schéma ou formule`:""} · ${d.pages} pages · <span class="muted">${esc(d.fileName)}</span></p>
      ${ok<n?`<p class="doc-warn">⚠ ${n-ok} question(s) ignorée(s) : aucune bonne réponse cochée dans le PDF.</p>`:""}
      <label class="doc-subject">Matière <input list="subjectList" value="${esc(subjectOf(d))}" data-subject-input="${esc(d.key)}"></label>
    </div>
    <div class="doc-actions"><button class="primary-btn small" data-train="${esc(d.key)}">S'entraîner <span>→</span></button>
    ${d.source==="local"?`${admin.ok?`<button class="secondary-btn pub-btn" data-pub="${esc(d.key)}">Partager avec tous ↗</button>`:""}<button class="secondary-btn" data-del="${esc(d.key)}">Supprimer</button>`
      :d.source==="db"?`<span class="badge-site">Partagé · pour tous</span>${admin.ok?`<button class="secondary-btn" data-unpub="${esc(d.key)}">Retirer</button>`:""}`
      :`<span class="badge-site" title="PDF du dossier ${PDF_FOLDER}/ du site">Dossier ${PDF_FOLDER}/</span>`}</div>
  </div><datalist id="subjectList">${subs.map(s=>`<option value="${esc(s)}">`).join("")}</datalist>`;
}
function adminPanel(){
  if(!SB_ON)return `<div class="panel help-panel"><div class="eyebrow muted">ADMINISTRATEUR</div><h3>Base partagée non configurée</h3>
    <p>Pour partager les CCTL avec tout le monde, crée un projet Supabase, exécute <code>supabase.sql</code>, puis renseigne <code>SUPABASE_URL</code> et <code>SUPABASE_ANON_KEY</code> en haut de <code>app.js</code> (voir le README).</p></div>`;
  if(admin.ok)return `<div class="panel help-panel admin-on"><div class="eyebrow muted">ADMINISTRATEUR</div><h3>✓ Connecté : ${esc(admin.email)}</h3>
    <p>À chaque import, tu peux choisir <b>Partager avec tout le monde</b> : les questions sont enregistrées dans la base et tous les visiteurs les ont immédiatement. Tu peux aussi retirer un CCTL partagé ou corriger sa matière pour tous.</p>
    <button class="secondary-btn" id="adminLogout">Se déconnecter</button></div>`;
  return `<details class="panel help-panel admin-login" ${admin.error?"open":""}><summary><span class="eyebrow muted">ADMINISTRATEUR</span><h3>Connexion pour partager des CCTL</h3></summary>
    <p>Réservé aux comptes administrateurs déclarés dans Supabase.</p>
    <div class="admin-row"><input type="email" id="adminEmail" placeholder="e-mail" autocomplete="username" value="${esc(admin.email)}"><input type="password" id="adminPass" placeholder="mot de passe" autocomplete="current-password"><button class="primary-btn small" id="adminConnect">Connexion</button></div>
    ${admin.error?`<p class="doc-warn">⚠ ${esc(admin.error)}</p>`:""}</details>`;
}
function renderLibrary(){
  const shared=DOCS.filter(d=>d.source!=="local"),local=DOCS.filter(d=>d.source==="local");
  $("#appContent").innerHTML=`<div class="view-title"><div><div class="eyebrow muted">TES SUJETS</div><h1>Mes CCTL</h1><p>Dépose un PDF de correction : les questions sont créées automatiquement.</p></div></div>
  <label class="dropzone" id="dropzone"><input type="file" id="fileInput" accept="application/pdf,.pdf" multiple hidden>
    <div class="drop-ico">⇪</div><strong>Glisse tes PDF ici</strong><span>ou clique pour les choisir</span>
    <small>Le PDF est lu directement dans ton navigateur. ${admin.ok?"Tu pourras ensuite partager ses questions avec tout le monde.":"Il reste sur cet appareil."}</small></label>
  <div id="importProgress"></div>
  ${state.sbError?`<div class="import-errors">⚠ ${esc(state.sbError)}</div>`:""}
  ${state.errors.length?`<div class="import-errors">${state.errors.slice(-3).map(e=>`<div>⚠ ${esc(e)}</div>`).join("")}</div>`:""}
  <div class="section-block"><div class="eyebrow muted" style="margin-bottom:10px">PARTAGÉS AVEC TOUT LE MONDE</div>
    ${shared.length?shared.map(docCard).join(""):`<div class="recent-empty">${state.siteStatus==="loading"?"Chargement des CCTL partagés…":"Aucun CCTL partagé pour l'instant."}</div>`}</div>
  <div class="section-block"><div class="eyebrow muted" style="margin-bottom:10px">SUR CET APPAREIL</div>
    ${local.length?local.map(docCard).join(""):'<div class="recent-empty">Aucun PDF importé sur cet appareil.</div>'}
    ${adminPanel()}</div>`;
  const dz=$("#dropzone"),fi=$("#fileInput");
  fi.onchange=()=>{importLocalFiles(fi.files);fi.value=""};
  ["dragenter","dragover"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add("over")}));
  ["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove("over")}));
  dz.addEventListener("drop",e=>importLocalFiles(e.dataTransfer.files));
  $$("[data-del]").forEach(b=>b.onclick=async()=>{const d=DOCS.find(x=>x.key===b.dataset.del);if(!confirm(`Supprimer « ${d.title} » de cet appareil ?`))return;await dbDel(d.key);DOCS=DOCS.filter(x=>x.key!==d.key);rebuild();renderLibrary();updateStatus();toast("PDF supprimé.")});
  $$("[data-train]").forEach(b=>b.onclick=()=>{const d=DOCS.find(x=>x.key===b.dataset.train),pool=QUESTIONS.filter(q=>q.docKey===d.key);startQuiz({pool,count:pool.length,mode:d.title,topic:d.title,ordered:true})});
  $$("[data-pub]").forEach(b=>b.onclick=()=>publishDoc(DOCS.find(x=>x.key===b.dataset.pub)));
  $$("[data-unpub]").forEach(b=>b.onclick=()=>unpublishDoc(DOCS.find(x=>x.key===b.dataset.unpub)));
  $("#adminConnect")&&($("#adminConnect").onclick=async()=>{
    const email=$("#adminEmail").value.trim(),pass=$("#adminPass").value;if(!email||!pass)return;
    state.busy="Connexion…";updateStatus();
    try{await sbLogin(email,pass);await checkAdmin()}catch(e){admin.error=e.message;admin.email=email}
    state.busy=null;toast(admin.ok?"Connecté : tu peux partager des CCTL.":"Connexion impossible : "+admin.error);renderLibrary()});
  $("#adminPass")&&$("#adminPass").addEventListener("keydown",e=>{if(e.key==="Enter")$("#adminConnect").click()});
  $("#adminLogout")&&($("#adminLogout").onclick=()=>{sbLogout();toast("Déconnecté.");renderLibrary()});
  $$("[data-subject-input]").forEach(inp=>inp.onchange=()=>saveSubject(DOCS.find(x=>x.key===inp.dataset.subjectInput),inp.value.trim()));
  updateStatus();
}

/* ===================== Quiz ===================== */
function questionBody(q){
  return (q.blocks||[{t:"p",text:q.q}]).map(b=>b.t==="img"?(b.src?`<figure class="q-figure">${imgTag(b,"q-img",b.alt)}</figure>`:""):b.t==="code"?`<pre class="q-code">${esc(b.text)}</pre>`:`<p class="q-p">${txt(b.text)}</p>`).join("");
}
function renderQuestion(){
  const z=state.quiz,q=z.items[z.index],n=z.items.length;
  const multi=q.a.length>1;
  const selected=z.selected;
  const reported=!!loadReported()[q.id];
  $("#appContent").innerHTML=`<div class="quiz-wrap">
    <div class="view-title"><div><div class="eyebrow muted">${esc(z.mode.toUpperCase())}</div><h1>Question ${z.index+1}</h1><p>${esc(q.subject)} · ${esc(q.topic)}</p></div><button class="back-btn" id="quitQuiz">✕ Quitter</button></div>
    <div class="quiz-top"><span>Progression</span><span>${z.index+1} / ${n}</span></div><div class="progress-track"><div class="progress-fill" style="width:${(z.index+1)/n*100}%"></div></div>
    <div class="question-card"><div class="question-meta"><span class="tag">${esc(q.doc)} · Q${q.num}</span><span class="tag green">${multi?"Plusieurs réponses":"Une seule réponse"}</span>
    <button class="report-btn ${reported?"done":""}" id="reportBtn" title="Signaler un bug ou une erreur sur cette question">⚑ ${reported?"Signalée":"Signaler"}</button></div>
    <div class="q-body">${questionBody(q)}</div><p class="question-hint">${multi?"Sélectionne toutes les bonnes réponses.":"Sélectionne la bonne réponse."}</p>
    <div class="answers">${q.o.map((o,i)=>answerHtml(o,i,selected,q,z.checked)).join("")}</div>
    ${z.checked?feedbackHtml(q,z):""}
    <div class="quiz-actions"><button class="secondary-btn" id="skipQuestion">Passer</button>
    ${z.checked?`<button class="primary-btn small" id="nextQuestion">${z.index===n-1?"Voir mon résultat":"Question suivante"} <span>→</span></button>`:`<button class="primary-btn small" id="validateAnswer" ${selected.length?"":"disabled"}>Valider ma réponse <span>→</span></button>`}</div>
    </div></div>`;
  $("#quitQuiz").onclick=()=>setView("practice");
  $("#skipQuestion").onclick=()=>advance(true);
  $("#reportBtn").onclick=()=>openReport(q);
  if(!z.checked){
    $$(".answer").forEach(b=>b.onclick=()=>{const i=Number(b.dataset.index);if(multi){z.selected=selected.includes(i)?selected.filter(x=>x!==i):[...selected,i]}else{z.selected=[i]}renderQuestion()});
    $("#validateAnswer").onclick=checkAnswer;
  }else $("#nextQuestion").onclick=()=>advance(false);
}
function answerHtml(o,i,selected,q,checked){
  const isSel=selected.includes(i),isCorrect=q.a.includes(i);
  let cls=isSel?"selected":"";
  if(checked){cls=isCorrect?"correct":(isSel?"wrong":"");}
  const im=q.oImg?.[i];
  const body=im?`<span class="answer-img-wrap">${imgTag(im,"answer-img",o)}</span>`:String(o).includes("\n")?`<pre class="answer-code">${esc(o)}</pre>`:`<span>${esc(o)}</span>`;
  return `<button class="answer ${cls}" data-index="${i}" ${checked?"disabled":""}><span class="answer-key">${letters[i]}</span>${body}${checked&&isCorrect?'<span style="margin-left:auto;color:#85e2a5">✓</span>':""}</button>`;
}
function feedbackHtml(q,z){
  const last=z.answers[z.answers.length-1],ok=last?.correct;
  const expl=q.eImg?`<div class="feedback-img">${imgTag(q.eImg,"q-img","Commentaire de correction")}</div>`:q.e?`<div class="feedback-text">${esc(q.e)}</div>`:`<div class="feedback-text muted">Pas de commentaire de correction dans le PDF. Bonne(s) réponse(s) : ${q.a.map(i=>letters[i]).join(", ")}.</div>`;
  return `<div class="feedback ${ok?"":"bad"}"><strong>${ok?"✓ Bonne réponse !":"✕ Pas tout à fait."}</strong>${expl}<div style="margin-top:7px;color:#8190a3;font-size:10px">Source : ${esc(q.src)}</div></div>`;
}

/* ===== Signalement ===== */
function buildReport(q,reason,comment){
  const z=state.quiz,sel=(z&&z.items[z.index]===q)?z.selected:[];
  const fmt=o=>String(o).includes("\n")?"\n```\n"+o+"\n```":o;
  const hasImg=q.hasFigure||q.oImg?.some(Boolean);
  const lines=[
    "### Question signalée",
    `- **ID** : \`${q.id}\``,
    `- **Source** : ${q.src}`,
    `- **Matière / thème** : ${q.subject} · ${q.topic}`,
    `- **Motif** : ${reason}`,
    "",
    "**Énoncé**"+(hasImg?" _(la question contient des schémas ou formules en image)_":""),
    "> "+q.q.replace(/\n/g,"\n> "),
    "",
    "**Propositions**",
    ...q.o.map((o,i)=>`- ${letters[i]}. ${fmt(o)}${q.a.includes(i)?"  ✅ (attendue)":""}`),
    "",
    `**Réponse(s) attendue(s)** : ${q.a.map(i=>letters[i]).join(", ")}`,
    `**Ma sélection** : ${sel.length?sel.map(i=>letters[i]).join(", "):"—"}`,
    "",
    "**Commentaire**",
    comment||"_(aucun)_",
    "",
    `<sub>Envoyé depuis CCTL Trainer · ${new Date().toLocaleString("fr-FR")}</sub>`
  ];
  let body=lines.join("\n");
  if(body.length>6000)body=body.slice(0,6000)+"\n…";
  return {title:`[Signalement] ${q.src} — ${reason}`,body};
}
function openReport(q){
  closeReport();
  const repo=detectRepo();
  const wrap=document.createElement("div");
  wrap.className="modal-backdrop";wrap.id="reportModal";
  wrap.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="reportTitle">
    <div class="modal-head"><div><div class="eyebrow muted">SIGNALER UN PROBLÈME</div><h3 id="reportTitle">${esc(q.doc)} · Question ${q.num}</h3><p class="modal-sub">${esc(q.id)}</p></div><button class="modal-close" id="reportClose" aria-label="Fermer">✕</button></div>
    <div class="modal-label">Quel est le problème ?</div>
    <div class="reason-list">${REPORT_REASONS.map((r,i)=>`<label class="reason"><input type="radio" name="reason" value="${esc(r)}" ${i===0?"checked":""}><span>${esc(r)}</span></label>`).join("")}</div>
    <div class="modal-label">Précisions <span class="muted">(facultatif)</span></div>
    <textarea id="reportComment" rows="4" placeholder="Ex. : la bonne réponse devrait être C car…"></textarea>
    <p class="modal-note">${repo?`Le signalement s'ouvre sur GitHub (<b>${esc(repo)}</b>) avec tout le contexte pré-rempli. Un compte GitHub est nécessaire pour valider.`:`Aucun dépôt GitHub détecté : copie le signalement et envoie-le au responsable du site.`}</p>
    <div class="modal-actions"><button class="secondary-btn" id="reportCopy">Copier le signalement</button>
    ${repo||REPORT_CONFIG.email?`<button class="primary-btn small" id="reportSend">${repo?"Ouvrir sur GitHub":"Envoyer par e-mail"} <span>↗</span></button>`:""}</div>
  </div>`;
  document.body.appendChild(wrap);
  const get=()=>buildReport(q,$("input[name=reason]:checked",wrap).value,$("#reportComment",wrap).value.trim());
  const done=()=>{const r=loadReported();r[q.id]=Date.now();saveReported(r);const b=$("#reportBtn");if(b){b.classList.add("done");b.textContent="⚑ Signalée"}};
  $("#reportClose",wrap).onclick=closeReport;
  wrap.addEventListener("click",e=>{if(e.target===wrap)closeReport()});
  $("#reportCopy",wrap).onclick=async()=>{const {title,body}=get();try{await navigator.clipboard.writeText(title+"\n\n"+body);done();toast("Signalement copié dans le presse-papiers.")}catch{toast("Copie impossible sur ce navigateur.")}};
  const send=$("#reportSend",wrap);
  if(send)send.onclick=()=>{const {title,body}=get();
    const url=repo?`https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
                  :`mailto:${REPORT_CONFIG.email}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    window.open(url,"_blank","noopener");done();closeReport();toast("Merci pour ton signalement !")};
  document.addEventListener("keydown",escClose);
  setTimeout(()=>$("#reportComment",wrap)?.focus(),50);
}
function escClose(e){if(e.key==="Escape")closeReport()}
function closeReport(){$("#reportModal")?.remove();document.removeEventListener("keydown",escClose)}

function checkAnswer(){
  const z=state.quiz,q=z.items[z.index];
  const ok=z.selected.length===q.a.length&&q.a.every(a=>z.selected.includes(a));
  z.checked=true;z.answers.push({id:q.id,correct:ok,selected:[...z.selected]});
  if(ok)z.score++;
  state.stats.answered++;if(ok)state.stats.correct++;
  state.stats.topic[q.topic]??={answered:0,correct:0};state.stats.topic[q.topic].answered++;if(ok)state.stats.topic[q.topic].correct++;
  saveStats();renderQuestion();
}
function advance(skipped){
  const z=state.quiz;if(skipped)z.answers.push({id:z.items[z.index].id,correct:false,selected:[]});
  if(z.index<z.items.length-1){z.index++;z.selected=[];z.checked=false;renderQuestion();window.scrollTo({top:0})}else finishQuiz();
}
function finishQuiz(){
  const z=state.quiz,score=z.score,total=z.items.length;
  const session={mode:z.mode,score,total,date:new Date().toLocaleDateString("fr-FR")};
  state.stats.sessions.unshift(session);state.stats.sessions=state.stats.sessions.slice(0,30);saveStats();
  state.view="result";$("#crumb").textContent="Résultat";
  $("#appContent").innerHTML=`<div class="result-card"><div class="eyebrow muted" style="justify-content:center;margin-bottom:17px">SESSION TERMINÉE</div>
  <div class="result-ring"><strong>${pct(score,total)}%</strong></div><h2>${score===total?"Excellent travail !":score>=total*.7?"Bien joué !":"Continue tes efforts !"}</h2>
  <p>Tu as obtenu <b style="color:#f4f6fb">${score} bonne(s) réponse(s) sur ${total}</b> en ${esc(z.mode)}. Chaque session t'aide à identifier ce qu'il reste à consolider.</p>
  <div class="stats-grid" style="margin:22px 0 0;grid-template-columns:repeat(2,1fr)">${statCard("Bonnes réponses",score,"✓","Réponses correctes")}${statCard("À retravailler",total-score,"↗","Réponses incorrectes ou passées")}</div>
  <div class="result-actions"><button class="primary-btn" id="retryBtn">Recommencer <span>↻</span></button><button class="secondary-btn" id="homeBtn">Retour à l'accueil</button><button class="secondary-btn" id="statsBtn">Ma progression</button></div></div>`;
  $("#retryBtn").onclick=()=>startQuiz({pool:z.pool,count:z.count,mode:z.mode,topic:z.topic,ordered:z.ordered});
  $("#homeBtn").onclick=()=>setView("home");$("#statsBtn").onclick=()=>setView("stats");
}
function renderStats(){
  const answered=state.stats.answered,correct=state.stats.correct;
  const topicRows=Object.entries(state.stats.topic).sort((a,b)=>pct(a[1].correct,a[1].answered)-pct(b[1].correct,b[1].answered));
  $("#appContent").innerHTML=`<div class="view-title"><div><div class="eyebrow muted">TON ÉVOLUTION</div><h1>Ma progression</h1><p>Un aperçu de tes résultats, enregistré directement sur cet appareil.</p></div><button class="back-btn" id="resetStats">Réinitialiser</button></div>
  <div class="stats-grid">${statCard("Questions répondues",answered,"✓","Toutes sessions")}${statCard("Bonnes réponses",correct,"✦","Réussites")}${statCard("Taux de réussite",pct(correct,answered)+"%","↗","Sur l'ensemble des réponses")}${statCard("Sessions",state.stats.sessions.length,"◷","QCM terminés")}</div>
  <div class="stats-panels"><div class="panel"><div class="eyebrow muted">PAR THÈME</div><h3>Points à consolider</h3>${topicRows.length?topicRows.map(([t,v])=>`<div class="progress-item"><div class="progress-label"><span>${esc(t)}</span><span>${pct(v.correct,v.answered)} % · ${v.answered} réponses</span></div><div class="progress-track slim"><div class="progress-fill" style="width:${pct(v.correct,v.answered)}%"></div></div></div>`).join(""):'<div class="recent-empty">Réponds à quelques questions pour afficher tes statistiques par thème.</div>'}</div>
  <div class="panel"><div class="eyebrow muted">HISTORIQUE</div><h3>Dernières sessions</h3>${state.stats.sessions.length?state.stats.sessions.slice(0,8).map(s=>`<div class="progress-item"><div class="progress-label"><span>${esc(s.mode)}</span><span>${s.score}/${s.total} · ${pct(s.score,s.total)} %</span></div><div class="progress-track slim"><div class="progress-fill" style="width:${pct(s.score,s.total)}%"></div></div><div style="font-size:9px;color:#778397;margin-top:5px">${s.date}</div></div>`).join(""):'<div class="recent-empty">Aucune session pour le moment.</div>'}</div></div>`;
  $("#resetStats").onclick=()=>{if(confirm("Effacer toutes les statistiques enregistrées sur cet appareil ?")){state.stats={answered:0,correct:0,sessions:[],topic:{}};saveStats();renderStats();toast("Statistiques réinitialisées.")}};
}
function bindNav(){
  $$(".nav-link").forEach(b=>b.onclick=()=>setView(b.dataset.view));
  $("#menuBtn").onclick=()=>$("#sidebar").classList.toggle("open");
  $(".brand").onclick=e=>{e.preventDefault();setView("home")};
  document.addEventListener("click",e=>{
    const go=e.target.closest("[data-go]");if(go){setView(go.dataset.go);return}
    const b=e.target.closest("[data-subject]");if(b){const s=b.dataset.subject;startQuiz({pool:QUESTIONS.filter(q=>q.subject===s),count:15,mode:s,topic:s})}
  });
  // déposer un PDF n'importe où sur la page
  document.addEventListener("dragover",e=>{if([...e.dataTransfer.types].includes("Files"))e.preventDefault()});
  document.addEventListener("drop",e=>{if(e.target.closest("#dropzone"))return;if(e.dataTransfer.files.length){e.preventDefault();setView("library");importLocalFiles(e.dataTransfer.files)}});
}
async function init(){
  bindNav();
  try{DOCS=(await dbAll()).filter(d=>d.parserVersion===PARSER_VERSION||d.source==="local")}catch(e){console.warn("IndexedDB indisponible",e);DOCS=[]}
  rebuild();setView("home");
  checkAdmin().then(()=>{if(state.view==="library")renderLibrary()});
  state.siteStatus="loading";
  await loadSharedDocs();
  await loadSitePdfs();
}
init();
