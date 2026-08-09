// The standing balance — what the board costs and earns right now.
//
// The log answers "what did that tap just do"; this answers "what is true at
// this moment". Different questions, so a separate view rather than more log
// lines.
//
// What it exists to make visible is the two-budget rule (see design.md's
// Milestone 19), which the board itself can't show: **your reserve pays only
// for tiles you fed, and a grid's generation pays only for its own cascade.**
// A flat list of tiles with a cost column would imply one pot and quietly
// misstate the whole economy, so rows are grouped by grid and every row says
// who pays for it.
//
// Derived from live board state rather than from a turn record, because this
// has to be correct before the first tap has happened.

import { solvePower } from "./power.js";
import { buildingFor, costOf, generationOf, paysPool } from "./buildings.js";
import { resolveColony, poolIncome, starvationCost } from "./colony.js";

const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Rows collapse as far as they can without losing information: tiles of the
// same type fold into one row only when everything the table reports about
// them matches. Payer is part of that key, so four cascaded crystals are one
// row but a fifth you fed yourself stays separate — they're drawn from
// different budgets, which is the thing the view is for.
function groupRows(cells, staffed, solved) {
  const groups = new Map();

  for (const cell of cells) {
    const building = buildingFor(cell);
    const powered = solved.powered.has(cell);
    // Three ways a tile gets paid for, and they never mix: its own storage,
    // your reserve, or the grid it's wired into.
    const payer = solved.selfPowered.has(cell) ? "self" : cell.enabled ? "you" : "grid";
    const dark = cell.enabled && !powered;
    // A job that's powered but contributing nothing, because nobody lives on
    // the board to work it (colony.js's requiresLabor).
    const idle = paysPool(building) && powered
      && building.colony?.requiresLabor === true && !staffed;
    const key = `${cell.type}|${payer}|${dark}|${idle}`;

    if (!groups.has(key)) {
      groups.set(key, {
        type: cell.type,
        name: building.name,
        count: 0,
        cost: 0,
        generation: 0,
        toPool: paysPool(building),
        payer,
        dark,
        idle,
      });
    }
    const row = groups.get(key);
    row.count++;
    row.cost += costOf(building);
    // What this tile actually hands over, not its nameplate output: a plant
    // that keeps 1 of its 5 back shows +4, so the rows add up to the grid
    // total above them. Pool-bound output isn't refilling anything, so it's
    // reported whole.
    row.generation += paysPool(building)
      ? generationOf(building)
      : (solved.contributed.get(cell) ?? 0);
  }

  // Dearest first, matching the order the cascade itself serves them in.
  return [...groups.values()].sort((a, b) => b.cost / b.count - a.cost / a.count);
}

// One line per building type, for the reserve's own totals: what makes up
// "upkeep −1" or "mined +4". The grid tables already carry the same tiles, but
// a bare total there doesn't say which of them your reserve is actually
// paying — and under the two-budget rule that's exactly the thing to be able
// to look up.
function tally(cells, amountFor) {
  const groups = new Map();
  for (const cell of cells) {
    if (!groups.has(cell.type)) {
      groups.set(cell.type, { type: cell.type, name: buildingFor(cell).name, count: 0, amount: 0 });
    }
    const row = groups.get(cell.type);
    row.count++;
    row.amount += amountFor(buildingFor(cell));
  }
  return [...groups.values()].sort((a, b) => b.amount - a.amount);
}

// { grids, reserve, empty } for the board as it stands.
//
// Solves the board fresh rather than reading the last turn's result, so the
// figures are what the *next* turn costs from here — which is the question
// being asked, since every number on this screen is per-turn. It's also how a
// generator that has just charged shows up as free before you spend another
// move finding out. solvePower is pure, so the returned storage is discarded.
export function describeBudget(world) {
  const solved = solvePower(world, world.energy);
  const colony = resolveColony(world, solved.powered);
  const income = poolIncome(world, solved.powered, colony);
  const starvation = starvationCost(world, colony);

  const grids = [];
  solved.perGrid.forEach((grid) => {
    const live = grid.cells.filter((cell) => solved.powered.has(cell) || cell.enabled);
    if (live.length === 0) return;

    grids.push({
      label: LABELS[grids.length] ?? "?",
      tiles: live.length,
      // Straight from the solve: what its generators handed it after their own
      // refills, and what the cascade spent. Re-deriving these here is how the
      // view and the rules end up disagreeing.
      generation: grid.generation,
      cascadeDraw: grid.draw,
      spare: grid.spare,
      rows: groupRows(live, colony.staffed, solved),
    });
  });

  // What the reserve is being asked for every turn. Tiles running on their own
  // storage aren't in this — they cost you nothing — so feeding a generator is
  // a one-off jump-start rather than a standing bill. Upkeep is all-or-none, so
  // "committed but blocked" is a real state and the one worth shouting about.
  const fed = world.cells.filter(
    (cell) => cell.enabled && !solved.selfPowered.has(cell)
  );
  const upkeep = fed.reduce((total, cell) => total + costOf(buildingFor(cell)), 0);
  const blocked = solved.dark.size > 0;

  const net = blocked ? 0 : income - starvation - upkeep;
  const energy = world.energy;

  // How many more turns the reserve can carry this, if nothing changes. You
  // fail on the turn the reserve can no longer cover upkeep in full, not when
  // it reaches zero.
  let turnsLeft = null;
  if (!blocked && net < 0 && energy >= upkeep) {
    turnsLeft = Math.floor((energy - upkeep) / -net) + 1;
  }

  // Which tiles those two totals are made of. Earners are picked with the same
  // predicate poolIncome uses (colony.js) rather than a second guess at it, so
  // the breakdown can't disagree with the number it explains.
  const earners = [...solved.powered].filter((cell) => {
    const building = buildingFor(cell);
    if (!paysPool(building)) return false;
    return !(building.colony?.requiresLabor && !colony.staffed);
  });

  return {
    grids,
    empty: grids.length === 0,
    reserve: {
      energy, upkeep, income, starvation, net, turnsLeft, blocked,
      upkeepRows: tally(fed, costOf),
      incomeRows: tally(earners, generationOf),
      population: colony.population,
      foodCapacity: colony.foodCapacity,
      staffed: colony.staffed,
    },
  };
}
