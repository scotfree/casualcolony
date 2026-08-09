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

import { components } from "./power.js";
import {
  buildingFor, costOf, generationOf, paysPool, selfStarting, selfSustaining,
} from "./buildings.js";
import { resolveColony, poolIncome, starvationCost } from "./colony.js";

const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Rows collapse as far as they can without losing information: tiles of the
// same type fold into one row only when everything the table reports about
// them matches. Payer is part of that key, so four cascaded crystals are one
// row but a fifth you fed yourself stays separate — they're drawn from
// different budgets, which is the thing the view is for.
function groupRows(cells, staffed) {
  const groups = new Map();

  for (const cell of cells) {
    const building = buildingFor(cell);
    // Three answers, not two. A generator you fed banks enough to cover its own
    // cost (buildings.js's selfSustaining), so it isn't on your reserve *or* on
    // its grid — saying "you" there would invent a bill you don't pay.
    const payer = !cell.enabled ? "grid" : selfSustaining(building) ? "self" : "you";
    const dark = cell.enabled && !cell.powered;
    // A job that's powered but contributing nothing, because nobody lives on
    // the board to work it (colony.js's requiresLabor).
    const idle = paysPool(building) && cell.powered
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
    row.generation += generationOf(building);
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
export function describeBudget(world) {
  const powered = new Set(world.cells.filter((cell) => cell.powered));
  const colony = resolveColony(world, powered);
  const income = poolIncome(world, powered, colony);
  const starvation = starvationCost(world, colony);

  const grids = [];
  components(world).forEach((group) => {
    const live = group.filter((cell) => cell.powered || cell.enabled);
    if (live.length === 0) return;

    // A grid's own generation, and what gets spent out of it. Anything your
    // reserve is carrying is excluded — that cost isn't the grid's. Everything
    // else draws here, including a fed generator's own cost, which it pays out
    // of its own generation; that's what leaves a plant netting 4 rather
    // than 5.
    let generation = 0;
    let cascadeDraw = 0;
    for (const cell of live) {
      if (!cell.powered) continue;
      const building = buildingFor(cell);
      if (!paysPool(building)) generation += generationOf(building);
      if (!cell.enabled || selfSustaining(building)) cascadeDraw += costOf(building);
    }

    grids.push({
      label: LABELS[grids.length] ?? "?",
      tiles: live.length,
      generation,
      cascadeDraw,
      spare: generation - cascadeDraw,
      rows: groupRows(live, colony.staffed),
    });
  });

  // What you've committed to paying every turn, whether or not it's being met —
  // and only what your reserve actually carries. A fed generator pays for
  // itself out of storage, so it never appears here: feeding one is a decision,
  // not a standing bill. What's left is all-or-none (power.js), so "committed
  // but blocked" is a real state and the one worth shouting about.
  const fed = world.cells.filter((cell) => cell.enabled);
  const carried = fed.filter((cell) => !selfSustaining(buildingFor(cell)));
  const upkeep = carried.reduce((total, cell) => total + costOf(buildingFor(cell)), 0);
  const blocked = carried.length > 0 && carried.some((cell) => !cell.powered);

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
  const earners = [...powered].filter((cell) => {
    const building = buildingFor(cell);
    if (!paysPool(building) || !selfStarting(building)) return false;
    return !(building.colony?.requiresLabor && !colony.staffed);
  });

  return {
    grids,
    empty: grids.length === 0,
    reserve: {
      energy, upkeep, income, starvation, net, turnsLeft, blocked,
      upkeepRows: tally(carried, costOf),
      incomeRows: tally(earners, generationOf),
      population: colony.population,
      foodCapacity: colony.foodCapacity,
      staffed: colony.staffed,
    },
  };
}
