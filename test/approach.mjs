import assert from "node:assert/strict";
import {
  bearingRadians,
  buildContacts,
  buildLineGraph,
  cardinalOfBearing,
  chooseApproach,
  chooseRangeSeconds,
  destinationOf,
  findByName,
  formatEta,
  layoutLabels,
  normName,
  parseLocation,
  project,
  shortDestination,
} from "../lib.js";

const kx = { id: "KX", name: "King's Cross St. Pancras Underground Station", lat: 51.53, lon: -0.12 };
const farringdon = { id: "FAR", name: "Farringdon Underground Station", lat: 51.53, lon: -0.1 };
const eustonSq = { id: "EUS", name: "Euston Square Underground Station", lat: 51.53, lon: -0.14 };
const hammersmith = { id: "HAM", name: "Hammersmith (H&C Line) Underground Station", lat: 51.49, lon: -0.22 };

const graph = buildLineGraph({
  lineId: "hammersmith-city",
  lineName: "Hammersmith & City",
  stations: [farringdon, kx, eustonSq, hammersmith],
  stopPointSequences: [
    {
      direction: "inbound",
      stopPoint: [farringdon, kx, eustonSq, hammersmith],
    },
    {
      direction: "outbound",
      stopPoint: [hammersmith, eustonSq, kx, farringdon],
    },
  ],
});

assert.equal(normName("King's Cross & St. Pancras Underground Station"), "kings cross and st pancras");
assert.equal(shortDestination("Hammersmith (H&C Line) Underground Station"), "HAMMERSMITH (H&C LINE)");
assert.equal(shortDestination("Check Front of Train"), "UNKNOWN");
assert.equal(formatEta(127), "2:07");
assert.equal(formatEta(0), "0:00");

const parsed = parseLocation("Between Farringdon and King's Cross St. Pancras");
assert.equal(parsed.kind, "between");
assert.deepEqual(parsed.names, ["Farringdon", "King's Cross St. Pancras"]);
assert.equal(parseLocation("Left Angel, heading towards Kings Cross").names[0], "Angel");
assert.equal(parseLocation("At Hammersmith Platform 3").names[0], "Hammersmith");
assert.equal(parseLocation("At London Bridge Plaform 1").names[0], "London Bridge");

const east = bearingRadians({ lat: 51.5, lon: -0.12 }, { lat: 51.5, lon: -0.1 });
assert.ok(Math.abs(east - Math.PI / 2) < 0.02, `east bearing ${east}`);
assert.equal(cardinalOfBearing(0), "north");
assert.equal(cardinalOfBearing(Math.PI / 2), "east");
assert.equal(cardinalOfBearing(Math.PI), "south");
assert.equal(cardinalOfBearing(-Math.PI / 2), "west");

const fromLocation = chooseApproach({
  direction: "inbound",
  currentLocation: "Between Farringdon and King's Cross St. Pancras",
  platformName: "Westbound - Platform 1",
  destinationName: "Hammersmith (H&C Line) Underground Station",
  destinationNaptanId: "HAM",
}, graph, kx);
assert.equal(fromLocation.station.id, "FAR");

const fromDirection = chooseApproach({
  direction: "outbound",
  currentLocation: "At Moorgate Platform 2",
  platformName: "Eastbound - Platform 2",
  destinationName: "Barking Underground Station",
}, graph, kx);
assert.equal(fromDirection.station.id, "EUS");

const fromLeft = chooseApproach({
  direction: "",
  currentLocation: "Left Euston Square",
  platformName: "",
  destinationName: "Barking Underground Station",
}, graph, kx);
assert.equal(fromLeft.station.id, "EUS");

const found = findByName(
  [
    { id: "EDG", name: "Edgware Underground Station" },
    { id: "ERD", name: "Edgware Road Underground Station" },
  ],
  "Edgware Road",
);
assert.equal(found.id, "ERD");
assert.equal(findByName(
  [
    { id: "HUBKGX", name: "King's Cross & St Pancras International" },
    { id: "KX", name: "King's Cross St. Pancras Underground Station" },
  ],
  "King's Cross",
).id, "KX");

