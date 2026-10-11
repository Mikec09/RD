import {
  buildContacts,
  buildLineGraph,
  chooseRangeSeconds,
  formatEta,
  layoutLabels,
  project,
  ringMinutes,
  shortStation,
} from "./lib.js";

const PRESETS = [
  ["940GZZLUKSX", "King's Cross"],
  ["940GZZLUOXC", "Oxford Circus"],
  ["940GZZLUBNK", "Bank"],
  ["940GZZLUWLO", "Waterloo"],
  ["940GZZLUVIC", "Victoria"],
  ["940GZZLULSQ", "Leicester Sq"],
];

const REFRESH_MS = 30000;
const TAU = Math.PI * 2;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const els = {
  input: document.getElementById("station-input"),
  form: document.getElementById("search-form"),
  results: document.getElementById("results"),
  stationName: document.getElementById("station-name"),
  stationMeta: document.getElementById("station-meta"),
  canvas: document.getElementById("scope"),
  wrap: document.getElementById("scope-wrap"),
  list: document.getElementById("contact-list"),
  count: document.getElementById("contact-count"),
  status: document.getElementById("status"),
  refresh: document.getElementById("refresh"),
  chips: document.getElementById("chips"),
  ranges: document.querySelectorAll(".ranges button"),
};

const state = {
  station: null,
  contacts: [],
  fetchedAt: 0,
  error: "",
  loading: false,
  rangeMode: "auto",
  hoverId: null,
  lockedId: null,
  sweep: 0,
  hits: [],
  graphs: new Map(),
  graphPromises: new Map(),
};

let loadToken = 0;
let searchToken = 0;
let resultIndex = -1;
let lastListPaint = 0;

function appKey() {
  return window.TFL_CONFIG?.appKey || "";
}

