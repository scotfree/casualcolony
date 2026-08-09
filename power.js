// How energy flows, and therefore what's powered this turn.
//
// **There is one move: feed a tile.** Your reserve then carries that tile's
// cost every turn, and the tile becomes a place a cascade starts. Nothing can
// be switched off — the wave decides what runs, fresh, every turn.
//
// **Two budgets that never mix.** The reserve pays for the tiles you fed and
// nothing else. Generation pays for the cascade and nothing else. That's what
// keeps the two halves of the game distinct: your pool is a countdown against
// your own commitments, while how far a cascade reaches is a fact about the
// board you wired it into. A fat reserve cannot push a cascade one tile
// further, and a grid sitting on unused surplus cannot pay your upkeep.
//
// **Not everything you feed is a bill.** A generator banks enough to cover its
// own cost across the turn boundary (buildings.js's `selfSustaining`) — that's
// what storage is for — so feeding one is a one-off decision and it hands the
// grid whatever's left: a plant nets 4 and carries four crystals. Anything that
// makes nothing is carried by your reserve outright, for as long as it runs.
//
// **The wave.** Each step it looks at every unpowered tile wired to what's
// already lit and tries to pay for it out of that grid's remaining generation:
//
//   Tiles are served in **descending order of cost**, a whole cost class at a
//   time. If the grid can afford the entire class it powers all of it; if it
//   can't, it skips that class and tries the next cheaper one.
//
// Expensive tiles therefore get first refusal on whatever energy reaches them,
// and can starve a branch beyond them — a routing mechanic you can build with
// deliberately, not just a limit.
//
// **Why whole classes.** Only three distinct costs exist and roughly half of a
// typical board is cost 1, so ties are the common case, not a corner. Any
// per-tile tiebreak ("top-left wins") would therefore be the rule silently
// deciding most outcomes — the engine choosing geography, which it must never
// do. All-or-none within a class removes the question entirely: nothing is
// ever picked over an equal peer.
//
// **The frontier pools its grid's surplus** rather than each tile spending its
// own. Otherwise a tile bordered by two powered neighbours would be funded by
// whichever the walk happened to visit first, and traversal order would leak
// into the result.
//
// **Generation stays inside its own grid.** Surplus is tracked per connected
// component, so a plant can only feed what it's actually wired to. This is the
// whole reason topology is worth playing with — an unreachable surplus is a
// routing problem, not a rounding error.
//
// **Upkeep is all-or-none.** If the reserve can't carry every tile you've fed,
// none of them come up. Same reason as within a cost class: the alternative is
// the rule choosing which of your tiles matters. It makes running out a cliff
// rather than a slide — but the pool ticking down toward your upkeep is the
// warning, and it arrives many turns ahead.
//
// Pure: reads the world, changes nothing. The caller applies the result.

import {
  buildingFor, costOf, generationOf, paysPool, selfStarting, selfSustaining,
} from "./buildings.js";

const AXES = {
  all: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  vertical: [[0, 1], [0, -1]],
  horizontal: [[1, 0], [-1, 0]],
};

// Two tiles are wired together only if *both* conduct along the axis between
// them. That symmetry lets parallel runs sit flush without merging — two
// adjacent columns of red crystal are two grids, not one. It doesn't let runs
// *cross*: a green tile in a red run breaks it, since one tile has one axis.
//
// Wiring is a property of the *board*, not of what you've switched on. A tile
// doesn't have to be lit to carry energy past itself — that's what makes this
// a cascade rather than a set of tiles you light one at a time.
export function wiredNeighbours(world, cell) {
  const axis = AXES[buildingFor(cell).conducts];
  if (!axis) return [];
  const { width, height } = world.level;
  const out = [];
  for (const [dx, dy] of axis) {
    const x = cell.x + dx;
    const y = cell.y + dy;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const neighbour = world.cells[y * width + x];
    const theirAxis = AXES[buildingFor(neighbour).conducts];
    if (!theirAxis) continue;
    if (!theirAxis.some(([ndx, ndy]) => ndx === -dx && ndy === -dy)) continue;
    out.push(neighbour);
  }
  return out;
}

// Every connected group of conducting tiles — one "grid". Fixed by the level's
// layout, since wiring doesn't depend on what's switched on. The solve uses
// these to keep each grid's generation to itself; it's also what "how many
// separate grids does this board have" means for the log and the tests.
export function components(world) {
  const seen = new Set();
  const groups = [];
  for (const cell of world.cells) {
    if (seen.has(cell) || !buildingFor(cell).conducts) continue;
    const group = [];
    let frontier = [cell];
    seen.add(cell);
    while (frontier.length > 0) {
      const next = [];
      for (const current of frontier) {
        group.push(current);
        for (const neighbour of wiredNeighbours(world, current)) {
          if (seen.has(neighbour)) continue;
          seen.add(neighbour);
          next.push(neighbour);
        }
      }
      frontier = next;
    }
    groups.push(group);
  }
  return groups;
}

