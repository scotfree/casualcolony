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
import { buildingFor, costOf, generationOf, paysPool } from "./buildings.js";
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
    const payer = cell.enabled ? "you" : "grid";
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

    // A grid's own generation, and what its cascade spends. A fed tile's cost
    // came out of the reserve, so only the tiles the wave reached draw here —
    // and a fed tile's whole generation is available to the grid.
    let generation = 0;
    let cascadeDraw = 0;
    for (const cell of live) {
      if (!cell.powered) continue;
      const building = buildingFor(cell);
      if (!paysPool(building)) generation += generationOf(building);
      if (!cell.enabled) cascadeDraw += costOf(building);
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

  // What you've committed to paying for every turn, whether or not it's being
  // met. Upkeep is all-or-none: if the reserve can't carry everything you fed,
  // none of it runs (power.js), so "committed but blocked" is a real state and
  // the one worth shouting about.
  const fed = world.cells.filter((cell) => cell.enabled);
  const upkeep = fed.reduce((total, cell) => total + costOf(buildingFor(cell)), 0);
  const blocked = fed.length > 0 && fed.some((cell) => !cell.powered);

  const net = blocked ? 0 : income - starvation - upkeep;
  const energy = world.energy;

  // How many more turns the reserve can carry this, if nothing changes. You
  // fail on the turn the reserve can no longer cover upkeep in full, not when
  // it reaches zero.
  let turnsLeft = null;
  if (!blocked && net < 0 && energy >= upkeep) {
    turnsLeft = Math.floor((energy - upkeep) / -net) + 1;
  }

  return {
    grids,
    empty: grids.length === 0,
    reserve: {
      energy, upkeep, income, starvation, net, turnsLeft, blocked,
      population: colony.population,
      foodCapacity: colony.foodCapacity,
      staffed: colony.staffed,
    },
  };
}
