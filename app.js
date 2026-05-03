import {
  centerOnUser,
  clearInvalidLocalPositions,
  enableManualPlacement,
  fitAllClients,
  focusMapOn,
  focusOperationalArea,
  getCaptureTargets,
  getClientLocationInfo,
  getGeoSummary,
  getLocatedClients,
  getUserCoords,
  initMap,
  primeClientLocations,
  refreshUserPosition,
  renderClients,
  saveClientAtUser,
  setGeocodeStatusCallback,
  setMapMode,
  startGeocoding,
  startLocationWatch,
  wazeUrl
} from "./map.js?v=16";
import {
  averageScore,
  rankFor,
  recentChartDays,
  scoreClass,
  streakBlazing,
  streakCount,
  todayPercent,
  totalScore
} from "./score.js?v=16";

const SUPABASE_URL = "https://fuxephmatxzgccmaaftt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1eGVwaG1hdHh6Z2NjbWFhZnR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTk2MjYsImV4cCI6MjA5Mjc3NTYyNn0.FN9McvOO2Mb9-vrdvGsiUzinkldz02mSAJSgmh6sm1U";

const state = {
  clients: [],
  scores: [],
  quests: [],
  selectedClient: null,
  mapReady: false,
  mapMode: "satellite",
  geoSummary: { placed: 0, city: 0, total: 0 },
  questsBootstrapped: false,  // évite de retenter l'insert auto en boucle
  gpsWatchActive: false,
  miniMap: null,
  miniMarkers: [],
  miniUserMarker: null,
  homeSelectedClient: null
};

const $ = (selector) => document.querySelector(selector);
const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });

document.addEventListener("DOMContentLoaded", () => {
  bindActions();
  setGeocodeStatusCallback(updateGeocodeStatus);
  registerServiceWorker();
  updateDate();
  clearOldGeoCaches();
  renderMiniMap();
  ensureLocationWatch();
  loadTerrain();
  setInterval(loadTerrain, 60000);
});

async function loadTerrain() {
  setNetwork("SYNC");
  try {
    const today = todayIso();
    const [clients, scores, quests] = await Promise.all([
      fetchRows("clients", "select=*&order=updated_at.desc"),
      fetchRows("daily_scores", "select=*&order=score_date.desc"),
      fetchRows("daily_quests", `select=*&score_date=eq.${today}&order=slot.asc`)
    ]);
    state.clients = clients;
    state.scores = scores;
    state.quests = quests;
    primeClientLocations(state.clients);
    await ensureTodayQuests();
    renderCockpit();
    if (state.mapReady) renderMap();
    setNetwork("LIVE");
  } catch (error) {
    console.error(error);
    setNetwork("OFFLINE");
    restoreOfflineData();
  }
}

