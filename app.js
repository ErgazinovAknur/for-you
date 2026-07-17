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

/* ================= HOME: сообщение в облачке по клику на картинку ================= */
const dailyMessages = [
  "Ты самый важный для меня человек, я люблю тебя больше всего на свете",
  "Твой голос, общение со мной и твоя любовь делает меня самым счастливым",
  "Я всегда скучаю по тебе и очень жду нашей встречи",
  "Никогда не усомнюсь в тебе и всегда буду на твоей стороне, моя принцесса",
  "Улыбайся почаще, у тебя самая прекрасная улыбка на свете",
  "Я всегда буду рядом с тобой, чтобы ни случилось, я навеки твой",
];
const homeImageWrap = document.getElementById("home-image-wrap");
const homeBubbleText = document.getElementById("home-bubble-text");
let lastMsgIdx = -1;
homeImageWrap.addEventListener("click", () => {
  let idx;
  do { idx = Math.floor(Math.random() * dailyMessages.length); } while (idx === lastMsgIdx && dailyMessages.length > 1);
  lastMsgIdx = idx;
  homeBubbleText.style.opacity = "0";
  setTimeout(() => {
    homeBubbleText.textContent = dailyMessages[idx];
    homeBubbleText.style.opacity = "1";
  }, 120);
});
document.getElementById("year").textContent = new Date().getFullYear();

/* =========================================================
   PLAYLIST + ВСТРОЕННЫЙ ПЛЕЕР
   ========================================================= */
const songForm = document.getElementById("song-form");
const songGroupsEl = document.getElementById("song-groups");
const songStatus = document.getElementById("song-status");
const groupOptionsEl = document.getElementById("group-options");
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

/* ---- добавление песни (ссылка + необязательный сборник) ---- */
songForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const urlInput = document.getElementById("song-link");
  const groupInput = document.getElementById("song-group");
  const url = urlInput.value.trim();
  const group = groupInput.value.trim();
  if (!url) return;
  const type = detectSongType(url);
  if (!type) {
    songStatus.textContent = "не получилось распознать ссылку (нужен YouTube, Spotify или прямой .mp3)";
    return;
  }
  songStatus.textContent = "добавляю...";
  const title = await fetchTitle(url, type);
  const song = { url, type, title, group, ts: Date.now() };

  if (cloudEnabled) {
    db.collection("songs").add(song)
      .then(() => { songStatus.textContent = "добавлено"; setTimeout(() => songStatus.textContent = "", 1500); })
      .catch(err => { songStatus.textContent = "ошибка сохранения"; console.error(err); });
  } else {
    const songs = localStore.read("songs", []);
    song.id = "local-" + song.ts;
    songs.unshift(song);
    localStore.write("songs", songs);
    renderSongs(songs);
    songStatus.textContent = "добавлено локально (настрой Firebase, чтобы делиться онлайн)";
  }
  urlInput.value = ""; // поле сборника нарочно не чистим — удобно добавлять несколько песен подряд в один сборник
  urlInput.focus();
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
  const holder = document.getElementById("embed-" + song.id);
  if (!holder) return;
  if (holder.innerHTML) { holder.innerHTML = ""; return; }
  const spId = extractSpotifyId(song.url);
  holder.innerHTML = spId
    ? '<iframe style="border-radius:8px" src="https://open.spotify.com/embed/track/' + spId + '" width="100%" height="152" frameborder="0" allow="encrypted-media" loading="lazy"></iframe>'
    : '<a href="' + escapeAttr(song.url) + '" target="_blank" rel="noopener">открыть в Spotify</a>';
}

function groupKeyOf(song) {
  const g = (song.group || "").trim();
  return g || "Без сборника";
}

