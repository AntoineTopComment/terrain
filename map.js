const CITY_COORDS = {
  "Vénissieux": [45.697, 4.885],
  "Saint-Fons": [45.708, 4.854],
  "Givors": [45.584, 4.773],
  "Feyzin": [45.673, 4.859],
  "Pierre-Bénite": [45.703, 4.824],
  "Lyon": [45.748, 4.846],
  "Lyon 7e": [45.745, 4.842],
  "Lyon 7": [45.745, 4.842],
  "Corbas": [45.667, 4.902],
  "Mions": [45.663, 4.953],
  "Irigny": [45.673, 4.823],
  "Oullins": [45.714, 4.808],
  "Saint-Priest": [45.697, 4.944],
  "Brignais": [45.673, 4.754],
  "Villeurbanne": [45.771, 4.890],
  "Bron": [45.733, 4.913]
};

const LYON_SUD = [45.708, 4.86];
const MANUAL_COORDS_KEY = "terrain:manual-coords:v1";
const GEOCODE_CACHE_KEY = "terrain:geocode-cache:v5";
const GEOCODE_URL = "https://data.geopf.fr/geocodage/search";

let map;
let userMarker;
let markers = [];
let clientsCache = [];
let userCoords = null;
let locationWatchId = null;
let manualPlacement = null;
let selectClientCallback = () => {};
let geoStatusCallback = () => {};
let gpsStatusCallback = () => {};
let geocodeStatusCallback = () => {};
let activeMode = "satellite";
let activeTileLayer = null;

const manualCoords = readStore(MANUAL_COORDS_KEY);
const geocodeCache = readStore(GEOCODE_CACHE_KEY);
const tileLayers = {};

export function initMap({ onClientSelected, onGeoStatusChange, onGpsStatusChange } = {}) {
  if (map) return map;
  selectClientCallback = onClientSelected || selectClientCallback;
  geoStatusCallback = onGeoStatusChange || geoStatusCallback;
  gpsStatusCallback = onGpsStatusChange || gpsStatusCallback;

  map = L.map("map", { zoomControl: false, preferCanvas: true }).setView(LYON_SUD, 12);
  tileLayers.satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Tiles &copy; Esri",
    maxZoom: 19
  });
  activeTileLayer = tileLayers.satellite.addTo(map);
  L.control.zoom({ position: "bottomleft" }).addTo(map);

  map.on("zoomend", applyZoomClass);
  map.on("click", (event) => {
    if (manualPlacement) {
      const coords = [event.latlng.lat, event.latlng.lng];
      saveManualPosition(manualPlacement.client, coords, "posé sur carte");
      manualPlacement.onPlaced?.(coords);
      manualPlacement = null;
      return;
    }
    selectClientCallback(null);
  });
  applyZoomClass();
  return map;
}

export function setGeocodeStatusCallback(callback) {
  geocodeStatusCallback = callback || (() => {});
}

export function setMapMode(mode) {
  activeMode = mode;
  const screen = document.querySelector("#map-screen");
  if (screen) screen.dataset.mode = mode;
  if (map && tileLayers.satellite && activeTileLayer !== tileLayers.satellite) {
    map.removeLayer(activeTileLayer);
    activeTileLayer = tileLayers.satellite.addTo(map);
  }
  setTimeout(() => map?.invalidateSize(), 80);
}

export function primeClientLocations(clients = []) {
  setClientCache(clients);
  if (map) drawMarkers(selectClientCallback);
  publishGeoStatus();
  return getGeoSummary();
}

export function renderClients(clients = [], onClientSelected) {
  selectClientCallback = onClientSelected || selectClientCallback;
  setClientCache(clients);
  if (map) drawMarkers(selectClientCallback);
  publishGeoStatus();
}

export function centerOnUser() {
  return refreshUserPosition((coords) => {
    if (map) map.setView(coords, 16, { animate: true, duration: 1.2, easeLinearity: 0.15 });
  }).catch(() => {});
}

export function focusMapOn(coords, zoom = 16) {
  if (!map || !validGpsCoords(coords)) return false;
  map.setView(coords, zoom, { animate: true, duration: 1.1, easeLinearity: 0.15 });
  return true;
}

