const CITY_COORDS = {
  "Vénissieux": [45.697, 4.885],
  "Saint-Fons": [45.708, 4.854],
  "Saint-Chamond": [45.476, 4.512],
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
  "Grigny": [45.611, 4.795],
  "Grenay": [45.664, 5.079],
  "Hauterives": [45.255, 5.025],
  "La Côte-Saint-André": [45.394, 5.258],
  "Rive-de-Gier": [45.529, 4.616],
  "Saint-Priest": [45.697, 4.944],
  "Chaponnay": [45.629, 4.938],
  "Toussieu": [45.654, 4.985],
  "Brignais": [45.673, 4.754],
  "Millery": [45.632, 4.783],
  "Sérézin-du-Rhône": [45.629, 4.824],
  "Chaponost": [45.711, 4.744],
  "Tassin-la-Demi-Lune": [45.763, 4.778],
  "Écully": [45.775, 4.778],
  "Villeurbanne": [45.771, 4.890],
  "Bron": [45.733, 4.913],
  "Chassieu": [45.745, 4.970],
  "Genas": [45.732, 5.000]
};

const LYON_SUD = [45.708, 4.86];
const ARA_BOUNDS = {
  minLat: 44.05,
  maxLat: 46.65,
  minLng: 2.05,
  maxLng: 7.35
};
const GEOCODE_URL = "https://data.geopf.fr/geocodage/search";
const GEOCODE_CACHE_KEY = "terrain:geocode-cache:v4";
const MANUAL_COORDS_KEY = "terrain:manual-coords:v1";

let map;
let userMarker;
let markers = [];
let clientsCache = [];
let notified = new Set();
let activeMode = "satellite";
let activeTileLayer;
let geocodeRun = 0;
let manualPlacement = null;
let userCoords = null;
let selectClientCallback = () => {};
let geoStatusCallback = () => {};
let geocodeStatusCallback = () => {};
let gpsStatusCallback = () => {};

const tileLayers = {};
const manualCoords = readStore(MANUAL_COORDS_KEY);
const geocodeCache = readStore(GEOCODE_CACHE_KEY);

export function initMap({ onClientSelected, onGeoStatusChange, onGpsStatusChange } = {}) {
  if (map) return map;
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
    onClientSelected?.(null);
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
  const wantedLayer = tileLayers.satellite;
  if (map && wantedLayer && wantedLayer !== activeTileLayer) {
    map.removeLayer(activeTileLayer);
    activeTileLayer = wantedLayer.addTo(map);
  }
  setTimeout(() => map?.invalidateSize(), 80);
}

export function renderClients(clients, onClientSelected) {
  if (!map) return;
  selectClientCallback = onClientSelected || selectClientCallback;
  purgeInvalidLocalPositions();
  clientsCache = clients.map((client) => ({ ...client, __geo: sanitizeGeo(resolveClientCoords(client)) }));
  drawMarkers(selectClientCallback);
  publishGeoStatus();
}

export function startGeocoding() {
  queueGeocoding(selectClientCallback);
}

export function centerOnUser() {
  if (!navigator.geolocation || !map) {
    removeUserMarker();
    gpsStatusCallback("GPS indisponible");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const coords = [position.coords.latitude, position.coords.longitude];
      if (!validGpsCoords(coords)) {
        removeUserMarker();
        gpsStatusCallback("GPS indisponible");
        return;
      }
      userCoords = coords;
      setUserMarker(coords);
      map.setView(coords, 16);
    },
    () => {
      removeUserMarker();
      gpsStatusCallback("GPS indisponible");
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );
}

export function fitAllClients() {
  if (!map || !clientsCache.length) return;
  const coords = clientsCache
    .map((client) => client.__geo?.coords)
    .filter((coords) => validCoords(coords) && insideAra(coords));
  if (!coords.length) return;
  const bounds = L.latLngBounds(coords);
  if (coords.length === 1) {
    map.setView(coords[0], 15);
    return;
  }
  map.fitBounds(bounds, {
    padding: [48, 48],
    maxZoom: 13
  });
}

export function startLocationWatch(onNearClient, onPositionChange) {
  if (!navigator.geolocation) {
    removeUserMarker();
    gpsStatusCallback("GPS indisponible");
    return;
  }
  navigator.geolocation.watchPosition(
    (position) => {
      const coords = [position.coords.latitude, position.coords.longitude];
      if (!validGpsCoords(coords)) {
        removeUserMarker();
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
        if (distance <= 100 && !notified.has(clientKey(client)) && shouldAlert(client)) {
          notified.add(clientKey(client));
          onNearClient?.(client, Math.round(distance));
        }
      });
    },
    () => {
      removeUserMarker();
      gpsStatusCallback("GPS indisponible");
    },
    { enableHighAccuracy: true, maximumAge: 12000, timeout: 15000 }
  );
}

