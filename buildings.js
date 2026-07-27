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

import { orthogonalNeighbours, verticalNeighbours, horizontalNeighbours } from "./grid.js";

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

    // Activating a crystal activates every orthogonally adjacent crystal.
    // Applied repeatedly by the cascade, this floods the whole connected group.
    propagate(world, cell) {
      return orthogonalNeighbours(world, cell).filter((n) => n.type === "crystal");
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
      return verticalNeighbours(world, cell).filter((n) => n.type === "redCrystal");
    },
  },

  greenCrystal: {
    id: "greenCrystal",
    name: "Green Crystal",
    inert: false,
    fill: "#1f2c22",
    stroke: "#2f4736",
    dormant: "#3d6b4a",
    lit: "#4ade80",
    glow: "#22c55e",

    // Same as crystal, but only floods along the east/west axis.
    propagate(world, cell) {
      return horizontalNeighbours(world, cell).filter((n) => n.type === "greenCrystal");
    },
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
