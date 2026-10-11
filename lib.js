// Pure plotting logic for the tube radar. No DOM, so it can be tested in Node.

export const LINE_CODE = {
  bakerloo: "BAK",
  central: "CEN",
  circle: "CIR",
  district: "DIS",
  "hammersmith-city": "H&C",
  jubilee: "JUB",
  metropolitan: "MET",
  northern: "NOR",
  piccadilly: "PIC",
  victoria: "VIC",
  "waterloo-city": "W&C",
  elizabeth: "ELZ",
  dlr: "DLR",
};

export const LINE_COLOR = {
  bakerloo: "#B36305",
  central: "#E32017",
  circle: "#FFD300",
  district: "#00782A",
  "hammersmith-city": "#F3A9BB",
  jubilee: "#A0A5A9",
  metropolitan: "#9B0056",
  northern: "#E6E6E6",
  piccadilly: "#003688",
  victoria: "#0098D4",
  "waterloo-city": "#95CDBA",
  elizabeth: "#6950A1",
  dlr: "#00A4A7",
};

const APPROACH_FROM = { west: "east", east: "west", north: "south", south: "north" };

export function lineCode(lineId) {
  if (!lineId) return "—";
  return LINE_CODE[lineId] || String(lineId).slice(0, 3).toUpperCase();
}

export function lineColor(lineId) {
  return LINE_COLOR[lineId] || "#7dff9a";
}

export function normName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(underground|rail|dlr)\s+station\b/g, "")
    .replace(/\bunderground\b/g, "")
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function namesMatch(query, station) {
  if (!query || !station) return false;
  if (query === station) return true;
  if (station.startsWith(`${query} `)) return true;
  if (query.startsWith(`${station} `)) return true;
  return false;
}

export function findByName(stations, query) {
  const wanted = normName(query);
  if (!wanted) return null;
  let best = null;
  let bestScore = -1;
  for (const station of stations) {
    const name = normName(station.name);
    if (!name) continue;
    let score = -1;
    if (name === wanted) score = 3000 + name.length;
    else if (name.startsWith(`${wanted} `)) score = 2000 - name.length;
    else if (wanted.startsWith(`${name} `)) score = 1000 + name.length;
    if (score > bestScore) {
      best = station;
      bestScore = score;
    }
  }
  return best;
}

export function shortStation(name) {
  return String(name || "Station")
    .replace(/\s+Underground Station$/i, "")
    .replace(/\s+Rail Station$/i, "")
    .replace(/\s+DLR Station$/i, "")
    .replace(/\s*-\s*Underground$/i, "")
    .trim();
}

export function shortDestination(name) {
  if (!name) return "UNKNOWN";
  let text = String(name)
    .replace(/\s+Underground Station$/i, "")
    .replace(/\s+Rail Station$/i, "")
    .replace(/\s+DLR Station$/i, "")
    .replace(/\s*-\s*Underground$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^check (front of )?train$/i.test(text)) return "UNKNOWN";
  text = text.toUpperCase();
  if (text.length > 26) text = `${text.slice(0, 25)}…`;
  return text;
}

export function destinationOf(prediction) {
  const bad = /check front|check train|^unknown$/i;
  if (prediction.destinationName && !bad.test(prediction.destinationName)) {
    return shortDestination(prediction.destinationName);
  }
  if (prediction.towards && !bad.test(prediction.towards)) {
    return shortDestination(prediction.towards);
  }
  return "UNKNOWN";
}

export function formatEta(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  }
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

