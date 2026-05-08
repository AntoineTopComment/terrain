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
  metersBetween,
  primeClientLocations,
  refreshUserPosition,
  renderClients,
  saveClientAtUser,
  setGeocodeStatusCallback,
  setMapMode,
  startGeocoding,
  startLocationWatch,
  stopLocationWatch,
  wazeUrl
} from "./map.js?v=36-place-no-reopen";
import {
  averageScore,
  rankFor,
  recentChartDays,
  scoreClass,
  streakBlazing,
  streakCount,
  todayPercent,
  todaySalesCount,
  totalScore
} from "./score.js?v=36-place-no-reopen";

const SUPABASE_URL = "https://fuxephmatxzgccmaaftt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1eGVwaG1hdHh6Z2NjbWFhZnR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTk2MjYsImV4cCI6MjA5Mjc3NTYyNn0.FN9McvOO2Mb9-vrdvGsiUzinkldz02mSAJSgmh6sm1U";
const RECENTER_JITTER_METERS = 14;

const state = {
  clients: [],
  scores: [],
  quests: [],
  ranks: [],
  selectedClient: null,
  mapReady: false,
  mapMode: "satellite",
  questsBootstrapped: false,
  gpsWatchActive: false,
  liveTracking: true,
  miniMap: null,
  miniMarkers: [],
  miniUserMarker: null,
  miniLastCenteredCoords: null,
  miniFallbackReady: false,
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
  updateLiveButton();
  renderMiniMap();
  ensureLocationWatch();
  loadTerrain();
  setInterval(loadTerrain, 60000);
});

async function loadTerrain() {
  setNetwork("SYNC");
  try {
    const today = todayIso();
    const [clients, scores, quests, ranks] = await Promise.all([
      fetchRows("clients", "select=*&order=updated_at.desc"),
      fetchRows("daily_scores", "select=*&order=score_date.desc"),
      fetchRows("daily_quests", `select=*&score_date=eq.${today}&order=slot.asc`),
      fetchRows("ranks", "select=level,name,points_required&order=points_required.asc").catch((error) => {
        console.warn("Ranks unavailable", error);
        return JSON.parse(localStorage.getItem("terrain:ranks") || "[]");
      })
    ]);
    state.clients = clients;
    state.scores = scores;
    state.quests = quests;
    state.ranks = ranks;
    primeClientLocations(state.clients);
    await ensureTodayQuests();
    renderCockpit();
    if (state.mapReady) renderMap();
    setNetwork(state.liveTracking ? "LIVE" : "FREE");
  } catch (error) {
    console.error(error);
    setNetwork("OFFLINE");
    restoreOfflineData();
  }
}

async function fetchRows(table, query) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
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
  state.ranks = JSON.parse(localStorage.getItem("terrain:ranks") || "[]");
  primeClientLocations(state.clients);
  renderCockpit();
  if (state.mapReady) renderMap();
}

function clearOldGeoCaches() {
  localStorage.removeItem("terrain:geocode-cache:v1");
  localStorage.removeItem("terrain:geocode-cache:v2");
  localStorage.removeItem("terrain:geocode-cache:v3");
  localStorage.removeItem("terrain:geocode-cache:v4");
}

function bindActions() {
  $("#go-map-button")?.addEventListener("click", () => showScreen("map-screen"));
  $("#back-home-button")?.addEventListener("click", () => showScreen("home-screen"));
  $("#refresh-button")?.addEventListener("click", refreshQuests);
  $("#toggle-quests-button")?.addEventListener("click", toggleQuestsPanel);
  $("#network-pill")?.addEventListener("click", toggleLiveMode);
  $("#minimap-center-button")?.addEventListener("click", refreshMiniMapPosition);
  $("#close-home-client-detail")?.addEventListener("click", () => showHomeClient(null));
  $("#home-open-map-button")?.addEventListener("click", openSelectedOnSatellite);
  $("#center-button")?.addEventListener("click", centerOnUser);
  $("#fit-button")?.addEventListener("click", fitAllClients);
  $("#fit-button")?.addEventListener("dblclick", cleanLocalPositions);
  $("#geocode-button")?.addEventListener("click", runGeocoding);
  $("#close-client-panel")?.addEventListener("click", () => showClient(null));
  $("#save-gps-button")?.addEventListener("click", saveSelectedAtGps);
  $("#place-on-map-button")?.addEventListener("click", placeSelectedOnMap);
  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => switchMapMode(button.dataset.mapMode));
  });
}