async function fetchRows(table, query) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`
    }
  });
  if (!response.ok) throw new Error(`Supabase ${table}: ${response.status}`);
  const rows = await response.json();
  localStorage.setItem(`terrain:${table}`, JSON.stringify(rows));
  return rows;
}

function restoreOfflineData() {
  state.clients = JSON.parse(localStorage.getItem("terrain:clients") || "[]");
  state.scores = JSON.parse(localStorage.getItem("terrain:daily_scores") || "[]");
  state.quests = JSON.parse(localStorage.getItem("terrain:daily_quests") || "[]");
  primeClientLocations(state.clients);
  renderCockpit();
  if (state.mapReady) renderMap();
}

function clearOldGeoCaches() {
  localStorage.removeItem("terrain:geocode-cache:v1");
  localStorage.removeItem("terrain:geocode-cache:v2");
  localStorage.removeItem("terrain:geocode-cache:v3");
  localStorage.removeItem("terrain:clients");
}

function bindActions() {
  $("#go-map-button").addEventListener("click", () => showScreen("map-screen"));
  $("#back-home-button").addEventListener("click", () => showScreen("home-screen"));
  $("#refresh-button").addEventListener("click", refreshQuests);
  $("#minimap-center-button").addEventListener("click", refreshMiniMapPosition);
  $("#close-home-client-detail").addEventListener("click", () => showHomeClient(null));
  $("#home-open-map-button").addEventListener("click", openSelectedOnSatellite);
  $("#center-button").addEventListener("click", centerOnUser);
  $("#fit-button").addEventListener("click", fitAllClients);
  $("#fit-button").addEventListener("dblclick", cleanLocalPositions);
  $("#geocode-button").addEventListener("click", runGeocoding);
  $("#close-client-panel").addEventListener("click", () => showClient(null));
  $("#save-gps-button").addEventListener("click", saveSelectedAtGps);
  $("#place-on-map-button").addEventListener("click", placeSelectedOnMap);
  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => switchMapMode(button.dataset.mapMode));
  });
}

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === screenId));
  if (screenId === "map-screen") {
    bootMap();
    setTimeout(() => window.dispatchEvent(new Event("resize")), 80);
    return;
  }
  setTimeout(() => {
    state.miniMap?.invalidateSize();
    renderMiniMap();
  }, 80);
  switchMapMode("satellite");
}

function bootMap() {
  if (!state.mapReady) {
    initMap({ onClientSelected: showClient, onGeoStatusChange: updateGeoStatus, onGpsStatusChange: updateGpsStatus });
    state.mapReady = true;
    renderMap();
    ensureLocationWatch();
    centerMapForEdit();
  }
  switchMapMode(state.mapMode);
}

function centerMapForEdit() {
  const cachedCoords = getUserCoords();
  if (focusMapOn(cachedCoords, 16)) {
    renderCaptureTargets();
    return;
  }
  refreshUserPosition((coords) => {
    focusMapOn(coords, 16);
    renderCaptureTargets();
  }).catch(() => focusOperationalArea(14));
}

function renderCockpit() {
  renderHomeMetrics();
  renderMiniMap();
  renderQuests();
  renderHistory();
}

function renderHomeMetrics() {
  const today = todayIso();
  const percent = todayPercent(state.scores, today);
  const total = totalScore(state.scores);
  const rank = rankFor(total);
  const streak = streakCount(state.scores);
  const blazing = streakBlazing(state.scores, today);
  const scoreKind = scoreClass(percent);

  $("#score-percent").textContent = `${percent}%`;
  $("#score-percent").className = `score-number ${scoreKind}`;
  $("#map-score").textContent = `${percent}%`;
  $("#score-status").textContent = statusText(percent);
  $("#score-status-chip").textContent = statusChip(percent);
  $("#score-energy-fill").style.width = `${Math.min(100, Math.max(0, percent))}%`;

  $("#rank-name").textContent = rank.current.name;
  $("#rank-progress-bar").style.width = `${rank.progress}%`;
  $("#rank-percent").textContent = `${rank.progress}%`;
  $("#rank-next").textContent = rank.next ? `${rank.next.name} à portée : ${rank.progress}% du chemin.` : "Rang maximum actif.";

  $("#streak-count").textContent = streak;
  const streakCard = document.querySelector(".streak-card");
  streakCard.classList.toggle("blazing", blazing && streak > 0);
  if (blazing && streak > 0) {
    $("#streak-badge").textContent = "Journée en surchauffe — chiffre en feu.";
  } else if (streak > 1) {
    $("#streak-badge").textContent = `${streak} jours validés à 100%+.`;
  } else if (streak === 1) {
    $("#streak-badge").textContent = "Premier jour validé. On enchaîne demain.";
  } else {
    $("#streak-badge").textContent = "Streak à construire aujourd'hui.";
  }
}

function renderHistory() {
  const days = recentChartDays(state.scores, 8);
  const avg = averageScore(state.scores);
  $("#history-label").textContent = "";
  if (!days.length) {
    $("#history-bars").innerHTML = `<div class="history-empty">Aucune journée enregistrée pour l'instant.</div>`;
    return;
  }
  // Scaling dynamique : la barre la plus haute du jeu affiché occupe 100%
  // de la hauteur. Plancher à 100% pour garder une référence visuelle stable
  // quand aucun jour ne dépasse la moyenne.
  const percents = days.map((day) => (avg ? Math.round((Number(day.raw_score || 0) / avg) * 100) : 0));
  const maxPct = Math.max(100, ...percents);
  $("#history-bars").innerHTML = days.map((day, i) => {
    const percent = percents[i];
    const height = Math.max(6, Math.round((percent / maxPct) * 100));
    const classes = ["bar", scoreClass(percent), day.score_date === todayIso() ? "today" : ""].filter(Boolean).join(" ");
    return `
      <div class="bar-wrap">
        <div class="${classes}" style="height:${height}%">
          <span class="bar-percent">${percent}%</span>
        </div>
        <span class="bar-label">${dayLabel(day.score_date)}</span>
      </div>
    `;
  }).join("");
}