async function tfl(path) {
  const key = appKey();
  const join = path.includes("?") ? "&" : "?";
  const url = `https://api.tfl.gov.uk${path}${key ? `${join}app_key=${encodeURIComponent(key)}` : ""}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = `TfL ${response.status}`;
    try {
      const body = JSON.parse(text);
      if (body.message) detail = body.message;
    } catch {
      /* status is enough */
    }
    throw new Error(detail);
  }
  if (!text) return [];
  return JSON.parse(text);
}

function tubeMetros(data) {
  const found = [];
  const seen = new Set();
  const consider = (record) => {
    if (!record?.id || seen.has(record.id)) return;
    const modes = record.modes || [];
    if (!modes.includes("tube")) return;
    if (record.stopType !== "NaptanMetroStation" && !String(record.id).startsWith("940GZZLU")) return;
    seen.add(record.id);
    found.push(record);
  };
  if (data.stopType === "NaptanMetroStation") consider(data);
  for (const child of data.children || []) consider(child);
  return found;
}

function toStation(record, fallback) {
  const lat = record.lat ?? fallback?.lat;
  const lon = record.lon ?? fallback?.lon;
  if (lat == null || lon == null) return null;
  return {
    id: record.id,
    name: record.commonName || record.name || record.id,
    lat,
    lon,
  };
}

async function resolveStation(id) {
  const data = await tfl(`/StopPoint/${encodeURIComponent(id)}`);
  if (!data || data.httpStatusCode || !data.id) {
    throw new Error(data?.message || "Station not found");
  }
  const tubes = tubeMetros(data);
  const exact = tubes.find((station) => station.id === id);
  if (exact) {
    const station = toStation(exact, data);
    if (station) return station;
  }
  if (tubes.length === 1) {
    const station = toStation(tubes[0], data);
    if (station) return station;
  }
  if (tubes.length > 1) {
    const options = tubes.map((station) => toStation(station, data)).filter(Boolean);
    if (options.length > 1) return { ambiguous: true, options };
    if (options.length === 1) return options[0];
  }
  const self = toStation(data, data);
  if (self && (data.modes || []).includes("tube")) return self;
  throw new Error("No tube station for that stop");
}

function setStatus(text) {
  els.status.textContent = text;
}

function liveEta(contact, now = Date.now()) {
  if (!state.fetchedAt) return contact.eta;
  const elapsed = (now - state.fetchedAt) / 1000;
  // rAF timestamps are not wall-clock milliseconds. Ignore a clock that cannot be a refresh age.
  if (!Number.isFinite(elapsed) || elapsed < -2 || elapsed > 60 * 30) return contact.eta;
  return Math.max(0, contact.eta - elapsed);
}

function currentRange() {
  if (state.rangeMode === "auto") return chooseRangeSeconds(state.contacts.map((contact) => contact.eta));
  return state.rangeMode;
}

function setUrl(id, push) {
  const url = new URL(location.href);
  url.searchParams.set("station", id);
  const data = { id };
  if (push) history.pushState(data, "", url);
  else history.replaceState(data, "", url);
}

async function ensureGraphs(predictions, token) {
  const lineIds = [...new Set(predictions.map((item) => item.lineId).filter(Boolean))];
  await Promise.all(lineIds.map(async (lineId) => {
    if (state.graphs.has(lineId)) return;
    if (!state.graphPromises.has(lineId)) {
      state.graphPromises.set(lineId, tfl(`/Line/${encodeURIComponent(lineId)}/Route/Sequence/all`)
        .then((data) => {
          const graph = buildLineGraph(data);
          state.graphs.set(lineId, graph);
          return graph;
        })
        .catch(() => {
          state.graphPromises.delete(lineId);
          return null;
        }));
    }
    await state.graphPromises.get(lineId);
    if (token !== loadToken) return;
  }));
}

async function pullArrivals(token) {
  const station = state.station;
  if (!station) return;
  state.loading = true;
  state.error = "";
  setStatus(`ACQUIRING ${shortStation(station.name).toUpperCase()}…`);
  try {
    const arrivals = await tfl(`/StopPoint/${encodeURIComponent(station.id)}/Arrivals`);
    if (token !== loadToken) return;
    const list = Array.isArray(arrivals) ? arrivals : [];
    await ensureGraphs(list, token);
    if (token !== loadToken) return;
    state.fetchedAt = Date.now();
    state.contacts = buildContacts(list, station, state.graphs);
    state.loading = false;
    renderList();
    renderReadout();
    paintStatus();
  } catch (error) {
    if (token !== loadToken) return;
    state.loading = false;
    state.error = error.name === "TimeoutError" ? "TfL timed out" : error.message;
    setStatus(`LINK LOST — ${state.error}`);
    renderList();
  }
}

async function loadStation(id, { push = false } = {}) {
  const token = ++loadToken;
  state.loading = true;
  state.error = "";
  state.contacts = [];
  state.lockedId = null;
  state.hoverId = null;
  els.stationName.textContent = "ACQUIRING…";
  els.stationMeta.textContent = "";
  renderList();
  setStatus("RESOLVING STATION…");
  try {
    const resolved = await resolveStation(id);
    if (token !== loadToken) return;
    if (resolved.ambiguous) {
      state.loading = false;
      showOptions(resolved.options, "MORE THAN ONE TUBE STATION");
      setStatus("CHOOSE A STATION");
      els.stationName.textContent = "SELECT STATION";
      return;
    }
    state.station = resolved;
    document.title = `Tube Radar — ${shortStation(resolved.name)}`;
    if (document.activeElement !== els.input) els.input.value = shortStation(resolved.name);
    setUrl(resolved.id, push);
    markChips();
    renderReadout();
    await pullArrivals(token);
  } catch (error) {
    if (token !== loadToken) return;
    state.loading = false;
    state.error = error.message;
    els.stationName.textContent = "NO FIX";
    setStatus(`LINK LOST — ${error.message}`);
  }
}

function renderReadout() {
  if (!state.station) return;
  els.stationName.textContent = shortStation(state.station.name);
  const lines = [...new Set(state.contacts.map((contact) => contact.code))];
  const rangeMin = Math.round(currentRange() / 60);
  els.stationMeta.textContent = lines.length
    ? `${lines.join("  ")}  ·  RANGE ${rangeMin} MIN`
    : "NO TUBE TRAINS IN THE FEED";
}

function paintStatus() {
  if (state.error) {
    setStatus(`LINK LOST — ${state.error}`);
    return;
  }
  if (!state.fetchedAt) return;
  const age = Math.max(0, Math.round((Date.now() - state.fetchedAt) / 1000));
  const next = Math.max(0, Math.ceil((REFRESH_MS - (Date.now() - state.fetchedAt)) / 1000));
  const count = state.contacts.length;
  setStatus(`${count} CONTACT${count === 1 ? "" : "S"}  ·  DATA ${age}s  ·  NEXT ${next}s`);
}

function renderList() {
  const now = Date.now();
  const scroll = els.list.scrollTop;
  els.count.textContent = state.contacts.length ? String(state.contacts.length).padStart(2, "0") : "00";
  els.list.replaceChildren();
  if (!state.contacts.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = state.loading
      ? "ACQUIRING CONTACTS…"
      : state.error
        ? "NO CONTACTS — LINK LOST"
        : "NO TRAINS IN RANGE. NIGHT SERVICE, OR THE LINE IS QUIET.";
    els.list.append(empty);
    return;
  }
  for (const contact of state.contacts) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "contact";
    button.dataset.id = contact.id;
    if (contact.nearest) button.classList.add("is-nearest");
    if (contact.id === state.lockedId) button.classList.add("is-locked");
    if (contact.id === state.hoverId) button.classList.add("is-hover");
    const eta = formatEta(liveEta(contact, now));
    const from = contact.approachName ? `FROM ${contact.approachName.toUpperCase()}` : "TRACK ESTIMATED";
    const where = [contact.platform, contact.location].filter(Boolean).join(" · ");
    button.innerHTML = `
      <div class="contact-top">
        <span class="eta" data-eta>${eta}</span>
        <span class="code">${contact.code}</span>
        <span class="dest">${escapeHtml(contact.destination)}</span>
      </div>
      <div class="meta">${contact.nearest ? '<span class="pulse-dot" aria-hidden="true"></span><span class="nearest-tag">NEAREST</span> · ' : ""}${escapeHtml(from)}${where ? ` · ${escapeHtml(where)}` : ""}</div>
    `;
    button.addEventListener("click", () => {
      state.lockedId = state.lockedId === contact.id ? null : contact.id;
      renderList();
    });
    button.addEventListener("mouseenter", () => {
      state.hoverId = contact.id;
      button.classList.add("is-hover");
    });
    button.addEventListener("mouseleave", () => {
      if (state.hoverId === contact.id) state.hoverId = null;
      button.classList.remove("is-hover");
    });
    item.append(button);
    els.list.append(item);
  }
  els.list.scrollTop = scroll;
}

function tickEtas() {
  const now = Date.now();
  for (const button of els.list.querySelectorAll(".contact")) {
    const contact = state.contacts.find((item) => item.id === button.dataset.id);
    const slot = button.querySelector("[data-eta]");
    if (contact && slot) slot.textContent = formatEta(liveEta(contact, now));
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showResults(matches, note) {
  els.results.replaceChildren();
  resultIndex = -1;
  if (note) {
    const item = document.createElement("li");
    item.className = "results-note";
    item.textContent = note;
    els.results.append(item);
  }
  if (!matches.length) {
    const item = document.createElement("li");
    item.className = "results-note";
    item.textContent = "NO TUBE STATIONS";
    els.results.append(item);
    els.results.hidden = false;
    return;
  }
  matches.forEach((match, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.role = "option";
    button.dataset.index = String(index);
    button.textContent = shortStation(match.name);
    button.addEventListener("click", () => {
      hideResults();
      loadStation(match.id, { push: true });
    });
    item.append(button);
    els.results.append(item);
  });
  els.results.hidden = false;
}

function showOptions(options, note) {
  showResults(options.map((station) => ({ id: station.id, name: station.name })), note);
  els.input.focus();
}

function hideResults() {
  els.results.hidden = true;
  resultIndex = -1;
}

function moveResult(delta) {
  const buttons = [...els.results.querySelectorAll("button")];
  if (!buttons.length || els.results.hidden) return;
  resultIndex = Math.max(0, Math.min(buttons.length - 1, resultIndex + delta));
  buttons.forEach((button, index) => {
    button.setAttribute("aria-selected", index === resultIndex ? "true" : "false");
  });
  buttons[resultIndex].scrollIntoView({ block: "nearest" });
}

let searchTimer = 0;
function scheduleSearch() {
  window.clearTimeout(searchTimer);
  const query = els.input.value.trim();
  if (query.length < 2) {
    hideResults();
    return;
  }
  searchTimer = window.setTimeout(() => runSearch(query), 220);
}

async function runSearch(query) {
  const token = ++searchToken;
  try {
    const data = await tfl(`/StopPoint/Search/${encodeURIComponent(query)}?modes=tube&maxResults=8`);
    if (token !== searchToken) return;
    const matches = (data.matches || []).filter((match) => (match.modes || []).includes("tube") || String(match.id).startsWith("HUB"));
    showResults(matches.slice(0, 8));
  } catch (error) {
    if (token !== searchToken) return;
    showResults([], error.message);
  }
}

function markChips() {
  for (const button of els.chips.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", button.dataset.id === state.station?.id ? "true" : "false");
  }
}

function buildChips() {
  for (const [id, label] of PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.dataset.id = id;
    button.textContent = label.toUpperCase();
    button.addEventListener("click", () => loadStation(id, { push: true }));
    els.chips.append(button);
  }
}

function resize() {
  const rect = els.canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (els.canvas.width !== width || els.canvas.height !== height) {
    els.canvas.width = width;
    els.canvas.height = height;
  }
  return { dpr, css: rect.width };
}

function markerDestination(name) {
  if (name.length <= 18) return name;
  return `${name.slice(0, 17)}…`;
}

function illumination(bearing, sweep) {
  let delta = sweep - bearing;
  delta = ((delta % TAU) + TAU) % TAU;
  if (delta < 0.05) return 1;
  return Math.exp(-delta / 1.15);
}

function draw(now) {
  const { dpr, css } = resize();
  const ctx = els.canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const size = css;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 28;
  ctx.clearRect(0, 0, size, size);

  if (!reduceMotion) state.sweep = (now / 1000) * 0.65;
  else if (state.contacts.some((contact) => contact.nearest)) {
    state.sweep = state.contacts.find((contact) => contact.nearest).bearing;
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 8, 0, TAU);
  ctx.clip();

  const glow = ctx.createRadialGradient(cx, cy, radius * 0.05, cx, cy, radius);
  glow.addColorStop(0, "rgba(40, 120, 70, 0.28)");
  glow.addColorStop(0.6, "rgba(10, 50, 28, 0.12)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  const clock = Date.now();
  const range = currentRange();
  ctx.strokeStyle = "rgba(130, 255, 170, 0.18)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "rgba(180, 255, 200, 0.55)";
  ctx.font = "11px Share Tech Mono, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const minutes of ringMinutes(range)) {
    const radial = 0.1 + (minutes * 60) / range * 0.82;
    const ring = radial * radius;
    ctx.beginPath();
    ctx.arc(cx, cy, ring, 0, TAU);
    ctx.stroke();
    if (ring >= 36) ctx.fillText(`${minutes}m`, cx - 6, cy - ring);
  }

  ctx.strokeStyle = "rgba(130, 255, 170, 0.16)";
  ctx.beginPath();
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.stroke();

  ctx.strokeStyle = "rgba(150, 255, 180, 0.45)";
  for (let deg = 0; deg < 360; deg += 10) {
    const rad = (deg * Math.PI) / 180;
    const inner = deg % 30 === 0 ? radius - 10 : radius - 5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(rad) * inner, cy - Math.cos(rad) * inner);
    ctx.lineTo(cx + Math.sin(rad) * radius, cy - Math.cos(rad) * radius);
    ctx.stroke();
  }

  const spokes = new Map();
  for (const contact of state.contacts) {
    const key = contact.approachId || contact.bearing.toFixed(2);
    if (!spokes.has(key)) spokes.set(key, contact.bearing);
  }
  ctx.strokeStyle = "rgba(120, 220, 150, 0.09)";
  for (const bearing of spokes.values()) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(bearing) * radius, cy - Math.cos(bearing) * radius);
    ctx.stroke();
  }

  if (!reduceMotion) {
    const span = 0.9;
    const steps = 22;
    for (let i = 0; i < steps; i += 1) {
      const start = state.sweep - span * (1 - i / steps);
      const end = state.sweep - span * (1 - (i + 1) / steps);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start - Math.PI / 2, end - Math.PI / 2);
      ctx.closePath();
      ctx.fillStyle = `rgba(120, 255, 170, ${0.012 + 0.09 * (i / steps)})`;
      ctx.fill();
    }
  }
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.sin(state.sweep) * radius, cy - Math.cos(state.sweep) * radius);
  ctx.strokeStyle = "rgba(210, 255, 220, 0.75)";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.restore();

  const plotted = state.contacts.map((contact) => {
    const eta = liveEta(contact, clock);
    const pos = project(contact.bearing, eta, range);
    const x = cx + pos.east * radius;
    const y = cy - pos.north * radius;
    const out = Math.hypot(pos.east, pos.north) || 1;
    return {
      contact,
      x,
      y,
      limited: pos.limited,
      eta,
      outX: pos.east / out,
      outY: -pos.north / out,
      tangX: pos.north / out,
      tangY: pos.east / out,
    };
  });

  const labels = layoutLabels(
    plotted.map((item) => ({
      id: item.contact.id,
      x: item.x,
      y: item.y,
      outX: item.outX,
      outY: item.outY,
      tangX: item.tangX,
      tangY: item.tangY,
      destination: markerDestination(item.contact.destination),
      code: item.contact.code,
      etaText: formatEta(item.eta),
      liveEta: item.eta,
      nearest: item.contact.nearest,
      locked: item.contact.id === state.lockedId,
      hover: item.contact.id === state.hoverId,
      lead: item.contact.lead,
    })),
    { cx, cy, radius },
    (text, px) => {
      ctx.font = `${px}px Share Tech Mono, monospace`;
      return ctx.measureText(text).width;
    },
  );

  state.hits = [];
  const drawOrder = [...plotted].sort((a, b) => Number(a.contact.nearest) - Number(b.contact.nearest));
  for (const item of drawOrder) {
    const lit = reduceMotion ? 1 : illumination(item.contact.bearing, state.sweep);
    const bright = item.contact.nearest ? Math.max(lit, 0.72) : 0.28 + lit * 0.72;
    drawContact(ctx, item, bright, now);
    const label = labels.get(item.contact.id);
    if (label?.show) drawLabel(ctx, item, label, bright);
    state.hits.push({
      id: item.contact.id,
      x: item.x,
      y: item.y,
      box: label?.show ? label : null,
    });
  }

  drawCentre(ctx, cx, cy, radius);

  ctx.fillStyle = "rgba(190, 255, 210, 0.8)";
  ctx.font = "12px Share Tech Mono, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cards = [["N", 0], ["E", 1], ["S", 2], ["W", 3]];
  for (const [letter, index] of cards) {
    const angle = index * (Math.PI / 2);
    ctx.fillText(letter, cx + Math.sin(angle) * (radius + 16), cy - Math.cos(angle) * (radius + 16));
  }

  if (!state.contacts.length) {
    ctx.fillStyle = "rgba(190, 255, 210, 0.8)";
    ctx.font = "13px Share Tech Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(state.loading ? "ACQUIRING" : state.error ? "LINK LOST" : "SCOPE CLEAR", cx, cy + 46);
  }
}

function drawCentre(ctx, cx, cy, radius) {
  ctx.save();
  ctx.strokeStyle = "rgba(214, 255, 140, 0.9)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, TAU);
  ctx.moveTo(cx - 11, cy);
  ctx.lineTo(cx - 4, cy);
  ctx.moveTo(cx + 4, cy);
  ctx.lineTo(cx + 11, cy);
  ctx.moveTo(cx, cy - 11);
  ctx.lineTo(cx, cy - 4);
  ctx.moveTo(cx, cy + 4);
  ctx.lineTo(cx, cy + 11);
  ctx.stroke();
  ctx.fillStyle = "rgba(190, 255, 210, 0.78)";
  ctx.font = "11px Share Tech Mono, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  let caption = state.station ? shortStation(state.station.name).toUpperCase() : "NO STATION";
  const maxWidth = Math.max(80, radius * 0.7);
  while (caption.length > 10 && ctx.measureText(caption).width > maxWidth) {
    caption = `${caption.slice(0, -2).trimEnd()}…`;
  }
  ctx.fillText(caption, cx, cy + 14);
  ctx.restore();
}

function drawContact(ctx, item, bright, now) {
  const { x, y, contact } = item;
  const size = contact.nearest ? 6.5 : 4.2;
  ctx.save();
  ctx.globalAlpha = Math.max(0.35, bright);
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = "#d8ffc8";
  ctx.shadowColor = "rgba(140, 255, 170, 0.95)";
  ctx.shadowBlur = contact.nearest ? 16 : 8;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = contact.color;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-size / 2 - 1.5, -size / 2 - 1.5, size + 3, size + 3);
  ctx.restore();

  if (item.limited) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(item.outY, item.outX));
    ctx.strokeStyle = `rgba(214, 255, 140, ${bright})`;
    ctx.beginPath();
    ctx.moveTo(8, -3);
    ctx.lineTo(12, 0);
    ctx.lineTo(8, 3);
    ctx.stroke();
    ctx.restore();
  }

  if (contact.nearest) {
    for (let i = 0; i < 3; i += 1) {
      const t = reduceMotion ? 0.35 + i * 0.2 : ((now / 1400) + i / 3) % 1;
      ctx.beginPath();
      ctx.arc(x, y, 8 + t * 36, 0, TAU);
      ctx.strokeStyle = `rgba(214, 255, 120, ${0.8 * (1 - t)})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }
}