function toggleQuestsPanel() {
  const panel = document.querySelector(".quests-panel");
  const button = document.getElementById("toggle-quests-button");
  if (!panel || !button) return;
  const collapsed = panel.classList.toggle("collapsed");
  button.textContent = collapsed ? "<" : ">";
  button.setAttribute("aria-expanded", collapsed ? "false" : "true");
  button.setAttribute("aria-label", collapsed ? "Redéployer les quêtes" : "Minimiser les quêtes");
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

function toggleLiveMode() {
  state.liveTracking = !state.liveTracking;
  document.body.classList.toggle("terrain-gps-free", !state.liveTracking);
  updateLiveButton();
  if (state.liveTracking) {
    ensureLocationWatch(true);
    setNetwork("LIVE");
    const coords = getUserCoords();
    if (coords) {
      positionMiniMap(coords, getMiniMapTargets(), { force: true });
    } else {
      refreshUserPosition(handlePositionChange)
        .then((freshCoords) => positionMiniMap(freshCoords, getMiniMapTargets(), { force: true }))
        .catch(() => setMiniMapStatus("GPS BLOQUÉ"));
    }
  } else {
    stopLocationWatch();
    state.gpsWatchActive = false;
    setNetwork("FREE");
  }
}

function updateLiveButton() {
  const pill = $("#network-pill");
  if (!pill) return;
  document.body.classList.toggle("terrain-gps-free", !state.liveTracking);
  pill.classList.toggle("free", !state.liveTracking);
  pill.setAttribute("aria-pressed", state.liveTracking ? "true" : "false");
  pill.title = state.liveTracking ? "LIVE : suivi GPS automatique actif" : "FREE : suivi GPS en pause, navigation libre";
  if (["LIVE", "FREE", "SYNC"].includes(pill.textContent.trim()) || !state.liveTracking) {
    pill.textContent = state.liveTracking ? "LIVE" : "FREE";
  }
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
  const streak = streakCount(state.scores);
  const blazing = streakBlazing(state.scores, today);

  renderHUD();
  $("#map-score").textContent = `${percent}%`;

  $("#streak-count").textContent = streak;
  const streakCard = document.querySelector(".streak-card");
  streakCard?.classList.toggle("blazing", blazing && streak > 0);
  if (blazing && streak > 0) $("#streak-badge").textContent = "Journée en surchauffe — chiffre en feu.";
  else if (streak > 1) $("#streak-badge").textContent = `${streak} jours validés à 100%+.`;
  else if (streak === 1) $("#streak-badge").textContent = "Premier jour validé. On enchaîne demain.";
  else $("#streak-badge").textContent = "Streak à construire aujourd'hui.";
}

function renderHUD() {
  const today = todayIso();
  const total = totalScore(state.scores);
  const rank = rankFor(total, state.ranks);
  const percent = todayPercent(state.scores, today);
  const sales = todaySalesCount(state.scores, today);

  const glitchTitle = document.querySelector(".glitch-title");
  if (glitchTitle && rank.current?.name) {
    glitchTitle.textContent = rank.current.name;
    glitchTitle.setAttribute("data-text", rank.current.name);
  }

  const level = document.getElementById("hud-level");
  if (level) level.textContent = rank.current?.level ?? "?";

  const rankFill = document.getElementById("hud-rank-fill");
  if (rankFill) rankFill.style.width = `${rank.current ? rank.progress : 0}%`;

  const perfWidth = Math.min(100, Math.max(0, percent));
  const perfFill = document.getElementById("hud-perf-fill");
  if (perfFill) {
    perfFill.style.width = `${perfWidth}%`;
    perfFill.classList.toggle("hud-perf-full", percent >= 100);
  }

  const number = document.getElementById("hud-perf-number");
  if (number) number.textContent = String(percent || 0);

  const slotsContainer = document.getElementById("hud-slots");
  if (slotsContainer) {
    const totalSlots = Math.max(5, sales);
    slotsContainer.innerHTML = Array.from({ length: totalSlots }, (_, index) =>
      `<div class="hud-slot ${index < sales ? "hud-slot-active" : ""}" aria-hidden="true"></div>`
    ).join("");
  }
}

function renderHistory() {
  const days = recentChartDays(state.scores, 8);
  const avg = averageScore(state.scores);
  const historyLabel = document.getElementById("history-label");
  if (historyLabel) historyLabel.textContent = `${streakCount(state.scores)} JOURS`;
  if (!days.length) {
    $("#history-bars").innerHTML = `<div class="history-empty">Aucune journée enregistrée pour l'instant.</div>`;
    return;
  }
  const percents = days.map((day) => (avg ? Math.round((Number(day.raw_score || day.score || day.points || 0) / avg) * 100) : 0));
  const maxPct = Math.max(100, ...percents);
  $("#history-bars").innerHTML = days.map((day, i) => {
    const percent = percents[i];
    const height = Math.max(6, Math.round((percent / maxPct) * 100));
    const classes = ["bar", scoreClass(percent), (day.score_date || day.date) === todayIso() ? "today" : ""].filter(Boolean).join(" ");
    return `<div class="bar-wrap"><div class="${classes}" style="height:${height}%"><span class="bar-percent">${percent}%</span></div><span class="bar-label">${dayLabel(day.score_date || day.date)}</span></div>`;
  }).join("");
}

function ensureLocationWatch(force = false) {
  if (!state.liveTracking && !force) return;
  if (state.gpsWatchActive) return;
  state.gpsWatchActive = startLocationWatch(handleNearClient, handlePositionChange) !== null;
}

function handlePositionChange() {
  renderMiniMap();
  renderCaptureTargets();
}

async function refreshMiniMapPosition() {
  state.liveTracking = true;
  updateLiveButton();
  ensureLocationWatch(true);
  setMiniMapStatus("GPS SCAN");
  try {
    const coords = await refreshUserPosition(handlePositionChange);
    positionMiniMap(coords, getMiniMapTargets(), { force: true });
  } catch {
    setMiniMapStatus("GPS BLOQUÉ");
  }
}

function renderMiniMap() {
  const map = ensureMiniMap();
  if (!map) return;
  const coords = getUserCoords();
  const targets = getMiniMapTargets();
  const summary = getGeoSummary();
  const displayed = summary.displayed || 0;
  const total = summary.total || state.clients.length || 0;

  setMiniMapStatus(coords ? `GPS ${state.liveTracking ? "LIVE" : "FREE"} · ${targets.length} POI` : `PLAN · ${targets.length} POI`);
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

  state.miniMap = L.map(container, { attributionControl: false, zoomControl: false, preferCanvas: true, tap: true }).setView([45.708, 4.86], 14);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap &copy; CARTO",
    maxZoom: 20,
    subdomains: "abcd"
  }).addTo(state.miniMap);
  state.miniMap.on("click", () => showHomeClient(null));
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
      icon: L.divIcon({ className: "home-user-marker", html: "<span></span>", iconSize: [34, 34], iconAnchor: [17, 17] })
    }).addTo(state.miniMap);
    return;
  }
  state.miniUserMarker.setLatLng(coords);
}