// === MINIMAP ================================================================

function ensureLocationWatch() {
  if (state.gpsWatchActive) return;
  state.gpsWatchActive = true;
  startLocationWatch(handleNearClient, handlePositionChange);
}

function handlePositionChange() {
  renderMiniMap();
  renderCaptureTargets();
}

async function refreshMiniMapPosition() {
  ensureLocationWatch();
  setMiniMapStatus("GPS SCAN");
  try {
    await refreshUserPosition(handlePositionChange);
  } catch {
    setMiniMapStatus("GPS BLOQUÉ");
  }
}

function renderMiniMap() {
  const map = ensureMiniMap();
  if (!map) return;
  const coords = getUserCoords();
  const targets = getLocatedClients(120);
  const summary = getGeoSummary();
  const displayed = summary.displayed || 0;
  const total = summary.total || state.clients.length || 0;

  setMiniMapStatus(coords ? `GPS LIVE · ${targets.length} POI` : `PLAN · ${targets.length} POI`);
  $("#minimap-range").textContent = coords ? miniMapRange(targets) : `${displayed}/${total} géocodés`;

  renderMiniMapUser(coords);
  renderMiniMapMarkers(targets);
  positionMiniMap(coords, targets);
  if (state.homeSelectedClient) showHomeClient(state.homeSelectedClient, { skipMarkers: true });
}

function ensureMiniMap() {
  const container = $("#home-minimap");
  if (!container || !window.L) return null;
  if (state.miniMap) return state.miniMap;

  state.miniMap = L.map(container, {
    attributionControl: false,
    zoomControl: false,
    preferCanvas: true,
    tap: true
  });
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap &copy; CARTO",
    maxZoom: 20,
    subdomains: "abcd"
  }).addTo(state.miniMap);
  state.miniMap.on("click", () => showHomeClient(null));
  state.miniMap.setView([45.708, 4.86], 14);
  setTimeout(() => state.miniMap?.invalidateSize(), 80);
  return state.miniMap;
}

function renderMiniMapUser(coords) {
  if (!state.miniMap) return;
  if (!coords) {
    if (state.miniUserMarker) {
      state.miniUserMarker.remove();
      state.miniUserMarker = null;
    }
    return;
  }
  if (!state.miniUserMarker) {
    state.miniUserMarker = L.marker(coords, {
      interactive: false,
      icon: L.divIcon({
        className: "home-user-marker",
        html: "<span></span>",
        iconSize: [34, 34],
        iconAnchor: [17, 17]
      })
    }).addTo(state.miniMap);
    return;
  }
  state.miniUserMarker.setLatLng(coords);
}

