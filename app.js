cat > /home/claude/site/app.js << 'JSEOF'
/* =========================================================
   НАСТРОЙКА FIREBASE (общий плейлист и календарь онлайн)
   Инструкция — в README.md. Без этого шага плейлист и
   календарь сохраняются только локально, в браузере.
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

const localStore = {
  read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch { return fallback; }
  },
  write(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
};

/* ================= helpers ================= */
function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}
function escapeAttr(str) { return escapeHtml(str); }

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
  dailyMsgEl.textContent = dailyMessages[Math.floor(Math.random() * dailyMessages.length)];
}
showRandomMsg();
document.getElementById("new-msg-btn").addEventListener("click", showRandomMsg);
document.getElementById("year").textContent = new Date().getFullYear();

/* =========================================================
   PLAYLIST + ВСТРОЕННЫЙ ПЛЕЕР
   ========================================================= */
const songForm = document.getElementById("song-form");
const songList = document.getElementById("song-list");
const songStatus = document.getElementById("song-status");
const audioEl = document.getElementById("audio-el");

let songsCache = [];
let currentIndex = -1;
let repeatMode = "off"; // off | all | one
let playbackRate = 1;
let volume = 80;
let ytPlayer = null;
let ytReady = false;
let pendingYtLoad = null;
let progressTimer = null;

/* ---- распознавание ссылок ---- */
function detectSongType(url) {
  if (/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)/.test(url)) return "youtube";
  if (/open\.spotify\.com\/track\//.test(url)) return "spotify";
  if (/\.(mp3|ogg|wav|m4a)(\?.*)?$/i.test(url)) return "audio";
  return null;
}
function extractYoutubeId(url) {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{6,})/);
  return m ? m[1] : null;
}
function extractSpotifyId(url) {
  const m = url.match(/open\.spotify\.com\/track\/([\w]+)/);
  return m ? m[1] : null;
}
async function fetchTitle(url, type) {
  try {
    if (type === "youtube") {
      const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      if (r.ok) { const d = await r.json(); return d.title + (d.author_name ? " — " + d.author_name : ""); }
    } else if (type === "spotify") {
      const r = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
      if (r.ok) { const d = await r.json(); return d.title; }
    } else if (type === "audio") {
      const name = decodeURIComponent(url.split("/").pop().split("?")[0]).replace(/\.[a-z0-9]+$/i, "");
      return name || "аудиофайл";
    }
  } catch (e) { console.warn("не удалось получить название", e); }
  return "без названия";
}

/* ---- добавление песни (только ссылка) ---- */
songForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const urlInput = document.getElementById("song-link");
  const url = urlInput.value.trim();
  if (!url) return;
  const type = detectSongType(url);
  if (!type) {
    songStatus.textContent = "не получилось распознать ссылку 😢 (нужен YouTube, Spotify или прямой .mp3)";
    return;
  }
  songStatus.textContent = "добавляю...";
  const title = await fetchTitle(url, type);
  const song = { url, type, title, ts: Date.now() };

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

function deleteSong(id) {
  if (cloudEnabled) {
    db.collection("songs").doc(id).delete();
  } else {
    const songs = localStore.read("songs", []).filter(s => s.id !== id);
    localStore.write("songs", songs);
    renderSongs(songs);
  }
}

function toggleSpotifyEmbed(song) {
  const holder = document.getElementById(`embed-${song.id}`);
  if (!holder) return;
  if (holder.innerHTML) { holder.innerHTML = ""; return; }
  const spId = extractSpotifyId(song.url);
  holder.innerHTML = spId
    ? `<iframe style="border-radius:8px" src="https://open.spotify.com/embed/track/${spId}" width="100%" height="152" frameborder="0" allow="encrypted-media" loading="lazy"></iframe>`
    : `<a href="${escapeAttr(song.url)}" target="_blank" rel="noopener">открыть в Spotify</a>`;
}

