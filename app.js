import {
  centerOnUser,
  clearInvalidLocalPositions,
  enableManualPlacement,
  fitAllClients,
  getCaptureTargets,
  getClientLocationInfo,
  getGeoSummary,
  initMap,
  renderClients,
  saveClientAtUser,
  setGeocodeStatusCallback,
  setMapMode,
  startGeocoding,
  startLocationWatch,
  wazeUrl
} from "./map.js?v=9";
import { averageScore, rankFor, scoreClass, streakCount, todayPercent, totalScore } from "./score.js?v=9";

const SUPABASE_URL = "https://fuxephmatxzgccmaaftt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1eGVwaG1hdHh6Z2NjbWFhZnR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTk2MjYsImV4cCI6MjA5Mjc3NTYyNn0.FN9McvOO2Mb9-vrdvGsiUzinkldz02mSAJSgmh6sm1U";

const state = {
  clients: [],
  scores: [],
  selectedClient: null,
  mapReady: false,
  mapMode: "satellite",
  geoSummary: { placed: 0, city: 0, total: 0 }
};

const $ = (selector) => document.querySelector(selector);
const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });

document.addEventListener("DOMContentLoaded", () => {
  bindActions();
  setGeocodeStatusCallback(updateGeocodeStatus);
  registerServiceWorker();
  updateDate();
  clearOldGeoCaches();
  loadTerrain();
  setInterval(loadTerrain, 60000);
});

async function loadTerrain() {
  setNetwork("SYNC");
  try {
    const [clients, scores] = await Promise.all([
      fetchRows("clients", "select=*&order=updated_at.desc"),
      fetchRows("daily_scores", "select=*&order=score_date.desc")
    ]);
    state.clients = clients;
    state.scores = scores;
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
  $("#refresh-button").addEventListener("click", loadTerrain);
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
  switchMapMode("satellite");
}

function bootMap() {
  if (!state.mapReady) {
    initMap({ onClientSelected: showClient, onGeoStatusChange: updateGeoStatus, onGpsStatusChange: updateGpsStatus });
    state.mapReady = true;
    renderMap();
    fitAllClients();
    startLocationWatch(handleNearClient, renderCaptureTargets);
  }
  switchMapMode(state.mapMode);
}

function renderCockpit() {
  renderHomeMetrics();
  renderQuests();
  renderStats();
  renderHistory();
}

function renderHomeMetrics() {
  const today = todayIso();
  const percent = todayPercent(state.scores, today);
  const total = totalScore(state.scores);
  const rank = rankFor(total);
  const streak = streakCount(state.scores);
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
  $("#streak-badge").textContent = streak > 1 ? "Jours au-dessus du seuil terrain." : "Streak à construire aujourd'hui.";
}

function renderStats() {
  const hot = state.clients.filter((client) => ["chaud", "tres-chaud"].includes(client.heat_level)).length;
  const signed = state.clients.filter((client) => client.signed_client).length;
  $("#total-clients").textContent = state.clients.length;
  $("#signed-clients").textContent = signed;
  $("#hot-clients").textContent = hot;
  $("#located-clients").textContent = state.geoSummary.total ? state.geoSummary.placed : estimateLocatedClients();
}

function renderHistory() {
  const avg = averageScore(state.scores);
  const days = chartDays(state.scores);
  $("#history-label").textContent = "Réf. 100%";
  $("#history-bars").innerHTML = days.map((day) => {
    const percent = avg ? Math.round((Number(day.raw_score || 0) / avg) * 100) : 0;
    const height = Math.max(8, Math.min(100, Math.round(percent * 0.78)));
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

function renderQuests() {
  const quests = buildQuests(state.clients);
  $("#quest-list").innerHTML = quests.map((quest) => `
    <article class="quest">
      <strong>${escapeHtml(quest.title)}</strong>
      <span>${escapeHtml(quest.detail)}</span>
    </article>
  `).join("");
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
  renderStats();
  updateMapCount(summary.displayed, summary.total);
  const label = summary.total
    ? `${summary.displayed}/${summary.total} affichées · ${summary.pending} sans coords`
    : "Localisation en cours";
  setGeoPill(label);
}

function updateGpsStatus(status) {
  if (status === "GPS indisponible") setGeoPill("GPS indisponible");
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

function buildQuests(clients) {
  const due = clients.find((client) => isDue(client.next_action_at));
  const invoice = clients.find((client) => ["facture-attendue", "contact-obtenu"].includes(client.machine_status));
  const hotFollow = clients.find((client) => ["chaud", "tres-chaud"].includes(client.heat_level) && client.machine_status !== "signe");
  const missingLocation = clients.find((client) => !client.address);
  const missingPhone = clients.find((client) => !client.phone);
  const quests = [];
  if (due) quests.push({ title: "Relance prioritaire", detail: `${due.enterprise_name} · ${due.city || "zone"} · action prévue maintenant.` });
  if (hotFollow) quests.push({ title: "Cuisson à maintenir", detail: `${hotFollow.enterprise_name} · ${hotFollow.city || "zone"} · repasser propre.` });
  if (invoice) quests.push({ title: "Facture à sortir", detail: `${invoice.enterprise_name} · transformer le contact en analyse.` });
  if (missingLocation) quests.push({ title: "Carte à nettoyer", detail: `${missingLocation.enterprise_name} · récupérer ou poser l'adresse exacte.` });
  if (missingPhone) quests.push({ title: "Fiche à muscler", detail: `${missingPhone.enterprise_name} · récupérer le téléphone.` });
  while (quests.length < 3) {
    quests.push({ title: "Terrain utile", detail: "Toucher 3 commerces proches et dicter le CR juste après." });
  }
  return quests.slice(0, 3);
}

function chartDays(scores) {
  const byDate = new Map(scores.map((day) => [day.score_date, day]));
  const dates = [...byDate.keys()].sort().slice(-13);
  const today = todayIso();
  if (!byDate.has(today)) dates.push(today);
  return dates.slice(-14).map((date) => byDate.get(date) || { score_date: date, raw_score: 0, actions_count: 0 });
}

function estimateLocatedClients() {
  return state.clients.filter((client) => client.address).length;
}

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