export function formatEtaCompact(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h`;
  if (minutes >= 1) return `${minutes}m`;
  return `${total}s`;
}

/** Clockwise radians from north. */
export function bearingRadians(from, to) {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const east = Math.sin(dLon) * Math.cos(lat2);
  const north =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return Math.atan2(east, north);
}

export function cardinalOfBearing(bearing) {
  const deg = ((bearing * 180) / Math.PI + 360) % 360;
  if (deg >= 315 || deg < 45) return "north";
  if (deg < 135) return "east";
  if (deg < 225) return "south";
  return "west";
}

export function platformCardinal(platformName) {
  const text = String(platformName || "").toLowerCase();
  if (text.includes("northbound")) return "north";
  if (text.includes("southbound")) return "south";
  if (text.includes("eastbound")) return "east";
  if (text.includes("westbound")) return "west";
  return null;
}

export function parseLocation(text) {
  const raw = String(text || "").trim();
  const between = /^(?:in )?between (.+?) and (.+)$/i.exec(raw);
  if (between) return { kind: "between", names: [cleanPlace(between[1]), cleanPlace(between[2])] };
  const left = /^left (.+?)(?:,|$)/i.exec(raw);
  if (left) return { kind: "left", names: [cleanPlace(left[1])] };
  const approaching = /^approaching (.+)$/i.exec(raw);
  if (approaching) return { kind: "approaching", names: [cleanPlace(approaching[1])] };
  const at = /^at (.+)$/i.exec(raw);
  if (at) return { kind: "at", names: [cleanPlace(at[1])] };
  return { kind: "unknown", names: [] };
}

function cleanPlace(value) {
  return String(value)
    .replace(/\b(?:plaform|platform)\b.*$/i, "")
    .replace(/\bheading\b.*$/i, "")
    .trim();
}

export function fallbackBearing(seed) {
  let hash = 2166136261;
  const text = String(seed);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 360) * (Math.PI / 180);
}

export function buildLineGraph(data) {
  const stations = [];
  const byId = new Map();

  const add = (raw) => {
    if (!raw) return null;
    const id = raw.id || raw.stationId;
    // Hubs sit on top of the real station and steal short name matches.
    if (!id || /^HUB/i.test(id)) return null;
    const existing = byId.get(id);
    if (existing) {
      if (raw.lat != null) existing.lat = raw.lat;
      if (raw.lon != null) existing.lon = raw.lon;
      if (raw.name && existing.name === id) existing.name = raw.name;
      return existing;
    }
    const station = {
      id,
      name: raw.name || raw.commonName || id,
      lat: raw.lat ?? null,
      lon: raw.lon ?? null,
    };
    byId.set(id, station);
    stations.push(station);
    return station;
  };

  for (const stop of data.stations || []) add(stop);

  const pred = { inbound: new Map(), outbound: new Map() };
  const routes = [];
  for (const sequence of data.stopPointSequences || []) {
    const dir = String(sequence.direction || "").toLowerCase();
    const stops = [];
    for (const raw of sequence.stopPoint || []) {
      const stop = add(raw);
      if (stop) stops.push(stop);
    }
    routes.push({ dir, stops });
    if (dir !== "inbound" && dir !== "outbound") continue;
    for (let i = 1; i < stops.length; i += 1) {
      const list = pred[dir].get(stops[i].id) || [];
      if (!list.some((item) => item.id === stops[i - 1].id)) list.push(stops[i - 1]);
      pred[dir].set(stops[i].id, list);
    }
  }

  return { lineId: data.lineId, lineName: data.lineName, stations, pred, routes };
}

function neighboursOf(graph, id) {
  const found = new Map();
  for (const dir of ["inbound", "outbound"]) {
    for (const prev of graph.pred[dir].get(id) || []) found.set(prev.id, prev);
    for (const [nextId, preds] of graph.pred[dir]) {
      if (!preds.some((prev) => prev.id === id)) continue;
      const next = graph.stations.find((station) => station.id === nextId);
      if (next) found.set(next.id, next);
    }
  }
  return found;
}

function isNeighbour(graph, id, otherId) {
  return neighboursOf(graph, id).has(otherId);
}

function destIsAhead(graph, dir, fromId, destId) {
  if (!destId) return false;
  return graph.routes.some((route) => {
    if (dir && route.dir !== dir) return false;
    const fromIndex = route.stops.findIndex((stop) => stop.id === fromId);
    const destIndex = route.stops.findIndex((stop) => stop.id === destId);
    return fromIndex >= 0 && destIndex > fromIndex;
  });
}

/**
 * The station the train is arriving from. Range on the scope is time, so this
 * bearing is the approach track, not a live GPS fix.
 */
function samePlace(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  if (![a.lat, a.lon, b.lat, b.lon].every(Number.isFinite)) return false;
  const dLat = (a.lat - b.lat) * 111320;
  const dLon = (a.lon - b.lon) * 111320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon) < 250;
}

export function chooseApproach(prediction, graph, station) {
  if (!graph || !station) return null;
  const centre =
    graph.stations.find((item) => item.id === station.id) ||
    findByName(graph.stations, station.name) ||
    station;
  const usable = (candidate) => candidate && !samePlace(candidate, centre) && !samePlace(candidate, station);
  const location = parseLocation(prediction.currentLocation);
  const ourName = normName(centre.name);
  const mentioned = location.names
    .map((name) => ({ name, station: findByName(graph.stations, name) }))
    .filter((item) => item.station);
  const mentionsUs = location.names.some((name) => namesMatch(normName(name), ourName));

  if (mentionsUs) {
    const other = mentioned.find((item) => usable(item.station));
    if (other) return { station: other.station, confident: true };
  }

  if (location.kind === "left" && mentioned[0] && usable(mentioned[0].station) && isNeighbour(graph, centre.id, mentioned[0].station.id)) {
    return { station: mentioned[0].station, confident: true };
  }

  if (location.kind === "between") {
    const adjacent = mentioned.filter(
      (item) => usable(item.station) && isNeighbour(graph, centre.id, item.station.id),
    );
    if (adjacent.length === 1) return { station: adjacent[0].station, confident: true };
  }

  const dir = String(prediction.direction || "").toLowerCase();
  const dirs = dir === "inbound" || dir === "outbound" ? [dir] : ["inbound", "outbound"];
  const candidates = [];
  for (const candidateDir of dirs) {
    for (const prev of graph.pred[candidateDir].get(centre.id) || []) {
      if (usable(prev) && !candidates.some((item) => item.station.id === prev.id)) {
        candidates.push({ station: prev, dir: candidateDir });
      }
    }
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return { station: candidates[0].station, confident: true };

  const travel = platformCardinal(prediction.platformName);
  const destId = prediction.destinationNaptanId;
  const scored = candidates.map((candidate) => {
    let score = 0;
    if (mentioned.some((item) => item.station.id === candidate.station.id)) score += 50;
    if (travel && centre.lat != null && candidate.station.lat != null && candidate.station.lon != null) {
      const bearing = bearingRadians(centre, candidate.station);
      if (cardinalOfBearing(bearing) === APPROACH_FROM[travel]) score += 25;
    }
    if (destIsAhead(graph, candidate.dir, centre.id, destId)) score += 15;
    if (dir && candidate.dir === dir) score += 5;
    return { ...candidate, score };
  });
  scored.sort((a, b) => b.score - a.score || a.station.id.localeCompare(b.station.id));
  return { station: scored[0].station, confident: scored[0].score > 0 };
}

function dedupePredictions(predictions) {
  const map = new Map();
  for (const prediction of predictions) {
    const key = [
      prediction.lineId,
      prediction.vehicleId || prediction.id,
      prediction.platformName || "",
    ].join("|");
    const previous = map.get(key);
    if (!previous || (prediction.timeToStation ?? 1e9) < (previous.timeToStation ?? 1e9)) {
      map.set(key, prediction);
    }
  }
  return [...map.values()];
}

function markLeads(contacts) {
  const best = new Map();
  for (const contact of contacts) {
    const key = `${contact.lineId}|${contact.approachId || contact.bearing.toFixed(2)}|${contact.destination}`;
    const previous = best.get(key);
    if (!previous || contact.eta < previous.eta) best.set(key, contact);
  }
  const winners = new Set(best.values());
  for (const contact of contacts) contact.lead = winners.has(contact);
}

function fanOverlaps(contacts) {
  const groups = new Map();
  for (const contact of contacts) {
    const key = `${contact.bearing.toFixed(2)}|${Math.round(contact.eta / 20)}`;
    const group = groups.get(key) || [];
    group.push(contact);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => String(a.vehicleId).localeCompare(String(b.vehicleId)));
    const mid = (group.length - 1) / 2;
    group.forEach((contact, index) => {
      contact.bearing += (index - mid) * 0.05;
    });
  }
}

export function buildContacts(predictions, station, graphs) {
  const tube = (predictions || []).filter(
    (prediction) => prediction && prediction.modeName === "tube" && prediction.timeToStation != null,
  );
  const contacts = dedupePredictions(tube).map((prediction) => {
    const graph = graphs?.get?.(prediction.lineId) || null;
    const approach = graph ? chooseApproach(prediction, graph, station) : null;
    const located =
      approach &&
      Number.isFinite(approach.station.lat) &&
      Number.isFinite(approach.station.lon) &&
      Number.isFinite(station.lat) &&
      Number.isFinite(station.lon);
    const bearing = located
      ? bearingRadians(station, approach.station)
      : fallbackBearing(`${prediction.lineId}|${prediction.direction || ""}|${prediction.platformName || ""}`);
    return {
      id: [prediction.lineId, prediction.vehicleId || prediction.id, prediction.platformName || ""].join("|"),
      vehicleId: prediction.vehicleId || "—",
      lineId: prediction.lineId,
      lineName: prediction.lineName || prediction.lineId,
      code: lineCode(prediction.lineId),
      color: lineColor(prediction.lineId),
      destination: destinationOf(prediction),
      platform: prediction.platformName || "",
      location: prediction.currentLocation || "",
      eta: Math.max(0, prediction.timeToStation),
      expected: prediction.expectedArrival || "",
      bearing,
      approachId: approach?.station.id || null,
      approachName: approach ? shortStation(approach.station.name) : "",
      synthetic: !located,
      nearest: false,
      lead: false,
    };
  });

  if (contacts.length) {
    const soonest = Math.min(...contacts.map((contact) => contact.eta));
    const tied = contacts
      .filter((contact) => contact.eta === soonest)
      .sort((a, b) => String(a.vehicleId).localeCompare(String(b.vehicleId)) || a.id.localeCompare(b.id));
    tied[0].nearest = true;
  }

  markLeads(contacts);
  fanOverlaps(contacts);
  contacts.sort((a, b) => a.eta - b.eta || Number(b.nearest) - Number(a.nearest) || a.destination.localeCompare(b.destination));
  return contacts;
}

export function chooseRangeSeconds(etas) {
  const list = (etas || []).filter((value) => Number.isFinite(value));
  const maxEta = Math.max(60, ...list, 60);
  const minutes = maxEta / 60;
  const steps = [5, 10, 15, 20, 30, 45, 60];
  for (const step of steps) {
    if (minutes <= step) return step * 60;
  }
  return Math.ceil(minutes / 15) * 15 * 60;
}

/** Unit position inside the scope. North is +north, east is +east. 1 is the rim. */
export function project(bearing, eta, rangeSec) {
  const range = Math.max(30, rangeSec);
  const limited = eta > range;
  const t = Math.min(Math.max(eta, 0), range) / range;
  const radial = 0.1 + t * 0.82;
  return {
    east: Math.sin(bearing) * radial,
    north: Math.cos(bearing) * radial,
    radial,
    limited,
  };
}

export function ringMinutes(rangeSec) {
  const minutes = rangeSec / 60;
  const steps =
    minutes <= 5 ? [1, 2, 3, 4, 5] : minutes <= 10 ? [2, 5, 10] : minutes <= 20 ? [5, 10, 15, 20] : minutes <= 30 ? [10, 20, 30] : [15, 30, 45, 60];
  return steps.filter((step) => step <= minutes + 0.01);
}

function overlaps(a, b, pad) {
  return a.l - pad < b.r && a.r + pad > b.l && a.t - pad < b.b && a.b + pad > b.t;
}

function boxMostlyInside(box, cx, cy, radius) {
  const midX = (box.l + box.r) / 2;
  const midY = (box.t + box.b) / 2;
  if (Math.hypot(midX - cx, midY - cy) > radius - 8) return false;
  const corners = [
    [box.l, box.t],
    [box.r, box.t],
    [box.l, box.b],
    [box.r, box.b],
  ];
  return corners.every(([x, y]) => Math.hypot(x - cx, y - cy) <= radius - 2);
}

/**
 * Greedy label placement. Only the closest train and a clicked train are labelled.
 */
export function layoutLabels(items, { cx, cy, radius }, measure) {
  const centreBox = { l: cx - 92, t: cy - 18, r: cx + 92, b: cy + 32 };
  const placed = [centreBox];
  const rank = (item) => (item.nearest ? 0 : 1);
  const ordered = [...items].sort((a, b) => rank(a) - rank(b) || a.liveEta - b.liveEta || a.id.localeCompare(b.id));
  const out = new Map();

  for (const item of ordered) {
    if (!item.nearest && !item.locked) {
      out.set(item.id, { show: false });
      continue;
    }
    const titleWidth = measure(item.destination, 13);
    const subWidth = measure(`${item.code}  ${item.etaText}`, 11);
    const width = Math.ceil(Math.max(titleWidth, subWidth) + 14);
    const height = 32;
    const outward = Math.hypot(item.x - cx, item.y - cy);
    const nearRim = outward > radius * 0.62;
    const nearCentre = outward < radius * 0.34;
    const radialSign = nearRim ? -1 : 1;
    const distances = nearCentre ? [54, 78, 102, 30] : [20, 44, 68, 10];
    const tries = [];
    for (const dist of distances) {
      for (const side of [1, -1, 2, -2]) {
        const lx = item.x + item.outX * dist * radialSign + item.tangX * side * 10;
        const ly = item.y + item.outY * dist * radialSign + item.tangY * side * 10;
        const alignRight = lx < item.x - 2;
        const left = alignRight ? lx - width : lx;
        const top = ly - height / 2;
        tries.push({
          l: left,
          t: top,
          r: left + width,
          b: top + height,
          alignRight,
        });
      }
    }

    const must = item.nearest || item.locked;
    let chosen = tries.find((box) => boxMostlyInside(box, cx, cy, radius) && !placed.some((other) => overlaps(other, box, 4)));
    if (!chosen && must) {
      chosen = tries.find((box) => boxMostlyInside(box, cx, cy, radius) && !overlaps(centreBox, box, 2))
        || tries.find((box) => boxMostlyInside(box, cx, cy, radius));
    }
    if (!chosen) {
      out.set(item.id, { show: false });
      continue;
    }
    placed.push(chosen);
    out.set(item.id, { show: true, ...chosen });
  }
  return out;
}