function drawLabel(ctx, item, label, bright) {
  const nearest = item.contact.nearest;
  ctx.save();
  ctx.globalAlpha = nearest ? 1 : Math.max(0.55, bright);
  ctx.beginPath();
  ctx.moveTo(item.x, item.y);
  const anchorX = label.alignRight ? label.r : label.l;
  const anchorY = (label.t + label.b) / 2;
  ctx.lineTo(anchorX, anchorY);
  ctx.strokeStyle = nearest ? "rgba(214, 255, 106, 0.8)" : "rgba(140, 255, 170, 0.45)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = nearest ? "rgba(18, 36, 12, 0.9)" : "rgba(3, 16, 10, 0.82)";
  ctx.strokeStyle = nearest ? "rgba(214, 255, 106, 0.95)" : "rgba(140, 255, 170, 0.55)";
  ctx.lineWidth = nearest ? 1.4 : 1;
  ctx.beginPath();
  ctx.roundRect(label.l, label.t, label.r - label.l, label.b - label.t, 2);
  ctx.fill();
  ctx.stroke();

  if (nearest) drawBrackets(ctx, label);

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = nearest ? "#f3ffc4" : "#d9ffe4";
  ctx.font = "13px Share Tech Mono, monospace";
  ctx.fillText(markerDestination(item.contact.destination), label.l + 6, label.t + 3);
  ctx.font = "11px Share Tech Mono, monospace";
  ctx.fillStyle = nearest ? "#d6ff6a" : "rgba(180, 255, 200, 0.8)";
  ctx.fillText(`${item.contact.code}  ${formatEta(item.eta)}`, label.l + 6, label.t + 17);
  ctx.restore();
}