function renderMiniMapMarkers(targets) {
  if (!state.miniMap) return;
  const selectedKey = state.homeSelectedClient ? clientKey(state.homeSelectedClient) : "";
  state.miniMarkers.forEach((marker) => marker.remove());
  state.miniMarkers = targets.map((target) => {
    const key = clientKey(target.client);
    const marker = L.marker(target.coords, {
      icon: L.divIcon({
        className: `home-map-marker ${homeMarkerClass(target.client)} ${target.source === "city" ? "approx" : ""} ${key === selectedKey ? "selected" : ""}`,
        html: "<span></span>",
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      }),
      bubblingMouseEvents: false,
      riseOnHover: true
    }).addTo(state.miniMap);
    marker.on("click", (event) => {
      if (event.originalEvent) L.DomEvent.stop(event.originalEvent);
      showHomeClient(target.client);
    });
    return marker;
  });
}

function positionMiniMap(coords, targets) {
  if (!state.miniMap) return;
  if (coords) {
    state.miniMap.setView(coords, 17, { animate: false });
    return;
  }
  const selected = state.homeSelectedClient ? targets.find((target) => clientKey(target.client) === clientKey(state.homeSelectedClient)) : null;
  const anchor = selected || targets[0];
  if (anchor) state.miniMap.setView(anchor.coords, 16, { animate: false });
}

function miniMapRange(targets) {
  const distances = targets.map((target) => target.distance).filter((value) => Number.isFinite(value));
  if (!distances.length) return "GPS en attente";
  return `rayon ${distanceLabel(Math.max(...distances.slice(0, 8)))}`;
}

function setMiniMapStatus(label) {
  const status = $("#minimap-status");
  if (status) status.textContent = label;
}

function showHomeClient(client, options = {}) {
  const panel = $("#home-client-detail");
  if (!panel) return;
  state.homeSelectedClient = client;
  if (!client) {
    panel.classList.remove("open");
    if (!options.skipMarkers) renderMiniMapMarkers(getLocatedClients(120));
    return;
  }
  $("#home-client-city").textContent = client.city || "Zone";
  $("#home-client-title").textContent = client.enterprise_name || "Client terrain";
  $("#home-client-meta").textContent = [client.contact_name, client.phone, client.business_activity].filter(Boolean).join(" · ") || "Infos à compléter.";
  $("#home-client-tags").innerHTML = [client.machine_status, client.seller_label, client.heat_level]
    .filter(Boolean)
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join("");
  $("#home-client-location").textContent = getClientLocationInfo(client);
  $("#home-client-notes").textContent = client.relationship_summary || client.notes || "Pas encore de note terrain.";
  $("#home-waze-link").href = wazeUrl(client);
  panel.classList.add("open");
  if (!options.skipMarkers) renderMiniMapMarkers(getLocatedClients(120));
}

function openSelectedOnSatellite() {
  if (!state.homeSelectedClient) return;
  showScreen("map-screen");
  setTimeout(() => showClient(state.homeSelectedClient), 140);
}

function homeMarkerClass(client) {
  if (state.quests.some((quest) => quest.target_client_id && String(quest.target_client_id) === String(client.id) && !quest.completed)) return "quest";
  if (client.signed_client) return "signed";
  if (isDue(client.next_action_at)) return "due";
  if (client.heat_level === "tres-chaud") return "very-hot";
  if (client.heat_level === "chaud") return "hot";
  if (client.heat_level === "tiede") return "warm";
  return "cold";
}

// === QUÊTES =================================================================

const QUEST_BONUS = { easy: 10, medium: 18, hard: 28 };