function getMiniMapTargets() {
  // Vue normale/minimap : ne pas filtrer par type d’icône ni par priorité.
  // Les marqueurs froids/grisés doivent rester visibles comme les marqueurs action/chauds.
  return getLocatedClients();
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
        html: `<span>${homeMarkerIcon(target.client)}</span>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19]
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

function positionMiniMap(coords, targets, options = {}) {
  if (!state.miniMap) return;
  if (coords && state.liveTracking) {
    const last = state.miniLastCenteredCoords;
    const distance = last ? metersBetween(last, coords) : Infinity;
    if (!options.force && distance < RECENTER_JITTER_METERS && state.miniMap.getZoom() === 17) return;
    state.miniLastCenteredCoords = [...coords];
    state.miniMap.setView(coords, 17, { animate: true, duration: 1.7, easeLinearity: 0.12 });
    return;
  }
  if (coords && !state.liveTracking) return;
  const selected = state.homeSelectedClient ? targets.find((target) => clientKey(target.client) === clientKey(state.homeSelectedClient)) : null;
  const anchor = selected || targets[0];
  if (anchor && (!state.miniMap._loaded || options.forceFallback || !state.miniFallbackReady)) {
    state.miniFallbackReady = true;
    state.miniMap.setView(anchor.coords, 16, { animate: true, duration: 1.1, easeLinearity: 0.14 });
  }
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
    if (!options.skipMarkers) renderMiniMapMarkers(getMiniMapTargets());
    return;
  }
  $("#home-client-city").textContent = client.city || "Zone";
  $("#home-client-title").textContent = client.enterprise_name || "Client terrain";
  $("#home-client-meta").textContent = [client.contact_name, client.phone, client.business_activity].filter(Boolean).join(" · ") || "Infos à compléter.";
  $("#home-client-tags").innerHTML = [client.machine_status, client.seller_label, client.heat_level].filter(Boolean).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  $("#home-client-location").textContent = getClientLocationInfo(client);
  $("#home-client-notes").textContent = client.relationship_summary || client.notes || "Pas encore de note terrain.";
  $("#home-waze-link").href = wazeUrl(client);
  panel.classList.add("open");
  if (!options.skipMarkers) renderMiniMapMarkers(getMiniMapTargets());
}

function openSelectedOnSatellite() {
  if (!state.homeSelectedClient) return;
  showScreen("map-screen");
  setTimeout(() => showClient(state.homeSelectedClient), 140);
}

function homeMarkerClass(client) {
  if (client.signed_client || client.machine_status === "signe") return "signed";
  if (homeNeedsAction(client)) return "action";
  return "cold";
}

function homeMarkerIcon(client) {
  if (client.signed_client || client.machine_status === "signe") return "!";
  if (homeNeedsAction(client)) return "!";
  return "";
}

function homeNeedsAction(client) {
  const hasQuest = state.quests.some((quest) => quest.target_client_id && String(quest.target_client_id) === String(client.id) && !quest.completed);
  if (hasQuest || isDue(client.next_action_at)) return true;
  if (["tres-chaud", "chaud", "tiede"].includes(client.heat_level)) return true;
  return ["a-signer", "proposition-envoyee", "facture-attendue", "contact-obtenu"].includes(client.machine_status);
}

const QUEST_BONUS = { easy: 10, medium: 18, hard: 28 };

function renderQuests() {
  const today = todayIso();
  const hasTodayScore = state.scores.some((day) => (day.score_date || day.date) === today);
  if (!hasTodayScore) {
    $("#quest-list").innerHTML = `<div class="quest-empty"><strong>Quêtes verrouillées</strong><span>Ouvre ta journée — dicte un CR ou crée la ligne du jour pour débloquer 3 quêtes.</span></div>`;
    return;
  }
  if (!state.quests.length) {
    $("#quest-list").innerHTML = `<div class="quest-empty"><span>Génération des quêtes en cours...</span></div>`;
    return;
  }
  $("#quest-list").innerHTML = state.quests.map((quest) => {
    const completed = quest.completed ? "completed" : "";
    return `<article class="quest ${completed}" data-difficulty="${escapeHtml(quest.difficulty || "medium")}"><span class="quest-icon">!</span><div class="quest-copy"><div class="quest-head"><strong>${escapeHtml(quest.title)}</strong><span class="quest-bonus">+${quest.bonus_percent}%</span></div><span class="quest-detail">${escapeHtml(quest.detail)}</span>${quest.completed ? `<span class="quest-check">VALIDÉE</span>` : ""}</div></article>`;
  }).join("");
}

async function ensureTodayQuests() {
  const today = todayIso();
  const hasTodayScore = state.scores.some((day) => (day.score_date || day.date) === today);
  if (!hasTodayScore || state.quests.length >= 3 || state.questsBootstrapped) return;
  state.questsBootstrapped = true;
  const inserted = await insertQuests(today, buildQuests(state.clients));
  if (inserted) state.quests = inserted;
}

async function refreshQuests() {
  const today = todayIso();
  const hasTodayScore = state.scores.some((day) => (day.score_date || day.date) === today);
  if (!hasTodayScore) {
    setNetwork("VERROU");
    setTimeout(() => setNetwork(state.liveTracking ? "LIVE" : "FREE"), 1400);
    return;
  }
  setNetwork("ROLL");
  try {
    await deleteQuests(today);
    state.quests = [];
    state.questsBootstrapped = false;
    const inserted = await insertQuests(today, buildQuests(state.clients));
    if (inserted) state.quests = inserted;
    renderQuests();
    setNetwork(state.liveTracking ? "LIVE" : "FREE");
  } catch (error) {
    console.error(error);
    setNetwork("OFFLINE");
  }
}

async function deleteQuests(date) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/daily_quests?score_date=eq.${date}`, {
    method: "DELETE",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Prefer: "return=minimal" }
  });
  if (!response.ok && response.status !== 404) throw new Error(`Delete quests: ${response.status}`);
}

