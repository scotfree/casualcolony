// Cascade traversal.
//
// A tap activates a building, which activates others, which activate others
// again. That is a breadth-first walk from the tapped cell, following each
// building's propagate rule — but it isn't unlimited.
//
// Every building has an activationCost (buildings.js) — how much signal it
// takes to switch it on — checked the same way everywhere, tapped cell
// included: a cell only activates if the signal reaching it covers that
// cost. A tap hands the tapped cell exactly its own activationCost, which is
// just enough to cover itself; what a cell then has left to hand a neighbour
// is that signal minus the neighbour's own cost, plus this cell's boost (0
// for most buildings; a power plant's is world.level[boostKey], e.g.
// world.level.powerPlantBoost). For a direct tap this collapses to exactly the
// tapped building's own boost — 0 for everything except a power plant —
// which is why a bare tap on anything else only ever lights the one cell you
// tapped, and it takes a power plant somewhere in the chain to reach further.
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

// activationCost is only meaningful on buildings that can ever be a
// propagation target (buildings.js's activatable() already keeps desert and
// drain out of the running); this is just the "no cost defined" fallback.
function costOf(building) {
  return building.activationCost ?? 0;
}

// Returns [{ cell, depth }] in breadth-first order, or [] if this cell can't
// start a cascade. Pure: it reads the world but changes nothing.
export function computeCascade(world, start) {
  if (!start) return [];
  if (start.active) return []; // already lit
  const startBuilding = buildingFor(start);
  if (startBuilding.inert) return [];

  // The tapped cell always activates — a tap hands it exactly its own cost,
  // which by definition covers it. What's left to hand a neighbour is just
  // this cell's own boost (0 for anything but a power plant) — see the
  // module doc above.
  const startBoost = startBuilding.boostKey ? world.level[startBuilding.boostKey] : 0;
  const result = [{ cell: start, depth: 0 }];
  const seen = new Set([start]);
  let frontier = [{ cell: start, signal: startBoost }];
  let depth = 1;

  while (frontier.length > 0) {
    const next = [];
    for (const { cell, signal } of frontier) {
      const building = buildingFor(cell);
      if (!building.propagate) continue;
      for (const neighbour of building.propagate(world, cell)) {
        if (seen.has(neighbour)) continue;
        if (neighbour.active) continue;
        const nBuilding = buildingFor(neighbour);
        const cost = costOf(nBuilding);
        if (signal < cost) continue; // can't afford to activate this one — dead end
        seen.add(neighbour);
        result.push({ cell: neighbour, depth });
        const boost = nBuilding.boostKey ? world.level[nBuilding.boostKey] : 0;
        next.push({ cell: neighbour, signal: signal - cost + boost });
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
