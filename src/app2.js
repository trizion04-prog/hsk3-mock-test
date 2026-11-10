
/* ================= Settings ================= */
const POINTS_PER_CORRECT = 10;
const MAX_QUESTIONS_PER_QUIZ = 10;
/* Paste the Firebase web config here to switch from the local prototype to the shared online version.
   Leave it as null to run the prototype that saves data in this browser only. */
const FIREBASE_CONFIG = null;
const MODE = FIREBASE_CONFIG ? "cloud" : "local";
const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
const DB_KEY = "sq_db_v3";
const SESSION_KEY = "sq_session_v3";
const DEFAULT_PIN = "1234";
const STRAND_LABEL = { bio: "Biology", chem: "Chemistry", phys: "Physics", earth: "Earth & Space" };
const TYPE_LABEL = { mcq: "Multiple choice", tf: "True / false", fill: "Fill in the blank" };

/* ================= Storage ================= */
const memoryStore = {};
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : (key in memoryStore ? memoryStore[key] : fallback); }
    catch (e) { return key in memoryStore ? memoryStore[key] : fallback; }
  },
  set(key, value) {
    memoryStore[key] = value;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
};

/* ================= Demo data ================= */
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function seedDb(withDemo) {
  const db = {
    pin: DEFAULT_PIN,
    classes: withDemo ? ["6A", "6B", "6C"] : ["1A", "2A", "3A", "4A", "5A", "6A"],
    teachers: [],
    topics: SEED_TOPICS.map(t => ({ ...t })),
    questions: SEED_QUESTIONS.map(q => ({ ...q, options: q.options ? q.options.slice() : undefined, answer: Array.isArray(q.answer) ? q.answer.slice() : q.answer })),
    students: {},
    qstats: {}
  };
  if (!withDemo) return db;
  const demo = [
    ["Aisyah", "6A"], ["Budi", "6A"], ["Citra", "6A"], ["Dimas", "6A"], ["Eka", "6A"],
    ["Farhan", "6B"], ["Gita", "6B"], ["Hana", "6B"], ["Indra", "6B"], ["Joko", "6B"],
    ["Kirana", "6C"], ["Lukas", "6C"], ["Maya", "6C"], ["Nadia", "6C"], ["Omar", "6C"]
  ];
  const r = rng(42);
  // Topic difficulty so the demo "weak topics" view shows something meaningful.
  const topicSkill = { "s6-heart": .85, "s6-digest": .75, "s6-food": .8, "s6-change": .7, "s6-mix": .6, "s6-force": .45, "s6-elec": .65, "s6-earth": .55 };
  demo.forEach(([name, cls], i) => {
    const id = "st" + i;
    const ability = 0.55 + r() * 0.4;
    const st = { id, name, cls, points: 0, answered: 0, correct: 0, best: {}, attempts: {}, lastActive: null, demo: true };
    db.topics.filter(t => +t.stage === 6).forEach(t => {
      if (r() < 0.25) return; // not every student has tried every topic
      const qs = db.questions.filter(q => q.topic === t.id);
      const tries = 1 + Math.floor(r() * 3);
      let best = 0;
      for (let k = 0; k < tries; k++) {
        let c = 0;
        qs.forEach(q => {
          const ok = r() < Math.min(.97, ability * (topicSkill[t.id] || .7) * 1.35);
          const s = db.qstats[q.id] || (db.qstats[q.id] = { a: 0, c: 0 });
          s.a++; if (ok) { s.c++; c++; }
        });
        st.answered += qs.length; st.correct += c; best = Math.max(best, c);
      }
      st.best[t.id] = best; st.attempts[t.id] = tries;
    });
    st.points = st.correct * POINTS_PER_CORRECT;
    st.lastActive = Date.now() - Math.floor(r() * 6 * 86400000);
    db.students[id] = st;
  });
  return db;
}

let db = MODE === "local" ? (store.get(DB_KEY, null) || seedDb(true)) : { classes: [], teachers: [], topics: [], questions: [], students: {}, qstats: {} };
let session = store.get(SESSION_KEY, null); // {role:'student', id, cls} | {role:'teacher'}
function save() { if (MODE === "local") store.set(DB_KEY, db); store.set(SESSION_KEY, session); }
save();

/* ================= Persistence (local or Firebase) ================= */
let fs = null, auth = null;
let cloudReady = MODE === "local", cloudError = "", bankLoaded = MODE === "local";
let classListening = null, classLoaded = MODE === "local", classUnsub = null;
let teacherUnsubs = [], commonUnsubs = [];
let schoolTop = null, pendingRender = false;
const clean = o => JSON.parse(JSON.stringify(o));
function cloudFail(e) { console.error(e); toast("Could not save: " + (e && e.message ? e.message : e)); }
function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.style.cssText = "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#24324f;color:#fff;padding:12px 18px;border-radius:12px;font-weight:800;z-index:99;max-width:90vw"; document.body.appendChild(t); }
  t.textContent = msg; t.style.display = "block";
  clearTimeout(t._h); t._h = setTimeout(() => { t.style.display = "none"; }, 5000);
}
function persistBank() {
  if (MODE === "local") return save();
  fs.doc("meta/bank").set(clean({ topics: db.topics, questions: db.questions })).catch(cloudFail);
}
function persistSettings() {
  if (MODE === "local") return save();
  fs.doc("meta/settings").update(clean({ classes: db.classes, teachers: db.teachers })).catch(cloudFail);
}
function studentData(s) {
  return clean({ name: s.name, cls: s.cls, points: s.points, answered: s.answered, correct: s.correct, best: s.best, attempts: s.attempts, lastActive: s.lastActive });
}
function persistStudent(s) {
  if (MODE === "local") return save();
  fs.collection("students").doc(s.id).set(studentData(s)).catch(cloudFail);
}
function removeStudentDoc(id) {
  delete db.students[id];
  if (MODE === "local") return save();
  fs.collection("students").doc(id).delete().catch(cloudFail);
}
// Saves a student's progress after (part of) a quiz. Local mode already saved per answer.
function flushQuiz() {
  if (!quiz || MODE === "local") return;
  const fresh = quiz.results.slice(quiz.flushed || 0);
  if (!fresh.length) return;
  quiz.flushed = quiz.results.length;
  const u = me(); if (!u) return;
  const d = studentData(u);
  fs.collection("students").doc(u.id).update({ points: d.points, answered: d.answered, correct: d.correct, best: d.best, attempts: d.attempts, lastActive: d.lastActive }).catch(cloudFail);
  if (fresh.length) {
    const inc = firebase.firestore.FieldValue.increment;
    const upd = {};
    fresh.forEach(r => {
      const cur = upd[r.q.id] || (upd[r.q.id] = { a: 0, c: 0 });
      cur.a++; if (r.ok) cur.c++;
    });
    Object.keys(upd).forEach(k => { upd[k] = { a: inc(upd[k].a), c: inc(upd[k].c) }; });
    fs.collection("qstats").doc(quiz.topicId).set(upd, { merge: true }).catch(cloudFail);
  }
}
function scheduleRender() { if (modal) { pendingRender = true; return; } render(); }
function loadScript(src) {
  return new Promise((ok, fail) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => fail(new Error("Could not load " + src)); document.head.appendChild(s); });
}
function studentFromDoc(doc) { return { id: doc.id, best: {}, attempts: {}, points: 0, answered: 0, correct: 0, lastActive: null, ...doc.data() }; }
function attachCommon() {
  if (commonUnsubs.length) return;
  commonUnsubs.push(fs.doc("meta/settings").onSnapshot(snap => {
    const d = snap.exists ? snap.data() : {};
    db.classes = d.classes || []; db.teachers = d.teachers || [];
    scheduleRender();
  }, e => { cloudError = e.message; scheduleRender(); }));
  commonUnsubs.push(fs.doc("meta/bank").onSnapshot(snap => {
    const d = snap.exists ? snap.data() : {};
    db.topics = d.topics || []; db.questions = d.questions || []; bankLoaded = true;
    scheduleRender();
  }, e => { cloudError = e.message; scheduleRender(); }));
}
function ensureClassListener(cls) {
  if (MODE === "local" || teacherUnsubs.length || !cls || classListening === cls) return;
  if (classUnsub) classUnsub();
  classListening = cls; classLoaded = false;
  db.students = {};
  classUnsub = fs.collection("students").where("cls", "==", cls).onSnapshot(snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type === "removed") delete db.students[ch.doc.id];
      else db.students[ch.doc.id] = studentFromDoc(ch.doc);
    });
    classLoaded = true; scheduleRender();
  }, e => { cloudError = e.message; scheduleRender(); });
}
function detachTeacher() { teacherUnsubs.forEach(u => u()); teacherUnsubs = []; }
async function enterTeacher(user) {
  const email = (user.email || "").toLowerCase();
  const ref = fs.doc("meta/settings");
  const snap = await ref.get();
  if (!snap.exists) {
    // First teacher to sign in sets up the school: settings + the starter question bank.
    const seed = seedDb(false);
    const batch = fs.batch();
    batch.set(ref, { teachers: [email], classes: seed.classes });
    batch.set(fs.doc("meta/bank"), clean({ topics: seed.topics, questions: seed.questions }));
    await batch.commit();
  } else if (!(snap.data().teachers || []).includes(email)) {
    loginRole = "teacher";
    loginError = email + " is not registered as a teacher. Ask an existing teacher to add this email in Settings.";
    await auth.signOut();
    return;
  }
  if (classUnsub) { classUnsub(); classUnsub = null; classListening = null; }
  attachCommon();
  detachTeacher();
  db.students = {}; db.qstats = {};
  teacherUnsubs.push(fs.collection("students").onSnapshot(s => {
    s.docChanges().forEach(ch => { if (ch.type === "removed") delete db.students[ch.doc.id]; else db.students[ch.doc.id] = studentFromDoc(ch.doc); });
    classLoaded = true; scheduleRender();
  }, e => { cloudError = e.message; scheduleRender(); }));
  teacherUnsubs.push(fs.collection("qstats").onSnapshot(s => {
    const all = {};
    s.forEach(doc => { const d = doc.data(); Object.keys(d).forEach(k => { all[k] = d[k]; }); });
    db.qstats = all; scheduleRender();
  }));
  session = { role: "teacher", email }; save();
  view = "teacher";
}
function enterStudentMode() {
  detachTeacher();
  attachCommon();
  if (session && session.role === "teacher") { session = null; save(); view = "login"; }
  if (session && session.role === "student") ensureClassListener(session.cls);
}
async function initCloud() {
  try {
    await loadScript(FIREBASE_SDK + "firebase-app-compat.js");
    await loadScript(FIREBASE_SDK + "firebase-auth-compat.js");
    await loadScript(FIREBASE_SDK + "firebase-firestore-compat.js");
    firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth(); fs = firebase.firestore();
    if (String(FIREBASE_CONFIG.projectId).startsWith("demo-")) { // local testing with the Firebase emulators
      auth.useEmulator("http://127.0.0.1:9099"); fs.useEmulator("127.0.0.1", 8080);
    }
    auth.onAuthStateChanged(async user => {
      try {
        if (!user) { await auth.signInAnonymously(); return; }
        if (user.isAnonymous) enterStudentMode();
        else await enterTeacher(user);
      } catch (e) { cloudError = e.message; }
      cloudReady = true; render();
    });
  } catch (e) { cloudError = e.message; cloudReady = true; render(); }
}
function teacherSignIn() {
  loginError = "";
  auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(e => { loginError = e.message; render(); });
}
function logoutTeacher() {
  session = null; save(); view = "login"; loginRole = "teacher";
  if (MODE === "cloud") { detachTeacher(); db.students = {}; auth.signOut(); }
  render();
}