async function insertQuests(date, quests) {
  if (!quests?.length) return [];
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
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) return null;
  return (await response.json()).sort((a, b) => a.slot - b.slot);
}

function buildQuests(clients) {
  const pools = buildQuestPools(clients);
  const order = ["closing", "hot", "invoice", "due", "missingPhone", "missingLocation", "fallback"];
  const picked = [];
  const usedTargets = new Set();
  for (const key of order) {
    if (picked.length >= 3) break;
    const candidates = (pools[key] || []).filter((q) => !q.target_client_id || !usedTargets.has(q.target_client_id));
    if (!candidates.length) continue;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    picked.push(pick);
    if (pick.target_client_id) usedTargets.add(pick.target_client_id);
  }
  while (picked.length < 3) picked.push(genericFallback(picked.length));
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
    closing: closing.map((c) => quest(c, "Closing à finaliser", "passer signer ou relancer le contrat.", QUEST_BONUS.hard, "hard")),
    hot: hot.map((c) => quest(c, "Cuisson à maintenir", "garder le contact chaud, ne pas laisser refroidir.", QUEST_BONUS.medium, "medium")),
    invoice: invoice.map((c) => quest(c, "Facture à sortir", "transformer le contact en facture analysable.", QUEST_BONUS.medium, "medium")),
    due: due.map((c) => quest(c, "Relance prioritaire", "action prévue maintenant, à traiter.", QUEST_BONUS.medium, "medium")),
    missingPhone: missingPhone.map((c) => quest(c, "Fiche à muscler", "récupérer le téléphone.", QUEST_BONUS.easy, "easy")),
    missingLocation: missingLocation.map((c) => quest(c, "Carte à nettoyer", "récupérer ou poser l'adresse exacte.", QUEST_BONUS.easy, "easy")),
    fallback: [genericFallback(0), genericFallback(1), genericFallback(2)]
  };
}