function renderQuests() {
  const today = todayIso();
  const hasTodayScore = state.scores.some((day) => day.score_date === today);

  if (!hasTodayScore) {
    $("#quest-list").innerHTML = `
      <div class="quest-empty">
        <strong>Quêtes verrouillées</strong>
        <span>Ouvre ta journée — dicte un CR ou crée la ligne du jour pour débloquer 3 quêtes.</span>
      </div>
    `;
    return;
  }

  if (!state.quests.length) {
    $("#quest-list").innerHTML = `<div class="quest-empty"><span>Génération des quêtes en cours...</span></div>`;
    return;
  }

  $("#quest-list").innerHTML = state.quests.map((quest) => {
    const completed = quest.completed ? "completed" : "";
    const bonus = `+${quest.bonus_percent}%`;
    return `
      <article class="quest ${completed}" data-difficulty="${escapeHtml(quest.difficulty || "medium")}">
        <span class="quest-icon">!</span>
        <div class="quest-copy">
          <div class="quest-head">
            <strong>${escapeHtml(quest.title)}</strong>
            <span class="quest-bonus">${bonus}</span>
          </div>
          <span class="quest-detail">${escapeHtml(quest.detail)}</span>
          ${quest.completed ? `<span class="quest-check">VALIDÉE</span>` : ""}
        </div>
      </article>
    `;
  }).join("");
}

// Si aujourd'hui a une ligne daily_scores mais aucune quête en base,
// on en génère 3 et on les insère.
async function ensureTodayQuests() {
  const today = todayIso();
  const hasTodayScore = state.scores.some((day) => day.score_date === today);
  if (!hasTodayScore) return;
  if (state.quests.length >= 3) return;
  if (state.questsBootstrapped) return;
  state.questsBootstrapped = true;

  const generated = buildQuests(state.clients);
  const inserted = await insertQuests(today, generated);
  if (inserted) state.quests = inserted;
}

async function refreshQuests() {
  const today = todayIso();
  const hasTodayScore = state.scores.some((day) => day.score_date === today);
  if (!hasTodayScore) {
    setNetwork("VERROU");
    setTimeout(() => setNetwork("LIVE"), 1400);
    return;
  }
  setNetwork("ROLL");
  try {
    await deleteQuests(today);
    state.quests = [];
    state.questsBootstrapped = false;
    const generated = buildQuests(state.clients);
    const inserted = await insertQuests(today, generated);
    if (inserted) state.quests = inserted;
    renderQuests();
    setNetwork("LIVE");
  } catch (error) {
    console.error(error);
    setNetwork("OFFLINE");
  }
}

async function deleteQuests(date) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/daily_quests?score_date=eq.${date}`, {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: "return=minimal"
    }
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Delete quests: ${response.status}`);
  }
}

async function insertQuests(date, quests) {
  if (!quests || !quests.length) return [];
  const payload = quests.slice(0, 3).map((quest, index) => ({
    score_date: date,
    slot: index + 1,
    title: quest.title,
    detail: quest.detail,
    bonus_percent: quest.bonus_percent,
    difficulty: quest.difficulty,
    target_client_id: quest.target_client_id || null
  }));
  const response = await fetch(`${SUPABASE_URL}/rest/v1/daily_quests`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    console.error("Insert quests failed", response.status);
    return null;
  }
  const rows = await response.json();
  return rows.sort((a, b) => a.slot - b.slot);
}

// Génère 3 quêtes depuis les règles métier.
// Pool de candidats par catégorie, on tire au sort dans chaque catégorie
// pour que le bouton "Rafraîchir" donne des quêtes différentes.
function buildQuests(clients) {
  const pools = buildQuestPools(clients);
  const order = ["closing", "hot", "invoice", "due", "missingPhone", "missingLocation", "fallback"];
  const picked = [];
  const usedTargets = new Set();

  for (const key of order) {
    if (picked.length >= 3) break;
    const candidates = (pools[key] || []).filter((q) => {
      if (!q.target_client_id) return true;
      return !usedTargets.has(q.target_client_id);
    });
    if (!candidates.length) continue;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    picked.push(pick);
    if (pick.target_client_id) usedTargets.add(pick.target_client_id);
  }

  while (picked.length < 3) {
    picked.push(genericFallback(picked.length));
  }
  return picked.slice(0, 3);
}