function drawBrackets(ctx, box) {
  const arm = 7;
  ctx.strokeStyle = "#d6ff6a";
  ctx.lineWidth = 1.4;
  const corners = [
    [box.l - 2, box.t - 2, 1, 1],
    [box.r + 2, box.t - 2, -1, 1],
    [box.l - 2, box.b + 2, 1, -1],
    [box.r + 2, box.b + 2, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x, y + sy * arm);
    ctx.lineTo(x, y);
    ctx.lineTo(x + sx * arm, y);
    ctx.stroke();
  }
}

function eventPoint(event) {
  const rect = els.canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function hitTest(point) {
  const { css } = { css: els.canvas.getBoundingClientRect().width };
  const radius = css / 2 - 28;
  if (Math.hypot(point.x - css / 2, point.y - css / 2) > radius + 8) return null;
  for (let i = state.hits.length - 1; i >= 0; i -= 1) {
    const hit = state.hits[i];
    if (hit.box && point.x >= hit.box.l && point.x <= hit.box.r && point.y >= hit.box.t && point.y <= hit.box.b) {
      return hit;
    }
    if (Math.hypot(point.x - hit.x, point.y - hit.y) <= 14) return hit;
  }
  return null;
}

function highlightOnly(id) {
  for (const button of els.list.querySelectorAll(".contact")) {
    button.classList.toggle("is-hover", button.dataset.id === id);
  }
}

function frame(now) {
  draw(now);
  if (now - lastListPaint > 500) {
    tickEtas();
    paintStatus();
    lastListPaint = now;
  }
  requestAnimationFrame(frame);
}

function bind() {
  buildChips();
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const selected = els.results.querySelector('[aria-selected="true"]');
    if (selected) {
      selected.click();
      return;
    }
    const first = els.results.querySelector("button");
    if (first && !els.results.hidden) {
      first.click();
      return;
    }
    const query = els.input.value.trim();
    if (query) runSearch(query);
  });
  els.input.addEventListener("input", scheduleSearch);
  els.input.addEventListener("focus", () => els.input.select());
  els.input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveResult(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveResult(-1);
    } else if (event.key === "Escape") {
      hideResults();
    }
  });
  document.addEventListener("click", (event) => {
    if (!els.form.contains(event.target)) hideResults();
  });
  els.refresh.addEventListener("click", () => {
    if (state.station) pullArrivals(loadToken);
  });
  for (const button of els.ranges) {
    button.addEventListener("click", () => {
      const value = button.dataset.range;
      state.rangeMode = value === "auto" ? "auto" : Number(value);
      for (const other of els.ranges) other.setAttribute("aria-pressed", other === button ? "true" : "false");
      renderReadout();
    });
  }
  els.canvas.addEventListener("mousemove", (event) => {
    const hit = hitTest(eventPoint(event));
    const id = hit?.id || null;
    if (id !== state.hoverId) {
      state.hoverId = id;
      els.canvas.style.cursor = id ? "pointer" : "crosshair";
      highlightOnly(id);
    }
  });
  els.canvas.addEventListener("mouseleave", () => {
    state.hoverId = null;
    highlightOnly(null);
  });
  els.canvas.addEventListener("click", (event) => {
    const hit = hitTest(eventPoint(event));
    state.lockedId = hit && state.lockedId === hit.id ? null : hit?.id || null;
    renderList();
    if (state.lockedId) {
      document.querySelector(`.contact[data-id="${CSS.escape(state.lockedId)}"]`)?.scrollIntoView({ block: "nearest" });
    }
  });
  window.addEventListener("popstate", () => {
    const id = new URLSearchParams(location.search).get("station");
    if (id && id !== state.station?.id) loadStation(id, { push: false });
  });
  window.addEventListener("resize", () => resize());
  setInterval(() => {
    if (state.station && !state.loading) pullArrivals(loadToken);
  }, REFRESH_MS);
}

function boot() {
  bind();
  const params = new URLSearchParams(location.search);
  const requested = params.get("station") || "940GZZLUKSX";
  loadStation(requested, { push: false });
  requestAnimationFrame(frame);
}

boot();
