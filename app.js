const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
let QUESTIONS = [];
let state = { view: "home", filter: "Toutes", quiz: null, stats: loadStats() };
const letters = ["A", "B", "C", "D", "E", "F"];

/* ===== Signalement des questions =====
   Les signalements ouvrent une "issue" pré-remplie sur le dépôt GitHub du site.
   Sur GitHub Pages (pseudo.github.io/depot), le dépôt est détecté automatiquement.
   Pour forcer un dépôt, renseigne repo, ex. : "pseudo/cctl-trainer".
   email (facultatif) : adresse utilisée en secours quand aucun dépôt n'est trouvé. */
const REPORT_CONFIG = { repo: "", email: "" };
const REPORT_REASONS = [
	"Bonne réponse incorrecte",
	"Énoncé faux ou incomplet",
	"Schéma / formule / code manquant ou illisible",
	"Explication fausse ou peu claire",
	"Faute de frappe",
	"Autre",
];

function esc(t) {
	return String(t ?? "").replace(
		/[&<>"']/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			})[c],
	);
}
function txt(t) {
	return esc(t).replace(/\n/g, "<br>");
}
function docOf(q) {
	return (q.src || "").split(",")[0].trim();
}
function loadReported() {
	try {
		return JSON.parse(localStorage.getItem("cctlTrainerReports")) || {};
	} catch {
		return {};
	}
}
function saveReported(r) {
	try {
		localStorage.setItem("cctlTrainerReports", JSON.stringify(r));
	} catch {}
}

function loadStats() {
	try {
		return (
			JSON.parse(localStorage.getItem("cctlTrainerStats")) || {
				answered: 0,
				correct: 0,
				sessions: [],
				topic: {},
			}
		);
	} catch {
		return { answered: 0, correct: 0, sessions: [], topic: {} };
	}
}
function saveStats() {
	localStorage.setItem("cctlTrainerStats", JSON.stringify(state.stats));
}
function toast(msg) {
	const el = $("#toast");
	el.textContent = msg;
	el.classList.add("show");
	setTimeout(() => el.classList.remove("show"), 2100);
}
function pct(a, b) {
	return b ? Math.round((a / b) * 100) : 0;
}
function shuffle(arr) {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}
function unique(a) {
	return [...new Set(a)];
}
function setView(v) {
	state.view = v;
	state.quiz = null;
	$$(".nav-link").forEach((b) =>
		b.classList.toggle("active", b.dataset.view === v),
	);
	$("#crumb").textContent =
		{
			home: "Vue d'ensemble",
			practice: "Entraînement",
			topics: "Par matière",
			stats: "Ma progression",
		}[v] || "Entraînement";
	$("#sidebar").classList.remove("open");
	if (v === "home") renderHome();
	else if (v === "practice") renderPractice();
	else if (v === "topics") renderTopics();
	else if (v === "stats") renderStats();
}
function startQuiz({
	pool = QUESTIONS,
	count = 10,
	mode = "Entraînement",
	topic = "Toutes",
	ordered = false,
} = {}) {
	const chosen = (ordered ? [...pool] : shuffle(pool)).slice(
		0,
		Math.min(count, pool.length),
	);
	if (!chosen.length) {
		toast("Aucune question dans cette sélection.");
		return;
	}
	state.quiz = {
		items: chosen,
		pool,
		count,
		ordered,
		index: 0,
		answers: [],
		selected: [],
		checked: false,
		mode,
		topic,
		score: 0,
	};
	state.view = "quiz";
	$("#crumb").textContent = mode;
	renderQuestion();
}
function renderHome() {
	const total = QUESTIONS.length,
		answered = state.stats.answered,
		correct = state.stats.correct;
	$("#appContent").innerHTML = `
  <section class="hero"><div class="hero-copy"><div class="eyebrow"><span class="eyebrow-dot"></span> TON ESPACE DE RÉVISION</div>
  <h1>Prêt à faire<br><em>la différence ?</em></h1><p>Entraîne-toi sur les notions de tes CCTL, identifie tes points faibles et progresse à ton rythme.</p>
  <button class="primary-btn" id="heroStart">Commencer un entraînement <span>↗</span></button></div>
  <div class="hero-art" aria-hidden="true"><div class="art-ring ring-one"></div><div class="art-ring ring-two"></div><div class="art-card card-back">∑</div><div class="art-card card-front"><span class="art-tick">✓</span><strong>QCM</strong><small>MODE RÉVISION</small><div class="art-bars"><i></i><i></i><i></i><i></i><i></i></div></div><div class="art-orbit">✦</div></div></section>
  <section class="stats-grid">
    ${statCard("Questions dans la banque", total, "▤", "À réviser")}
    ${statCard("Questions répondues", answered, "✓", "Toutes sessions confondues")}
    ${statCard("Bonnes réponses", pct(correct, answered) + "%", "↗", "Taux de réussite")}
    ${statCard("Sessions terminées", state.stats.sessions.length, "◷", "Continue sur ta lancée")}
  </section>
  <section class="section-block"><div class="section-heading"><div><div class="eyebrow muted">CHOISIS TON PARCOURS</div><h2>Que veux-tu travailler ?</h2></div><button class="text-btn" data-view="topics">Voir toutes les matières <span>→</span></button></div>
  <div class="subject-grid">${subjectCard("Mathématiques", "Probabilités, statistiques, graphes, jeux…", "math", "∑", "Mathématiques")}
  ${subjectCard("Sciences du numérique", "Python, algorithmique, OS, Green IT…", "num", "⌘", "Sciences du numérique")}</div></section>
  <section class="section-block bottom-grid"><div class="panel recent-panel"><div class="panel-head"><div><div class="eyebrow muted">REPRENDRE</div><h3>Dernière activité</h3></div><span class="panel-icon">◷</span></div>
  ${state.stats.sessions.length ? recentHtml(state.stats.sessions[0]) : '<div class="recent-empty">Pas encore de session. Lance un premier QCM pour voir tes résultats ici.</div>'}</div>
  <div class="panel tip-panel"><div class="tip-icon">✧</div><div class="eyebrow muted">LE CONSEIL DU JOUR</div><h3>Comprendre vaut mieux que mémoriser.</h3><p>Après chaque réponse, prends quelques secondes pour lire l'explication. C'est là que tu consolides tes connaissances.</p></div></section>`;
	$("#heroStart").onclick = renderPractice;
	$$("[data-view='topics']").forEach(
		(b) => (b.onclick = () => setView("topics")),
	);
}
function statCard(label, value, icon, caption) {
	return `<div class="stat-card"><div class="stat-top">${label}<span class="stat-symbol">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-caption">${caption}</div></div>`;
}
function subjectCard(title, desc, cls, icon, subject) {
	return `<button class="subject-card" data-subject="${subject}"><span class="subject-icon ${cls}">${icon}</span><span><h3>${title}</h3><p>${desc}</p></span><span class="subject-arrow">↗</span></button>`;
}
function recentHtml(s) {
	return `<div class="recent-empty"><strong style="color:#e6ebf2">${esc(s.mode)}</strong><br>${s.date} · ${s.score}/${s.total} bonnes réponses (${pct(s.score, s.total)} %)<br><span style="color:var(--accent)">→ Continue avec un nouveau QCM</span></div>`;
}
function renderPractice() {
	$("#appContent").innerHTML =
		`<div class="view-title"><div><div class="eyebrow muted">À TOI DE JOUER</div><h1>Entraînement</h1><p>Choisis un format de révision selon le temps dont tu disposes.</p></div></div>
  <div class="mode-grid">
    <button class="mode-card" id="quickMode"><div class="mode-ico">⚡</div><h3>QCM rapide</h3><p>10 questions aléatoires pour réviser en quelques minutes.</p></button>
    <button class="mode-card" id="fullMode"><div class="mode-ico">◈</div><h3>Mode examen</h3><p>20 questions mélangées. Découvre ton score à la fin.</p></button>
    <button class="mode-card" id="allMode"><div class="mode-ico">∞</div><h3>Révision complète</h3><p>Parcours toute la banque de questions, sans limite.</p></button>
    <button class="mode-card" id="mathMode"><div class="mode-ico">∑</div><h3>Mathématiques</h3><p>Probabilités, statistiques, complexité, graphes et cryptographie.</p></button>
    <button class="mode-card" id="numMode"><div class="mode-ico">⌘</div><h3>Sciences du numérique</h3><p>Python, structures de données, systèmes et Green IT.</p></button>
    <button class="mode-card" id="topicMode"><div class="mode-ico">▦</div><h3>Choisir un thème</h3><p>Travaille précisément une notion à renforcer.</p></button>
  </div>`;
	$("#quickMode").onclick = () =>
		startQuiz({ count: 10, mode: "QCM rapide" });
	$("#fullMode").onclick = () =>
		startQuiz({ count: 20, mode: "Mode examen" });
	$("#allMode").onclick = () =>
		startQuiz({ count: QUESTIONS.length, mode: "Révision complète" });
	$("#mathMode").onclick = () =>
		startQuiz({
			pool: QUESTIONS.filter((q) => q.subject === "Mathématiques"),
			count: 15,
			mode: "Mathématiques",
			topic: "Mathématiques",
		});
	$("#numMode").onclick = () =>
		startQuiz({
			pool: QUESTIONS.filter(
				(q) => q.subject === "Sciences du numérique",
			),
			count: 15,
			mode: "Sciences du numérique",
			topic: "Sciences du numérique",
		});
	$("#topicMode").onclick = renderTopics;
}
function renderTopics() {
	const topics = unique(QUESTIONS.map((q) => q.topic)).sort();
	const docs = unique(QUESTIONS.map(docOf));
	$("#appContent").innerHTML =
		`<div class="view-title"><div><div class="eyebrow muted">RÉVISER À LA CARTE</div><h1>Par matière</h1><p>Sélectionne un thème ou un CCTL pour lancer un QCM ciblé.</p></div></div>
  <div class="eyebrow muted" style="margin-bottom:10px">PAR CCTL</div>
  <div class="topic-list" style="margin-bottom:26px">${docs.map((d) => `<button class="topic-row" data-doc="${esc(d)}"><span><b>${esc(d)}</b><small>${QUESTIONS.filter((q) => docOf(q) === d).length} questions · dans l'ordre du sujet</small></span><span>↗</span></button>`).join("")}</div>
  <div class="eyebrow muted" style="margin-bottom:10px">PAR THÈME</div>
  <div class="topic-list">${topics.map((t) => `<button class="topic-row" data-topic="${esc(t)}"><span><b>${esc(t)}</b><small>${QUESTIONS.filter((q) => q.topic === t).length} questions · ${unique(QUESTIONS.filter((q) => q.topic === t).map((q) => q.subject)).join(" / ")}</small></span><span>↗</span></button>`).join("")}</div>`;
	$$("[data-topic]").forEach(
		(b) =>
			(b.onclick = () => {
				const t = b.dataset.topic,
					pool = QUESTIONS.filter((q) => q.topic === t);
				startQuiz({ pool, count: pool.length, mode: t, topic: t });
			}),
	);
	$$("[data-doc]").forEach(
		(b) =>
			(b.onclick = () => {
				const d = b.dataset.doc,
					pool = QUESTIONS.filter((q) => docOf(q) === d);
				startQuiz({
					pool,
					count: pool.length,
					mode: d,
					topic: d,
					ordered: true,
				});
			}),
	);
}
function questionExtras(q) {
	let h = "";
	if (q.table) {
		const [head, ...rows] = q.table;
		h += `<div class="q-table-wrap"><table class="q-table"><thead><tr>${head.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
	}
	if (q.img)
		h += `<figure class="q-figure"><img src="${esc(q.img)}" alt="Schéma de la question" loading="lazy"></figure>`;
	if (q.code) h += `<pre class="q-code">${esc(q.code)}</pre>`;
	return h;
}
function renderQuestion() {
	const z = state.quiz,
		q = z.items[z.index],
		n = z.items.length;
	const multi = q.a.length > 1;
	const selected = z.selected;
	const reported = !!loadReported()[q.id];
	$("#appContent").innerHTML = `<div class="quiz-wrap">
    <div class="view-title"><div><div class="eyebrow muted">${esc(z.mode.toUpperCase())}</div><h1>Question ${z.index + 1}</h1><p>${esc(q.subject)} · ${esc(q.topic)}</p></div><button class="back-btn" id="quitQuiz">✕ Quitter</button></div>
    <div class="quiz-top"><span>Progression</span><span>${z.index + 1} / ${n}</span></div><div class="progress-track"><div class="progress-fill" style="width:${((z.index + 1) / n) * 100}%"></div></div>
    <div class="question-card"><div class="question-meta"><span class="tag">${esc(q.subject)}</span><span class="tag green">${multi ? "Plusieurs réponses" : "Une seule réponse"}</span>
    <button class="report-btn ${reported ? "done" : ""}" id="reportBtn" title="Signaler un bug ou une erreur sur cette question">⚑ ${reported ? "Signalée" : "Signaler"}</button></div>
    <h2>${txt(q.q)}</h2>${questionExtras(q)}<p class="question-hint">${multi ? "Sélectionne toutes les bonnes réponses." : "Sélectionne la bonne réponse."}</p>
    <div class="answers">${q.o.map((o, i) => answerHtml(o, i, selected, q, z.checked)).join("")}</div>
    ${z.checked ? feedbackHtml(q, z) : ""}
    <div class="quiz-actions"><button class="secondary-btn" id="skipQuestion">Passer</button>
    ${z.checked ? `<button class="primary-btn small" id="nextQuestion">${z.index === n - 1 ? "Voir mon résultat" : "Question suivante"} <span>→</span></button>` : `<button class="primary-btn small" id="validateAnswer" ${selected.length ? "" : "disabled"}>Valider ma réponse <span>→</span></button>`}</div>
    </div></div>`;
	$("#quitQuiz").onclick = () => setView("practice");
	$("#skipQuestion").onclick = () => advance(true);
	$("#reportBtn").onclick = () => openReport(q);
	if (!z.checked) {
		$$(".answer").forEach(
			(b) =>
				(b.onclick = () => {
					const i = Number(b.dataset.index);
					if (multi) {
						z.selected = selected.includes(i)
							? selected.filter((x) => x !== i)
							: [...selected, i];
					} else {
						z.selected = [i];
					}
					renderQuestion();
				}),
		);
		$("#validateAnswer").onclick = checkAnswer;
	} else $("#nextQuestion").onclick = () => advance(false);
}
function answerHtml(o, i, selected, q, checked) {
	const isSel = selected.includes(i),
		isCorrect = q.a.includes(i);
	let cls = isSel ? "selected" : "";
	if (checked) {
		cls = isCorrect ? "correct" : isSel ? "wrong" : "";
	}
	const body = String(o).includes("\n")
		? `<pre class="answer-code">${esc(o)}</pre>`
		: `<span>${esc(o)}</span>`;
	return `<button class="answer ${cls}" data-index="${i}" ${checked ? "disabled" : ""}><span class="answer-key">${letters[i]}</span>${body}${checked && isCorrect ? '<span style="margin-left:auto;color:#85e2a5">✓</span>' : ""}</button>`;
}
function feedbackHtml(q, z) {
	const last = z.answers[z.answers.length - 1],
		ok = last?.correct;
	return `<div class="feedback ${ok ? "" : "bad"}"><strong>${ok ? "✓ Bonne réponse !" : "✕ Pas tout à fait."}</strong><div class="feedback-text">${esc(q.e)}</div><div style="margin-top:7px;color:#8190a3;font-size:10px">Source : ${esc(q.src)}</div></div>`;
}

/* ===== Signalement ===== */
function detectRepo() {
	if (REPORT_CONFIG.repo) return REPORT_CONFIG.repo;
	const h = location.hostname;
	if (!h.endsWith(".github.io")) return "";
	const owner = h.slice(0, -".github.io".length);
	const seg = location.pathname.split("/").filter(Boolean)[0];
	return owner + "/" + (seg && !seg.includes(".") ? seg : h);
}
function buildReport(q, reason, comment) {
	const z = state.quiz,
		sel = z && z.items[z.index] === q ? z.selected : [];
	const fmt = (o) => (String(o).includes("\n") ? "\n```\n" + o + "\n```" : o);
	const lines = [
		"### Question signalée",
		`- **ID** : \`${q.id}\``,
		`- **Source** : ${q.src}`,
		`- **Matière / thème** : ${q.subject} · ${q.topic}`,
		`- **Motif** : ${reason}`,
		"",
		"**Énoncé**",
		"> " + q.q.replace(/\n/g, "\n> "),
		"",
		"**Propositions**",
		...q.o.map(
			(o, i) =>
				`- ${letters[i]}. ${fmt(o)}${q.a.includes(i) ? "  ✅ (attendue)" : ""}`,
		),
		"",
		`**Réponse(s) attendue(s)** : ${q.a.map((i) => letters[i]).join(", ")}`,
		`**Ma sélection** : ${sel.length ? sel.map((i) => letters[i]).join(", ") : "—"}`,
		"",
		"**Commentaire**",
		comment || "_(aucun)_",
		"",
		`<sub>Envoyé depuis CCTL Trainer · ${new Date().toLocaleString("fr-FR")}</sub>`,
	];
	return {
		title: `[Signalement] ${q.id} — ${reason}`,
		body: lines.join("\n"),
	};
}
function openReport(q) {
	closeReport();
	const repo = detectRepo();
	const wrap = document.createElement("div");
	wrap.className = "modal-backdrop";
	wrap.id = "reportModal";
	wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="reportTitle">
    <div class="modal-head"><div><div class="eyebrow muted">SIGNALER UN PROBLÈME</div><h3 id="reportTitle">Question ${esc(q.id)}</h3><p class="modal-sub">${esc(q.src)}</p></div><button class="modal-close" id="reportClose" aria-label="Fermer">✕</button></div>
    <div class="modal-label">Quel est le problème ?</div>
    <div class="reason-list">${REPORT_REASONS.map((r, i) => `<label class="reason"><input type="radio" name="reason" value="${esc(r)}" ${i === 0 ? "checked" : ""}><span>${esc(r)}</span></label>`).join("")}</div>
    <div class="modal-label">Précisions <span class="muted">(facultatif)</span></div>
    <textarea id="reportComment" rows="4" placeholder="Ex. : la bonne réponse devrait être C car…"></textarea>
    <p class="modal-note">${repo ? `Le signalement s'ouvre sur GitHub (<b>${esc(repo)}</b>) avec tout le contexte pré-rempli. Un compte GitHub est nécessaire pour valider.` : `Aucun dépôt GitHub détecté : copie le signalement et envoie-le au responsable du site.`}</p>
    <div class="modal-actions"><button class="secondary-btn" id="reportCopy">Copier le signalement</button>
    ${repo || REPORT_CONFIG.email ? `<button class="primary-btn small" id="reportSend">${repo ? "Ouvrir sur GitHub" : "Envoyer par e-mail"} <span>↗</span></button>` : ""}</div>
  </div>`;
	document.body.appendChild(wrap);
	const get = () =>
		buildReport(
			q,
			$("input[name=reason]:checked", wrap).value,
			$("#reportComment", wrap).value.trim(),
		);
	const done = () => {
		const r = loadReported();
		r[q.id] = Date.now();
		saveReported(r);
		const b = $("#reportBtn");
		if (b) {
			b.classList.add("done");
			b.textContent = "⚑ Signalée";
		}
	};
	$("#reportClose", wrap).onclick = closeReport;
	wrap.addEventListener("click", (e) => {
		if (e.target === wrap) closeReport();
	});
	$("#reportCopy", wrap).onclick = async () => {
		const { title, body } = get();
		try {
			await navigator.clipboard.writeText(title + "\n\n" + body);
			done();
			toast("Signalement copié dans le presse-papiers.");
		} catch {
			toast("Copie impossible sur ce navigateur.");
		}
	};
	const send = $("#reportSend", wrap);
	if (send)
		send.onclick = () => {
			const { title, body } = get();
			const url = repo
				? `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
				: `mailto:${REPORT_CONFIG.email}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
			window.open(url, "_blank", "noopener");
			done();
			closeReport();
			toast("Merci pour ton signalement !");
		};
	document.addEventListener("keydown", escClose);
	setTimeout(() => $("#reportComment", wrap)?.focus(), 50);
}
function escClose(e) {
	if (e.key === "Escape") closeReport();
}
function closeReport() {
	$("#reportModal")?.remove();
	document.removeEventListener("keydown", escClose);
}
function checkAnswer() {
	const z = state.quiz,
		q = z.items[z.index];
	const ok =
		z.selected.length === q.a.length &&
		q.a.every((a) => z.selected.includes(a));
	z.checked = true;
	z.answers.push({ id: q.id, correct: ok, selected: [...z.selected] });
	if (ok) z.score++;
	state.stats.answered++;
	if (ok) state.stats.correct++;
	state.stats.topic[q.topic] ??= { answered: 0, correct: 0 };
	state.stats.topic[q.topic].answered++;
	if (ok) state.stats.topic[q.topic].correct++;
	saveStats();
	renderQuestion();
}
function advance(skipped) {
	const z = state.quiz;
	if (skipped)
		z.answers.push({
			id: z.items[z.index].id,
			correct: false,
			selected: [],
		});
	if (z.index < z.items.length - 1) {
		z.index++;
		z.selected = [];
		z.checked = false;
		renderQuestion();
	} else finishQuiz();
}
function finishQuiz() {
	const z = state.quiz,
		score = z.score,
		total = z.items.length;
	const session = {
		mode: z.mode,
		score,
		total,
		date: new Date().toLocaleDateString("fr-FR"),
	};
	state.stats.sessions.unshift(session);
	state.stats.sessions = state.stats.sessions.slice(0, 30);
	saveStats();
	$("#crumb").textContent = "Résultat";
	$("#appContent").innerHTML =
		`<div class="result-card"><div class="eyebrow muted" style="justify-content:center;margin-bottom:17px">SESSION TERMINÉE</div>
  <div class="result-ring"><strong>${pct(score, total)}%</strong></div><h2>${score === total ? "Excellent travail !" : score >= total * 0.7 ? "Bien joué !" : "Continue tes efforts !"}</h2>
  <p>Tu as obtenu <b style="color:#f4f6fb">${score} bonne(s) réponse(s) sur ${total}</b> en ${z.mode}. Chaque session t'aide à identifier ce qu'il reste à consolider.</p>
  <div class="stats-grid" style="margin:22px 0 0;grid-template-columns:repeat(2,1fr)">${statCard("Bonnes réponses", score, "✓", "Réponses correctes")}${statCard("À retravailler", total - score, "↗", "Réponses incorrectes ou passées")}</div>
  <div class="result-actions"><button class="primary-btn" id="retryBtn">Recommencer <span>↻</span></button><button class="secondary-btn" id="homeBtn">Retour à l'accueil</button><button class="secondary-btn" id="statsBtn">Ma progression</button></div></div>`;
	$("#retryBtn").onclick = () =>
		startQuiz({
			pool: z.pool,
			count: z.count,
			mode: z.mode,
			topic: z.topic,
			ordered: z.ordered,
		});
	$("#homeBtn").onclick = () => setView("home");
	$("#statsBtn").onclick = () => setView("stats");
}
function renderStats() {
	const answered = state.stats.answered,
		correct = state.stats.correct;
	const topicRows = Object.entries(state.stats.topic).sort(
		(a, b) =>
			pct(a[1].correct, a[1].answered) - pct(b[1].correct, b[1].answered),
	);
	$("#appContent").innerHTML =
		`<div class="view-title"><div><div class="eyebrow muted">TON ÉVOLUTION</div><h1>Ma progression</h1><p>Un aperçu de tes résultats, enregistré directement sur cet appareil.</p></div><button class="back-btn" id="resetStats">Réinitialiser</button></div>
  <div class="stats-grid">${statCard("Questions répondues", answered, "✓", "Toutes sessions")}${statCard("Bonnes réponses", correct, "✦", "Réussites")}${statCard("Taux de réussite", pct(correct, answered) + "%", "↗", "Sur l'ensemble des réponses")}${statCard("Sessions", state.stats.sessions.length, "◷", "QCM terminés")}</div>
  <div class="stats-panels"><div class="panel"><div class="eyebrow muted">PAR THÈME</div><h3>Points à consolider</h3>${topicRows.length ? topicRows.map(([t, v]) => `<div class="progress-item"><div class="progress-label"><span>${t}</span><span>${pct(v.correct, v.answered)} % · ${v.answered} réponses</span></div><div class="progress-track slim"><div class="progress-fill" style="width:${pct(v.correct, v.answered)}%"></div></div></div>`).join("") : '<div class="recent-empty">Réponds à quelques questions pour afficher tes statistiques par thème.</div>'}</div>
  <div class="panel"><div class="eyebrow muted">HISTORIQUE</div><h3>Dernières sessions</h3>${
		state.stats.sessions.length
			? state.stats.sessions
					.slice(0, 8)
					.map(
						(s) =>
							`<div class="progress-item"><div class="progress-label"><span>${s.mode}</span><span>${s.score}/${s.total} · ${pct(s.score, s.total)} %</span></div><div class="progress-track slim"><div class="progress-fill" style="width:${pct(s.score, s.total)}%"></div></div><div style="font-size:9px;color:#778397;margin-top:5px">${s.date}</div></div>`,
					)
					.join("")
			: '<div class="recent-empty">Aucune session pour le moment.</div>'
  }</div></div>`;
	$("#resetStats").onclick = () => {
		if (
			confirm(
				"Effacer toutes les statistiques enregistrées sur cet appareil ?",
			)
		) {
			state.stats = { answered: 0, correct: 0, sessions: [], topic: {} };
			saveStats();
			renderStats();
			toast("Statistiques réinitialisées.");
		}
	};
}
function bindNav() {
	$$(".nav-link").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
	$$("[data-view]").forEach((b) => {
		if (!b.classList.contains("nav-link"))
			b.onclick = () => setView(b.dataset.view);
	});
	$("#menuBtn").onclick = () => $("#sidebar").classList.toggle("open");
	document.addEventListener("click", (e) => {
		const b = e.target.closest("[data-subject]");
		if (b) {
			const s = b.dataset.subject;
			startQuiz({
				pool: QUESTIONS.filter((q) => q.subject === s),
				count: 15,
				mode: s,
				topic: s,
			});
		}
	});
}
async function init() {
	try {
		const r = await fetch("questions.json");
		QUESTIONS = await r.json();
	} catch (e) {
		$("#appContent").innerHTML =
			'<div class="empty-state">Impossible de charger questions.json. Vérifie que les fichiers du site sont tous présents dans le même dossier.</div>';
		return;
	}
	bindNav();
	renderHome();
}
init();