function buildQuestPools(clients) {
  const due = clients.filter((c) => isDue(c.next_action_at));
  const closing = clients.filter((c) => ["a-signer", "proposition-envoyee"].includes(c.machine_status) && !c.signed_client);
  const hot = clients.filter((c) => ["chaud", "tres-chaud"].includes(c.heat_level) && c.machine_status !== "signe" && !c.signed_client);
  const invoice = clients.filter((c) => ["facture-attendue", "contact-obtenu"].includes(c.machine_status));
  const missingPhone = clients.filter((c) => !c.phone && c.enterprise_name);
  const missingLocation = clients.filter((c) => !c.address && c.enterprise_name);

  return {
    closing: closing.map((c) => ({
      title: "Closing à finaliser",
      detail: questDetail(c, "passer signer ou relancer le contrat."),
      bonus_percent: QUEST_BONUS.hard,
      difficulty: "hard",
      target_client_id: c.id
    })),
    hot: hot.map((c) => ({
      title: "Cuisson à maintenir",
      detail: questDetail(c, "garder le contact chaud, ne pas laisser refroidir."),
      bonus_percent: QUEST_BONUS.medium,
      difficulty: "medium",
      target_client_id: c.id
    })),
    invoice: invoice.map((c) => ({
      title: "Facture à sortir",
      detail: questDetail(c, "transformer le contact en facture analysable."),
      bonus_percent: QUEST_BONUS.medium,
      difficulty: "medium",
      target_client_id: c.id
    })),
    due: due.map((c) => ({
      title: "Relance prioritaire",
      detail: questDetail(c, "action prévue maintenant, à traiter."),
      bonus_percent: QUEST_BONUS.medium,
      difficulty: "medium",
      target_client_id: c.id
    })),
    missingPhone: missingPhone.map((c) => ({
      title: "Fiche à muscler",
      detail: questDetail(c, "récupérer le téléphone."),
      bonus_percent: QUEST_BONUS.easy,
      difficulty: "easy",
      target_client_id: c.id
    })),
    missingLocation: missingLocation.map((c) => ({
      title: "Carte à nettoyer",
      detail: questDetail(c, "récupérer ou poser l'adresse exacte."),
      bonus_percent: QUEST_BONUS.easy,
      difficulty: "easy",
      target_client_id: c.id
    })),
    fallback: [
      {
        title: "Tournée éclair",
        detail: "Toucher 3 commerces proches et dicter le CR juste après.",
        bonus_percent: QUEST_BONUS.medium,
        difficulty: "medium",
        target_client_id: null
      },
      {
        title: "Cold zone",
        detail: "Pousser une zone industrielle nouvelle et créer 2 fiches fraîches.",
        bonus_percent: QUEST_BONUS.medium,
        difficulty: "medium",
        target_client_id: null
      },
      {
        title: "Ménage pipeline",
        detail: "Repasser sur 3 fiches dormantes et trancher : à relancer ou KO.",
        bonus_percent: QUEST_BONUS.easy,
        difficulty: "easy",
        target_client_id: null
      }
    ]
  };
}

function questDetail(client, action) {
  const name = client.enterprise_name || client.contact_name || "Client";
  const city = client.city ? ` · ${client.city}` : "";
  return `${name}${city} · ${action}`;
}

function genericFallback(index) {
  const pool = [
    { title: "Terrain utile", detail: "Toucher 3 commerces proches et dicter le CR juste après.", bonus_percent: QUEST_BONUS.medium, difficulty: "medium", target_client_id: null },
    { title: "Carnet en main", detail: "Récupérer 2 numéros de portable de gérants encore manquants.", bonus_percent: QUEST_BONUS.easy, difficulty: "easy", target_client_id: null },
    { title: "Audit de pipe", detail: "Repasser sur 3 fiches dormantes et statuer.", bonus_percent: QUEST_BONUS.easy, difficulty: "easy", target_client_id: null }
  ];
  return pool[index % pool.length];
}

// === MAP / CLIENTS / GEO ====================================================

function renderMap() {
  renderClients(state.clients, showClient);
  const summary = getGeoSummary();
  updateMapCount(summary.displayed, summary.total);
}

