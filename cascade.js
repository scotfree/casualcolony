// Cascade traversal.
//
// A tap activates a building, which activates others, which activate others
// again. That is a breadth-first walk from the tapped cell, following each
// building's propagate rule.
//
// The BFS *depth* is the useful part: cells at depth 0 light immediately,
// depth 1 a moment later, and so on. Playing back depth by depth is exactly a
// ripple travelling outward from the player's finger.

import { buildingFor } from "./buildings.js";

// Returns [{ cell, depth }] in breadth-first order, or [] if this cell can't
// start a cascade. Pure: it reads the world but changes nothing.
export function computeCascade(world, start) {
  if (!start) return [];
  if (start.activateAt !== null) return []; // already lit or already scheduled
  if (buildingFor(start).inert) return [];

  const result = [];
  const seen = new Set([start]);
  let frontier = [start];
  let depth = 0;

  while (frontier.length > 0) {
    for (const cell of frontier) {
      result.push({ cell, depth });
    }

    const next = [];
    for (const cell of frontier) {
      const building = buildingFor(cell);
      if (!building.propagate) continue;
      for (const neighbour of building.propagate(world, cell)) {
        if (seen.has(neighbour)) continue;
        if (neighbour.activateAt !== null) continue;
        seen.add(neighbour);
        next.push(neighbour);
      }
    }

    frontier = next;
    depth++;
  }

  return result;
}
