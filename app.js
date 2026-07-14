/* =========================================================
   НАСТРОЙКА FIREBASE
   1. Зайди на https://console.firebase.google.com
   2. Создай проект (бесплатно) -> Build -> Firestore Database -> Create database
      (режим test mode подойдёт для старта)
   3. Project settings -> General -> "Your apps" -> Web app -> скопируй конфиг
   4. Вставь свои значения ниже вместо REPLACE_ME
   Без этого шага плейлист и календарь будут работать только
   в твоём браузере (через localStorage) и не будут видны другим.
   ========================================================= */
const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME"
};

let db = null;
let cloudEnabled = false;
try {
  if (firebaseConfig.apiKey !== "REPLACE_ME" && window.firebase) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    cloudEnabled = true;
  }
} catch (e) {
  console.warn("Firebase недоступен, работаем локально:", e);
}

/* ---------- маленький локальный "движок хранения" на замену Firebase ---------- */
const localStore = {
  read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch { return fallback; }
  },
  write(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
};

/* ================= TABS ================= */
const tabs = document.querySelectorAll(".tab");
const views = document.querySelectorAll(".view");
tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
    views.forEach(v => v.classList.remove("active"));
    tab.classList.add("active");
    tab.setAttribute("aria-selected", "true");
    document.getElementById(tab.dataset.tab).classList.add("active");
  });
});

/* ================= HOME: daily message ================= */
const dailyMessages = [
  "ты — лучшее, что случилось со мной в этом году 💗",
  "просто хотел(а) напомнить: ты потрясающая ✨",
  "если скучаешь — открой плейлист, там кое-что для тебя 🎧",
  "не забудь про важные даты в календаре 🗓️",
  "улыбнись, тебя любят 🎀",
  "сегодня отличный день, чтобы попрыгать в игру ниже 🐾",
  "ты справишься со всем, во что упрёшься сегодня 💪💕",
];
const dailyMsgEl = document.getElementById("daily-msg");
function showRandomMsg() {
  const msg = dailyMessages[Math.floor(Math.random() * dailyMessages.length)];
  dailyMsgEl.textContent = msg;
}
showRandomMsg();
document.getElementById("new-msg-btn").addEventListener("click", showRandomMsg);
document.getElementById("year").textContent = new Date().getFullYear();

/* ================= PLAYLIST ================= */
const songForm = document.getElementById("song-form");
const songList = document.getElementById("song-list");
const songStatus = document.getElementById("song-status");

/* Определяем тип ссылки и возвращаем HTML плеера, встроенного в страницу.
   Поддержаны: YouTube, Spotify, прямые ссылки на аудиофайлы (.mp3/.ogg/.wav).
   Если ссылка другого типа (например Яндекс.Музыка не даёт встраивание
   без своего плеера) — возвращаем null, тогда покажем обычную кнопку-ссылку. */
function getEmbedHtml(url) {
  if (!url) return null;

  // YouTube: youtube.com/watch?v=ID  или  youtu.be/ID  или youtube shorts
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{6,})/);
  if (yt) {
    return `<iframe width="100%" height="180" src="https://www.youtube.com/embed/${yt[1]}"
      title="плеер" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen loading="lazy"></iframe>`;
  }

  // Spotify: open.spotify.com/track/ID
  const sp = url.match(/open\.spotify\.com\/track\/([\w]+)/);
  if (sp) {
    return `<iframe style="border-radius:8px" src="https://open.spotify.com/embed/track/${sp[1]}"
      width="100%" height="152" frameborder="0" allow="encrypted-media" loading="lazy"></iframe>`;
  }

  // прямая ссылка на аудиофайл
  if (/\.(mp3|ogg|wav|m4a)(\?.*)?$/i.test(url)) {
    return `<audio controls style="width:100%" src="${escapeAttr(url)}"></audio>`;
  }

  return null; // не умеем встраивать — покажем просто ссылку
}