function runGeocoding() {
  if (!localStorage.getItem("terrain:ign-geocode-ok")) {
    const approved = window.confirm("Recaler IGN envoie les adresses et noms d'entreprises au géocodeur public IGN pour récupérer des coordonnées. Lancer le recalage ?");
    if (!approved) return;
    localStorage.setItem("terrain:ign-geocode-ok", "yes");
  }
  setGeoPill("Recalage IGN en cours...");
  startGeocoding();
}

function updateGeocodeStatus(status) {
  if (status.state === "empty") {
    setGeoPill("Aucune fiche à recaler");
    return;
  }
  if (status.state === "start") {
    setGeoPill(`${status.total} fiches à vérifier`);
    return;
  }
  if (status.state === "running") {
    setGeoPill(`IGN ${status.processed}/${status.total} · ${status.changed} placées`);
    return;
  }
  if (status.state === "done") {
    setGeoPill(`Recalage fini · ${status.changed}/${status.total} placées`);
  }
}

function switchMapMode(mode) {
  state.mapMode = mode;
  setMapMode(mode);
  document.querySelectorAll(".mode-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mapMode === mode);
  });
  if (mode === "capture") {
    renderCaptureTargets();
  }
}

function renderCaptureTargets() {
  if (state.mapMode !== "capture") return;
  const targets = getCaptureTargets(8);
  $("#capture-orbs").innerHTML = targets.slice(0, 6).map((target, index) => {
    const angle = (target.angle * Math.PI) / 180;
    const left = 50 + Math.cos(angle) * target.radius;
    const top = 50 + Math.sin(angle) * target.radius * 0.78;
    return `
      <button class="capture-orb ${captureClass(target.client)}" data-key="${escapeHtml(clientKey(target.client))}" style="left:${left}%;top:${top}%;animation-delay:${index * 0.18}s" type="button">
        <strong>${escapeHtml(shortName(target.client))}</strong>
      </button>
    `;
  }).join("");
  $("#capture-strip").innerHTML = targets.map((target) => `
    <button class="capture-target" data-key="${escapeHtml(clientKey(target.client))}" type="button">
      <strong>${escapeHtml(target.client.enterprise_name || "Client")}</strong>
      <span>${distanceLabel(target.distance)} · ${escapeHtml(target.client.city || "zone")}</span>
    </button>
  `).join("");
  document.querySelectorAll("[data-key]").forEach((item) => {
    item.addEventListener("click", () => {
      const client = targets.find((target) => clientKey(target.client) === item.dataset.key)?.client;
      if (client) showClient(client);
    });
  });
}

function showClient(client) {
  state.selectedClient = client;
  const panel = $("#client-panel");
  if (!client) {
    panel.classList.remove("open");
    return;
  }
  $("#client-city").textContent = client.city || "Zone";
  $("#client-title").textContent = client.enterprise_name || "Client terrain";
  $("#client-meta").textContent = [client.contact_name, client.phone, client.business_activity].filter(Boolean).join(" · ") || "Infos à compléter.";
  $("#client-tags").innerHTML = [client.machine_status, client.seller_label, client.heat_level]
    .filter(Boolean)
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join("");
  $("#client-location").textContent = getClientLocationInfo(client);
  $("#client-notes").textContent = client.relationship_summary || client.notes || "Pas encore de note terrain.";
  $("#waze-link").href = wazeUrl(client);
  panel.classList.add("open");
}

async function saveSelectedAtGps() {
  if (!state.selectedClient) return;
  setGeoPill("GPS en cours...");
  try {
    const coords = await saveClientAtUser(state.selectedClient);
    await persistManualCoords(state.selectedClient, coords, "GPS terrain");
    state.geoSummary = getGeoSummary();
    updateGeoStatus(state.geoSummary);
    showClient(state.selectedClient);
  } catch {
    setGeoPill("GPS bloqué sur ce navigateur");
  }
}

