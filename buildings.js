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
    fill: "#1f2c38",
    stroke: "#2f4756",
    dormant: "#3d5a6b",
    lit: "#5eead4",
    glow: "#2dd4bf",

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
    fill: "#2c1f24",
    stroke: "#472f37",
    dormant: "#6b3d47",
    lit: "#f87171",
    glow: "#ef4444",

    // Same as crystal, but only floods along the north/south axis.
    propagate(world, cell) {
      return verticalNeighbours(world, cell).filter((n) => CRYSTAL_TYPES.has(n.type));
    },
  },

  greenCrystal: {
    id: "greenCrystal",
    name: "Green Crystal",
    inert: false,
    fill: "#1e2416",
    stroke: "#333d22",
    dormant: "#4d5c26",
    lit: "#a3e635",
    glow: "#84cc16",

    // Same as crystal, but only floods along the east/west axis.
    propagate(world, cell) {
      return horizontalNeighbours(world, cell).filter((n) => CRYSTAL_TYPES.has(n.type));
    },
  },

  powerPlant: {
    id: "powerPlant",
    name: "Power Plant",
    inert: false,
    fill: "#2c2617",
    stroke: "#473d1f",
    dormant: "#6b5a2f",
    lit: "#fbbf24",
    glow: "#f59e0b",
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
    fill: "#16202c",
    stroke: "#254056",
    dormant: "#3d5f78",
    lit: "#38bdf8",
    glow: "#0ea5e9",
    houses: true,
    toggle: true,
    // No propagate: activating one only ever lights that single cell. The
    // colony isn't part of the crystal signal network.
  },

  farm: {
    id: "farm",
    name: "Farm",
    inert: false,
    fill: "#241c14",
    stroke: "#4a3620",
    dormant: "#7a5a35",
    lit: "#fb923c",
    glow: "#f97316",
    feeds: true,
  },

  mine: {
    id: "mine",
    name: "Mine",
    inert: false,
    fill: "#1c2024",
    stroke: "#3a424a",
    dormant: "#5c6773",
    lit: "#cbd5e1",
    glow: "#94a3b8",
    mines: true,
  },

  drain: {
    id: "drain",
    name: "Drain",
    inert: true,
    fill: "#241c2c",
    stroke: "#3c2d47",
    // Static marker gem — a drain never activates, so it has no
    // dormant/lit pair, just a fixed color plus a brief brighter pulse
    // (glow) the moment it actually drains something.
    icon: "#a855f7",
    glow: "#c084fc",

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