function renderSongs(songs) {
  songList.innerHTML = "";
  if (!songs.length) {
    songList.innerHTML = `<li class="song-item"><span>пока пусто... добавь первую песню 🎀</span></li>`;
    return;
  }
  songs.forEach(song => {
    const li = document.createElement("li");
    li.className = "song-item";

    const canEmbed = !!getEmbedHtml(song.url);
    const playBtn = song.url
      ? (canEmbed
          ? `<button class="play" data-id="${song.id}">▶ слушать здесь</button>`
          : `<a href="${escapeAttr(song.url)}" target="_blank" rel="noopener">▶ открыть ссылку</a>`)
      : "";

    li.innerHTML = `
      <div class="song-row">
        <div class="song-info">
          <b>${escapeHtml(song.title)}</b>
          <span>${escapeHtml(song.artist || "")}${song.from ? " · от " + escapeHtml(song.from) : ""}</span>
        </div>
        <div class="song-actions">
          ${playBtn}
          <button class="del" data-id="${song.id}">✕</button>
        </div>
      </div>
      <div class="embed-holder" id="embed-${song.id}"></div>`;
    songList.appendChild(li);
  });

  songList.querySelectorAll(".del").forEach(btn => {
    btn.addEventListener("click", () => deleteSong(btn.dataset.id));
  });

  // клик на "слушать здесь" — вставляем плеер лениво (только когда нажали,
  // чтобы страница не грузила сразу кучу видео/аудио)
  songList.querySelectorAll(".play").forEach(btn => {
    btn.addEventListener("click", () => {
      const song = songs.find(s => s.id === btn.dataset.id);
      const holder = document.getElementById(`embed-${song.id}`);
      if (holder.innerHTML) {
        holder.innerHTML = ""; // повторный клик — свернуть плеер
        btn.textContent = "▶ слушать здесь";
      } else {
        holder.innerHTML = getEmbedHtml(song.url);
        btn.textContent = "✕ свернуть";
      }
    });
  });
}

function deleteSong(id) {
  if (cloudEnabled) {
    db.collection("songs").doc(id).delete();
  } else {
    const songs = localStore.read("songs", []).filter(s => s.id !== id);
    localStore.write("songs", songs);
    renderSongs(songs);
  }
}

songForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const title = document.getElementById("song-title").value.trim();
  const artist = document.getElementById("song-artist").value.trim();
  const url = document.getElementById("song-link").value.trim();
  const from = document.getElementById("song-from").value.trim();
  if (!title) return;

  const song = { title, artist, url, from, ts: Date.now() };

  if (cloudEnabled) {
    db.collection("songs").add(song)
      .then(() => { songStatus.textContent = "добавлено ✔"; setTimeout(() => songStatus.textContent = "", 1500); })
      .catch(err => { songStatus.textContent = "ошибка сохранения :("; console.error(err); });
  } else {
    const songs = localStore.read("songs", []);
    song.id = "local-" + song.ts;
    songs.unshift(song);
    localStore.write("songs", songs);
    renderSongs(songs);
    songStatus.textContent = "добавлено локально (настрой Firebase, чтобы делиться онлайн)";
  }
  songForm.reset();
});

if (cloudEnabled) {
  db.collection("songs").orderBy("ts", "desc").onSnapshot(snap => {
    const songs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSongs(songs);
  }, err => {
    console.error(err);
    songStatus.textContent = "не удалось подключиться к базе, проверь настройки Firebase";
  });
} else {
  renderSongs(localStore.read("songs", []));
  songStatus.textContent = "⚠ офлайн-режим: настрой Firebase в app.js, чтобы плейлист был общим онлайн";
}

/* ================= CALENDAR ================= */
const calGrid = document.getElementById("cal-grid");
const calLabel = document.getElementById("cal-month-label");
const upcomingList = document.getElementById("upcoming-list");
const modalOverlay = document.getElementById("modal-overlay");
const modalDateLabel = document.getElementById("modal-date-label");
const modalNoteList = document.getElementById("modal-note-list");
const noteForm = document.getElementById("note-form");

