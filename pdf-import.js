/* =========================================================================
   CCTL Trainer — convertisseur PDF → questions (100 % dans le navigateur)
   Lit les PDF de correction CCTL (format « Question N / Réponse attendue /
   Commentaire de correction ») avec PDF.js et produit des questions :
   texte, code, propositions, bonne(s) réponse(s), explication.
   Les schémas, tableaux et formules dessinés sont découpés en images.
   ========================================================================= */
import * as pdfjsLib from "./lib/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./lib/pdf.worker.min.mjs", import.meta.url).href;
const FONT_URL = new URL("./lib/standard_fonts/", import.meta.url).href;

export const PARSER_VERSION = 3;
const ANALYSIS_SCALE = 1.5;   // rendu pour détecter les zones dessinées
const CROP_SCALE = 2;         // rendu pour les images découpées
const DARK = 185;             // luminance sous laquelle un pixel est de « l'encre »
const CHECKED = new Set(["☑", "☒", "✅", "✓", "✔"]);
const BOXES = new Set(["☑", "☒", "■", "☐", "□", "✅", "✓", "✔"]);

/* ---------- utilitaires ---------- */
const cmp = (a, b) => a.p - b.p || a.yb - b.yb || a.x - b.x;
const before = (a, b) => a.p < b.p || (a.p === b.p && a.yb < b.yb);
const between = (it, s, e) => !before(it, s) && before(it, e);
function slug(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "cctl";
}
export async function sha256(buf) {
  if (crypto?.subtle) {
    const h = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 2166136261; const u = new Uint8Array(buf);           // secours hors HTTPS
  for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619); }
  return "f" + (h >>> 0).toString(16) + u.length.toString(16);
}