export function focusOperationalArea(zoom = 14) {
  if (!map) return false;
  const anchor = getLocatedClients(1)[0];
  if (anchor) {
    map.setView(anchor.coords, zoom, { animate: true, duration: 1.1 });
    return true;
  }
  map.setView(LYON_SUD, zoom, { animate: true, duration: 1.1 });
  return false;
}

export function fitAllClients() {
  if (!map || !clientsCache.length) return;
  const coords = clientsCache.map((client) => client.__geo?.coords).filter(validCoords);
  if (!coords.length) return;
  if (coords.length === 1) {
    map.setView(coords[0], 15, { animate: true });
    return;
  }
  map.fitBounds(L.latLngBounds(coords), { padding: [48, 48], maxZoom: 14, animate: true });
}

export function startLocationWatch(onNearClient, onPositionChange) {
  if (!navigator.geolocation) {
    removeUserMarker();
    gpsStatusCallback("GPS indisponible");
    return null;
  }
  if (locationWatchId !== null) return locationWatchId;

  locationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const coords = [position.coords.latitude, position.coords.longitude];
      if (!validGpsCoords(coords)) {
        gpsStatusCallback("GPS indisponible");
        return;
      }
      userCoords = coords;
      setUserMarker(coords);
      gpsStatusCallback("GPS actif");
      onPositionChange?.(coords);
      clientsCache.forEach((client) => {
        if (!client.__geo?.coords) return;
        const distance = metersBetween(coords, client.__geo.coords);
        if (distance <= 100 && shouldAlert(client)) onNearClient?.(client, Math.round(distance));
      });
    },
    () => {
      gpsStatusCallback("GPS indisponible");
    },
    { enableHighAccuracy: true, maximumAge: 12000, timeout: 15000 }
  );
  return locationWatchId;
}

export function stopLocationWatch() {
  if (locationWatchId === null || !navigator.geolocation) return;
  navigator.geolocation.clearWatch(locationWatchId);
  locationWatchId = null;
  gpsStatusCallback("GPS en pause");
}

export function getUserCoords() {
  return userCoords ? [...userCoords] : null;
}

export async function refreshUserPosition(onPositionChange) {
  const coords = await getCurrentPosition();
  userCoords = coords;
  setUserMarker(coords);
  gpsStatusCallback("GPS actif");
  onPositionChange?.(coords);
  return coords;
}

export function saveClientAtUser(client) {
  if (!client) return Promise.reject(new Error("Aucun client sélectionné"));
  if (userCoords) {
    saveManualPosition(client, userCoords, "GPS terrain");
    return Promise.resolve(userCoords);
  }
  return getCurrentPosition().then((coords) => {
    userCoords = coords;
    setUserMarker(coords);
    saveManualPosition(client, coords, "GPS terrain");
    return coords;
  });
}

export function enableManualPlacement(client, onPlaced) {
  manualPlacement = { client, onPlaced };
}

export function clearInvalidLocalPositions() {
  let removed = 0;
  for (const [key, value] of Object.entries(manualCoords)) {
    const coords = normalizeCoordPair(Number(value.lat), Number(value.lng));
    if (!validCoords(coords)) {
      delete manualCoords[key];
      removed += 1;
    }
  }
  writeStore(MANUAL_COORDS_KEY, manualCoords);
  setClientCache(clientsCache);
  if (map) drawMarkers(selectClientCallback);
  publishGeoStatus();
  fitAllClients();
  return removed;
}

export function getGeoSummary() {
  const summary = { displayed: 0, precise: 0, manual: 0, database: 0, city: 0, pending: 0, total: clientsCache.length };
  clientsCache.forEach((client) => {
    const source = client.__geo?.source || "pending";
    if (validCoords(client.__geo?.coords)) summary.displayed += 1;
    if (source === "manual") summary.manual += 1;
    if (["database", "web", "geocode"].includes(source)) summary.precise += 1;
    if (source === "database") summary.database += 1;
    if (source === "city") summary.city += 1;
    if (source === "pending") summary.pending += 1;
  });
  summary.placed = summary.precise + summary.manual;
  return summary;
}

