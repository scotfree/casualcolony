// The building type table.
//
// Adding a building type should mean adding one entry here and one legend
// character in a level file — nothing else. If a new type needs a branch
// somewhere else in the codebase, this table is the wrong shape.
//
// propagate(world, cell) returns the cells this building activates when it
// becomes active. Omit it for buildings that don't spread.
//
// drain(world, cell) returns the already-activated cells this building
// deactivates when tapped. It's the inverse of propagate — a tap here
// undoes neighbours' activation instead of spreading its own. Omit it for
// buildings that don't drain.
//
// boostKey names a field on the level itself (like attenuation) holding how
// much this building adds to the signal when it activates, before that
// signal attenuates on its way to the next cell. Omit it for buildings that
// don't amplify — see cascade.js. Boost lives on the level, not a hardcoded
// number here, so different levels can tune it without a new building type.
//
// houses/feeds/mines are capability flags for the colony economy (see
// colony.js): an activated houses building counts toward population, feeds
// toward food capacity, mines toward energy income when the colony is fed.
// None of these buildings propagate — the colony economy isn't part of the
// crystal signal network, it's a separate system resolved every tap.
//
// toggle: true means tapping an already-activated cell of this type
// deactivates it instead of no-opping — see game.js. Residential is the
// only one: it's how a player fixes a starving colony themselves, rather
// than the game picking who starves.
//
// shape names the glyph game.js draws at a tile's center — "plus", "bolt",
// "person", "leaf", "dollar", "x", or omitted for no icon (desert). iconColor
// is that glyph's color, always at full brightness: activation never dims
// it, so a tile's *type* reads at a glance whether or not it's lit. Only
// fill/stroke (at rest) versus activeFill/glow (once active) change with
// state — see game.js's paintTile. That split is deliberate: "what is this"
// and "is it active" are two different questions and shouldn't share one
// visual signal.

import { orthogonalNeighbours, verticalNeighbours, horizontalNeighbours } from "./grid.js";

// Crystal, red crystal, green crystal and the power plant all activate each
// other — only the *axis* differs per color, not who counts as a valid
// neighbour. A plain crystal next to a red one lights it just like it would
// another crystal.
const CRYSTAL_TYPES = new Set(["crystal", "redCrystal", "greenCrystal", "powerPlant"]);

export const BUILDINGS = {
  desert: {
    id: "desert",
    name: "Desert",
    inert: true,
    fill: "#181e27",
    stroke: "#20283340",
  },

  crystal: {
    id: "crystal",
    name: "Crystal",
    inert: false,
    fill: "#1b2732",
    stroke: "#35505f",
    activeFill: "#23414e",
    glow: "#2dd4bf",
    iconColor: "#f3f7fa",
    shape: "plus",

    // Activating a crystal activates every orthogonally adjacent crystal,
    // red crystal, or green crystal. Applied repeatedly by the cascade,
    // this floods the whole connected group regardless of color.
    propagate(world, cell) {
      return orthogonalNeighbours(world, cell).filter((n) => CRYSTAL_TYPES.has(n.type));
    },
  },

  redCrystal: {
    id: "redCrystal",
    name: "Red Crystal",
    inert: false,
    fill: "#2a1c20",
    stroke: "#5c2a34",
    activeFill: "#3a2830",
    glow: "#ef4444",
    iconColor: "#f87171",
    shape: "plus",

    // Same as crystal, but only floods along the north/south axis.
    propagate(world, cell) {
      return verticalNeighbours(world, cell).filter((n) => CRYSTAL_TYPES.has(n.type));
    },
  },

  greenCrystal: {
    id: "greenCrystal",
    name: "Green Crystal",
    inert: false,
    fill: "#1a2015",
    stroke: "#3d4d22",
    activeFill: "#26301c",
    glow: "#84cc16",
    iconColor: "#a3e635",
    shape: "plus",

    // Same as crystal, but only floods along the east/west axis.
    propagate(world, cell) {
      return horizontalNeighbours(world, cell).filter((n) => CRYSTAL_TYPES.has(n.type));
    },
  },

  powerPlant: {
    id: "powerPlant",
    name: "Power Plant",
    inert: false,
    fill: "#2a2415",
    stroke: "#5b4c22",
    activeFill: "#40341a",
    glow: "#f59e0b",
    iconColor: "#fbbf24",
    shape: "bolt",
    // See world.powerPlantBoost (level.js) for the actual amount.
    boostKey: "powerPlantBoost",

    // Same reach as plain crystal — every orthogonal crystal-family neighbour.
    propagate(world, cell) {
      return orthogonalNeighbours(world, cell).filter((n) => CRYSTAL_TYPES.has(n.type));
    },
  },

  residential: {
    id: "residential",
    name: "Residential",
    inert: false,
    fill: "#131f2c",
    stroke: "#2c5170",
    activeFill: "#1c3245",
    glow: "#0ea5e9",
    iconColor: "#38bdf8",
    shape: "person",
    houses: true,
    toggle: true,
    // No propagate: activating one only ever lights that single cell. The
    // colony isn't part of the crystal signal network.
  },

  farm: {
    id: "farm",
    name: "Farm",
    inert: false,
    fill: "#131f16",
    stroke: "#29572f",
    activeFill: "#1c3922",
    glow: "#22c55e",
    iconColor: "#4ade80",
    shape: "leaf",
    feeds: true,
  },

  mine: {
    id: "mine",
    name: "Mine",
    inert: false,
    fill: "#24141a",
    stroke: "#5c2a34",
    activeFill: "#3a1e26",
    glow: "#dc2626",
    iconColor: "#ef4444",
    shape: "dollar",
    mines: true,
  },

  drain: {
    id: "drain",
    name: "Drain",
    inert: true,
    fill: "#241c2c",
    stroke: "#3c2d47",
    activeFill: "#372a45",
    // Static marker — a drain never activates, so its icon is always
    // visible at rest, with only a brief brighter pulse (glow) the moment
    // it actually drains something.
    glow: "#c084fc",
    iconColor: "#a855f7",
    shape: "x",

    // Tapping a drain deactivates every orthogonally adjacent activated
    // cell, regardless of type. It never activates anything itself.
    drain(world, cell) {
      return orthogonalNeighbours(world, cell).filter((n) => n.activateAt !== null);
    },
  },
};

export function buildingFor(cell) {
  return BUILDINGS[cell.type];
}