function placeSelectedOnMap() {
  if (!state.selectedClient) return;
  setGeoPill("Tape sur la carte pour poser la fiche");
  $("#client-panel").classList.remove("open");
  enableManualPlacement(state.selectedClient, async (coords) => {
    await persistManualCoords(state.selectedClient, coords, "posé sur carte");
    state.geoSummary = getGeoSummary();
    updateGeoStatus(state.geoSummary);
  });
}

async function persistManualCoords(client, coords, source) {
  if (!client?.id) {
    setGeoPill("Position locale enregistrée");
    return;
  }
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${encodeURIComponent(client.id)}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        manual_lat: coords[0],
        manual_lng: coords[1],
        manual_location_source: source,
        manual_location_updated_at: new Date().toISOString()
      })
    });
    setGeoPill(response.ok ? "Position enregistrée en base" : "Position locale, synchro Supabase refusée");
  } catch {
    setGeoPill("Position locale, synchro impossible");
  }
}

function updateGeoStatus(summary) {
  state.geoSummary = summary;
  updateMapCount(summary.displayed, summary.total);
  const label = summary.total
    ? `${summary.displayed}/${summary.total} affichées · ${summary.pending} sans coords`
    : "Localisation en cours";
  setGeoPill(label);
  renderMiniMap();
}

function updateGpsStatus(status) {
  if (status === "GPS indisponible") {
    setGeoPill("GPS indisponible");
    setMiniMapStatus("GPS BLOQUÉ");
  } else if (status === "GPS actif") {
    setMiniMapStatus("GPS LIVE");
  }
  renderMiniMap();
}

function updateMapCount(displayed, total = displayed) {
  $("#map-count-pill").textContent = `${displayed || 0}/${total || 0} fiches`;
}

function cleanLocalPositions() {
  const removed = clearInvalidLocalPositions();
  setGeoPill(removed ? `${removed} positions locales invalides supprimées` : "Cache local positions OK");
}

function setGeoPill(label) {
  $("#geo-pill").textContent = label;
}

// === HELPERS ================================================================

function handleNearClient(client, distance) {
  if (navigator.vibrate) navigator.vibrate([180, 80, 180]);
  const message = `${client.enterprise_name} à ${distance}m`;
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("TERRAIN", { body: message });
  } else if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function statusText(percent) {
  if (percent >= 120) return "Tu roules au-dessus de la moyenne. Garde la pression.";
  if (percent >= 80) return "Journée dans le rythme. Une action chaude peut la faire basculer.";
  return "Sous la moyenne pour l'instant. Va chercher facture, chaud ou relance utile.";
}

function statusChip(percent) {
  if (percent >= 120) return "Surpression";
  if (percent >= 80) return "Dans le rythme";
  return "À lancer";
}

function isDue(value) {
  if (!value) return false;
  return new Date(value).getTime() <= Date.now();
}

function dayLabel(date) {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "short", timeZone: "Europe/Paris" }).format(new Date(`${date}T12:00:00`));
}

function updateDate() {
  $("#today-label").textContent = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: "Europe/Paris"
  }).format(new Date());
}

function setNetwork(label) {
  $("#network-pill").textContent = label;
}

function distanceLabel(distance) {
  if (distance === null || !Number.isFinite(distance)) return "distance GPS en attente";
  if (distance < 1000) return `${Math.round(distance)} m`;
  return `${(distance / 1000).toFixed(1)} km`;
}

function captureClass(client) {
  if (client.signed_client) return "signed";
  if (client.heat_level === "tres-chaud") return "very-hot";
  if (client.heat_level === "chaud") return "hot";
  return "";
}

function shortName(client) {
  return (client.enterprise_name || client.contact_name || "Client").slice(0, 18);
}

function clientKey(client) {
  return String(client.id || `${client.enterprise_name || ""}-${client.city || ""}-${client.address || ""}`);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}
