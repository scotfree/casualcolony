// Colony economy — resolved fresh from what's powered, every turn.
//
// Buildings declare what they contribute as resources (see buildings.js's
// `colony`) rather than as named flags this module branches on. `stocks` are
// recounted from the board each turn: what the colony currently *is*
// (population, food capacity). Nothing accumulates here — switch a
// residential off and population drops the same turn, with no bookkeeping.
//
// **Why this can't create a circular solve.** A mine's generation pays into
// the player's pool, not into its own grid (buildings.js's `output`), so it
// never affects whether a component powers. That means power.js can solve the
// grid without knowing anything about the colony, and the colony is then
// resolved from whatever came out powered. If a job ever paid back into the
// grid *and* required labour, that would be circular and would need a rule.

import { buildingFor, generationOf, paysPool, selfStarting } from "./buildings.js";

// An amount on a building is either a literal number or the name of a level
// knob to look up, so "how much does a farm feed" stays level-tunable without
// this module knowing which knob belongs to which building.
function amountOf(value, level) {
  return typeof value === "number" ? value : level[value] ?? 0;
}

// { population, foodCapacity, fed, staffed, stocks } for the powered board.
// Pure: reads, changes nothing.
//
// A colony is fed while population fits inside food capacity. It's *staffed*
// when it's fed and at least one person lives there — a colony of zero is
// trivially fed against any capacity, but there's nobody to work a mine.
export function resolveColony(world, powered) {
  const { level } = world;
  const stocks = {};

  for (const cell of world.cells) {
    if (!powered.has(cell)) continue;
    const { colony } = buildingFor(cell);
    if (!colony) continue;
    for (const [resource, amount] of Object.entries(colony.stocks ?? {})) {
      stocks[resource] = (stocks[resource] ?? 0) + amountOf(amount, level);
    }
  }

  const population = stocks.population ?? 0;
  const foodCapacity = stocks.food ?? 0;
  const fed = population <= foodCapacity;

  return { population, foodCapacity, fed, staffed: fed && population > 0, stocks };
}

// What the powered board pays into the player's pool this turn. Jobs marked
// `requiresLabor` sit idle without a staffed colony; anything else pays
// regardless (nothing does yet, but the table allows it).
export function poolIncome(world, powered, colony) {
  let total = 0;
  for (const cell of powered) {
    const building = buildingFor(cell);
    if (!paysPool(building) || !selfStarting(building)) continue;
    if (building.colony?.requiresLabor && !colony.staffed) continue;
    total += generationOf(building);
  }
  return total;
}

// What an unfed colony costs, per person over capacity, per turn.
export function starvationCost(world, colony) {
  if (colony.fed) return 0;
  return (colony.population - colony.foodCapacity) * world.level.starvationPenalty;
}

// Whether any building on this board takes part in the colony economy at all —
// the HUD uses it to decide whether population/food are worth showing.
export function hasColony(world) {
  return world.cells.some((cell) => buildingFor(cell).colony);
}