function renderSongs(songs) {
  songsCache = songs;
  songList.innerHTML = "";
  if (!songs.length) {
    songList.innerHTML = `<li class="song-item"><span>пока пусто... вставь первую ссылку 🎀</span></li>`;
    return;
  }
  songs.forEach((song, idx) => {
    const li = document.createElement("li");
    li.className = "song-item" + (idx === currentIndex ? " now-playing" : "");
    const icon = song.type === "youtube" ? "▶️" : song.type === "spotify" ? "🟢" : "🎵";
    li.innerHTML = `
      <div class="song-row">
        <button class="song-select" data-idx="${idx}">
          <span class="song-icon">${icon}</span>
          <span class="song-title-text">${escapeHtml(song.title || "без названия")}</span>
        </button>
        <div class="song-actions"><button class="del" data-id="${song.id}">✕</button></div>
      </div>
      ${song.type === "spotify" ? `<div class="embed-holder" id="embed-${song.id}"></div>` : ""}`;
    songList.appendChild(li);
  });

  songList.querySelectorAll(".del").forEach(btn => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); deleteSong(btn.dataset.id); });
  });
  songList.querySelectorAll(".song-select").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const song = songsCache[idx];
      if (song.type === "spotify") toggleSpotifyEmbed(song);
      else playTrackByIndex(idx);
    });
  });
}

if (cloudEnabled) {
  db.collection("songs").orderBy("ts", "desc").onSnapshot(snap => {
    renderSongs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, err => {
    console.error(err);
    songStatus.textContent = "не удалось подключиться к базе, проверь настройки Firebase";
  });
} else {
  renderSongs(localStore.read("songs", []));
  songStatus.textContent = "⚠ офлайн-режим: настрой Firebase в app.js, чтобы плейлист был общим онлайн";
}

/* ---- плеер: YouTube IFrame API ---- */
function ensureYoutubeApi() {
  if (window.YT && window.YT.Player) { ytReady = true; return; }
  if (document.getElementById("yt-iframe-api")) return;
  const tag = document.createElement("script");
  tag.id = "yt-iframe-api";
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);
  window.onYouTubeIframeAPIReady = function () {
    ytReady = true;
    if (pendingYtLoad) { const vid = pendingYtLoad; pendingYtLoad = null; createOrLoadYt(vid); }
  };
}
function createOrLoadYt(videoId) {
  document.getElementById("cover-placeholder").style.display = "none";
  const target = document.getElementById("yt-target");
  target.style.display = "block";
  if (!ytPlayer) {
    ytPlayer = new YT.Player("yt-target", {
      videoId,
      playerVars: { rel: 0, modestbranding: 1 },
      events: {
        onReady: (e) => {
          e.target.setVolume(volume);
          e.target.setPlaybackRate(playbackRate);
          e.target.playVideo();
          setPlayPauseIcon(true);
          startYtProgressTimer();
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.ENDED) handleTrackEnd();
          else if (e.data === YT.PlayerState.PLAYING) setPlayPauseIcon(true);
          else if (e.data === YT.PlayerState.PAUSED) setPlayPauseIcon(false);
        }
      }
    });
  } else {
    ytPlayer.loadVideoById(videoId);
    ytPlayer.setVolume(volume);
    ytPlayer.setPlaybackRate(playbackRate);
    setPlayPauseIcon(true);
    startYtProgressTimer();
  }
}
function startYtProgressTimer() {
  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    if (ytPlayer && ytPlayer.getCurrentTime) {
      updateProgress(ytPlayer.getCurrentTime(), ytPlayer.getDuration());
    }
  }, 500);
}
function loadYoutubeTrack(song) {
  const videoId = extractYoutubeId(song.url);
  if (!videoId) return;
  if (!ytReady) { pendingYtLoad = videoId; ensureYoutubeApi(); return; }
  createOrLoadYt(videoId);
}

/* ---- плеер: аудиофайлы ---- */
function loadAudioTrack(song) {
  document.getElementById("yt-target").style.display = "none";
  document.getElementById("cover-placeholder").style.display = "flex";
  audioEl.src = song.url;
  audioEl.playbackRate = playbackRate;
  audioEl.volume = volume / 100;
  audioEl.currentTime = 0;
  audioEl.play().catch(() => {});
  setPlayPauseIcon(true);
  audioEl.onended = () => handleTrackEnd();
  audioEl.ontimeupdate = () => updateProgress(audioEl.currentTime, audioEl.duration);
}