export function getLocatedClients(limit = 999) {
  return clientsCache
    .filter((client) => validCoords(client.__geo?.coords))
    .map((client) => ({
      client,
      coords: [...client.__geo.coords],
      distance: userCoords ? metersBetween(userCoords, client.__geo.coords) : null,
      source: client.__geo.source,
      heat: heatWeight(client)
    }))
    .sort((a, b) => {
      if (a.distance !== null && b.distance !== null) return a.distance - b.distance;
      return b.heat - a.heat;
    })
    .slice(0, limit);
}

export function getCaptureTargets(limit = 8) {
  return getLocatedClients(limit).map((target) => {
    const seed = hash(clientKey(target.client));
    return {
      ...target,
      angle: userCoords ? bearingBetween(userCoords, target.coords) - 90 : seed % 360,
      radius: targetRadius(target.distance, seed)
    };
  });
}

export function wazeUrl(client) {
  const selected = findCachedClient(client) || client;
  if (selected?.__geo?.coords && selected.__geo.source !== "city") {
    const [lat, lng] = selected.__geo.coords;
    return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  }
  const query = encodeURIComponent([selected?.address, selected?.city].filter(Boolean).join(", "));
  return query ? `https://waze.com/ul?q=${query}&navigate=yes` : "https://waze.com/ul";
}

export function getClientLocationInfo(client) {
  const selected = findCachedClient(client) || client;
  const geo = selected?.__geo;
  if (!geo?.coords) return "Aucune coordonnée disponible pour cette fiche.";
  const coords = `${geo.coords[0].toFixed(5)}, ${geo.coords[1].toFixed(5)}`;
  if (geo.source === "manual") return `Position terrain corrigée localement · ${coords}.`;
  if (geo.source === "database") return `Coordonnées précises depuis la base · ${coords}.`;
  if (geo.source === "web") return `Position web · ${coords}.`;
  if (geo.source === "geocode") return `Adresse géocodée · ${coords}.`;
  return `Position approximative par ville · ${coords}.`;
}

export function startGeocoding() {
  queueGeocoding();
}

function setClientCache(clients = []) {
  clientsCache = clients.map((client) => ({ ...client, __geo: resolveClientCoords(client) }));
}

function drawMarkers(onClientSelected) {
  markers.forEach((marker) => marker.remove());
  markers = clientsCache.filter((client) => validCoords(client.__geo?.coords)).map((client) => {
    const icon = L.divIcon({
      className: `terrain-marker ${heatClass(client)} ${confidenceClass(client)}`,
      html: markerHtml(client),
      iconSize: [148, 46],
      iconAnchor: [18, 23]
    });
    const marker = L.marker(client.__geo.coords, { icon, riseOnHover: true }).addTo(map);
    marker.on("click", (event) => {
      event.originalEvent?.stopPropagation();
      onClientSelected?.(client);
    });
    return marker;
  });
}

function markerHtml(client) {
  return `
    <div class="marker-shell">
      <span class="marker-icon">${markerIcon(client)}</span>
      <span class="marker-label">${escapeHtml(markerLabel(client))}</span>
      <span class="marker-source">${sourceBadge(client.__geo?.source)}</span>
    </div>
  `;
}

function markerIcon(client) {
  if (client.signed_client || client.machine_status === "signe") return "\u{1FA99}";
  if (client.heat_level === "tres-chaud" || client.heat_level === "chaud") return "◆";
  if (client.heat_level === "tiede") return "◇";
  return "□";
}

function resolveClientCoords(client) {
  const key = clientKey(client);
  if (manualCoords[key]) {
    const coords = normalizeCoordPair(Number(manualCoords[key].lat), Number(manualCoords[key].lng));
    if (validCoords(coords)) return { coords, source: "manual", label: manualCoords[key].label };
  }
  const database = databaseLocation(client);
  if (database) return database;
  const cached = geocodeCache[geocodeKey(client)];
  if (cached?.coords) return { coords: normalizeCoordPair(cached.coords[0], cached.coords[1]), source: "geocode", label: cached.label };
  const city = cityFallback(client);
  if (city) return { coords: city, source: "city", label: client.city || "ville" };
  return null;
}