export function wazeUrl(client) {
  const selected = findCachedClient(client) || client;
  if (selected.__geo?.source !== "city" && selected.__geo?.coords) {
    const [lat, lng] = selected.__geo.coords;
    return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  }
  const query = encodeURIComponent([selected.address, selected.city].filter(Boolean).join(", "));
  return query ? `https://waze.com/ul?q=${query}&navigate=yes` : "https://waze.com/ul";
}

export function getClientLocationInfo(client) {
  const selected = findCachedClient(client) || client;
  const geo = selected.__geo || resolveClientCoords(selected);
  if (!geo) return "Aucune coordonnée disponible pour cette fiche.";
  const coords = validCoords(geo.coords) ? ` · ${geo.coords[0].toFixed(5)}, ${geo.coords[1].toFixed(5)}` : "";
  if (geo.source === "manual") return `Position terrain corrigée localement${coords}.`;
  if (geo.source === "web") return `Position web: ${geo.label || "coordonnées proposées"}${Number.isFinite(geo.confidence) ? ` · confiance ${geo.confidence}` : ""}${coords}.`;
  if (geo.source === "database") return "Coordonnées précises depuis la base.";
  if (geo.source === "geocode") return `Adresse géocodée: ${geo.label || "résultat IGN/BAN"}.`;
  return "Position approximative par ville: à recaler si cette fiche compte.";
}

export async function saveClientAtUser(client) {
  const coords = userCoords || await getCurrentPosition();
  saveManualPosition(client, coords, "GPS terrain");
  return coords;
}

export function enableManualPlacement(client, onPlaced) {
  manualPlacement = { client, onPlaced };
}

export function getGeoSummary() {
  const summary = { displayed: 0, precise: 0, manual: 0, database: 0, city: 0, pending: 0, total: clientsCache.length };
  clientsCache.forEach((client) => {
    const source = client.__geo?.source || "city";
    if (validCoords(client.__geo?.coords)) summary.displayed += 1;
    if (source === "manual") summary.manual += 1;
    if (source === "web") summary.precise += 1;
    if (source === "database") summary.database += 1;
    if (source === "geocode") summary.precise += 1;
    if (source === "city") summary.pending += 1;
  });
  summary.placed = summary.precise + summary.manual + summary.database;
  return summary;
}

export function getCaptureTargets(limit = 8) {
  const ranked = clientsCache
    .filter((client) => validCoords(client.__geo?.coords))
    .map((client) => {
      const key = clientKey(client);
      const seed = hash(key);
      const distance = userCoords ? metersBetween(userCoords, client.__geo.coords) : null;
      return {
        client,
        distance,
        angle: seed % 360,
        radius: 18 + (seed % 18),
        heat: heatWeight(client)
      };
    })
    .sort((a, b) => {
      if (a.distance !== null && b.distance !== null) return a.distance - b.distance;
      return b.heat - a.heat;
    });
  return ranked.slice(0, limit);
}

function drawMarkers(onClientSelected) {
  markers.forEach((marker) => marker.remove());
  markers = clientsCache.filter((client) => validCoords(client.__geo?.coords)).map((client) => {
    const icon = L.divIcon({
      className: `terrain-marker ${heatClass(client)} ${confidenceClass(client)}`,
      html: markerHtml(client),
      iconSize: [140, 44],
      iconAnchor: [18, 22]
    });
    const marker = L.marker(client.__geo.coords, { icon, riseOnHover: true }).addTo(map);
    marker.on("click", (event) => {
      event.originalEvent.stopPropagation();
      onClientSelected?.(client);
    });
    return marker;
  });
}

function markerHtml(client) {
  return `
    <div class="marker-shell">
      <span class="marker-dot"></span>
      <span class="marker-label">${escapeHtml(markerLabel(client))}</span>
      <span class="marker-source">${sourceBadge(client.__geo?.source)}</span>
    </div>
  `;
}