function pauseAll() {
  audioEl.pause();
  if (ytPlayer && ytPlayer.pauseVideo) { try { ytPlayer.pauseVideo(); } catch (e) {} }
  clearInterval(progressTimer);
}

/* ---- общее управление плеером ---- */
function findNextPlayableIndex(from, dir) {
  if (!songsCache.length) return -1;
  let idx = from;
  for (let i = 0; i < songsCache.length; i++) {
    idx = (idx + dir + songsCache.length) % songsCache.length;
    if (songsCache[idx].type !== "spotify") return idx;
  }
  return -1;
}

function playTrackByIndex(idx) {
  if (idx < 0 || idx >= songsCache.length) return;
  const song = songsCache[idx];
  if (song.type === "spotify") { toggleSpotifyEmbed(song); return; }
  pauseAll();
  currentIndex = idx;
  document.getElementById("player-title").textContent = song.title || "без названия";
  document.getElementById("player-sub").textContent = `трек ${idx + 1} из ${songsCache.length}`;
  if (song.type === "youtube") loadYoutubeTrack(song);
  else if (song.type === "audio") loadAudioTrack(song);
  renderSongs(songsCache);
}

function togglePlayPause() {
  if (currentIndex === -1) {
    const idx = findNextPlayableIndex(-1, 1);
    if (idx > -1) playTrackByIndex(idx);
    return;
  }
  const song = songsCache[currentIndex];
  if (song.type === "audio") {
    if (audioEl.paused) { audioEl.play(); setPlayPauseIcon(true); }
    else { audioEl.pause(); setPlayPauseIcon(false); }
  } else if (song.type === "youtube" && ytPlayer && ytPlayer.getPlayerState) {
    const state = ytPlayer.getPlayerState();
    if (state === YT.PlayerState.PLAYING) { ytPlayer.pauseVideo(); setPlayPauseIcon(false); }
    else { ytPlayer.playVideo(); setPlayPauseIcon(true); }
  }
}

function stopTrack() {
  if (currentIndex === -1) return;
  const song = songsCache[currentIndex];
  if (song.type === "audio") { audioEl.pause(); audioEl.currentTime = 0; }
  else if (song.type === "youtube" && ytPlayer && ytPlayer.stopVideo) { ytPlayer.stopVideo(); }
  setPlayPauseIcon(false);
  updateProgress(0, null);
}

function nextTrack() {
  const idx = findNextPlayableIndex(currentIndex, 1);
  if (idx > -1) playTrackByIndex(idx);
}
function prevTrack() {
  const idx = findNextPlayableIndex(currentIndex, -1);
  if (idx > -1) playTrackByIndex(idx);
}

function handleTrackEnd() {
  if (repeatMode === "one") { playTrackByIndex(currentIndex); return; }
  let found = -1;
  for (let i = currentIndex + 1; i < songsCache.length; i++) {
    if (songsCache[i].type !== "spotify") { found = i; break; }
  }
  if (found === -1 && repeatMode === "all") {
    for (let i = 0; i <= currentIndex; i++) {
      if (songsCache[i].type !== "spotify") { found = i; break; }
    }
  }
  if (found > -1) playTrackByIndex(found);
  else {
    pauseAll();
    setPlayPauseIcon(false);
    document.getElementById("player-sub").textContent = "плейлист закончился 🎀";
  }
}

const repeatIcons = { off: "➡️", all: "🔁", one: "🔂" };
function cycleRepeat() {
  repeatMode = repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off";
  const btn = document.getElementById("btn-repeat");
  btn.textContent = repeatIcons[repeatMode];
  btn.classList.toggle("on", repeatMode !== "off");
}

function changeSpeed(delta) {
  playbackRate = Math.min(2, Math.max(0.5, Math.round((playbackRate + delta) * 100) / 100));
  document.getElementById("speed-label").textContent = playbackRate + "x";
  audioEl.playbackRate = playbackRate;
  if (ytPlayer && ytPlayer.setPlaybackRate) ytPlayer.setPlaybackRate(playbackRate);
}