function quest(client, title, action, bonus_percent, difficulty) {
  return { title, detail: questDetail(client, action), bonus_percent, difficulty, target_client_id: client.id };
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
  if (status.state === "empty") return setGeoPill("Aucune fiche à recaler");
  if (status.state === "start") return setGeoPill(`${status.total} fiches à vérifier`);
  if (status.state === "running") return setGeoPill(`IGN ${status.processed}/${status.total} · ${status.changed} placées`);
  if (status.state === "done") setGeoPill(`Recalage fini · ${status.changed}/${status.total} placées`);
}

function switchMapMode(mode) {
  state.mapMode = mode;
  setMapMode(mode);
  document.querySelectorAll(".mode-button").forEach((button) => button.classList.toggle("active", button.dataset.mapMode === mode));
  if (mode === "capture") renderCaptureTargets();
}

function renderCaptureTargets() {
  if (state.mapMode !== "capture") return;
  const targets = getCaptureTargets(8);
  $("#capture-orbs").innerHTML = targets.slice(0, 6).map((target, index) => {
    const angle = (target.angle * Math.PI) / 180;
    const left = 50 + Math.cos(angle) * target.radius;
    const top = 50 + Math.sin(angle) * target.radius * 0.78;
    return `<button class="capture-orb ${captureClass(target.client)}" data-key="${escapeHtml(clientKey(target.client))}" style="left:${left}%;top:${top}%;animation-delay:${index * 0.18}s" type="button"><strong>${escapeHtml(shortName(target.client))}</strong></button>`;
  }).join("");
  $("#capture-strip").innerHTML = targets.map((target) => `<button class="capture-target" data-key="${escapeHtml(clientKey(target.client))}" type="button"><strong>${escapeHtml(target.client.enterprise_name || "Client")}</strong><span>${distanceLabel(target.distance)} · ${escapeHtml(target.client.city || "zone")}</span></button>`).join("");
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
  if (!client) return panel?.classList.remove("open");
  $("#client-city").textContent = client.city || "Zone";
  $("#client-title").textContent = client.enterprise_name || "Client terrain";
  $("#client-meta").textContent = [client.contact_name, client.phone, client.business_activity].filter(Boolean).join(" · ") || "Infos à compléter.";
  $("#client-tags").innerHTML = [client.machine_status, client.seller_label, client.heat_level].filter(Boolean).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  $("#client-location").textContent = getClientLocationInfo(client);
  $("#client-notes").textContent = client.relationship_summary || client.notes || "Pas encore de note terrain.";
  $("#waze-link").href = wazeUrl(client);
  panel.classList.add("open");
}