function queueGeocoding(onClientSelected) {
  const run = ++geocodeRun;
  const targets = clientsCache.filter((client) => needsGeocoding(client));
  if (!targets.length) {
    geocodeStatusCallback({ state: "empty", total: 0, processed: 0, changed: 0 });
    publishGeoStatus();
    return;
  }
  geocodeStatusCallback({ state: "start", total: targets.length, processed: 0, changed: 0 });
  runGeocodeQueue(run, targets, onClientSelected);
}

async function runGeocodeQueue(run, targets, onClientSelected) {
  let changed = 0;
  for (let index = 0; index < targets.length; index += 1) {
    const client = targets[index];
    if (run !== geocodeRun) return;
    const result = await geocodeClient(client);
    if (result) {
      const key = geocodeKey(client);
      geocodeCache[key] = result;
      writeStore(GEOCODE_CACHE_KEY, geocodeCache);
      const cached = findCachedClient(client);
      if (cached && cached.__geo?.source !== "manual") {
        cached.__geo = { ...result, source: "geocode" };
        changed += 1;
      }
    }
    if (changed && changed % 8 === 0) {
      drawMarkers(onClientSelected);
      publishGeoStatus();
    }
    geocodeStatusCallback({ state: "running", total: targets.length, processed: index + 1, changed });
    await delay(150);
  }
  if (changed) drawMarkers(onClientSelected);
  publishGeoStatus();
  geocodeStatusCallback({ state: "done", total: targets.length, processed: targets.length, changed });
}

async function geocodeClient(client) {
  const query = geocodeQuery(client);
  if (!query) return null;
  try {
    const url = new URL(GEOCODE_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "5");
    url.searchParams.set("index", client.address ? "address,poi" : "poi,address");
    url.searchParams.set("autocomplete", "0");
    const response = await fetch(url.toString());
    if (!response.ok) return null;
    const payload = await response.json();
    const feature = (payload.features || []).find((item) => geocodeFeatureAllowed(client, item));
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const score = Number(feature.properties?.score ?? feature.properties?._score ?? 0);
    if (!client.address && score && score < 0.28) return null;
    return {
      coords: [Number(coords[1]), Number(coords[0])],
      label: feature.properties?.label || feature.properties?.name || query,
      score,
      query,
      savedAt: new Date().toISOString()
    };
  } catch {
    return null;
  }
}

function needsGeocoding(client) {
  if (client.__geo?.source !== "city") return false;
  if (geocodeCache[geocodeKey(client)]) return false;
  return Boolean(geocodeQuery(client));
}

function geocodeFeatureAllowed(client, feature) {
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return false;
  const point = [Number(coords[1]), Number(coords[0])];
  if (!insideAra(point)) return false;

  const city = normalizeCity(client.city);
  if (!hasDeclaredCity(city)) return false;

  const props = feature.properties || {};
  const resultCities = extractCities(props).map((item) => normalizeCity(item));
  const cityMatches = resultCities.some((item) => sameCity(city, item));
  const cityCenter = CITY_COORDS[city];
  const nearDeclaredCity = cityCenter ? metersBetween(point, cityCenter) <= cityTolerance(city) : false;
  if (!cityMatches && !nearDeclaredCity) return false;

  if (!client.address) {
    const resultName = [props.label, props.name, props.toponym].flat().filter(Boolean).join(" ");
    const nameScore = tokenSimilarity(client.enterprise_name, resultName);
    const score = Number(props.score ?? props._score ?? 0);
    if (nameScore < 0.28 && score < 0.62) return false;
  }

  return true;
}

function resolveClientCoords(client) {
  const key = clientKey(client);
  if (manualCoords[key]) {
    const coords = normalizeCoordPair(Number(manualCoords[key].lat), Number(manualCoords[key].lng));
    if (validCoords(coords) && insideAra(coords)) return { coords, source: "manual", label: manualCoords[key].label };
  }
  const dbLocation = databaseLocation(client);
  if (dbLocation) return dbLocation;
  const cached = geocodeCache[geocodeKey(client)];
  if (cached?.coords) return guardDeclaredCity(client, { ...cached, source: "geocode" });
  return null;
}

function sanitizeGeo(geo) {
  if (!geo?.coords) return null;
  const coords = normalizeCoordPair(Number(geo.coords[0]), Number(geo.coords[1]));
  if (!validCoords(coords) || !insideAra(coords)) return null;
  return { ...geo, coords };
}