function databaseLocation(client) {
  const manual = coordsFrom(client, ["manual_lat"], ["manual_lng"]);
  if (manual) return { coords: manual, source: "manual", label: client.manual_location_source || "Supabase terrain" };
  const web = coordsFrom(client, ["web_lat"], ["web_lng"]);
  if (web) return { coords: web, source: "web", label: client.web_location_label || "localisation web" };
  const database = coordsFrom(client, ["lat", "latitude", "gps_lat", "geo_lat", "location_lat"], ["lng", "lon", "longitude", "gps_lng", "geo_lng", "location_lng", "location_lon"]);
  if (database) return { coords: database, source: "database", label: "coordonnées base" };
  return null;
}

function coordsFrom(client, latFields, lngFields) {
  for (const latField of latFields) {
    for (const lngField of lngFields) {
      const coords = normalizeCoordPair(Number(client[latField]), Number(client[lngField]));
      if (validCoords(coords)) return coords;
    }
  }
  return null;
}

function saveManualPosition(client, coords, label) {
  coords = normalizeCoordPair(Number(coords[0]), Number(coords[1]));
  if (!validCoords(coords)) return;
  manualCoords[clientKey(client)] = { lat: coords[0], lng: coords[1], label, savedAt: new Date().toISOString() };
  writeStore(MANUAL_COORDS_KEY, manualCoords);
  const cached = findCachedClient(client);
  if (cached) cached.__geo = { coords, source: "manual", label };
  if (map) drawMarkers(selectClientCallback);
  publishGeoStatus();
}

function queueGeocoding() {
  const targets = clientsCache.filter((client) => client.__geo?.source === "city" && geocodeQuery(client));
  if (!targets.length) {
    geocodeStatusCallback({ state: "empty", total: 0, processed: 0, changed: 0 });
    return;
  }
  geocodeStatusCallback({ state: "start", total: targets.length, processed: 0, changed: 0 });
  runGeocodeQueue(targets);
}

async function runGeocodeQueue(targets) {
  let changed = 0;
  for (let i = 0; i < targets.length; i += 1) {
    const client = targets[i];
    const result = await geocodeClient(client);
    if (result) {
      geocodeCache[geocodeKey(client)] = result;
      writeStore(GEOCODE_CACHE_KEY, geocodeCache);
      const cached = findCachedClient(client);
      if (cached && cached.__geo?.source !== "manual") {
        cached.__geo = { ...result, source: "geocode" };
        changed += 1;
      }
    }
    geocodeStatusCallback({ state: "running", total: targets.length, processed: i + 1, changed });
    await delay(150);
  }
  if (map) drawMarkers(selectClientCallback);
  publishGeoStatus();
  geocodeStatusCallback({ state: "done", total: targets.length, processed: targets.length, changed });
}

async function geocodeClient(client) {
  const query = geocodeQuery(client);
  if (!query) return null;
  try {
    const url = new URL(GEOCODE_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "1");
    url.searchParams.set("autocomplete", "0");
    const response = await fetch(url.toString());
    if (!response.ok) return null;
    const payload = await response.json();
    const feature = payload.features?.[0];
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    return { coords: [Number(coords[1]), Number(coords[0])], label: feature.properties?.label || query, savedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}

function geocodeQuery(client) {
  const address = clean(client.address);
  const city = clean(client.city);
  const name = clean(client.enterprise_name);
  if (address && city) return `${address} ${city} France`;
  if (name && city) return `${name} ${city} France`;
  return "";
}

function cityFallback(client) {
  const city = normalizeCity(client.city || "");
  const base = CITY_COORDS[city];
  if (!base) return null;
  const seed = hash(clientKey(client));
  return [base[0] + (((seed % 1000) / 1000) - 0.5) * 0.008, base[1] + ((((seed / 1000) % 1000) / 1000) - 0.5) * 0.01];
}

function setUserMarker(coords) {
  if (!map || !validGpsCoords(coords)) return;
  if (!userMarker) {
    userMarker = L.marker(coords, {
      interactive: false,
      icon: L.divIcon({ className: "user-arrow", html: "<span></span>", iconSize: [34, 34], iconAnchor: [17, 17] })
    }).addTo(map);
    return;
  }
  userMarker.setLatLng(coords);
}

function removeUserMarker() {
  if (!userMarker) return;
  userMarker.remove();
  userMarker = null;
}

function publishGeoStatus() {
  geoStatusCallback(getGeoSummary());
}

function applyZoomClass() {
  if (!map) return;
  const container = map.getContainer();
  const zoom = map.getZoom();
  container.classList.toggle("map-zoom-far", zoom < 13);
  container.classList.toggle("map-zoom-mid", zoom >= 13 && zoom < 15);
  container.classList.toggle("map-zoom-close", zoom >= 15);
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("GPS indisponible"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = [position.coords.latitude, position.coords.longitude];
        validGpsCoords(coords) ? resolve(coords) : reject(new Error("GPS invalide"));
      },
      reject,
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 15000 }
    );
  });
}