async function saveSelectedAtGps() {
  if (!state.selectedClient) return;
  try {
    const coords = await saveClientAtUser(state.selectedClient);
    setGeoPill(`GPS enregistré · ${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`);
    renderMap();
    renderMiniMap();
    showClient(state.selectedClient);
  } catch {
    setGeoPill("GPS indisponible");
  }
}

function placeSelectedOnMap() {
  if (!state.selectedClient) return;
  const clientToPlace = state.selectedClient;
  setGeoPill("Touchez la carte pour poser la fiche");
  $("#client-panel")?.classList.remove("open");
  enableManualPlacement(clientToPlace, () => {
    setGeoPill("Position posée");
    renderMap();
    renderMiniMap();
  });
}

function cleanLocalPositions() {
  const removed = clearInvalidLocalPositions();
  setGeoPill(removed ? `${removed} positions invalides nettoyées` : "Positions locales propres");
}

function updateGeoStatus(summary) {
  updateMapCount(summary.displayed, summary.total);
}

function updateGpsStatus(label) {
  if (!state.liveTracking && label === "GPS actif") return;
  setGeoPill(label);
}

function updateMapCount(displayed = 0, total = 0) {
  const count = $("#map-count-pill");
  if (count) count.textContent = `${displayed}/${total} fiches`;
}

function setGeoPill(label) {
  const pill = $("#geo-pill");
  if (pill) pill.textContent = label;
}

function setNetwork(label) {
  const pill = $("#network-pill");
  if (!pill) return;
  if (!state.liveTracking && label === "LIVE") label = "FREE";
  pill.textContent = label;
  pill.classList.toggle("free", label === "FREE");
  updateLiveButton();
}

function updateDate() {
  const label = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "2-digit", month: "short", timeZone: "Europe/Paris" }).format(new Date()).replace(".", "").toUpperCase();
  $("#today-label").textContent = label;
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
}

function handleNearClient(client, distance) {
  console.log(`Client proche: ${client.enterprise_name || client.contact_name || "Client"} · ${distance}m`);
}

function statusText(percent) {
  if (percent >= 150) return "Surcharge terrain. Les néons chauffent.";
  if (percent >= 100) return "Objectif validé. Journée rentable.";
  if (percent >= 55) return "En cours. Il manque encore du carburant.";
  return "À lancer. La tournée attend son premier signal.";
}

function statusChip(percent) {
  if (percent >= 150) return "SURCHARGE";
  if (percent >= 100) return "VALIDÉ";
  if (percent >= 55) return "EN COURS";
  return "À lancer";
}

function dayLabel(date) {
  if (!date) return "--";
  const parsed = new Date(`${date}T12:00:00`);
  return parsed.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "");
}

function distanceLabel(distance) {
  if (!Number.isFinite(distance)) return "-- m";
  if (distance >= 1000) return `${(distance / 1000).toFixed(1)} km`;
  return `${Math.round(distance)} m`;
}

function shortName(client) {
  return (client.enterprise_name || client.contact_name || "Client").split(/\s+/).slice(0, 2).join(" ");
}

function captureClass(client) {
  if (client.signed_client || client.machine_status === "signe") return "signed";
  if (client.heat_level === "tres-chaud") return "very-hot";
  if (client.heat_level === "chaud") return "hot";
  return "";
}

function isDue(value) {
  if (!value) return false;
  const today = todayIso();
  return String(value).slice(0, 10) <= today;
}

function clientKey(client) {
  return String(client.id || `${client.enterprise_name || ""}-${client.city || ""}-${client.address || ""}`);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[char]);
}