function guardDeclaredCity(client, geo) {
  if (!geo?.coords || geo.source === "manual") return geo;
  const city = normalizeCity(client.city);
  const cityCenter = CITY_COORDS[city];
  if (!cityCenter) return geo;
  const distance = metersBetween(geo.coords, cityCenter);
  if (distance <= Math.max(25000, cityTolerance(city))) return geo;
  return {
    coords: cityFallback(client),
    source: "city",
    label: `${city} · position automatique rejetée`
  };
}

function saveManualPosition(client, coords, label) {
  coords = normalizeCoordPair(Number(coords[0]), Number(coords[1]));
  if (!validCoords(coords) || !insideAra(coords)) return;
  const key = clientKey(client);
  manualCoords[key] = {
    lat: coords[0],
    lng: coords[1],
    label,
    savedAt: new Date().toISOString()
  };
  writeStore(MANUAL_COORDS_KEY, manualCoords);
  const cached = findCachedClient(client);
  if (cached) {
    cached.__geo = { coords, source: "manual", label };
    drawMarkers(selectClientCallback);
    publishGeoStatus();
  }
}

function databaseLocation(client) {
  const manual = coordsFrom(client, ["manual_lat"], ["manual_lng"]);
  if (manual && insideAra(manual)) return { coords: manual, source: "manual", label: client.manual_location_source || "Supabase terrain" };
  const web = coordsFrom(client, ["web_lat"], ["web_lng"]);
  if (web && insideAra(web)) {
    return {
      coords: web,
      source: "web",
      label: client.web_location_label || "localisation web",
      confidence: Number(client.web_location_confidence),
      sourceName: client.web_location_source || ""
    };
  }
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

function normalizeCoordPair(lat, lng) {
  const coords = [lat, lng];
  if (!validCoords(coords)) return coords;
  const swapped = [lng, lat];
  if (!insideAra(coords) && insideAra(swapped)) return swapped;
  return coords;
}

function cityFallback(client) {
  const base = CITY_COORDS[normalizeCity(client.city)] || LYON_SUD;
  const seed = hash(clientKey(client));
  const jitterLat = ((seed % 1000) / 1000 - 0.5) * 0.008;
  const jitterLng = (((seed / 1000) % 1000) / 1000 - 0.5) * 0.01;
  return [base[0] + jitterLat, base[1] + jitterLng];
}

function geocodeQuery(client) {
  const address = clean(client.address);
  const city = clean(client.city);
  const name = clean(client.enterprise_name);
  if (!hasDeclaredCity(city)) return "";
  if (address && city) return `${address} ${city} Auvergne-Rhône-Alpes France`;
  if (name && city) return `${name} ${city} Auvergne-Rhône-Alpes France`;
  return "";
}

function normalizeCity(city = "") {
  const cleanCity = city.trim();
  const comparable = cityComparable(cleanCity);
  if (!comparable || comparable === "inconnue" || comparable === "unknown") return "";
  if (comparable.includes("lyon 7")) return "Lyon 7e";
  return Object.keys(CITY_COORDS).find((name) => cityComparable(name) === comparable) || cleanCity;
}

function isKnownCity(city = "") {
  return Boolean(CITY_COORDS[normalizeCity(city)]);
}

function hasDeclaredCity(city = "") {
  return Boolean(normalizeCity(city));
}

function insideAra(coords) {
  return coords[0] >= ARA_BOUNDS.minLat && coords[0] <= ARA_BOUNDS.maxLat && coords[1] >= ARA_BOUNDS.minLng && coords[1] <= ARA_BOUNDS.maxLng;
}

function extractCities(props) {
  return [props.city, props.city_name, props.municipality, props.context].flat().filter(Boolean);
}

function sameCity(a, b) {
  const left = cityComparable(a).replace(/\barrondissement\b/g, "").trim();
  const right = cityComparable(b).replace(/\barrondissement\b/g, "").trim();
  return Boolean(left && right && (left === right || right.includes(left) || left.includes(right)));
}

function cityComparable(value = "") {
  return normalizeText(value)
    .replace(/\bst\b/g, "saint")
    .replace(/\bste\b/g, "sainte")
    .replace(/\bsainte?\s+etienne\b/g, "saint etienne")
    .trim();
}

function cityTolerance(city) {
  if (normalizeCity(city).startsWith("Lyon")) return 9000;
  return 12000;
}

function tokenSimilarity(a = "", b = "") {
  const left = new Set(normalizeText(a).split(/\s+/).filter((token) => token.length > 2));
  const right = new Set(normalizeText(b).split(/\s+/).filter((token) => token.length > 2));
  if (!left.size || !right.size) return 0;
  let hits = 0;
  for (const token of left) if (right.has(token)) hits += 1;
  return hits / Math.max(left.size, right.size);
}

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function applyZoomClass() {
  if (!map) return;
  const container = map.getContainer();
  container.classList.toggle("map-zoom-far", map.getZoom() < 13);
  container.classList.toggle("map-zoom-mid", map.getZoom() >= 13 && map.getZoom() < 15);
  container.classList.toggle("map-zoom-close", map.getZoom() >= 15);
}

function setUserMarker(coords) {
  if (!map || !validGpsCoords(coords)) return;
  if (!userMarker) {
    userMarker = L.circleMarker(coords, {
      radius: 9,
      color: "#00c8f0",
      fillColor: "#00c8f0",
      fillOpacity: 0.84,
      weight: 2
    }).addTo(map);
    return;
  }
  userMarker.setLatLng(coords);
}

function removeUserMarker() {
  if (!userMarker) return;
  userMarker.remove();
  userMarker = null;
  userCoords = null;
}

function publishGeoStatus() {
  geoStatusCallback(getGeoSummary());
}

function sourceBadge(source) {
  if (source === "manual") return "G";
  if (source === "web") return "W";
  if (source === "database") return "B";
  if (source === "geocode") return "✓";
  return "?";
}

function heatClass(client) {
  if (client.signed_client) return "heat-signed";
  return `heat-${client.heat_level || "froid"}`;
}

function confidenceClass(client) {
  if (client.__geo?.source !== "web") return "";
  const confidence = Number(client.__geo.confidence);
  if (!Number.isFinite(confidence)) return "";
  if (confidence <= 0) return "geo-placeholder";
  if (confidence < 0.5) return "geo-low";
  return "";
}

function heatWeight(client) {
  if (client.signed_client) return 5;
  return { "tres-chaud": 4, chaud: 3, tiede: 2, froid: 1 }[client.heat_level] || 1;
}

function markerLabel(client) {
  const firstName = (client.contact_name || "").trim().split(/\s+/)[0];
  return [firstName, client.enterprise_name].filter(Boolean).join(" · ") || "Client";
}

function shouldAlert(client) {
  return client.signed_client || ["tres-chaud", "chaud"].includes(client.heat_level) || client.machine_status === "nouveau";
}

function findCachedClient(client) {
  const key = clientKey(client);
  return clientsCache.find((item) => clientKey(item) === key);
}

function clientKey(client) {
  return String(client.id || `${client.enterprise_name || ""}-${client.city || ""}-${client.address || ""}`);
}

function geocodeKey(client) {
  return `${clientKey(client)}:${hash(geocodeQuery(client))}`;
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
        if (!validGpsCoords(coords)) {
          reject(new Error("GPS invalide"));
          return;
        }
        resolve(coords);
      },
      reject,
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 15000 }
    );
  });
}