// Solves the board for this turn.
//
// Returns { powered, dark, produced, consumed, fromPool, poolIncome } —
// `dark` being tiles you fed that the reserve couldn't carry.
//
// Note fromPool is *not* `consumed - produced`. The two budgets never mix: the
// reserve pays for the tiles you fed and nothing else, and generation pays for
// the cascade and nothing else. That separation is the whole economy — a grid
// sitting on unused surplus can't subsidise your reserve, and a fat reserve
// can't push a cascade one tile further than its generator affords.
export function solvePower(world, pool = world.energy) {
  const grids = components(world);
  const gridOf = new Map();
  grids.forEach((grid, index) => {
    for (const cell of grid) gridOf.set(cell, index);
  });

  // What each grid has spare, in its own right. Everything else is global
  // because it's reporting, not budgeting.
  const surplus = grids.map(() => 0);
  const powered = new Set();
  let produced = 0;   // generation feeding grids
  let consumed = 0;   // what the powered set draws
  let poolIncome = 0; // generation feeding the player's reserve
  let reserve = pool;
  let drawn = 0;      // how much of the reserve this turn actually spends

  // Every tile you've fed is where a wave starts. What that costs you depends
  // on whether it can pay its own way: a generator banks enough to cover
  // itself (buildings.js's selfSustaining) and hands the grid the rest, so
  // feeding one is a one-off decision. Anything else is carried by your
  // reserve for as long as it runs.
  const sources = [];
  grids.forEach((grid, index) => {
    for (const cell of grid) {
      if (!cell.enabled) continue;
      const building = buildingFor(cell);
      // A generator with nothing banked can't restart itself, so feeding it
      // achieves nothing (see selfStarting in buildings.js).
      if (!selfStarting(building)) continue;
      sources.push({ cell, index, need: selfSustaining(building) ? 0 : costOf(building) });
    }
  });

  // The ones that need carrying are all-or-none together: if the reserve can't
  // cover them, none come up rather than the rule choosing which of your tiles
  // matters. Self-sustaining ones are never held hostage to that — a generator
  // shouldn't go dark because you also fed one crystal too many.
  const upkeep = sources.reduce((total, source) => total + source.need, 0);
  const carried = upkeep <= reserve;
  if (carried && upkeep > 0) {
    reserve -= upkeep;
    drawn += upkeep;
  }
  for (const { cell, index, need } of sources) {
    if (need > 0 && !carried) continue;
    const building = buildingFor(cell);
    powered.add(cell);
    consumed += costOf(building);
    if (paysPool(building)) poolIncome += generationOf(building);
    else {
      produced += generationOf(building);
      // A carried tile's cost came out of the reserve, so all of its
      // generation is free for the cascade. A self-sustaining one spent its
      // own cost on itself, so it hands over what's left: a plant nets +4.
      surplus[index] += generationOf(building) - (need > 0 ? 0 : costOf(building));
    }
  }

  for (;;) {
    // Everything unpowered that's wired to something lit, filed by cost and
    // then by which grid is being asked to pay for it.
    const classes = new Map();
    for (const cell of powered) {
      for (const neighbour of wiredNeighbours(world, cell)) {
        if (powered.has(neighbour)) continue;
        const cost = costOf(buildingFor(neighbour));
        if (!classes.has(cost)) classes.set(cost, new Map());
        const byGrid = classes.get(cost);
        const index = gridOf.get(neighbour);
        if (!byGrid.has(index)) byGrid.set(index, new Set());
        byGrid.get(index).add(neighbour);
      }
    }
    if (classes.size === 0) break;

    let progressed = false;
    for (const cost of [...classes.keys()].sort((a, b) => b - a)) {
      for (const [index, cells] of classes.get(cost)) {
        // Whole cost class or none of it, out of that grid's own generation.
        // The reserve is not an option here — a cascade reaches exactly as far
        // as its generators pay for, which is what makes wiring to a plant
        // worth doing instead of feeding tiles one at a time.
        const total = cost * cells.size;
        if (total > surplus[index]) continue;
        surplus[index] -= total;
        for (const cell of cells) {
          const building = buildingFor(cell);
          powered.add(cell);
          consumed += cost;
          if (paysPool(building)) poolIncome += generationOf(building);
          else {
            produced += generationOf(building);
            surplus[index] += generationOf(building);
          }
        }
        progressed = true;
      }
    }
    // A class skipped this round may become affordable once a generator the
    // wave just reached starts contributing, so keep going while anything
    // changes.
    if (!progressed) break;
  }

  // Tiles you paid to light that didn't come up — the reserve couldn't cover
  // the jump-start. Everything else that's unlit is just board the wave hasn't
  // reached, which isn't a failure and isn't worth flagging.
  const dark = new Set();
  for (const cell of world.cells) {
    if (cell.enabled && buildingFor(cell).conducts && !powered.has(cell)) dark.add(cell);
  }

  return { powered, dark, produced, consumed, fromPool: drawn, poolIncome };
}