function setVolume(v) {
  volume = Math.min(100, Math.max(0, v));
  document.getElementById("vol-slider").value = volume;
  audioEl.volume = volume / 100;
  if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(volume);
}

function fmtTime(s) {
  s = Math.floor(s || 0);
  const m = Math.floor(s / 60);
  const sec = String(s % 60).padStart(2, "0");
  return `${m}:${sec}`;
}
function updateProgress(current, duration) {
  const fill = document.getElementById("progress-fill");
  const curEl = document.getElementById("time-current");
  const totEl = document.getElementById("time-total");
  if (!duration || isNaN(duration)) { fill.style.width = "0%"; curEl.textContent = fmtTime(current || 0); totEl.textContent = "0:00"; return; }
  fill.style.width = Math.min(100, (current / duration) * 100) + "%";
  curEl.textContent = fmtTime(current);
  totEl.textContent = fmtTime(duration);
}
function setPlayPauseIcon(isPlaying) {
  document.getElementById("btn-playpause").textContent = isPlaying ? "⏸" : "▶";
}

document.getElementById("btn-prev").addEventListener("click", prevTrack);
document.getElementById("btn-next").addEventListener("click", nextTrack);
document.getElementById("btn-playpause").addEventListener("click", togglePlayPause);
document.getElementById("btn-stop").addEventListener("click", stopTrack);
document.getElementById("btn-repeat").addEventListener("click", cycleRepeat);
document.getElementById("speed-down").addEventListener("click", () => changeSpeed(-0.25));
document.getElementById("speed-up").addEventListener("click", () => changeSpeed(0.25));
document.getElementById("vol-down").addEventListener("click", () => setVolume(volume - 10));
document.getElementById("vol-up").addEventListener("click", () => setVolume(volume + 10));
document.getElementById("vol-slider").addEventListener("input", (e) => setVolume(parseInt(e.target.value, 10)));
document.getElementById("progress-bar").addEventListener("click", (e) => {
  if (currentIndex === -1) return;
  const song = songsCache[currentIndex];
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  if (song.type === "audio" && audioEl.duration) audioEl.currentTime = pct * audioEl.duration;
  else if (song.type === "youtube" && ytPlayer && ytPlayer.getDuration) ytPlayer.seekTo(pct * ytPlayer.getDuration(), true);
});
setVolume(volume);

/* =========================================================
   CALENDAR
   ========================================================= */
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
let allNotes = [];

function dateKey(y, m, d) { return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }

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

  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7;
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
    const hasImportant = dayNotes.some(n => n.important);
    const el = document.createElement("div");
    el.className = "cal-day"
      + (key === todayKey ? " today" : "")
      + (dayNotes.length ? " has-note" : "")
      + (hasImportant ? " has-important" : "");

    let noteHtml = "";
    if (dayNotes.length) {
      const first = dayNotes[0];
      noteHtml = `<span class="day-note">${first.important ? "⚠ " : ""}${escapeHtml(first.text)}</span>`;
      if (dayNotes.length > 1) noteHtml += `<span class="day-note-more">+${dayNotes.length - 1} ещё</span>`;
    }
    el.innerHTML = `<span class="day-num">${d}</span>${noteHtml}`;
    el.addEventListener("click", () => openModal(key));
    calGrid.appendChild(el);
  }

  renderUpcoming();
}

function renderUpcoming() {
  const todayStr = dateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const upcoming = allNotes.filter(n => n.date >= todayStr).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
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

document.getElementById("cal-prev").addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() - 1); renderCalendar(); });
document.getElementById("cal-next").addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() + 1); renderCalendar(); });

function openModal(key) {
  selectedDateKey = key;
  const [y, m, d] = key.split("-");
  modalDateLabel.textContent = `${d}.${m}.${y}`;
  renderModalNotes();
  modalOverlay.classList.add("open");
}
function closeModal() { modalOverlay.classList.remove("open"); noteForm.reset(); }
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