function normalizeCoordPair(lat, lng) {
  const coords = [Number(lat), Number(lng)];
  if (!validCoords(coords)) return coords;
  const swapped = [coords[1], coords[0]];
  if (looksLocal(swapped) && !looksLocal(coords)) return swapped;
  return coords;
}

function validCoords(coords) {
  return Array.isArray(coords) && coords.length >= 2 && Number.isFinite(Number(coords[0])) && Number.isFinite(Number(coords[1])) && Math.abs(Number(coords[0])) <= 90 && Math.abs(Number(coords[1])) <= 180;
}

function validGpsCoords(coords) {
  return validCoords(coords) && !(Math.abs(Number(coords[0])) < 0.0001 && Math.abs(Number(coords[1])) < 0.0001);
}

function looksLocal(coords) {
  return coords[0] >= 44 && coords[0] <= 47 && coords[1] >= 2 && coords[1] <= 7.5;
}

export function metersBetween(a, b) {
  const radius = 6371000;
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearingBetween(a, b) {
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const dLng = toRad(b[1] - a[1]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function targetRadius(distance, seed) {
  if (!Number.isFinite(distance)) return 22 + (seed % 30);
  return Math.min(42, Math.max(16, distance / 18));
}

function toRad(value) { return Number(value) * Math.PI / 180; }
function clean(value = "") { return String(value || "").trim(); }
function normalizeCity(value = "") {
  const cleanValue = clean(value);
  const comparable = normalizeText(cleanValue);
  if (comparable.includes("lyon 7")) return "Lyon 7e";
  return Object.keys(CITY_COORDS).find((name) => normalizeText(name) === comparable) || cleanValue;
}
function normalizeText(value = "") { return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function markerLabel(client) { return [clean(client.contact_name).split(/\s+/)[0], client.enterprise_name].filter(Boolean).join(" · ") || "Client"; }
function sourceBadge(source) { return ({ manual: "G", web: "W", database: "B", geocode: "✓", city: "?" })[source] || "?"; }
function heatClass(client) { if (client.signed_client || client.machine_status === "signe") return "heat-signed"; return `heat-${client.heat_level || "froid"}`; }
function confidenceClass() { return ""; }
function heatWeight(client) { if (client.signed_client || client.machine_status === "signe") return 5; return { "tres-chaud": 4, chaud: 3, tiede: 2, froid: 1 }[client.heat_level] || 1; }
function shouldAlert(client) { return client.signed_client || ["tres-chaud", "chaud"].includes(client.heat_level) || client.machine_status === "nouveau"; }
function clientKey(client) { return String(client?.id || `${client?.enterprise_name || ""}-${client?.city || ""}-${client?.address || ""}`); }
function geocodeKey(client) { return `${clientKey(client)}:${hash(geocodeQuery(client))}`; }
function findCachedClient(client) { const key = clientKey(client); return clientsCache.find((item) => clientKey(item) === key); }
function hash(value = "") { return [...String(value)].reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) >>> 0, 2166136261); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function readStore(key) { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; } }
function writeStore(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[char]); }