const MONTHS_RU = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
const DOW_RU = ["пн","вт","ср","чт","пт","сб","вс"];

let viewDate = new Date();
viewDate.setDate(1);
let selectedDateKey = null;
let allNotes = []; // {id, date:'YYYY-MM-DD', text, important}

function dateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function renderCalendar() {
  const y = viewDate.getFullYear();
  const m = viewDate.getMonth();
  calLabel.textContent = `${MONTHS_RU[m]} ${y}`;
  calGrid.innerHTML = "";

  DOW_RU.forEach(d => {
    const el = document.createElement("div");
    el.className = "cal-dow";
    el.textContent = d;
    calGrid.appendChild(el);
  });

  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7; // понедельник = 0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayKey = dateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  for (let i = 0; i < firstDow; i++) {
    const el = document.createElement("div");
    el.className = "cal-day empty";
    calGrid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateKey(y, m, d);
    const dayNotes = allNotes.filter(n => n.date === key);
    const el = document.createElement("div");
    el.className = "cal-day" + (key === todayKey ? " today" : "") + (dayNotes.some(n => n.important) ? " important" : "");
    el.innerHTML = `<span>${d}</span>` + (dayNotes.length ? `<span class="dot"></span>` : "");
    el.addEventListener("click", () => openModal(key));
    calGrid.appendChild(el);
  }

  renderUpcoming();
}

function renderUpcoming() {
  const todayStr = dateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const upcoming = allNotes
    .filter(n => n.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8);

  upcomingList.innerHTML = "";
  if (!upcoming.length) {
    upcomingList.innerHTML = `<li class="upcoming-item">пока нет запланированных дат 🎀</li>`;
    return;
  }
  upcoming.forEach(n => {
    const li = document.createElement("li");
    li.className = "upcoming-item" + (n.important ? " important" : "");
    const [yy, mm, dd] = n.date.split("-");
    li.innerHTML = `<span>${n.important ? "⚠ " : ""}${escapeHtml(n.text)}</span><span class="u-date">${dd}.${mm}.${yy}</span>`;
    upcomingList.appendChild(li);
  });
}

document.getElementById("cal-prev").addEventListener("click", () => {
  viewDate.setMonth(viewDate.getMonth() - 1);
  renderCalendar();
});
document.getElementById("cal-next").addEventListener("click", () => {
  viewDate.setMonth(viewDate.getMonth() + 1);
  renderCalendar();
});

function openModal(key) {
  selectedDateKey = key;
  const [y, m, d] = key.split("-");
  modalDateLabel.textContent = `${d}.${m}.${y}`;
  renderModalNotes();
  modalOverlay.classList.add("open");
}
function closeModal() {
  modalOverlay.classList.remove("open");
  noteForm.reset();
}
document.getElementById("modal-close").addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });

function renderModalNotes() {
  const notes = allNotes.filter(n => n.date === selectedDateKey);
  modalNoteList.innerHTML = notes.length
    ? notes.map(n => `<li class="note-item${n.important ? " important" : ""}">${n.important ? "⚠ " : ""}${escapeHtml(n.text)}</li>`).join("")
    : `<li class="note-item">заметок пока нет</li>`;
}

noteForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = document.getElementById("note-text").value.trim();
  const important = document.getElementById("note-important").checked;
  if (!text || !selectedDateKey) return;
  const note = { date: selectedDateKey, text, important, ts: Date.now() };

  if (cloudEnabled) {
    db.collection("notes").add(note);
  } else {
    const notes = localStore.read("notes", []);
    note.id = "local-" + note.ts;
    notes.push(note);
    localStore.write("notes", notes);
    allNotes = notes;
    renderCalendar();
    renderModalNotes();
  }
  noteForm.reset();
});

if (cloudEnabled) {
  db.collection("notes").onSnapshot(snap => {
    allNotes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCalendar();
    if (modalOverlay.classList.contains("open")) renderModalNotes();
  });
} else {
  allNotes = localStore.read("notes", []);
}
renderCalendar();

