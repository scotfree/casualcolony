// Cascade traversal.
//
// A tap activates a building, which activates others, which activate others
// again. That is a breadth-first walk from the tapped cell, following each
// building's propagate rule — but it isn't unlimited. A tap hands the tapped
// cell one unit of signal; each cell that activates passes along whatever
// signal it received, plus its own boost (0 for most buildings; a power
// plant's is world[boostKey], e.g. world.powerPlantBoost), minus the
// activation cost of whatever it's reaching next (buildings.js's
// activationCost — a property of that neighbour's *type*, not the level:
// crystal is cheap, a mine is steep). A neighbour that can't cover its own
// cost simply doesn't activate — the cascade dead-ends there, same as
// running out of signal entirely.
//
// The cell you actually tap is the one exception: it always activates,
// regardless of cost. That's the certainty spending the energy on a tap
// buys. Only what's left over after paying its own cost decides how far
// the cascade reaches beyond it — a lone crystal only ever lights itself,
// and it takes a power plant somewhere in the chain to reach any further.
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

// What a tap hands the tapped cell, before that cell's own activation cost
// is paid. With the default crystal activationCost of 1, this is exactly
// enough to activate a lone crystal and nothing more.
const TAP_SIGNAL = 1;

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
  if (start.activateAt !== null) return []; // already lit or already scheduled
  const startBuilding = buildingFor(start);
  if (startBuilding.inert) return [];

  // The tap itself is unconditional — see the module doc above. What's left
  // after paying its own cost (plus any boost) is what depth-1 candidates
  // have to work with.
  const startBoost = startBuilding.boostKey ? world[startBuilding.boostKey] : 0;
  const result = [{ cell: start, depth: 0 }];
  const seen = new Set([start]);
  let frontier = [{ cell: start, signal: TAP_SIGNAL - costOf(startBuilding) + startBoost }];
  let depth = 1;

  while (frontier.length > 0) {
    const next = [];
    for (const { cell, signal } of frontier) {
      const building = buildingFor(cell);
      if (!building.propagate) continue;
      for (const neighbour of building.propagate(world, cell)) {
        if (seen.has(neighbour)) continue;
        if (neighbour.activateAt !== null) continue;
        const nBuilding = buildingFor(neighbour);
        const cost = costOf(nBuilding);
        if (signal < cost) continue; // can't afford to activate this one — dead end
        seen.add(neighbour);
        result.push({ cell: neighbour, depth });
        const boost = nBuilding.boostKey ? world[nBuilding.boostKey] : 0;
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