const withHub = buildLineGraph({
  lineId: "piccadilly",
  stations: [{ id: "HUBKGX", name: "King's Cross & St Pancras International", lat: 51.531, lon: -0.124 }],
  stopPointSequences: [{
    direction: "inbound",
    stopPoint: [
      { id: "CAR", name: "Caledonian Road Underground Station", lat: 51.548, lon: -0.118 },
      { id: "KX", name: "King's Cross St. Pancras Underground Station", lat: 51.531, lon: -0.123 },
      { id: "RSQ", name: "Russell Square Underground Station", lat: 51.523, lon: -0.124 },
    ],
  }],
});
assert.equal(withHub.stations.some((stop) => stop.id === "HUBKGX"), false);
const shortName = chooseApproach({
  direction: "inbound",
  currentLocation: "Approaching King's Cross",
  platformName: "Northbound - Platform 6",
  destinationName: "Arnos Grove Underground Station",
}, withHub, { id: "KX", name: "King's Cross St. Pancras Underground Station", lat: 51.531, lon: -0.123 });
assert.equal(shortName.station.id, "CAR");

const graphs = new Map([["hammersmith-city", graph]]);
const contacts = buildContacts([
  {
    id: "1",
    modeName: "tube",
    lineId: "hammersmith-city",
    lineName: "Hammersmith & City",
    vehicleId: "206",
    platformName: "Westbound - Platform 1",
    direction: "inbound",
    currentLocation: "Between Farringdon and King's Cross St. Pancras",
    destinationName: "Hammersmith (H&C Line) Underground Station",
    destinationNaptanId: "HAM",
    timeToStation: 90,
  },
  {
    id: "2",
    modeName: "tube",
    lineId: "hammersmith-city",
    lineName: "Hammersmith & City",
    vehicleId: "207",
    platformName: "Eastbound - Platform 2",
    direction: "outbound",
    currentLocation: "Left Euston Square",
    destinationName: "Barking Underground Station",
    timeToStation: 400,
  },
  {
    id: "3",
    modeName: "bus",
    lineId: "hammersmith-city",
    timeToStation: 10,
    destinationName: "Ignored",
  },
], kx, graphs);

assert.equal(contacts.length, 2);
assert.equal(contacts.filter((contact) => contact.nearest).length, 1);
assert.equal(contacts[0].nearest, true);
assert.equal(contacts[0].destination, "HAMMERSMITH (H&C LINE)");
assert.equal(contacts[0].approachId, "FAR");
assert.ok(contacts[0].bearing > 1 && contacts[0].bearing < 2);
assert.equal(contacts[1].approachId, "EUS");
assert.equal(destinationOf({ destinationName: null, towards: "Barking" }), "BARKING");

const centre = project(0, 0, 600);
assert.ok(centre.north > 0.09 && centre.north < 0.12);
const rim = project(0, 600, 600);
assert.ok(Math.abs(rim.north - 0.92) < 0.001);
assert.equal(chooseRangeSeconds([90, 700]), 15 * 60);
assert.equal(chooseRangeSeconds([]), 5 * 60);

const labels = layoutLabels([
  {
    id: "near",
    x: 200,
    y: 180,
    outX: 0,
    outY: -1,
    tangX: 1,
    tangY: 0,
    destination: "HAMMERSMITH",
    code: "H&C",
    etaText: "1:30",
    liveEta: 90,
    nearest: true,
    locked: false,
    hover: false,
    lead: true,
  },
  {
    id: "far",
    x: 200,
    y: 80,
    outX: 0,
    outY: -1,
    tangX: 1,
    tangY: 0,
    destination: "BARKING",
    code: "H&C",
    etaText: "6:40",
    liveEta: 400,
    nearest: false,
    locked: true,
    hover: false,
    lead: true,
  },
  {
    id: "quiet",
    x: 80,
    y: 200,
    outX: -1,
    outY: 0,
    tangX: 0,
    tangY: 1,
    destination: "BARKING",
    code: "H&C",
    etaText: "4:00",
    liveEta: 240,
    nearest: false,
    locked: false,
    hover: true,
    lead: true,
  },
], { cx: 200, cy: 200, radius: 180 }, (text) => text.length * 7);

assert.equal(labels.get("near").show, true);
assert.equal(labels.get("far").show, true);
assert.equal(labels.get("quiet").show, false);
const near = labels.get("near");
const far = labels.get("far");
const separated = near.r < far.l || far.r < near.l || near.b < far.t || far.b < near.t;
assert.equal(separated, true);

console.log("approach tests passed");
