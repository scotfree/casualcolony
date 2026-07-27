// Cascade traversal.
//
// A tap activates a building, which activates others, which activate others
// again. That is a breadth-first walk from the tapped cell, following each
// building's propagate rule.
//
// The BFS *depth* is the useful part: cells at depth 0 light immediately,
// depth 1 a moment later, and so on. Playing back depth by depth is exactly a
// ripple travelling outward from the player's finger.
//
// Drains don't fit that model — they're reactive, not tapped-and-propagated.
// triggeredDrains() below is the other half of the picture: not a walk
// outward from one cell, but a scan for any drain whose neighbourhood
// changed.

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

// Returns [{ sink, targets }] for every drain tile that currently has at
// least one activated orthogonal neighbour — targets is what that drain
// would clear. Call this after scheduling a cascade so a drain reacts the
// same tick a neighbour lights up, whether that neighbour is brand new or
// was already lit from an earlier tap. Pure: reads the world, changes
// nothing; the caller applies the deactivation.
export function triggeredDrains(world) {
  const triggered = [];
  for (const cell of world.cells) {
    const building = buildingFor(cell);
    if (!building.drain) continue;
    const targets = building.drain(world, cell);
    if (targets.length > 0) triggered.push({ sink: cell, targets });
  }
  return triggered;
}
