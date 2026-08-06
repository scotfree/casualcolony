// Colony economy — resolved fresh from the board after every tap.
//
// There's no clock in this game — "taps are time" — so a tap is the only
// notion of a tick the colony needs, the same beat everything else already
// resolves on. This isn't a background simulation running independently of
// the player; it only ever changes in direct response to something tapped.
//
// Buildings declare what they contribute as *resources* (see buildings.js's
// `colony`), not as named capability flags this module branches on. Two
// kinds, because the game genuinely has two:
//
//   stocks — recounted from the board every tap: what the colony currently
//     *is*. Population and food capacity. Nothing accumulates; culling a
//     residential tile drops population the same tap, with no bookkeeping.
//   flows  — added to the energy pool every tap: what the colony currently
//     *earns*. Mining income. This is the only thing that accumulates, and
//     it accumulates in world.energy, not here.
//
// Adding a building that produces a new resource — or a new resource
// entirely — takes one entry in buildings.js and no changes here: stocks are
// summed generically, and anything a caller wants to read comes back in
// `stocks`. What *isn't* generic yet is the fed/starving rule below, which
// still names population and food specifically; that's the colony's single
// piece of actual game design, and it belongs somewhere concrete until a
// second rule of the same shape shows up to generalize against.

import { buildingFor } from "./buildings.js";

// An amount on a building is either a literal number or the name of a level
// knob to look up (see buildings.js), so "how much does a farm feed" stays
// level-tunable without this module knowing which knob belongs to which
// building.
function amountOf(value, level) {
  return typeof value === "number" ? value : level[value] ?? 0;
}

// { population, foodCapacity, fed, energyDelta, stocks } for the board's
// current state. Pure: reads the world, changes nothing — the caller applies
// energyDelta to world.energy.
//
// A colony is fed when population fits inside food capacity. A *fed* colony
// with at least one resident earns its buildings' flows; a colony of zero is
// trivially "fed" against any capacity, but there's nobody there to work a
// mine, so it earns nothing. An unfed colony earns nothing either and bleeds
// energy proportional to the shortfall — that's the cost the player is
// avoiding by culling excess residential (tapping an already-active one
// deactivates it; see buildings.js's `toggle`) rather than letting it sit.
export function resolveColony(world) {
  const { level } = world;
  const stocks = {};
  const earners = [];

  for (const cell of world.cells) {
    if (!cell.active) continue;
    const { colony } = buildingFor(cell);
    if (!colony) continue;
    for (const [resource, amount] of Object.entries(colony.stocks ?? {})) {
      stocks[resource] = (stocks[resource] ?? 0) + amountOf(amount, level);
    }
    if (colony.flows) earners.push(colony);
  }

  const population = stocks.population ?? 0;
  const foodCapacity = stocks.food ?? 0;
  const fed = population <= foodCapacity;
  // Somebody has to actually live here for a job to be worked.
  const staffed = fed && population > 0;

  let energyDelta = 0;
  if (!fed) {
    energyDelta = -(population - foodCapacity) * level.starvationPenalty;
  } else {
    for (const colony of earners) {
      // A job that needs hands sits idle without them; one that doesn't
      // (nothing yet, but the table allows it) earns regardless.
      if (colony.requiresLabor && !staffed) continue;
      energyDelta += amountOf(colony.flows.energy ?? 0, level);
    }
  }

  return { population, foodCapacity, fed, energyDelta, stocks };
}

// Whether any building on this board takes part in the colony economy at
// all — the HUD uses it to decide whether population/food are worth showing.
export function hasColony(world) {
  return world.cells.some((cell) => buildingFor(cell).colony);
}