/* ================= helpers ================= */
function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}
function escapeAttr(str) { return escapeHtml(str); }

/* ================= GAME: прыг-прыг котик ================= */
(function () {
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("game-overlay");
  const msgEl = document.getElementById("game-msg");
  const scoreEl = document.getElementById("score");
  const highscoreEl = document.getElementById("highscore");

  const W = canvas.width, H = canvas.height;
  const GROUND_Y = H - 30;
  const GRAV = 0.9;
  const JUMP_V = -13;

  let cat, obstacles, speed, score, running, best;

  best = parseInt(localStorage.getItem("bowGameHighscore") || "0", 10);
  highscoreEl.textContent = best;

  function reset() {
    cat = { x: 40, y: GROUND_Y - 24, w: 22, h: 24, vy: 0, onGround: true };
    obstacles = [];
    speed = 6;
    score = 0;
    running = true;
    scoreEl.textContent = "0";
  }

  function spawnObstacle() {
    const h = 18 + Math.random() * 18;
    obstacles.push({ x: W + 10, y: GROUND_Y - h, w: 14, h });
  }
  let spawnTimer = 0;

  function jump() {
    if (!running) { reset(); overlay.style.display = "none"; loop(); return; }
    if (cat.onGround) { cat.vy = JUMP_V; cat.onGround = false; }
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") { e.preventDefault(); jump(); }
  });
  overlay.addEventListener("click", jump);
  canvas.addEventListener("click", jump);
  canvas.addEventListener("touchstart", (e) => { e.preventDefault(); jump(); }, { passive: false });

  function drawPixelRect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function drawCat() {
    // pixel-ish bow cat: body + ears + bow
    drawPixelRect(cat.x, cat.y, cat.w, cat.h, "#5b2a45");
    drawPixelRect(cat.x + 3, cat.y + 4, cat.w - 6, cat.h - 8, "#ffcfe3");
    drawPixelRect(cat.x - 2, cat.y - 4, 6, 6, "#5b2a45"); // ear
    drawPixelRect(cat.x + cat.w - 4, cat.y - 4, 6, 6, "#5b2a45"); // ear
    drawPixelRect(cat.x + 6, cat.y - 8, 10, 5, "#ffd166"); // bow
  }

  function drawObstacle(o) {
    drawPixelRect(o.x, o.y, o.w, o.h, "#e85c9c");
    drawPixelRect(o.x + 4, o.y - 5, 6, 6, "#e85c9c");
  }

  function loop() {
    if (!running) return;
    ctx.clearRect(0, 0, W, H);

    // ground
    drawPixelRect(0, GROUND_Y, W, 3, "#5b2a45");

    // physics
    cat.vy += GRAV;
    cat.y += cat.vy;
    if (cat.y >= GROUND_Y - cat.h) { cat.y = GROUND_Y - cat.h; cat.vy = 0; cat.onGround = true; }

    spawnTimer--;
    if (spawnTimer <= 0) { spawnObstacle(); spawnTimer = 60 + Math.random() * 50 - speed * 3; }

    obstacles.forEach(o => o.x -= speed);
    obstacles = obstacles.filter(o => o.x + o.w > 0);

    // collision
    for (const o of obstacles) {
      if (cat.x < o.x + o.w - 4 && cat.x + cat.w - 4 > o.x && cat.y < o.y + o.h && cat.y + cat.h > o.y) {
        running = false;
        best = Math.max(best, score);
        localStorage.setItem("bowGameHighscore", best);
        highscoreEl.textContent = best;
        msgEl.textContent = `ой! счёт: ${score} 💔 нажми, чтобы попробовать снова`;
        overlay.style.display = "flex";
        return;
      }
    }

    drawCat();
    obstacles.forEach(drawObstacle);

    score++;
    scoreEl.textContent = Math.floor(score / 5);
    speed = 6 + Math.floor(score / 400);

    requestAnimationFrame(loop);
  }

  reset();
  msgEl.textContent = "нажми, чтобы начать 🐾";
})();