/* ---------- thème automatique ---------- */
const TOPICS = [
  ["Graphes", [/graphe/, /sommet/, /arête/, /\bbfs\b/, /\bdfs\b/, /dijkstra/, /adjacence/, /chromatique/, /cordal/, /\bdag\b/, /plus court chemin/, /largeur|profondeur/]],
  ["Cryptographie", [/\brsa\b/, /chiffr/, /césar/, /euclide/, /mersenne/, /sha-?256/, /clé (publique|privée)/, /φ\(n\)/, /cryptograph/, /factoriser/]],
  ["Green IT", [/green/, /énergi/, /co₂|co2/, /carbone/, /data ?cent/, /\bpue\b/, /éco-?concep/, /écolog/, /durable/, /refroidissement/]],
  ["Probabilités", [/probabilit/, /loi (de|normale|géométrique)/, /poisson/, /bernoulli/, /espérance/, /file d'attente/, /tirage|lancer|dé /]],
  ["Théorie des jeux", [/nash/, /point selle/, /somme nulle/, /minimax|maximin/, /stratégie/, /jeu (séquentiel|statique|coopératif|dynamique|symétrique)/, /équilibre/]],
  ["Statistiques", [/moyenne/, /médiane/, /écart-type/, /quartile/, /corrélation/, /régression/, /histogramme/, /z-score/, /boxplot|boîte à moustaches/, /\biqr\b/, /aberrant|outlier/, /moindres carrés/, /distribution/, /nuage de points/, /erreur (absolue|relative)/, /hypothèse/]],
  ["Systèmes d'exploitation", [/système d.exploitation/, /\bos\b/, /noyau|kernel/, /driver|pilote/, /fragmentation/, /processus/, /scheduling|ordonnanc/, /gestionnaire des tâches/]],
  ["Structures de données", [/hachage|hash/, /liste chaînée/, /\bpile\b/, /structure de données/, /dictionnaire/]],
  ["Algorithmique", [/complexité/, /\bo\(/, /algorithme/, /dichotom/, /\btri\b/, /récursi/]],
  ["Python", [/python/, /numpy|\bnp\./, /pandas|\bpd\./, /matplotlib|\bplt\./, /\bdef\b/, /\bimport\b/]],
  ["Modélisation et mesure", [/modèle/, /expérien/, /mesure/, /capteur/, /données expérimentales/, /serveur web/]],
];
export function guessTopic(q) {
  const main = (q.q + " " + (q.code || "")).toLowerCase(), opts = q.o.join(" ").toLowerCase();
  let best = "Divers", score = 0;
  for (const [t, res] of TOPICS) {
    let s = 0;
    for (const r of res) { if (r.test(main)) s += 2; if (r.test(opts)) s += 1; }
    if (s > score) { score = s; best = t; }
  }
  return best;
}
export function guessSubject(title) {
  const t = title.toLowerCase();
  if (/math/.test(t)) return "Mathématiques";
  if (/num[ée]rique|informatique/.test(t)) return "Sciences du numérique";
  return title;
}
function cleanTitle(t, fallback) {
  t = (t || "").replace(/^sciences fondamentales\s*[-–]\s*/i, "").replace(/\s+\d{2}-\d{2}\b.*$/, "").trim();
  return t || fallback.replace(/\.pdf$/i, "");
}

/* ---------- texte ---------- */
function groupLines(items) {
  const lines = [];
  for (const it of [...items].sort(cmp)) {
    const l = lines[lines.length - 1];
    if (l && l.p === it.p && Math.abs(l.yb - it.yb) <= 3.2) { l.items.push(it); continue; }
    lines.push({ p: it.p, yb: it.yb, items: [it] });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.x0 = Math.min(...l.items.map(i => i.x));
    l.x1 = Math.max(...l.items.map(i => i.x + i.w));
    l.top = Math.min(...l.items.map(i => i.top));
    l.bottom = Math.max(...l.items.map(i => i.bottom));
    const hs = l.items.map(i => i.h).sort((a, b) => a - b);
    l.small = hs[hs.length >> 1] <= 9;
    l.gaps = 0;
    for (let k = 1; k < l.items.length; k++) {
      const a = l.items[k - 1], b = l.items[k];
      if (b.x - (a.x + a.w) > 30) l.gaps++;
    }
  }
  return lines;
}
function lineText(l) {
  let s = l.bullet ? "• " : "";
  l.items.forEach((it, k) => {
    if (k) {
      const a = l.items[k - 1], gap = it.x - (a.x + a.w);
      if (gap > 1.2 && !s.endsWith(" ") && !it.s.startsWith(" ")) s += gap > 30 ? "   " : " ";
    }
    s += it.s;
  });
  return s.replace(/\s+$/, "");
}
/* lignes → blocs {t:"p"|"code", text, top, bottom, p} */
function toBlocks(lines) {
  const blocks = [];
  const normal = lines.filter(l => !l.small);
  const right = normal.length ? Math.max(...normal.map(l => l.x1)) : 0;
  let prev = null;
  for (const l of lines) {
    const t = l.small ? "code" : "p";
    const b = blocks[blocks.length - 1];
    const gap = prev ? (prev.p === l.p ? l.top - prev.bottom : 6) : 99;
    if (b && b.t === t && gap < (t === "code" ? 16 : 12)) {
      b.lines.push(l);
    } else blocks.push({ t, lines: [l] });
    prev = l;
  }
  for (const b of blocks) {
    if (b.t === "code") {
      // niveaux d'indentation : chaque retrait distinct = 4 espaces
      const xs = [];
      for (const x of b.lines.map(l => l.x0).sort((a, b) => a - b)) if (!xs.length || x - xs[xs.length - 1] > 2.5) xs.push(x);
      const lvl = x => xs.findIndex(v => Math.abs(v - x) <= 2.5);
      b.text = b.lines.map((l, k) => (k && l.top - b.lines[k - 1].bottom > 5 ? "\n" : "") + "    ".repeat(Math.max(0, lvl(l.x0))) + lineText(l)).join("\n");
    } else {
      let s = "";
      b.lines.forEach((l, k) => {
        if (k) s += (l.bullet || b.lines[k - 1].x1 < right * 0.82) ? "\n" : " ";
        s += lineText(l).trim();
      });
      b.text = s.replace(/[ \t]+/g, " ");
    }
    b.top = b.lines[0].top; b.bottom = b.lines[b.lines.length - 1].bottom; b.p = b.lines[0].p;
  }
  return blocks;
}
const blocksText = bl => bl.map(b => b.text).join("\n").trim();

/* ---------- géométrie multi-pages ---------- */
function segments(p0, y0, p1, y1, x0, x1, H) {
  const out = [];
  for (let p = p0; p <= p1; p++) {
    const top = p === p0 ? y0 : 24, bot = p === p1 ? y1 : H - 48;
    if (bot - top > 2) out.push({ p, x0, x1, y0: top, y1: bot });
  }
  return out;
}

/* ---------- analyse pixel : trouve l'« encre » qui n'est pas du texte ---------- */
function analyseRegion(img, W, mask, seg, s, wantLight) {
  const X0 = Math.max(0, Math.floor(seg.x0 * s)), X1 = Math.min(W, Math.ceil(seg.x1 * s));
  const Y0 = Math.max(0, Math.floor(seg.y0 * s)), Y1 = Math.ceil(seg.y1 * s);
  const d = img.data, bands = [], light = [];
  let cur = null, lc = null;
  for (let y = Y0; y < Y1; y++) {
    let n = 0, mn = 1e9, mx = -1, ln = 0, lmn = 1e9, lmx = -1;
    for (let x = X0; x < X1; x++) {
      const k = y * W + x;
      if (mask[k]) continue;
      const o = k * 4, lum = (d[o] * 299 + d[o + 1] * 587 + d[o + 2] * 114) / 1000;
      if (lum < DARK) { n++; if (x < mn) mn = x; if (x > mx) mx = x; }
      if (wantLight && lum < 238) { ln++; if (x < lmn) lmn = x; if (x > lmx) lmx = x; }
    }
    if (n >= 2) {
      if (cur && y - cur.y1 <= 6) { cur.y1 = y; cur.n += n; cur.x0 = Math.min(cur.x0, mn); cur.x1 = Math.max(cur.x1, mx); }
      else { cur = { y0: y, y1: y, n, x0: mn, x1: mx }; bands.push(cur); }
    }
    if (ln >= 3) {
      if (lc && y - lc.y1 <= 3) { lc.y1 = y; lc.x0 = Math.min(lc.x0, lmn); lc.x1 = Math.max(lc.x1, lmx); }
      else { lc = { y0: y, y1: y, x0: lmn, x1: lmx }; light.push(lc); }
    }
  }
  const conv = b => ({ p: seg.p, y0: b.y0 / s, y1: (b.y1 + 1) / s, x0: b.x0 / s, x1: (b.x1 + 1) / s, n: b.n });
  return { ink: bands.filter(b => b.n >= 14).map(conv), light: light.filter(b => b.y1 - b.y0 > 6).map(conv) };
}

/* encre parasite : puces de liste (marquent la ligne) et filets horizontaux */
function cleanInk(ink, lines) {
  return ink.filter(b => {
    const h = b.y1 - b.y0, w = b.x1 - b.x0;
    if (h <= 3.5 && w >= 100) return false;                       // filet / bordure
    if (w >= 200 && b.n / (w * h * ANALYSIS_SCALE * ANALYSIS_SCALE) > 0.7) return false;  // bandeau décoratif plein
    if (w <= 9 && h <= 9) {
      const l = lines.find(l => l.p === b.p && b.y0 < l.bottom && b.y1 > l.top && b.x1 <= l.x0 + 1.5 && l.x0 - b.x1 < 18);
      if (l) { l.bullet = true; return false; }                   // puce « • »
    }
    return true;
  });
}

async function renderPage(page, scale) {
  const vp = page.getViewport({ scale });
  const c = document.createElement("canvas");
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return c;
}

/* ===================================================================== */
export async function parsePdf(data, { fileName = "document.pdf", onProgress = () => {} } = {}) {
  const doc = await pdfjsLib.getDocument({ data, standardFontDataUrl: FONT_URL, isEvalSupported: false, verbosity: 0 }).promise;
  const N = doc.numPages, pages = [], all = [];
  let W = 0, H = 0;
  for (let p = 0; p < N; p++) {
    onProgress({ step: "texte", page: p + 1, pages: N });
    const page = await doc.getPage(p + 1);
    const vp = page.getViewport({ scale: 1 });
    W = vp.width; H = vp.height;
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const h = Math.abs(it.transform[3]) || it.height || 10;
      const yb = vp.height - it.transform[5];
      items.push({ p, x: it.transform[4], yb, w: it.width, h, s: it.str, top: yb - h * 0.92, bottom: yb + h * 0.3 });
    }
    pages.push({ page, items, W: vp.width, H: vp.height });
    all.push(...items);
  }
  all.sort(cmp);

  /* --- titre --- */
  const p0 = pages[0]?.items || [];
  const firstQ = all.find(i => /^Question\s+\d+$/.test(i.s.trim()));
  const big = p0.filter(i => i.h >= 16 && (!firstQ || before(i, firstQ))).sort((a, b) => b.h - a.h || a.yb - b.yb);
  const rawTitle = (big[0] || {}).s || "";
  const title = cleanTitle(rawTitle, fileName);
  const subject = guessSubject(title);

  /* --- découpage en questions --- */
  const heads = all.filter(i => /^Question\s+\d+$/.test(i.s.trim()) && i.x < 160);
  if (!heads.length) throw new Error("Aucune « Question N » trouvée : ce PDF ne ressemble pas à une correction de CCTL.");
  const end = { p: N - 1, yb: H + 1, x: 0 };
  const Q = [];
  heads.forEach((h, k) => {
    const next = heads[k + 1] || end;
    const its = all.filter(i => between(i, h, next) && i !== h);
    const footer = i => /^\d+\s*\/\s*\d+$/.test(i.s.trim()) && i.yb > i_H(i) - 60;
    const i_H = i => pages[i.p].H;
    const body = its.filter(i => !footer(i) && !(i.p === h.p && Math.abs(i.yb - h.yb) < 4));
    const num = +h.s.match(/\d+/)[0];

    const banner = body.find(i => /^R[ée]ponses?\s+(correctes|incorrectes|partiellement)|point obtenu|discordance/i.test(i.s));
    const discordItem = body.find(i => /discordante/i.test(i.s));
    const headerLabels = body.filter(i => /^(R[ée]ponse|attendue|saisie|discordante|R[ée]ponse (attendue|saisie|discordante))$/i.test(i.s.trim()));
    const tableTop = banner || headerLabels[0];
    if (!tableTop || !discordItem) return;               // pas un QCM exploitable
    const discordX = discordItem.x;
    const headerEnd = discordItem;   // premier en-tête du tableau (il peut être répété en haut de page)
    const commentHead = body.find(i => /^Commentaire de correction/i.test(i.s.trim()));

    const stmtItems = body.filter(i => before(i, tableTop) && !BOXES.has(i.s.trim()));
    const rowsLetters = body.filter(i => /^[A-H]$/.test(i.s.trim()) && i.x < 85 && before(headerEnd, i) && (!commentHead || before(i, commentHead)));
    if (rowsLetters.length < 2) return;

    // --- propositions ---
    const tableEnd = commentHead || next;
    const optAll = body.filter(i => before(headerEnd, i) && before(i, tableEnd) && i.x >= discordX + 55 && !BOXES.has(i.s.trim()));
    const optColX = Math.min(discordX + 50, optAll.length ? Math.min(...optAll.map(i => i.x)) - 6 : 1e9);
    const rows = rowsLetters.map((r, j) => {
      const nx = rowsLetters[j + 1];
      const yEndP = nx ? nx.p : tableEnd.p, yEnd = nx ? nx.yb - 13 : (commentHead ? commentHead.top - 8 : (tableEnd === end ? H - 48 : tableEnd.top - 14));
      const s0 = { p: r.p, yb: r.yb - 13 }, e0 = { p: yEndP, yb: yEnd };
      const inRow = i => !before(i, s0) && before(i, e0);
      const boxes = body.filter(i => inRow(i) && BOXES.has(i.s.trim()) && i.x < discordX).sort((a, b) => a.x - b.x);
      const txtItems = optAll.filter(inRow);
      const lines = groupLines(txtItems);
      const allSmall = lines.length && lines.every(l => l.small);
      const text = allSmall ? toBlocks(lines).map(b => b.text).join("\n") : lines.map(l => lineText(l).trim()).join(" ").replace(/\s+/g, " ");
      return {
        letter: r.s.trim(), expected: boxes.length ? CHECKED.has(boxes[0].s.trim()) : false, text, txtItems,
        segs: segments(s0.p, s0.yb, e0.p, e0.yb, optColX, W - 30, H)
      };
    });

    // --- énoncé ---
    const sLines = groupLines(stmtItems);
    const tab = new Set();
    sLines.forEach((l, j) => {
      const isTab = x => x && !x.small && x.items.length >= 2 && x.gaps >= 1;
      if (isTab(l) && (isTab(sLines[j - 1]) || isTab(sLines[j + 1]))) tab.add(l);
    });
    const tabBands = [];
    for (const l of sLines) {
      if (!tab.has(l)) continue;
      const b = tabBands[tabBands.length - 1];
      if (b && b.p === l.p && l.top - b.y1 < 40) { b.y1 = l.bottom; b.x0 = Math.min(b.x0, l.x0); b.x1 = Math.max(b.x1, l.x1); b.lines.push(l); }
      else tabBands.push({ p: l.p, y0: l.top, y1: l.bottom, x0: l.x0, x1: l.x1, lines: [l] });
    }
    const textLines = sLines.filter(l => !tab.has(l));
    const sTopY = h.yb + 18, sBot = tableTop.top - 9;
    const stmtSegs = segments(h.p, sTopY, tableTop.p, sBot, 48, W - 48, H);

    // --- commentaire ---
    let cItems = [], commentSegs = [];
    if (commentHead) {
      cItems = body.filter(i => before(commentHead, i) && i !== commentHead && !(i.p === commentHead.p && Math.abs(i.yb - commentHead.yb) < 4));
      const cEnd = next === end ? { p: N - 1, yb: H - 48 } : { p: next.p, yb: next.top - 22 };
      commentSegs = segments(commentHead.p, commentHead.bottom + 2, cEnd.p, cEnd.yb, 50, W - 48, H);
    }
    const cLines = groupLines(cItems);

    Q.push({
      num, rows, sLines, textLines, tabBands, stmtSegs, stmtItems,
      cItems, cLines, commentSegs,
      typeLabel: (its.find(i => /Question à r[ée]ponse/i.test(i.s)) || {}).s || ""
    });
  });
  if (!Q.length) throw new Error("Questions trouvées mais aucun tableau de réponses lisible.");

  /* --- passe 1 : détection des zones dessinées, page par page --- */
  const regions = [];   // {q, kind, idx, seg}
  for (const q of Q) {
    q.stmtSegs.forEach(seg => regions.push({ q, kind: "stmt", seg }));
    q.rows.forEach((r, idx) => r.segs.forEach(seg => regions.push({ q, kind: "opt", idx, seg })));
    q.commentSegs.forEach(seg => regions.push({ q, kind: "com", seg }));
  }
  for (const q of Q) { q.inkStmt = []; q.lightStmt = []; q.inkOpt = q.rows.map(() => []); q.inkCom = []; }
  const pagesWithRegions = [...new Set(regions.map(r => r.seg.p))].sort((a, b) => a - b);
  let done = 0;
  for (const p of pagesWithRegions) {
    onProgress({ step: "schémas", page: ++done, pages: pagesWithRegions.length });
    const pg = pages[p], s = ANALYSIS_SCALE;
    const c = await renderPage(pg.page, s);
    const Wp = c.width, Hp = c.height;
    const img = c.getContext("2d").getImageData(0, 0, Wp, Hp);
    const mask = new Uint8Array(Wp * Hp);
    for (const it of pg.items) {
      const x0 = Math.max(0, Math.floor((it.x - 1.5) * s)), x1 = Math.min(Wp, Math.ceil((it.x + it.w + 1.5) * s));
      const y0 = Math.max(0, Math.floor((it.top - 1.5) * s)), y1 = Math.min(Hp, Math.ceil((it.bottom + 1.5) * s));
      for (let y = y0; y < y1; y++) mask.fill(1, y * Wp + x0, y * Wp + x1);
    }
    for (const r of regions.filter(r => r.seg.p === p)) {
      const { ink, light } = analyseRegion(img, Wp, mask, r.seg, s, r.kind === "stmt");
      if (r.kind === "stmt") { r.q.inkStmt.push(...ink); r.q.lightStmt.push(...light); }
      else if (r.kind === "opt") r.q.inkOpt[r.idx].push(...ink);
      else r.q.inkCom.push(...ink);
    }
    c.width = c.height = 0;
  }

  /* --- décisions + demandes de découpe --- */
  const crops = [];   // {segs, target:(dataURL)=>void}
  const box = (its, ink, pad) => {
    // union des boîtes (texte + encre), regroupée par page
    const by = new Map();
    for (const b of [...its.map(i => ({ p: i.p, x0: i.x, x1: i.x + i.w, y0: i.top, y1: i.bottom })), ...ink]) {
      const m = by.get(b.p) || { p: b.p, x0: 1e9, x1: -1, y0: 1e9, y1: -1 };
      m.x0 = Math.min(m.x0, b.x0); m.x1 = Math.max(m.x1, b.x1); m.y0 = Math.min(m.y0, b.y0); m.y1 = Math.max(m.y1, b.y1);
      by.set(b.p, m);
    }
    const segs = [...by.values()].sort((a, b) => a.p - b.p).map(m => ({ p: m.p, x0: m.x0 - pad, x1: m.x1 + pad, y0: m.y0 - pad, y1: m.y1 + pad }));
    if (segs.length) { const X0 = Math.min(...segs.map(s => s.x0)), X1 = Math.max(...segs.map(s => s.x1)); segs.forEach(s => { s.x0 = X0; s.x1 = X1; }); }
    return segs;
  };
  const overlapsLine = (b, lines) => lines.some(l => l.p === b.p && b.y0 < l.bottom - 1 && b.y1 > l.top + 1);
  const inTab = (b, tabs) => tabs.some(t => t.p === b.p && b.y0 < t.y1 + 4 && b.y1 > t.y0 - 4);

  const out = Q.map(q => {
    const res = {
      id: `${slug(title)}-q${String(q.num).padStart(2, "0")}`,
      num: q.num, subject, doc: title, src: `${title}, Q${q.num}`,
      blocks: [], q: "", o: [], oImg: [], a: [], e: "", eImg: null, hasFigure: false,
    };
    // énoncé : tableaux (avec ou sans bordures)
    const absorbed = new Set(), tables = [];
    for (const t of q.tabBands) {
      const r = { p: t.p, y0: t.y0, y1: t.y1, x0: t.x0, x1: t.x1 };
      const lb = q.lightStmt.filter(b => b.p === t.p && b.y0 < t.y1 && b.y1 > t.y0);
      if (lb.length) {
        r.y0 = Math.min(r.y0, ...lb.map(b => b.y0)); r.y1 = Math.max(r.y1, ...lb.map(b => b.y1));
        r.x0 = Math.min(r.x0, ...lb.map(b => b.x0)); r.x1 = Math.max(r.x1, ...lb.map(b => b.x1));
      } else {
        for (let again = true; again;) {
          again = false;
          for (const l of q.textLines) {
            if (absorbed.has(l) || l.p !== r.p) continue;
            if (l.top < r.y1 + 8 && l.bottom > r.y0 - 8) {
              r.y0 = Math.min(r.y0, l.top); r.y1 = Math.max(r.y1, l.bottom); r.x0 = Math.min(r.x0, l.x0); r.x1 = Math.max(r.x1, l.x1);
              absorbed.add(l); again = true;
            }
          }
        }
        r.y0 -= 4; r.y1 += 4; r.x0 -= 8; r.x1 += 8;
      }
      if (r.x1 >= W - 52) r.x1 = W - 40;
      if (r.x0 <= 52) r.x0 = 42;
      for (const l of q.textLines) { const m = (l.top + l.bottom) / 2; if (l.p === r.p && m > r.y0 && m < r.y1) absorbed.add(l); }
      tables.push(r);
    }
    const textLines = q.textLines.filter(l => !absorbed.has(l));
    const ink = cleanInk(q.inkStmt.filter(b => !inTab(b, tables)), textLines);
    const inline = ink.some(b => overlapsLine(b, textLines));
    const sBlocks = toBlocks(textLines);
    res.q = [blocksText(sBlocks), ...q.tabBands.map(t => t.lines.map(lineText).join("\n"))].filter(Boolean).join("\n") || "(énoncé en image)";
    if (inline) {
      const blk = { t: "img", src: "", alt: res.q };
      res.blocks = [blk]; res.hasFigure = true;
      crops.push({ segs: box(q.stmtItems, q.inkStmt, 7), set: (u, w) => { blk.src = u; blk.w = w; } });
    } else {
      const parts = sBlocks.map(b => ({ t: b.t, text: b.text, p: b.p, y: b.top }));
      for (const t of tables) {
        const blk = { t: "img", src: "", alt: "Tableau", p: t.p, y: t.y0 };
        parts.push(blk); crops.push({ segs: [{ p: t.p, x0: t.x0 - 2, x1: t.x1 + 2, y0: t.y0 - 2, y1: t.y1 + 2 }], set: (u, w) => { blk.src = u; blk.w = w; } });
      }
      // regroupe les bandes d'encre proches en figures
      const figs = [];
      for (const b of ink.sort((a, b) => a.p - b.p || a.y0 - b.y0)) {
        const f = figs[figs.length - 1];
        if (f && f.p === b.p && b.y0 - f.y1 < 14) { f.y1 = Math.max(f.y1, b.y1); f.x0 = Math.min(f.x0, b.x0); f.x1 = Math.max(f.x1, b.x1); }
        else figs.push({ ...b });
      }
      for (const f of figs) {
        const blk = { t: "img", src: "", alt: "Schéma", p: f.p, y: f.y0 };
        parts.push(blk); crops.push({ segs: box([], [f], 6), set: (u, w) => { blk.src = u; blk.w = w; } });
      }
      parts.sort((a, b) => a.p - b.p || a.y - b.y);
      res.blocks = parts;   // les blocs image sont remplis par la passe 2 (mêmes objets)
      res.hasFigure = parts.some(p => p.t === "img");
      res.code = parts.filter(p => p.t === "code").map(p => p.text).join("\n\n");
    }
    // propositions
    q.rows.forEach((r, i) => {
      res.o.push(r.text || `(proposition ${r.letter} en image)`);
      res.oImg.push(null);
      if (r.expected) res.a.push(i);
      const oInk = cleanInk(q.inkOpt[i], groupLines(r.txtItems));
      if (oInk.length || !r.text) {
        const segs = box(r.txtItems, oInk, 4);
        if (segs.length) crops.push({ segs, set: (u, w) => res.oImg[i] = { src: u, w } });
      }
    });
    // commentaire
    const cInk = cleanInk(q.inkCom, q.cLines);
    res.e = blocksText(toBlocks(q.cLines));
    if (cInk.length) crops.push({ segs: box(q.cItems, cInk, 6), set: (u, w) => res.eImg = { src: u, w } });
    res.type = res.a.length > 1 ? "multiple" : "single";
    res.topic = guessTopic(res);
    if (!res.a.length) res.warning = "Aucune réponse attendue cochée dans le PDF";
    return res;
  });

  /* --- passe 2 : découpes haute définition --- */
  const needPages = [...new Set(crops.flatMap(c => c.segs.map(s => s.p)))].sort((a, b) => a - b);
  const canv = new Map();
  // rend les pages au fur et à mesure et garde au plus 2 pages en mémoire
  const pending = crops.map(c => ({ ...c, parts: [] }));
  let k = 0;
  for (const p of needPages) {
    onProgress({ step: "images", page: ++k, pages: needPages.length });
    const c = await renderPage(pages[p].page, CROP_SCALE);
    canv.set(p, c);
    for (const job of pending) {
      if (!job.parts) continue;
      for (const sg of job.segs.filter(s => s.p === p)) {
        const s = CROP_SCALE, x = Math.max(0, sg.x0 * s), y = Math.max(0, sg.y0 * s);
        const w = Math.min(c.width - x, (sg.x1 - sg.x0) * s), hh = Math.min(c.height - y, (sg.y1 - sg.y0) * s);
        if (w < 2 || hh < 2) continue;
        const part = document.createElement("canvas"); part.width = Math.round(w); part.height = Math.round(hh);
        part.getContext("2d").drawImage(c, x, y, w, hh, 0, 0, part.width, part.height);
        job.parts.push(part);
      }
      if (job.parts.length && job.segs.every(s => s.p <= p)) {
        const Wd = Math.max(...job.parts.map(c => c.width)), Hd = job.parts.reduce((t, c) => t + c.height, 0);
        const outC = document.createElement("canvas"); outC.width = Wd; outC.height = Hd;
        const ctx = outC.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, Wd, Hd);
        let yy = 0; for (const pc of job.parts) { ctx.drawImage(pc, 0, yy); yy += pc.height; }
        job.set(outC.toDataURL("image/jpeg", 0.88), Math.round(Wd / CROP_SCALE));
        job.parts = null;
      }
    }
    for (const old of canv.keys()) if (old < p) { const o = canv.get(old); o.width = o.height = 0; canv.delete(old); }
  }
  for (const c of canv.values()) c.width = c.height = 0;
  await doc.destroy();
  for (const q of out) q.blocks = q.blocks.map(b => b.t === "img" ? { t: "img", src: b.src, w: b.w, alt: b.alt } : { t: b.t, text: b.text });

  return { title, subject, fileName, pages: N, questions: out, parserVersion: PARSER_VERSION };
}