function validCoords(coords) {
  return Array.isArray(coords)
    && coords.length >= 2
    && Number.isFinite(Number(coords[0]))
    && Number.isFinite(Number(coords[1]))
    && Math.abs(Number(coords[0])) <= 90
    && Math.abs(Number(coords[1])) <= 180;
}

export function clearInvalidLocalPositions() {
  const removed = purgeInvalidLocalPositions();
  clientsCache = clientsCache.map((client) => ({ ...client, __geo: resolveClientCoords(client) }));
  drawMarkers(selectClientCallback);
  publishGeoStatus();
  fitAllClients();
  return removed;
}

function purgeInvalidLocalPositions() {
  let removed = 0;
  for (const [key, value] of Object.entries(manualCoords)) {
    const coords = normalizeCoordPair(Number(value.lat), Number(value.lng));
    if (!validCoords(coords) || !insideAra(coords)) {
      delete manualCoords[key];
      removed += 1;
    }
  }
  if (removed) writeStore(MANUAL_COORDS_KEY, manualCoords);
  return removed;
}

function validGpsCoords(coords) {
  if (!validCoords(coords)) return false;
  return !(Math.abs(Number(coords[0])) < 0.0001 && Math.abs(Number(coords[1])) < 0.0001);
}

function metersBetween(a, b) {
  const radius = 6371000;
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function hash(value) {
  let result = 0;
  const input = String(value || "");
  for (let i = 0; i < input.length; i += 1) {
    result = (result << 5) - result + input.charCodeAt(i);
    result |= 0;
  }
  return Math.abs(result);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clean(value) {
  return String(value || "").trim();
}

function readStore(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
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