function renderSongs(songs) {
  songsCache = songs;
  songGroupsEl.innerHTML = "";

  const groupNames = Array.from(new Set(songs.map(s => (s.group || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru"));
  groupOptionsEl.innerHTML = groupNames.map(g => '<option value="' + escapeAttr(g) + '"></option>').join("");

  if (!songs.length) {
    songGroupsEl.innerHTML = '<p class="empty-hint">пока пусто... вставь первую ссылку 🎀</p>';
    return;
  }

  const groups = new Map();
  songs.forEach((song, idx) => {
    const key = groupKeyOf(song);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(idx);
  });
  const orderedKeys = Array.from(groups.keys()).sort((a, b) => {
    if (a === "Без сборника") return 1;
    if (b === "Без сборника") return -1;
    return a.localeCompare(b, "ru");
  });

  orderedKeys.forEach(key => {
    const idxs = groups.get(key);
    const details = document.createElement("details");
    details.className = "song-group";
    details.open = true;

    const summary = document.createElement("summary");
    summary.innerHTML = "<span>" + (key === "Без сборника" ? "🎵 " : "📀 ") + escapeHtml(key) + "</span><span class=\"group-count\">" + idxs.length + "</span>";
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "song-group-body";
    const ul = document.createElement("ul");
    ul.className = "song-list";

    idxs.forEach(idx => {
      const song = songs[idx];
      const li = document.createElement("li");
      li.className = "song-item" + (idx === currentIndex ? " now-playing" : "");
      const icon = song.type === "youtube" ? "▶️" : song.type === "spotify" ? "🟢" : "🎵";
      li.innerHTML =
        '<div class="song-row">' +
          '<button class="song-select" data-idx="' + idx + '">' +
            '<span class="song-icon">' + icon + '</span>' +
            '<span class="song-title-text">' + escapeHtml(song.title || "без названия") + '</span>' +
          '</button>' +
          '<div class="song-actions"><button class="del" data-id="' + song.id + '">✕</button></div>' +
        '</div>' +
        (song.type === "spotify" ? '<div class="embed-holder" id="embed-' + song.id + '"></div>' : "");
      ul.appendChild(li);
    });

    body.appendChild(ul);
    details.appendChild(body);
    songGroupsEl.appendChild(details);
  });

  songGroupsEl.querySelectorAll(".del").forEach(btn => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); deleteSong(btn.dataset.id); });
  });
  songGroupsEl.querySelectorAll(".song-select").forEach(btn => {
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
    renderSongs(snap.docs.map(d => Object.assign({ id: d.id }, d.data())));
  }, err => {
    console.error(err);
    songStatus.textContent = "не удалось подключиться к базе, проверь настройки Firebase";
  });
} else {
  renderSongs(localStore.read("songs", []));
  songStatus.textContent = "офлайн-режим: настрой Firebase в app.js, чтобы плейлист был общим онлайн";
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
      videoId: videoId,
      playerVars: { rel: 0, modestbranding: 1 },
      events: {
        onReady: function (e) {
          e.target.setVolume(volume);
          e.target.setPlaybackRate(playbackRate);
          e.target.playVideo();
          setPlayPauseIcon(true);
          startYtProgressTimer();
        },
        onStateChange: function (e) {
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
  progressTimer = setInterval(function () {
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
  audioEl.play().catch(function () {});
  setPlayPauseIcon(true);
  audioEl.onended = function () { handleTrackEnd(); };
  audioEl.ontimeupdate = function () { updateProgress(audioEl.currentTime, audioEl.duration); };
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
  document.getElementById("player-sub").textContent = "трек " + (idx + 1) + " из " + songsCache.length;
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
  if (!song) return;
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
  if (!song) return;
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
    document.getElementById("player-sub").textContent = "плейлист закончился";
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
  return m + ":" + sec;
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
document.getElementById("speed-down").addEventListener("click", function () { changeSpeed(-0.25); });
document.getElementById("speed-up").addEventListener("click", function () { changeSpeed(0.25); });
document.getElementById("vol-down").addEventListener("click", function () { setVolume(volume - 10); });
document.getElementById("vol-up").addEventListener("click", function () { setVolume(volume + 10); });
document.getElementById("vol-slider").addEventListener("input", function (e) { setVolume(parseInt(e.target.value, 10)); });
document.getElementById("progress-bar").addEventListener("click", function (e) {
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

function dateKey(y, m, d) { return y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0"); }

function renderCalendar() {
  const y = viewDate.getFullYear();
  const m = viewDate.getMonth();
  calLabel.textContent = MONTHS_RU[m] + " " + y;
  calGrid.innerHTML = "";

  DOW_RU.forEach(function (d) {
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
    const dayNotes = allNotes.filter(function (n) { return n.date === key; });
    const hasImportant = dayNotes.some(function (n) { return n.important; });
    const el = document.createElement("div");
    el.className = "cal-day"
      + (key === todayKey ? " today" : "")
      + (dayNotes.length ? " has-note" : "")
      + (hasImportant ? " has-important" : "");

    let noteHtml = "";
    if (dayNotes.length) {
      const first = dayNotes[0];
      noteHtml = '<span class="day-note">' + (first.important ? "⚠ " : "") + escapeHtml(first.text) + '</span>';
      if (dayNotes.length > 1) noteHtml += '<span class="day-note-more">+' + (dayNotes.length - 1) + ' ещё</span>';
    }
    el.innerHTML = '<span class="day-num">' + d + '</span>' + noteHtml;
    el.addEventListener("click", function () { openModal(key); });
    calGrid.appendChild(el);
  }

  renderUpcoming();
}

function renderUpcoming() {
  const todayStr = dateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const upcoming = allNotes.filter(function (n) { return n.date >= todayStr; })
    .sort(function (a, b) { return a.date.localeCompare(b.date); }).slice(0, 8);
  upcomingList.innerHTML = "";
  if (!upcoming.length) {
    upcomingList.innerHTML = '<li class="upcoming-item">пока нет запланированных дат</li>';
    return;
  }
  upcoming.forEach(function (n) {
    const li = document.createElement("li");
    li.className = "upcoming-item" + (n.important ? " important" : "");
    const parts = n.date.split("-");
    li.innerHTML = '<span>' + (n.important ? "⚠ " : "") + escapeHtml(n.text) + '</span><span class="u-date">' + parts[2] + "." + parts[1] + "." + parts[0] + '</span>';
    upcomingList.appendChild(li);
  });
}

document.getElementById("cal-prev").addEventListener("click", function () { viewDate.setMonth(viewDate.getMonth() - 1); renderCalendar(); });
document.getElementById("cal-next").addEventListener("click", function () { viewDate.setMonth(viewDate.getMonth() + 1); renderCalendar(); });

/* ---- пикер месяца/года: клик по названию месяца открывает быстрый выбор ---- */
const monthPicker = document.getElementById("month-picker");
const mpYearLabel = document.getElementById("mp-year-label");
const mpMonths = document.getElementById("mp-months");
let pickerYear = viewDate.getFullYear();

function renderMonthPicker() {
  mpYearLabel.textContent = pickerYear;
  mpMonths.innerHTML = "";
  MONTHS_RU.forEach(function (name, i) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mp-month-btn" + (pickerYear === viewDate.getFullYear() && i === viewDate.getMonth() ? " current" : "");
    btn.textContent = name.slice(0, 3);
    btn.addEventListener("click", function () {
      viewDate = new Date(pickerYear, i, 1);
      renderCalendar();
      closeMonthPicker();
    });
    mpMonths.appendChild(btn);
  });
}
function openMonthPicker() {
  pickerYear = viewDate.getFullYear();
  renderMonthPicker();
  monthPicker.classList.add("open");
}
function closeMonthPicker() { monthPicker.classList.remove("open"); }

calLabel.addEventListener("click", function (e) {
  e.stopPropagation();
  if (monthPicker.classList.contains("open")) closeMonthPicker();
  else openMonthPicker();
});
document.getElementById("mp-year-prev").addEventListener("click", function () { pickerYear--; renderMonthPicker(); });
document.getElementById("mp-year-next").addEventListener("click", function () { pickerYear++; renderMonthPicker(); });
document.addEventListener("click", function (e) {
  if (!monthPicker.contains(e.target) && e.target !== calLabel) closeMonthPicker();
});

function openModal(key) {
  selectedDateKey = key;
  const parts = key.split("-");
  modalDateLabel.textContent = parts[2] + "." + parts[1] + "." + parts[0];
  renderModalNotes();
  modalOverlay.classList.add("open");
}
function closeModal() { modalOverlay.classList.remove("open"); noteForm.reset(); }
document.getElementById("modal-close").addEventListener("click", closeModal);
modalOverlay.addEventListener("click", function (e) { if (e.target === modalOverlay) closeModal(); });

function deleteNote(id) {
  if (cloudEnabled) {
    db.collection("notes").doc(id).delete();
  } else {
    const notes = localStore.read("notes", []).filter(function (n) { return n.id !== id; });
    localStore.write("notes", notes);
    allNotes = notes;
    renderCalendar();
    renderModalNotes();
  }
}

function renderModalNotes() {
  const notes = allNotes.filter(function (n) { return n.date === selectedDateKey; });
  modalNoteList.innerHTML = notes.length
    ? notes.map(function (n) {
        return '<li class="note-item' + (n.important ? " important" : "") + '">' +
          '<span class="note-text">' + (n.important ? "⚠ " : "") + escapeHtml(n.text) + '</span>' +
          '<button class="note-del" data-id="' + n.id + '" title="удалить">✕</button>' +
        '</li>';
      }).join("")
    : '<li class="note-item"><span class="note-text">заметок пока нет</span></li>';
  modalNoteList.querySelectorAll(".note-del").forEach(function (btn) {
    btn.addEventListener("click", function () { deleteNote(btn.dataset.id); });
  });
}

noteForm.addEventListener("submit", function (e) {
  e.preventDefault();
  const text = document.getElementById("note-text").value.trim();
  const important = document.getElementById("note-important").checked;
  if (!text || !selectedDateKey) return;
  const note = { date: selectedDateKey, text: text, important: important, ts: Date.now() };

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
  db.collection("notes").onSnapshot(function (snap) {
    allNotes = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
    renderCalendar();
    if (modalOverlay.classList.contains("open")) renderModalNotes();
  });
} else {
  allNotes = localStore.read("notes", []);
}
renderCalendar();

