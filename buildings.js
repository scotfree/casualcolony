// The building type table.
//
// Adding a building type should mean adding one entry here and one legend
// character in a level file — nothing else. If a new type needs a branch
// somewhere else in the codebase, this table is the wrong shape.
//
// propagate(world, cell) returns the cells this building activates when it
// becomes active. Omit it for buildings that don't spread.

import { orthogonalNeighbours } from "./grid.js";

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
};

export function buildingFor(cell) {
  return BUILDINGS[cell.type];
}
