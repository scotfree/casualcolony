// Colony economy — population (housed by residential), food capacity (grown
// by farms), and mining income, resolved fresh after every tap.
//
// There's no clock in this game — "taps are time" — so a tap is the only
// notion of a tick the colony needs, the same beat everything else already
// resolves on. This isn't a background simulation running independently of
// the player; it only ever changes in direct response to something tapped.
//
// Building types opt in with plain flags (houses/feeds/mines in
// buildings.js) rather than this module checking type ids by name, the same
// shape as propagate/drain.

import { buildingFor } from "./buildings.js";

// { population, foodCapacity, fed, energyDelta } for the world's current
// board state. Pure: reads the world, changes nothing — the caller applies
// energyDelta to world.energy.
//
// A fed colony (population <= foodCapacity) with at least one resident earns
// energy from every activated mine — a mine converts a fed *population* into
// income, so population 0 (trivially "fed" against any capacity) produces
// nothing: there's no one to work it. An unfed colony bleeds energy instead,
// proportional to the shortfall — that's the cost the player is avoiding by
// culling excess residential (tapping an already-active one deactivates it;
// see buildings.js's `toggle`) rather than just letting it sit unfed.
export function resolveColony(world) {
  let population = 0;
  let foodCapacity = 0;
  let mines = 0;

  for (const cell of world.cells) {
    if (cell.activateAt === null) continue;
    const building = buildingFor(cell);
    if (building.houses) population++;
    if (building.feeds) foodCapacity += world.foodPerFarm;
    if (building.mines) mines++;
  }

  const fed = population <= foodCapacity;
  const energyDelta = fed
    ? (population > 0 ? mines * world.mineYield : 0)
    : -(population - foodCapacity) * world.starvationPenalty;

  return { population, foodCapacity, fed, energyDelta };
}