/* ================= UI state ================= */
let view = "login";
let loginRole = "student";
let loginClass = db.classes[0];
let loginError = "";
let selectedStage = 6;
let lbScope = "class";
let quiz = null;
// teacher
let tTab = "overview";
let tClass = "all";
let tStage = 6;
let tTopic = "all";
let tStudent = null;
let modal = null;

if (MODE === "cloud") { if (session && session.role === "student" && session.cls) view = "home"; }
else if (session && session.role === "student" && db.students[session.id]) view = "home";
else if (session && session.role === "teacher") { view = "teacher"; }
else session = null;

/* ================= Helpers ================= */
const $app = document.getElementById("app");
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function norm(s) { return String(s).trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!]$/, ""); }
function starsFor(correct, total) { if (!total) return 0; const r = correct / total; return r >= 1 ? 3 : r >= 0.6 ? 2 : r > 0 ? 1 : 0; }
function me() { return session && session.role === "student" ? db.students[session.id] : null; }
function topicQuestions(tid) { return db.questions.filter(q => q.topic === tid); }
function topicById(tid) { return db.topics.find(t => t.id === tid); }
function quizLength(tid) { return Math.min(MAX_QUESTIONS_PER_QUIZ, topicQuestions(tid).length); }
function pct(c, a) { return a ? Math.round(100 * c / a) : null; }
function heatStyle(p) {
  if (p == null) return "background:#f1f4fa;color:#9aa7c2";
  if (p >= 80) return "background:#d9f5e7;color:#12804c";
  if (p >= 60) return "background:#fff2cc;color:#8a6500";
  return "background:#fde0e0;color:#b83434";
}
function barColor(p) { return p >= 80 ? "var(--good)" : p >= 60 ? "var(--gold)" : "var(--bad)"; }
function ago(ts) {
  if (!ts) return "Never";
  const d = Math.floor((Date.now() - ts) / 86400000);
  return d <= 0 ? "Today" : d === 1 ? "Yesterday" : d + " days ago";
}
const AVATAR_COLORS = ["#2f6fed", "#20a464", "#8a4fe0", "#f07b1d", "#1b8fc7", "#e04f8a", "#c79a00"];
function avatar(name, size) {
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const s = size || 44;
  return `<div class="avatar" style="width:${s}px;height:${s}px;background:${AVATAR_COLORS[h % AVATAR_COLORS.length]};font-size:${Math.round(s * 0.42)}px">${esc(name.charAt(0).toUpperCase())}</div>`;
}
const ICONS = {
  bio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>',
  chem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6"/><path d="M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/></svg>',
  phys: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
  earth: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
};
function star(filled, cls) {
  return `<svg class="${cls == null ? "star" : cls}" viewBox="0 0 24 24"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill="${filled ? "#f5b100" : "#dfe6f3"}" stroke="${filled ? "#d99a00" : "#c9d3e6"}" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
}
const LOGO = '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#ffd34d"/><ellipse cx="24" cy="24" rx="17" ry="7" fill="none" stroke="#1f54c4" stroke-width="3" transform="rotate(30 24 24)"/><ellipse cx="24" cy="24" rx="17" ry="7" fill="none" stroke="#1f54c4" stroke-width="3" transform="rotate(-30 24 24)"/><circle cx="24" cy="24" r="4.5" fill="#e04f4f"/></svg>';

/* ================= Render root ================= */
function render() {
  pendingRender = false;
  document.body.classList.toggle("teacher", view === "teacher");
  if (!cloudReady || cloudError || (view !== "login" && view !== "teacher" && !me())) {
    if (cloudError) { $app.innerHTML = `<div class="wrap"><div class="card login"><div class="hero">${LOGO}</div><h1>Something went wrong</h1><div class="muted">${esc(cloudError)}</div><div style="margin-top:18px"><button class="btn" onclick="location.reload()">Try again</button></div></div></div>`; return; }
    if (cloudReady && view !== "login" && view !== "teacher" && classLoaded) { session = null; save(); view = "login"; }
    else { $app.innerHTML = `<div class="wrap"><div class="card login"><div class="hero">${LOGO}</div><h1>Loading…</h1><div class="muted">Connecting to the school server.</div></div></div>`; return; }
  }
  if (view === "login") { renderLogin(); renderModal(); return; }
  let body = "", nav = "", pill = "";
  if (view === "teacher") {
    body = renderTeacher();
    nav = ["overview", "students", "questions", "settings"].map(t =>
      `<button data-ttab="${t}" class="${tTab === t ? "active" : ""}">${{ overview: "Overview", students: "Students", questions: "Questions", settings: "Settings" }[t]}</button>`).join("");
    pill = `<button class="pill" id="logout" style="border:0;color:#fff">Log out</button>`;
  } else {
    if (view === "home") body = renderHome();
    else if (view === "quiz") body = renderQuiz();
    else if (view === "result") body = renderResult();
    else if (view === "leaderboard") body = renderLeaderboard();
    nav = `<button data-nav="home" class="${view === "home" ? "active" : ""}">Practice</button>
           <button data-nav="leaderboard" class="${view === "leaderboard" ? "active" : ""}">Leaderboard</button>`;
    pill = `<div class="pill"><span class="coin"></span>${me().points}</div>`;
  }
  $app.innerHTML = `
    <div class="topbar"><div class="topbar-inner">
      <div class="brand">${LOGO}<span>${view === "teacher" ? "Teacher" : "Science Quest"}</span></div>
      <div class="nav">${nav}</div>
      <div class="spacer"></div>
      ${pill}
    </div></div>
    <div class="wrap">${body}</div>`;
  $app.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => { flushQuiz(); view = b.dataset.nav; quiz = null; if (view === "leaderboard") schoolTop = null; render(); window.scrollTo(0, 0); });
  $app.querySelectorAll("[data-ttab]").forEach(b => b.onclick = () => { tTab = b.dataset.ttab; tStudent = null; render(); window.scrollTo(0, 0); });
  const lo = document.getElementById("logout");
  if (lo) lo.onclick = logoutTeacher;
  bindView();
  renderModal();
}

/* ================= Login ================= */
function renderLogin() {
  if (!db.classes.includes(loginClass)) loginClass = db.classes[0];
  ensureClassListener(loginClass);
  const roster = Object.values(db.students).filter(s => s.cls === loginClass).sort((a, b) => a.name.localeCompare(b.name));
  const studentForm = `
    <label for="cl">Your class</label>
    <select id="cl">${db.classes.map(c => `<option ${c === loginClass ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
    <label for="nm">Your name</label>
    ${!classLoaded ? `<div class="muted" style="text-align:left">Loading names…</div>` : roster.length
      ? `<select id="nm">${roster.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select>`
      : `<div class="muted" style="text-align:left">No students in this class yet. Ask your teacher to add you.</div>`}
    <div style="margin-top:22px"><button class="btn block" type="submit" ${roster.length ? "" : "disabled"}>Start learning</button></div>`;
  const teacherForm = MODE === "cloud" ? `
    <div class="muted" style="margin-top:16px">Teachers sign in with their Google account.</div>
    <div style="margin-top:18px"><button class="btn block" type="button" id="gSignIn">Sign in with Google</button></div>` : `
    <label for="pin">Teacher PIN</label>
    <input id="pin" type="text" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="Enter PIN">
    <div class="hint" style="text-align:left">Prototype PIN: 1234 (change it in Settings).</div>
    <div style="margin-top:22px"><button class="btn block" type="submit">Open dashboard</button></div>`;
  $app.innerHTML = `
    <div class="wrap"><div class="card login">
      <div class="hero">${LOGO}</div>
      <h1>Science Quest</h1>
      <div class="muted">Cambridge Primary Science practice</div>
      <div class="role-seg">
        <button data-role="student" class="${loginRole === "student" ? "active" : ""}">I'm a student</button>
        <button data-role="teacher" class="${loginRole === "teacher" ? "active" : ""}">I'm a teacher</button>
      </div>
      <form id="loginForm">${loginRole === "student" ? studentForm : teacherForm}</form>
      <div class="err">${esc(loginError)}</div>
    </div></div>`;
  $app.querySelectorAll("[data-role]").forEach(b => b.onclick = () => { loginRole = b.dataset.role; loginError = ""; render(); });
  const cl = document.getElementById("cl");
  if (cl) cl.onchange = () => { loginClass = cl.value; render(); };
  const pin = document.getElementById("pin");
  if (pin) pin.focus();
  const g = document.getElementById("gSignIn");
  if (g) g.onclick = teacherSignIn;
  document.getElementById("loginForm").onsubmit = e => {
    e.preventDefault();
    loginError = "";
    if (loginRole === "student") {
      const nm = document.getElementById("nm");
      if (!nm) return;
      session = { role: "student", id: nm.value, cls: loginClass }; view = "home";
    } else {
      if (!pin) return;
      if (pin.value.trim() !== String(db.pin)) { loginError = "Wrong PIN. Try again."; render(); return; }
      session = { role: "teacher" }; view = "teacher"; tTab = "overview";
    }
    save(); render();
  };
}

/* ================= Student: home ================= */
function stagesWithQuestions() {
  const s = new Set();
  db.topics.forEach(t => { if (topicQuestions(t.id).length) s.add(+t.stage); });
  return s;
}
function renderHome() {
  const u = me();
  const live = stagesWithQuestions();
  const stageBtns = [1, 2, 3, 4, 5, 6].map(s =>
    `<button class="stage-btn ${s === selectedStage ? "active" : ""}" data-stage="${s}">Stage ${s}${live.has(s) ? "" : '<span class="soon">coming soon</span>'}</button>`).join("");
  const topics = db.topics.filter(t => +t.stage === selectedStage && topicQuestions(t.id).length);
  let starsTotal = 0;
  db.topics.forEach(t => { starsTotal += starsFor(u.best[t.id] || 0, quizLength(t.id)); });
  const acc = pct(u.correct, u.answered) || 0;
  const grid = topics.length ? `<div class="topics">${topics.map(t => {
      const n = topicQuestions(t.id).length;
      const st = starsFor(u.best[t.id] || 0, quizLength(t.id));
      return `<button class="topic" data-topic="${t.id}">
        <div class="icon strand-${t.strand}">${ICONS[t.strand]}</div>
        <div><div class="t">${esc(t.name)}</div>
          <div class="s">${STRAND_LABEL[t.strand]} · ${n} questions</div>
          <div class="stars">${star(st >= 1)}${star(st >= 2)}${star(st >= 3)}</div></div>
      </button>`;
    }).join("")}</div>`
    : `<div class="card empty"><h2 style="margin-top:0">Stage ${selectedStage} is coming soon</h2><div class="muted">Your teacher will add questions for this stage.</div></div>`;
  return `
    <h1>Hi, ${esc(u.name)}!</h1>
    <div class="muted">Class ${esc(u.cls)} · Pick a topic and earn coins for every correct answer.</div>
    <div class="stats">
      <div class="card stat"><div class="num">${u.points}</div><div class="lbl">Coins</div></div>
      <div class="card stat"><div class="num">${starsTotal}</div><div class="lbl">Stars</div></div>
      <div class="card stat"><div class="num">${acc}%</div><div class="lbl">Accuracy</div></div>
    </div>
    <h2>Choose your stage</h2>
    <div class="stages">${stageBtns}</div>
    <h2>Topics</h2>
    ${grid}
    <div class="row-actions"><button class="btn ghost" id="switchStudent">Log out</button></div>`;
}

/* ================= Student: quiz ================= */
function startQuiz(topicId) {
  // Shuffle question order and the order of multiple-choice options.
  const qs = shuffle(topicQuestions(topicId)).slice(0, MAX_QUESTIONS_PER_QUIZ).map(q => {
    if (q.type !== "mcq") return q;
    const order = shuffle(q.options.map((_, i) => i));
    return { ...q, options: order.map(i => q.options[i]), answer: order.indexOf(q.answer) };
  });
  quiz = { topicId, qs, index: 0, picked: null, checked: false, results: [], done: false, flushed: 0 };
  view = "quiz"; render(); window.scrollTo(0, 0);
}
function isCorrect(q, picked) {
  if (picked === null || picked === undefined) return false;
  if (q.type === "mcq" || q.type === "tf") return picked === q.answer;
  return q.answer.map(norm).includes(norm(picked));
}
function answerText(q) {
  if (q.type === "mcq") return "ABCD"[q.answer] + ". " + q.options[q.answer];
  if (q.type === "tf") return q.answer ? "True" : "False";
  return q.answer[0];
}
function givenText(q, picked) {
  if (q.type === "mcq") return "ABCD"[picked] + ". " + q.options[picked];
  if (q.type === "tf") return picked ? "True" : "False";
  return picked;
}
function renderQuiz() {
  const q = quiz.qs[quiz.index];
  const total = quiz.qs.length;
  const topic = topicById(quiz.topicId);
  const prog = Math.round(100 * (quiz.index + (quiz.checked ? 1 : 0)) / total);
  let answerArea = "";
  if (q.type === "mcq") {
    answerArea = `<div class="options">${q.options.map((o, i) => {
      let cls = "";
      if (quiz.checked) { if (i === q.answer) cls = "correct"; else if (i === quiz.picked) cls = "wrong"; }
      else if (i === quiz.picked) cls = "selected";
      return `<button class="opt ${cls}" data-opt="${i}" ${quiz.checked ? "disabled" : ""}><span class="key">${"ABCD"[i]}</span>${esc(o)}</button>`;
    }).join("")}</div>`;
  } else if (q.type === "tf") {
    answerArea = `<div class="options tf">${[true, false].map(v => {
      let cls = "";
      if (quiz.checked) { if (v === q.answer) cls = "correct"; else if (v === quiz.picked) cls = "wrong"; }
      else if (v === quiz.picked) cls = "selected";
      return `<button class="opt ${cls}" data-tf="${v}" ${quiz.checked ? "disabled" : ""}>${v ? "True" : "False"}</button>`;
    }).join("")}</div>`;
  } else {
    const val = quiz.picked == null ? "" : quiz.picked;
    const ok = quiz.checked && isCorrect(q, quiz.picked);
    answerArea = `<input id="fill" class="fill-input" type="text" autocomplete="off" placeholder="Type your answer" value="${esc(val)}" ${quiz.checked ? "disabled" : ""}
      style="${quiz.checked ? (ok ? "border-color:var(--good);background:var(--good-bg)" : "border-color:var(--bad);background:var(--bad-bg)") : ""}">`;
  }
  let feedback = "";
  if (quiz.checked) {
    const ok = isCorrect(q, quiz.picked);
    feedback = `<div class="feedback ${ok ? "ok" : "no"}">
      <div class="title">${ok ? "Correct! +" + POINTS_PER_CORRECT + " coins" : "Not quite"}</div>
      ${ok ? "" : `<div class="ans">Correct answer: ${esc(answerText(q))}</div>`}
      <div class="exp">${esc(q.explanation)}</div></div>`;
  }
  const canCheck = quiz.picked !== null && quiz.picked !== "";
  return `
    <div class="quiz-head">
      <button class="close-x" id="quitQuiz" aria-label="Quit">✕</button>
      <div class="progress"><div style="width:${prog}%"></div></div>
      <div class="qcount">${quiz.index + 1} / ${total}</div>
    </div>
    <div class="card">
      <span class="tag strand-${topic.strand}">${esc(topic.name)}</span>
      <div class="qtext">${esc(q.q)}</div>
      ${answerArea}
      ${feedback}
      <div class="quiz-actions">
        ${quiz.checked
          ? `<button class="btn ${isCorrect(q, quiz.picked) ? "good" : ""}" id="next">${quiz.index + 1 < total ? "Next question" : "See results"}</button>`
          : `<button class="btn" id="check" ${canCheck ? "" : "disabled"}>Check answer</button>`}
      </div>
    </div>`;
}
function checkAnswer() {
  const q = quiz.qs[quiz.index];
  if (quiz.picked === null || quiz.picked === "") return;
  quiz.checked = true;
  const ok = isCorrect(q, quiz.picked);
  quiz.results.push({ q, ok, given: givenText(q, quiz.picked) });
  const u = me();
  u.answered += 1; u.lastActive = Date.now();
  if (ok) { u.correct += 1; u.points += POINTS_PER_CORRECT; }
  const s = db.qstats[q.id] || (db.qstats[q.id] = { a: 0, c: 0 });
  s.a++; if (ok) s.c++;
  save(); render();
}
function nextQuestion() {
  if (quiz.index + 1 < quiz.qs.length) {
    quiz.index += 1; quiz.picked = null; quiz.checked = false; render(); window.scrollTo(0, 0);
  } else {
    quiz.done = true;
    const u = me();
    const correct = quiz.results.filter(r => r.ok).length;
    u.best[quiz.topicId] = Math.max(u.best[quiz.topicId] || 0, correct);
    u.attempts[quiz.topicId] = (u.attempts[quiz.topicId] || 0) + 1;
    save(); flushQuiz(); view = "result"; render(); window.scrollTo(0, 0);
  }
}
function renderResult() {
  const total = quiz.qs.length;
  const correct = quiz.results.filter(r => r.ok).length;
  const st = starsFor(correct, total);
  const topic = topicById(quiz.topicId);
  const msg = st === 3 ? "Perfect score! Amazing work!" : st === 2 ? "Great job! Keep going!" : "Good try! Review the answers and try again.";
  return `
    <div class="card result">
      <div class="muted" style="font-weight:800">${esc(topic.name)}</div>
      <div class="big-stars">${star(st >= 1, "")}${star(st >= 2, "")}${star(st >= 3, "")}</div>
      <div class="score">${correct} / ${total}</div>
      <div class="muted" style="font-weight:700">${msg}</div>
      <div class="earned"><span class="coin"></span>+${correct * POINTS_PER_CORRECT} coins</div>
      <div class="row-actions">
        <button class="btn" id="retry">Try again</button>
        <button class="btn ghost" id="toTopics">More topics</button>
        <button class="btn ghost" id="toLb">Leaderboard</button>
      </div>
      <h2 style="text-align:left">Review your answers</h2>
      <div class="review">${quiz.results.map((r, i) => `
        <div class="review-item ${r.ok ? "ok" : "no"}">
          <div class="q"><span class="mark">${r.ok ? "✓" : "✗"}</span> ${i + 1}. ${esc(r.q.q)}</div>
          <div class="a">${r.ok ? "" : `Your answer: <b>${esc(r.given)}</b> · `}Correct answer: <b>${esc(answerText(r.q))}</b></div>
          <div class="a muted">${esc(r.q.explanation)}</div>
        </div>`).join("")}</div>
    </div>`;
}

/* ================= Student: leaderboard ================= */
function renderLeaderboard() {
  const u = me();
  let all;
  if (lbScope === "class") all = Object.values(db.students).filter(s => s.cls === u.cls);
  else if (MODE === "local") all = Object.values(db.students);
  else {
    if (!schoolTop) {
      schoolTop = [];
      fs.collection("students").orderBy("points", "desc").limit(30).get()
        .then(s => { schoolTop = s.docs.map(studentFromDoc); scheduleRender(); }).catch(cloudFail);
    }
    all = schoolTop.filter(s => s.id !== u.id);
    if (schoolTop.length < 30 || schoolTop.some(s => s.id === u.id)) all.push(u);
  }
  all.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  const top = all.slice(0, 3);
  const podiumOrder = [top[1], top[0], top[2]];
  const podClass = ["p2", "p1", "p3"], rankNum = [2, 1, 3];
  const podium = `<div class="podium">${podiumOrder.map((s, i) => s ? `
      <div class="pod ${podClass[i]}">${avatar(s.name, 50)}
        <div class="name">${esc(s.name)}</div><div class="pts">${s.points} coins</div>
        <div class="bar">${rankNum[i]}</div></div>` : "<div></div>").join("")}</div>`;
  const list = all.map((s, i) => `
    <div class="lb-row ${s.id === u.id ? "me" : ""}">
      <div class="rank">${i + 1}</div>${avatar(s.name, 38)}
      <div class="nm">${esc(s.name)}${s.id === u.id ? " (you)" : ""}<div class="cls">Class ${esc(s.cls)}</div></div>
      <div class="pts"><span class="coin"></span>${s.points}</div>
    </div>`).join("");
  const myRank = all.findIndex(s => s.id === u.id) + 1;
  return `
    <h1>Leaderboard</h1>
    <div class="muted">${myRank ? `You are <b>#${myRank}</b> ${lbScope === "class" ? "in class " + esc(u.cls) : "in the school"}.` : ""}</div>
    <div style="margin-top:14px" class="seg">
      <button data-scope="class" class="${lbScope === "class" ? "active" : ""}">My class</button>
      <button data-scope="school" class="${lbScope === "school" ? "active" : ""}">Whole school</button>
    </div>
    ${podium}
    <div class="lb-list">${list}</div>
    <div class="note">${MODE === "local" ? "Prototype: scores are saved on this device only. The full version shares them through the school server." : (lbScope === "school" ? "Whole school shows the top 30 students." : "")}</div>`;
}

/* ================= Teacher ================= */
function classFilterSelect(id) {
  return `<select id="${id}"><option value="all" ${tClass === "all" ? "selected" : ""}>All classes</option>${db.classes.map(c => `<option ${tClass === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>`;
}
function filteredStudents() {
  return Object.values(db.students).filter(s => tClass === "all" || s.cls === tClass);
}
function topicPctFor(students, tid) {
  const n = quizLength(tid); let sum = 0, cnt = 0;
  students.forEach(s => { if (s.best[tid] != null) { sum += s.best[tid] / (n || 1); cnt++; } });
  return cnt ? { p: Math.round(100 * sum / cnt), cnt } : { p: null, cnt: 0 };
}

function renderTeacher() {
  if (tTab === "students" && tStudent && db.students[tStudent]) return renderStudentDetail(db.students[tStudent]);
  if (tTab === "overview") return renderOverview();
  if (tTab === "students") return renderStudents();
  if (tTab === "questions") return renderQuestions();
  return renderSettings();
}

function renderOverview() {
  const studs = filteredStudents();
  const answered = studs.reduce((a, s) => a + s.answered, 0);
  const correct = studs.reduce((a, s) => a + s.correct, 0);
  const activeWeek = studs.filter(s => s.lastActive && Date.now() - s.lastActive < 7 * 86400000).length;
  const topics = db.topics.filter(t => topicQuestions(t.id).length);
  const topicRows = topics.map(t => ({ t, ...topicPctFor(studs, t.id) }))
    .sort((a, b) => (a.p == null ? 999 : a.p) - (b.p == null ? 999 : b.p));
  const classIds = tClass === "all" ? db.classes : [tClass];
  const missed = db.questions
    .filter(q => db.qstats[q.id] && db.qstats[q.id].a >= 3)
    .map(q => ({ q, p: pct(db.qstats[q.id].c, db.qstats[q.id].a), a: db.qstats[q.id].a }))
    .sort((a, b) => a.p - b.p).slice(0, 5);
  const topStud = studs.slice().sort((a, b) => b.points - a.points).slice(0, 5);
  return `
    <div class="section-title" style="margin-top:8px"><h1 style="margin:0">Overview</h1>${classFilterSelect("ovClass")}</div>
    <div class="kpis">
      <div class="card kpi"><div class="num">${studs.length}</div><div class="lbl">Students</div></div>
      <div class="card kpi"><div class="num">${activeWeek}</div><div class="lbl">Active this week</div></div>
      <div class="card kpi"><div class="num">${answered}</div><div class="lbl">Questions answered</div></div>
      <div class="card kpi"><div class="num">${pct(correct, answered) ?? 0}%</div><div class="lbl">Average accuracy</div></div>
    </div>

    <div class="section-title"><h2>Topic mastery</h2><span class="muted" style="font-size:13px;font-weight:700">Average best score, weakest first</span></div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Topic</th><th class="hide-sm">Strand</th>${classIds.map(c => `<th class="num">${esc(c)}</th>`).join("")}<th class="num">Tried by</th></tr></thead>
      <tbody>${topicRows.map(r => `<tr>
        <td><b>${esc(r.t.name)}</b><div class="qrow-meta">Stage ${r.t.stage}</div></td>
        <td class="hide-sm">${STRAND_LABEL[r.t.strand]}</td>
        ${classIds.map(c => { const x = topicPctFor(studs.filter(s => s.cls === c), r.t.id); return `<td class="num"><span class="heat" style="${heatStyle(x.p)}">${x.p == null ? "–" : x.p + "%"}</span></td>`; }).join("")}
        <td class="num">${r.cnt} / ${studs.length}</td></tr>`).join("")}</tbody>
    </table></div>

    <div class="grid2">
      <div>
        <div class="section-title"><h2>Most-missed questions</h2></div>
        <div class="tbl-wrap"><table class="tbl"><tbody>
          ${missed.length ? missed.map(m => `<tr><td><div class="qrow-q">${esc(m.q.q)}</div><div class="qrow-meta">${esc((topicById(m.q.topic) || {}).name || "")} · ${m.a} attempts</div></td>
            <td class="num"><span class="heat" style="${heatStyle(m.p)}">${m.p}%</span></td></tr>`).join("")
            : `<tr><td class="muted">Not enough answers yet.</td></tr>`}
        </tbody></table></div>
        <div class="hint">Percent of attempts answered correctly, across all classes.</div>
      </div>
      <div>
        <div class="section-title"><h2>Top students</h2></div>
        <div class="tbl-wrap"><table class="tbl"><tbody>
          ${topStud.map((s, i) => `<tr class="click" data-student="${s.id}"><td style="width:30px;font-weight:900;color:var(--muted)">${i + 1}</td>
            <td><div class="namecell">${avatar(s.name, 32)}<div>${esc(s.name)}<div class="qrow-meta">Class ${esc(s.cls)}</div></div></div></td>
            <td class="num"><b>${s.points}</b> coins</td></tr>`).join("") || `<tr><td class="muted">No students yet.</td></tr>`}
        </tbody></table></div>
      </div>
    </div>`;
}

function renderStudents() {
  const studs = filteredStudents().sort((a, b) => a.cls.localeCompare(b.cls) || b.points - a.points);
  const totalStars = s => db.topics.reduce((a, t) => a + starsFor(s.best[t.id] || 0, quizLength(t.id)), 0);
  return `
    <div class="section-title" style="margin-top:8px"><h1 style="margin:0">Students</h1>
      <div style="display:flex;gap:10px;align-items:center">${classFilterSelect("stClass")}<button class="btn sm" id="addStudent">+ Add student</button></div></div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Name</th><th>Class</th><th class="num">Coins</th><th class="num">Accuracy</th><th class="num hide-sm">Answered</th><th class="num hide-sm">Stars</th><th class="hide-sm">Last active</th></tr></thead>
      <tbody>${studs.map(s => { const a = pct(s.correct, s.answered); return `<tr class="click" data-student="${s.id}">
        <td><div class="namecell">${avatar(s.name, 32)}${esc(s.name)}</div></td>
        <td>${esc(s.cls)}</td>
        <td class="num"><b>${s.points}</b></td>
        <td class="num"><span class="heat" style="${heatStyle(a)}">${a == null ? "–" : a + "%"}</span></td>
        <td class="num hide-sm">${s.answered}</td>
        <td class="num hide-sm">${totalStars(s)}</td>
        <td class="hide-sm">${ago(s.lastActive)}</td></tr>`; }).join("") || `<tr><td colspan="7" class="muted">No students in this class yet. Click "Add student".</td></tr>`}</tbody>
    </table></div>
    <div class="hint">Click a student to see their results per topic.</div>`;
}

function renderStudentDetail(s) {
  const a = pct(s.correct, s.answered);
  const rows = db.topics.filter(t => topicQuestions(t.id).length).map(t => {
    const n = quizLength(t.id), b = s.best[t.id];
    const p = b == null ? null : Math.round(100 * b / n);
    return `<tr><td><b>${esc(t.name)}</b><div class="qrow-meta">Stage ${t.stage} · ${STRAND_LABEL[t.strand]}</div></td>
      <td class="num">${b == null ? "–" : b + " / " + n}</td>
      <td style="width:30%"><div class="bar-mini"><div style="width:${p || 0}%;background:${barColor(p || 0)}"></div></div></td>
      <td class="num">${s.attempts[t.id] || 0}</td>
      <td class="num"><div class="stars" style="justify-content:flex-end">${(() => { const st = starsFor(b || 0, n); return star(st >= 1) + star(st >= 2) + star(st >= 3); })()}</div></td></tr>`;
  }).join("");
  return `
    <button class="back" id="backStudents">← All students</button>
    <div class="section-title" style="margin-top:10px">
      <div class="namecell" style="font-size:24px">${avatar(s.name, 52)}<div>${esc(s.name)}<div class="qrow-meta" style="font-size:14px">Class ${esc(s.cls)} · Last active ${ago(s.lastActive).toLowerCase()}</div></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn sm ghost" id="editStudent">Edit</button>
        <button class="btn sm ghost" id="resetStudent">Reset scores</button>
        <button class="btn sm danger" id="delStudent">Remove</button>
      </div>
    </div>
    <div class="kpis">
      <div class="card kpi"><div class="num">${s.points}</div><div class="lbl">Coins</div></div>
      <div class="card kpi"><div class="num">${a == null ? "–" : a + "%"}</div><div class="lbl">Accuracy</div></div>
      <div class="card kpi"><div class="num">${s.answered}</div><div class="lbl">Questions answered</div></div>
      <div class="card kpi"><div class="num">${Object.keys(s.best).length}</div><div class="lbl">Topics tried</div></div>
    </div>
    <h2>Results by topic</h2>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Topic</th><th class="num">Best score</th><th></th><th class="num">Attempts</th><th class="num">Stars</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

function renderQuestions() {
  const stageTopics = db.topics.filter(t => +t.stage === tStage);
  if (tTopic !== "all" && !stageTopics.some(t => t.id === tTopic)) tTopic = "all";
  const qs = db.questions.filter(q => { const t = topicById(q.topic); return t && +t.stage === tStage && (tTopic === "all" || q.topic === tTopic); });
  return `
    <div class="section-title" style="margin-top:8px"><h1 style="margin:0">Question bank</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm ghost" id="addTopic">+ Add topic</button><button class="btn sm" id="addQuestion">+ Add question</button></div></div>
    <div class="toolbar">
      <select id="qStage">${[1, 2, 3, 4, 5, 6].map(s => `<option value="${s}" ${s === tStage ? "selected" : ""}>Stage ${s} (${db.questions.filter(q => { const t = topicById(q.topic); return t && +t.stage === s; }).length})</option>`).join("")}</select>
      <select id="qTopic"><option value="all">All topics</option>${stageTopics.map(t => `<option value="${t.id}" ${t.id === tTopic ? "selected" : ""}>${esc(t.name)} (${topicQuestions(t.id).length})</option>`).join("")}</select>
      ${tTopic !== "all" ? `<button class="linkbtn" id="editTopic">Edit topic</button>` : ""}
    </div>
    ${stageTopics.length === 0 ? `<div class="card empty"><h2 style="margin-top:0">No topics in Stage ${tStage} yet</h2><div class="muted">Add a topic first, then add questions to it.</div></div>` : `
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Question</th><th class="hide-sm">Type</th><th class="num hide-sm">Correct rate</th><th></th></tr></thead>
      <tbody>${qs.map(q => { const st = db.qstats[q.id]; const p = st && st.a ? pct(st.c, st.a) : null; return `<tr>
        <td><div class="qrow-q">${esc(q.q)}</div><div class="qrow-meta">${esc((topicById(q.topic) || {}).name)} · Answer: ${esc(answerText(q))}</div></td>
        <td class="hide-sm"><span class="chip">${TYPE_LABEL[q.type]}</span></td>
        <td class="num hide-sm"><span class="heat" style="${heatStyle(p)}">${p == null ? "–" : p + "%"}</span></td>
        <td style="white-space:nowrap;text-align:right"><button class="linkbtn" data-editq="${q.id}">Edit</button><button class="linkbtn red" data-delq="${q.id}">Delete</button></td></tr>`; }).join("") || `<tr><td colspan="4" class="muted">No questions here yet.</td></tr>`}</tbody>
    </table></div>`}
    <div class="hint">Students see a topic once it has at least one question. Each practice round uses up to ${MAX_QUESTIONS_PER_QUIZ} random questions from the topic.</div>`;
}

function renderSettings() {
  return `
    <h1>Settings</h1>
    <div class="grid2">
      <div class="card">
        <h2 style="margin-top:0">Classes</h2>
        <div class="tbl-wrap" style="box-shadow:none;border:2px solid #eef2fa"><table class="tbl"><tbody>
          ${db.classes.map(c => `<tr><td><b>${esc(c)}</b></td><td class="num">${Object.values(db.students).filter(s => s.cls === c).length} students</td>
            <td style="text-align:right"><button class="linkbtn red" data-delclass="${esc(c)}">Remove</button></td></tr>`).join("")}
        </tbody></table></div>
        <form id="addClassForm" style="display:flex;gap:8px;margin-top:12px">
          <input id="newClass" type="text" maxlength="12" placeholder="e.g. 5A">
          <button class="btn sm" type="submit">Add</button>
        </form>
      </div>
      ${MODE === "cloud" ? `<div class="card">
        <h2 style="margin-top:0">Teachers</h2>
        <div class="muted" style="font-size:14px">These Google accounts can open the teacher dashboard.</div>
        <div class="tbl-wrap" style="box-shadow:none;border:2px solid #eef2fa;margin-top:10px"><table class="tbl"><tbody>
          ${db.teachers.map(t => `<tr><td><b>${esc(t)}</b></td><td style="text-align:right">${session && session.email === t ? '<span class="muted">you</span>' : `<button class="linkbtn red" data-delteacher="${esc(t)}">Remove</button>`}</td></tr>`).join("")}
        </tbody></table></div>
        <form id="addTeacherForm" style="display:flex;gap:8px;margin-top:12px">
          <input id="newTeacher" type="text" maxlength="80" placeholder="teacher@gmail.com">
          <button class="btn sm" type="submit">Add</button>
        </form>
      </div>` : `<div class="card">
        <h2 style="margin-top:0">Teacher PIN</h2>
        <form id="pinForm">
          <label for="newPin" style="margin-top:0">New PIN</label>
          <input id="newPin" type="text" inputmode="numeric" maxlength="8" placeholder="4 to 8 digits">
          <div style="margin-top:12px"><button class="btn sm" type="submit">Save PIN</button></div>
          <div class="err" id="pinMsg"></div>
        </form>
        <h2>Demo data</h2>
        <div class="muted" style="font-size:14px">Bring back the sample students, scores and the original question bank. Your changes will be lost.</div>
        <div style="margin-top:12px"><button class="btn sm danger" id="resetDemo">Reset everything</button></div>
      </div>`}
    </div>
    <div class="note">${MODE === "local" ? "Prototype: all data is saved in this browser only. In the full version it is stored on the school server and shared by every device." : "All data is stored on the school's Firebase server."}</div>`;
}

/* ================= Modals ================= */
function openModal(m) { modal = m; render(); }
function closeModal() { modal = null; render(); }
function renderModal() {
  const old = document.getElementById("modalRoot");
  if (old) old.remove();
  if (!modal) return;
  const root = document.createElement("div");
  root.id = "modalRoot";
  root.className = "modal-bg";
  root.innerHTML = `<div class="modal">${modal.html()}</div>`;
  document.body.appendChild(root);
  root.addEventListener("mousedown", e => { if (e.target === root) closeModal(); });
  modal.bind(root);
}
function confirmModal(title, text, okLabel, onOk) {
  openModal({
    html: () => `<h2>${esc(title)}</h2><div class="muted">${esc(text)}</div>
      <div class="modal-actions"><button class="btn ghost sm" id="mCancel">Cancel</button><button class="btn danger sm" id="mOk">${esc(okLabel)}</button></div>`,
    bind: r => { r.querySelector("#mCancel").onclick = closeModal; r.querySelector("#mOk").onclick = () => { onOk(); modal = null; save(); render(); }; }
  });
}
function studentModal(existing) {
  openModal({
    html: () => `<h2>${existing ? "Edit student" : "Add student"}</h2>
      <form id="sForm">
        <label for="sName" style="margin-top:0">Name</label>
        <input id="sName" type="text" maxlength="24" value="${esc(existing ? existing.name : "")}" placeholder="Student name">
        <label for="sClass">Class</label>
        <select id="sClass">${db.classes.map(c => `<option ${(existing ? existing.cls : (tClass !== "all" ? tClass : db.classes[0])) === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
        ${existing ? "" : `<div class="hint">Tip: you can add several at once by putting one name per line.</div>`}
        <div class="err" id="sErr"></div>
        <div class="modal-actions"><button type="button" class="btn ghost sm" id="mCancel">Cancel</button><button class="btn sm" type="submit">Save</button></div>
      </form>`,
    bind: r => {
      if (!existing) { // allow multiple names
        const inp = r.querySelector("#sName");
        const ta = document.createElement("textarea"); ta.id = "sName"; ta.placeholder = "One name per line"; ta.maxLength = 2000;
        inp.replaceWith(ta);
      }
      r.querySelector("#sName").focus();
      r.querySelector("#mCancel").onclick = closeModal;
      r.querySelector("#sForm").onsubmit = e => {
        e.preventDefault();
        const cls = r.querySelector("#sClass").value;
        const names = r.querySelector("#sName").value.split("\n").map(x => x.trim()).filter(Boolean);
        if (!names.length) { r.querySelector("#sErr").textContent = "Please type a name."; return; }
        if (existing) { existing.name = names[0].slice(0, 24); existing.cls = cls; persistStudent(existing); }
        else names.forEach(n => { const id = uid("st"); db.students[id] = { id, name: n.slice(0, 24), cls, points: 0, answered: 0, correct: 0, best: {}, attempts: {}, lastActive: null }; persistStudent(db.students[id]); });
        closeModal();
      };
    }
  });
}
function topicModal(existing) {
  openModal({
    html: () => `<h2>${existing ? "Edit topic" : "Add topic"}</h2>
      <form id="tForm">
        <label for="tName" style="margin-top:0">Topic name</label>
        <input id="tName" type="text" maxlength="60" value="${esc(existing ? existing.name : "")}" placeholder="e.g. Plants and photosynthesis">
        <label for="tStageSel">Stage</label>
        <select id="tStageSel">${[1, 2, 3, 4, 5, 6].map(s => `<option value="${s}" ${(existing ? +existing.stage : tStage) === s ? "selected" : ""}>Stage ${s}</option>`).join("")}</select>
        <label for="tStrand">Strand</label>
        <select id="tStrand">${Object.keys(STRAND_LABEL).map(k => `<option value="${k}" ${existing && existing.strand === k ? "selected" : ""}>${STRAND_LABEL[k]}</option>`).join("")}</select>
        <div class="err" id="tErr"></div>
        <div class="modal-actions">
          ${existing ? `<button type="button" class="btn danger sm" id="tDel" style="margin-right:auto">Delete topic</button>` : ""}
          <button type="button" class="btn ghost sm" id="mCancel">Cancel</button><button class="btn sm" type="submit">Save</button></div>
      </form>`,
    bind: r => {
      r.querySelector("#tName").focus();
      r.querySelector("#mCancel").onclick = closeModal;
      const del = r.querySelector("#tDel");
      if (del) del.onclick = () => {
        const n = topicQuestions(existing.id).length;
        confirmModal("Delete this topic?", `"${existing.name}" and its ${n} question(s) will be removed.`, "Delete", () => {
          db.questions = db.questions.filter(q => q.topic !== existing.id);
          db.topics = db.topics.filter(t => t.id !== existing.id);
          tTopic = "all"; persistBank();
        });
      };
      r.querySelector("#tForm").onsubmit = e => {
        e.preventDefault();
        const name = r.querySelector("#tName").value.trim();
        if (!name) { r.querySelector("#tErr").textContent = "Please type a topic name."; return; }
        const stage = +r.querySelector("#tStageSel").value, strand = r.querySelector("#tStrand").value;
        if (existing) Object.assign(existing, { name, stage, strand });
        else { const id = uid("tp"); db.topics.push({ id, name, stage, strand }); tTopic = id; }
        tStage = stage; persistBank(); closeModal();
      };
    }
  });
}
function questionModal(existing) {
  const draft = existing
    ? { ...existing, options: existing.options ? existing.options.slice() : ["", "", "", ""], answer: Array.isArray(existing.answer) ? existing.answer.slice() : existing.answer }
    : { topic: tTopic !== "all" ? tTopic : (db.topics.find(t => +t.stage === tStage) || {}).id, type: "mcq", q: "", options: ["", "", "", ""], answer: 0, explanation: "" };
  let dStage = draft.topic && topicById(draft.topic) ? +topicById(draft.topic).stage : tStage;
  const readForm = r => {
    draft.topic = r.querySelector("#qTopicSel").value;
    draft.q = r.querySelector("#qText").value;
    draft.explanation = r.querySelector("#qExp").value;
    if (draft.type === "mcq") {
      draft.options = [0, 1, 2, 3].map(i => r.querySelector("#opt" + i).value);
      const c = r.querySelector("input[name=correct]:checked"); draft.answer = c ? +c.value : 0;
    } else if (draft.type === "tf") {
      const c = r.querySelector("input[name=tfans]:checked"); draft.answer = c ? c.value === "true" : true;
    } else {
      draft.answer = r.querySelector("#fillAns").value.split(",").map(x => x.trim()).filter(Boolean);
    }
  };
  openModal({
    html: () => {
      const topics = db.topics.filter(t => +t.stage === dStage);
      let answerHtml = "";
      if (draft.type === "mcq") {
        const ans = typeof draft.answer === "number" ? draft.answer : 0;
        answerHtml = `<label>Options <span class="muted" style="font-weight:700">(tick the correct one)</span></label>
          ${[0, 1, 2, 3].map(i => `<div class="opt-edit"><input type="radio" name="correct" value="${i}" ${ans === i ? "checked" : ""} aria-label="Option ${"ABCD"[i]} is correct"><span class="k">${"ABCD"[i]}</span><input id="opt${i}" type="text" maxlength="160" value="${esc((draft.options || [])[i] || "")}"></div>`).join("")}`;
      } else if (draft.type === "tf") {
        answerHtml = `<label>Correct answer</label><div class="radio-row">
          <label><input type="radio" name="tfans" value="true" ${draft.answer !== false ? "checked" : ""}> True</label>
          <label><input type="radio" name="tfans" value="false" ${draft.answer === false ? "checked" : ""}> False</label></div>`;
      } else {
        answerHtml = `<label for="fillAns">Accepted answers</label>
          <input id="fillAns" type="text" maxlength="200" value="${esc(Array.isArray(draft.answer) ? draft.answer.join(", ") : "")}" placeholder="e.g. magma">
          <div class="hint">Separate different accepted answers with commas. Capital letters do not matter.</div>`;
      }
      return `<h2>${existing ? "Edit question" : "Add question"}</h2>
        <form id="qForm">
          <div class="grid2" style="gap:10px">
            <div><label for="qStageSel" style="margin-top:0">Stage</label>
              <select id="qStageSel">${[1, 2, 3, 4, 5, 6].map(s => `<option value="${s}" ${dStage === s ? "selected" : ""}>Stage ${s}</option>`).join("")}</select></div>
            <div><label for="qTopicSel" style="margin-top:0">Topic</label>
              <select id="qTopicSel">${topics.length ? topics.map(t => `<option value="${t.id}" ${draft.topic === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("") : `<option value="">No topics in this stage</option>`}</select></div>
          </div>
          <label for="qType">Question type</label>
          <select id="qType">${Object.keys(TYPE_LABEL).map(k => `<option value="${k}" ${draft.type === k ? "selected" : ""}>${TYPE_LABEL[k]}</option>`).join("")}</select>
          <label for="qText">Question</label>
          <textarea id="qText" maxlength="500" placeholder="Type the question. For fill in the blank, use ____ for the gap.">${esc(draft.q)}</textarea>
          ${answerHtml}
          <label for="qExp">Explanation shown after answering</label>
          <textarea id="qExp" maxlength="600" placeholder="Explain why the answer is correct.">${esc(draft.explanation)}</textarea>
          <div class="err" id="qErr"></div>
          <div class="modal-actions"><button type="button" class="btn ghost sm" id="mCancel">Cancel</button><button class="btn sm" type="submit">Save question</button></div>
        </form>`;
    },
    bind: r => {
      r.querySelector("#mCancel").onclick = closeModal;
      r.querySelector("#qStageSel").onchange = e => { readForm(r); dStage = +e.target.value; const first = db.topics.find(t => +t.stage === dStage); draft.topic = first ? first.id : ""; renderModal(); };
      r.querySelector("#qType").onchange = e => {
        readForm(r); draft.type = e.target.value;
        draft.answer = draft.type === "mcq" ? 0 : draft.type === "tf" ? true : [];
        renderModal();
      };
      r.querySelector("#qForm").onsubmit = e => {
        e.preventDefault(); readForm(r);
        const err = m => { r.querySelector("#qErr").textContent = m; };
        if (!draft.topic) return err("Choose a topic (add one first if this stage has none).");
        if (!draft.q.trim()) return err("Please type the question.");
        if (draft.type === "mcq" && draft.options.some(o => !o.trim())) return err("Please fill in all four options.");
        if (draft.type === "fill" && !draft.answer.length) return err("Please type at least one accepted answer.");
        if (!draft.explanation.trim()) return err("Please add a short explanation for students.");
        const clean = { id: existing ? existing.id : uid("q"), topic: draft.topic, type: draft.type, q: draft.q.trim(), answer: draft.answer, explanation: draft.explanation.trim() };
        if (draft.type === "mcq") clean.options = draft.options.map(o => o.trim());
        if (existing) db.questions[db.questions.findIndex(q => q.id === existing.id)] = clean;
        else db.questions.push(clean);
        tStage = dStage; tTopic = draft.topic;
        persistBank(); closeModal();
      };
    }
  });
}

/* ================= Event binding ================= */
function bindView() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  if (view === "home") {
    $app.querySelectorAll("[data-stage]").forEach(b => b.onclick = () => { selectedStage = +b.dataset.stage; render(); });
    $app.querySelectorAll("[data-topic]").forEach(b => b.onclick = () => startQuiz(b.dataset.topic));
    on("switchStudent", () => { session = null; save(); view = "login"; loginRole = "student"; render(); });
  }
  if (view === "quiz") {
    $app.querySelectorAll("[data-opt]").forEach(b => b.onclick = () => { quiz.picked = +b.dataset.opt; render(); });
    $app.querySelectorAll("[data-tf]").forEach(b => b.onclick = () => { quiz.picked = b.dataset.tf === "true"; render(); });
    const fill = document.getElementById("fill");
    if (fill && !quiz.checked) {
      fill.focus(); fill.setSelectionRange(fill.value.length, fill.value.length);
      fill.oninput = () => { quiz.picked = fill.value; const btn = document.getElementById("check"); if (btn) btn.disabled = !fill.value.trim(); };
      fill.onkeydown = e => { if (e.key === "Enter" && fill.value.trim()) checkAnswer(); };
    }
    on("check", checkAnswer);
    on("next", nextQuestion);
    on("quitQuiz", () => { flushQuiz(); quiz = null; view = "home"; render(); });
  }
  if (view === "result") {
    on("retry", () => startQuiz(quiz.topicId));
    on("toTopics", () => { quiz = null; view = "home"; render(); window.scrollTo(0, 0); });
    on("toLb", () => { quiz = null; view = "leaderboard"; render(); window.scrollTo(0, 0); });
  }
  if (view === "leaderboard") {
    $app.querySelectorAll("[data-scope]").forEach(b => b.onclick = () => { lbScope = b.dataset.scope; schoolTop = null; render(); });
  }
  if (view === "teacher") {
    ["ovClass", "stClass"].forEach(id => { const el = document.getElementById(id); if (el) el.onchange = () => { tClass = el.value; render(); }; });
    $app.querySelectorAll("[data-student]").forEach(r => r.onclick = () => { tTab = "students"; tStudent = r.dataset.student; render(); window.scrollTo(0, 0); });
    on("addStudent", () => studentModal(null));
    on("backStudents", () => { tStudent = null; render(); });
    const s = tStudent && db.students[tStudent];
    if (s) {
      on("editStudent", () => studentModal(s));
      on("resetStudent", () => confirmModal("Reset scores?", `${s.name}'s coins, stars and results will go back to zero.`, "Reset", () => {
        Object.assign(s, { points: 0, answered: 0, correct: 0, best: {}, attempts: {} }); persistStudent(s);
      }));
      on("delStudent", () => confirmModal("Remove student?", `${s.name} and all their results will be deleted.`, "Remove", () => {
        removeStudentDoc(s.id); tStudent = null;
      }));
    }
    const qs = document.getElementById("qStage"); if (qs) qs.onchange = () => { tStage = +qs.value; tTopic = "all"; render(); };
    const qt = document.getElementById("qTopic"); if (qt) qt.onchange = () => { tTopic = qt.value; render(); };
    on("addTopic", () => topicModal(null));
    on("editTopic", () => topicModal(topicById(tTopic)));
    on("addQuestion", () => questionModal(null));
    $app.querySelectorAll("[data-editq]").forEach(b => b.onclick = () => questionModal(db.questions.find(q => q.id === b.dataset.editq)));
    $app.querySelectorAll("[data-delq]").forEach(b => b.onclick = () => {
      const q = db.questions.find(x => x.id === b.dataset.delq);
      confirmModal("Delete question?", q.q, "Delete", () => { db.questions = db.questions.filter(x => x.id !== q.id); delete db.qstats[q.id]; persistBank(); });
    });
    $app.querySelectorAll("[data-delclass]").forEach(b => b.onclick = () => {
      const c = b.dataset.delclass, n = Object.values(db.students).filter(s => s.cls === c).length;
      if (db.classes.length <= 1) return;
      confirmModal("Remove class " + c + "?", n ? `Its ${n} student(s) and their results will also be deleted.` : "This class has no students.", "Remove", () => {
        db.classes = db.classes.filter(x => x !== c);
        Object.values(db.students).forEach(s => { if (s.cls === c) removeStudentDoc(s.id); });
        persistSettings();
        if (tClass === c) tClass = "all";
      });
    });
    const acf = document.getElementById("addClassForm");
    if (acf) acf.onsubmit = e => {
      e.preventDefault();
      const v = document.getElementById("newClass").value.trim().toUpperCase();
      if (v && !db.classes.includes(v)) { db.classes.push(v); db.classes.sort(); persistSettings(); render(); }
    };
    $app.querySelectorAll("[data-delteacher]").forEach(b => b.onclick = () => {
      const t = b.dataset.delteacher;
      confirmModal("Remove teacher?", t + " will no longer be able to open the dashboard.", "Remove", () => {
        db.teachers = db.teachers.filter(x => x !== t); persistSettings();
      });
    });
    const atf = document.getElementById("addTeacherForm");
    if (atf) atf.onsubmit = e => {
      e.preventDefault();
      const v = document.getElementById("newTeacher").value.trim().toLowerCase();
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) && !db.teachers.includes(v)) { db.teachers.push(v); persistSettings(); render(); }
    };
    const pf = document.getElementById("pinForm");
    if (pf) pf.onsubmit = e => {
      e.preventDefault();
      const v = document.getElementById("newPin").value.trim();
      const msg = document.getElementById("pinMsg");
      if (!/^\d{4,8}$/.test(v)) { msg.style.color = "var(--bad)"; msg.textContent = "Use 4 to 8 digits."; return; }
      db.pin = v; save(); msg.style.color = "var(--good)"; msg.textContent = "PIN saved.";
      document.getElementById("newPin").value = "";
    };
    on("resetDemo", () => confirmModal("Reset everything?", "All students, scores and question changes will be replaced with the demo data.", "Reset", () => {
      db = seedDb(true); tClass = "all"; tTopic = "all"; tStudent = null;
    }));
  }
}

render();
if (MODE === "cloud") initCloud();