/* =========================================================
   GAME: бесконечный забег в стиле Марио
   девушка — игрок, парень — NPC, повторяет прыжки с задержкой
   ========================================================= */
(function () {
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const titleScreen = document.getElementById("title-screen");
  const gameoverScreen = document.getElementById("gameover-screen");
  const btnStart = document.getElementById("btn-start-game");
  const btnRestart = document.getElementById("btn-restart-game");
  const scoreEl = document.getElementById("score");
  const highscoreEl = document.getElementById("highscore");
  const titleHighscoreEl = document.getElementById("title-highscore");
  const finalScoreEl = document.getElementById("final-score");
  const finalHighscoreEl = document.getElementById("final-highscore");

  const W = canvas.width, H = canvas.height;
  const GROUND_Y = H - 46;
  const GRAV = 0.85;
  const JUMP_V = -14.5;
  const PLAYER_X = 150, NPC_X = 96;
  const CHAR_W = 32, CHAR_H = 50;
  const NPC_DELAY = 10; // кадров задержки — парень повторяет прыжки девушки

  let best = parseInt(localStorage.getItem("bowGameHighscore") || "0", 10);
  highscoreEl.textContent = best;
  titleHighscoreEl.textContent = best;

  const girlImg = new Image(); girlImg.src = "images/girl.png";
  const boyImg = new Image(); boyImg.src = "images/boy.png";
  const bgImg = new Image(); bgImg.src = "images/level-bg.jpg";
  let loadedCount = 0, assetsReady = false;
  [girlImg, boyImg, bgImg].forEach(img => {
    img.onload = () => { loadedCount++; if (loadedCount === 3) assetsReady = true; };
  });

  let state = "title"; // title | playing | gameover
  let player, scrollX, speed, score, gaps, roses, spawnGapTimer, spawnRoseTimer, playerHistory, frameCount;

  function resetGame() {
    player = { y: GROUND_Y - CHAR_H, vy: 0, onGround: true };
    scrollX = 0;
    speed = 5.5;
    score = 0;
    gaps = [];
    roses = [];
    playerHistory = [];
    spawnGapTimer = 80;
    spawnRoseTimer = 120;
    frameCount = 0;
    scoreEl.textContent = "0";
  }

  function startGame() {
    resetGame();
    state = "playing";
    titleScreen.style.display = "none";
    gameoverScreen.style.display = "none";
    requestAnimationFrame(loop);
  }

  function endGame() {
    state = "gameover";
    const finalScore = Math.floor(score);
    best = Math.max(best, finalScore);
    localStorage.setItem("bowGameHighscore", best);
    highscoreEl.textContent = best;
    titleHighscoreEl.textContent = best;
    finalScoreEl.textContent = finalScore;
    finalHighscoreEl.textContent = best;
    gameoverScreen.style.display = "flex";
  }

  function jumpPlayer() {
    if (state !== "playing") return;
    if (player.onGround) { player.vy = JUMP_V; player.onGround = false; }
  }

  btnStart.addEventListener("click", startGame);
  btnRestart.addEventListener("click", startGame);
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      if (state === "title" || state === "gameover") startGame();
      else jumpPlayer();
    }
  });
  canvas.addEventListener("click", () => { if (state === "playing") jumpPlayer(); });
  canvas.addEventListener("touchstart", (e) => { e.preventDefault(); if (state === "playing") jumpPlayer(); }, { passive: false });

  function isOverGap(x, w) { return gaps.some(g => x + w > g.x && x < g.x + g.w); }

  function drawBackground() {
    if (!assetsReady) { ctx.fillStyle = "#2a1830"; ctx.fillRect(0, 0, W, H); return; }
    const bw = bgImg.width * (H / bgImg.height);
    scrollX -= speed * 0.4;
    if (scrollX <= -bw) scrollX += bw;
    let x = scrollX;
    while (x < W) { ctx.drawImage(bgImg, x, 0, bw, H); x += bw; }
  }

  function drawGround() {
    const sorted = [...gaps].sort((a, b) => a.x - b.x);
    ctx.fillStyle = "#3a2440";
    let segStart = 0;
    sorted.forEach(g => { ctx.fillRect(segStart, GROUND_Y, Math.max(0, g.x - segStart), H - GROUND_Y); segStart = g.x + g.w; });
    ctx.fillRect(segStart, GROUND_Y, W - segStart, H - GROUND_Y);
    ctx.fillStyle = "#ff9dc4";
    segStart = 0;
    sorted.forEach(g => { ctx.fillRect(segStart, GROUND_Y, Math.max(0, g.x - segStart), 4); segStart = g.x + g.w; });
    ctx.fillRect(segStart, GROUND_Y, W - segStart, 4);
  }

  function drawRose(r) {
    const x = Math.round(r.x), y = Math.round(r.y);
    ctx.fillStyle = "#3a2440"; ctx.fillRect(x + 5, y + 14, 4, 12);
    ctx.fillStyle = "#e85c9c"; ctx.fillRect(x, y, 14, 14);
    ctx.fillStyle = "#ffd166"; ctx.fillRect(x + 4, y + 4, 6, 6);
  }

  function drawShadow(x, y) {
    const h = Math.max(0, (GROUND_Y - CHAR_H) - y);
    const scale = Math.max(0.35, 1 - h / 130);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(x + CHAR_W / 2, GROUND_Y + 2, 14 * scale, 4 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawChar(img, x, y, onGround) {
    const bob = onGround ? Math.sin(frameCount * 0.35) * 1.5 : 0;
    drawShadow(x, y);
    if (assetsReady && img.complete) {
      ctx.drawImage(img, Math.round(x), Math.round(y - bob), CHAR_W, CHAR_H);
    } else {
      ctx.fillStyle = "#e85c9c";
      ctx.fillRect(x, y - bob, CHAR_W, CHAR_H);
    }
  }

  function loop() {
    if (state !== "playing") return;
    frameCount++;
    ctx.clearRect(0, 0, W, H);
    drawBackground();

    const groundLevel = GROUND_Y - CHAR_H;

    player.vy += GRAV;
    player.y += player.vy;
    const overGap = isOverGap(PLAYER_X, CHAR_W);
    if (!overGap && player.y >= groundLevel) {
      player.y = groundLevel; player.vy = 0; player.onGround = true;
    } else {
      player.onGround = false;
    }
    if (player.y > H + 80) { endGame(); return; }

    playerHistory.push(groundLevel - player.y);
    if (playerHistory.length > 500) playerHistory.shift();
    const histIdx = playerHistory.length - 1 - NPC_DELAY;
    const npcOffset = histIdx >= 0 ? playerHistory[histIdx] : 0;
    const npcY = groundLevel - npcOffset;
    const npcOnGround = npcOffset <= 0.5;

    spawnGapTimer--;
    if (spawnGapTimer <= 0) {
      gaps.push({ x: W + 20, w: 40 + Math.random() * 50 });
      spawnGapTimer = 90 + Math.random() * 60;
    }
    gaps.forEach(g => g.x -= speed);
    gaps = gaps.filter(g => g.x + g.w > -20);

    spawnRoseTimer--;
    if (spawnRoseTimer <= 0) {
      roses.push({ x: W + 20, y: GROUND_Y - 95 - Math.random() * 45, collected: false });
      spawnRoseTimer = 140 + Math.random() * 90;
    }
    roses.forEach(r => r.x -= speed);
    roses = roses.filter(r => r.x > -30 && !r.collected);
    roses.forEach(r => {
      if (PLAYER_X < r.x + 16 && PLAYER_X + CHAR_W > r.x && player.y < r.y + 16 && player.y + CHAR_H > r.y) {
        r.collected = true; score += 25;
      }
    });

    drawGround();
    roses.forEach(drawRose);
    drawChar(boyImg, NPC_X, npcY, npcOnGround);
    drawChar(girlImg, PLAYER_X, player.y, player.onGround);

    score += 0.35;
    scoreEl.textContent = Math.floor(score);
    speed = 5.5 + Math.floor(score / 250) * 0.6;

    requestAnimationFrame(loop);
  }
})();
