// How energy flows, and therefore what's powered this turn.
//
// Energy propagates *locally*, outward from generators, the way the original
// cascade did — but conserved. The old model handed each neighbour whatever
// signal was left over, so a branch duplicated it and a wide network cost no
// more than a narrow one. Here every unit is spent exactly once.
//
// **The wave.** Generators that can start themselves (see `selfStarting`)
// light first and put their surplus into the wave. Each step, the wave looks
// at every unpowered tile wired to what's already lit and tries to pay for
// them — and this is the interesting part:
//
//   Tiles are served in **descending order of cost**, a whole cost class at a
//   time. If the wave can afford the entire class it powers all of it; if it
//   can't, it skips that class and tries the next cheaper one.
//
// Expensive tiles therefore get first refusal on whatever energy reaches
// them, and can starve a branch beyond them — which is a routing mechanic you
// can build with deliberately, not just a limit.
//
// **Why whole classes.** Only three distinct costs exist and roughly half of
// a typical board is cost 1, so ties are the common case, not a corner. Any
// per-tile tiebreak ("top-left wins") would therefore be the rule silently
// deciding most outcomes — the engine choosing geography, which it must never
// do. All-or-none within a class removes the question entirely: nothing is
// ever picked over an equal peer.
//
// **The frontier pools its surplus** rather than each tile spending its own.
// Otherwise a tile bordered by two powered neighbours would be funded by
// whichever the walk happened to visit first, and traversal order would leak
// into the result.
//
// **Generation stays inside its own grid.** Surplus is tracked per connected
// component, so a plant can only feed what it's actually wired to. This is the
// whole reason topology is worth playing with — an unreachable surplus is a
// routing problem, not a rounding error.
//
// **The reserve tops the wave up, and it's shared.** Whatever a grid's own
// generation can't cover comes out of the player's pool, which is what makes
// an over-extended network drain you a little every turn instead of simply
// refusing to run. Because there's only one reserve, two grids can contend for
// it — and when it can't cover everyone asking, none of them draw. Same rule
// as within a cost class, for the same reason: the alternative is the engine
// choosing which grid matters.
//
// **A grid with no generator runs entirely off the reserve, or not at all.**
// There's no origin inside it for a wave to start from, so there's nothing to
// spread — it's the one case that isn't a cascade. Whole grid or nothing, and
// it's settled after the wave so an unaffordable remote cluster fails on its
// own terms rather than darkening the grid you already had running.
//
// Pure: reads the world, changes nothing. The caller applies the result.

import {
  buildingFor, costOf, generationOf, paysPool, selfStarting,
} from "./buildings.js";

const AXES = {
  all: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  vertical: [[0, 1], [0, -1]],
  horizontal: [[1, 0], [-1, 0]],
};

// Two enabled tiles are wired together only if *both* conduct along the axis
// between them. That symmetry lets parallel runs sit flush without merging —
// two adjacent columns of red crystal are two grids, not one. It doesn't let
// runs *cross*: a green tile in a red run breaks it, since one tile has one
// axis.
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
    if (!neighbour.enabled) continue;
    const theirAxis = AXES[buildingFor(neighbour).conducts];
    if (!theirAxis) continue;
    if (!theirAxis.some(([ndx, ndy]) => ndx === -dx && ndy === -dy)) continue;
    out.push(neighbour);
  }
  return out;
}

// Every connected group of enabled, conducting tiles — one "grid". The solve
// uses these to keep each grid's generation to itself; it's also what "how
// many separate grids do I have" means for the log and the tests.
export function components(world) {
  const seen = new Set();
  const groups = [];
  for (const cell of world.cells) {
    if (!cell.enabled || seen.has(cell) || !buildingFor(cell).conducts) continue;
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
// `dark` being tiles the player switched on that the wave couldn't reach.
//
// Note fromPool is *not* `consumed - produced`: a grid sitting on unused
// surplus doesn't offset another grid's shortfall, because the two aren't
// wired together. Only the reserve is shared.
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

  // Anything that can bring itself up starts the wave in its own grid.
  grids.forEach((grid, index) => {
    for (const cell of grid) {
      const building = buildingFor(cell);
      if (generationOf(building) === 0 || paysPool(building)) continue;
      if (!selfStarting(building)) continue;
      powered.add(cell);
      surplus[index] += generationOf(building) - costOf(building);
      produced += generationOf(building);
      consumed += costOf(building);
    }
  });

  // A generator that doesn't even cover its own cost leans on the reserve from
  // the outset, so settle that before anything downstream asks for it.
  surplus.forEach((value, index) => {
    if (value >= 0) return;
    reserve += value;
    drawn -= value;
    surplus[index] = 0;
  });

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
      const byGrid = classes.get(cost);

      // A grid that can pay for its whole share of the class out of its own
      // generation simply does. The rest are competing for the one reserve.
      const selfFunded = [];
      const contested = [];
      let needed = 0;
      for (const [index, cells] of byGrid) {
        const total = cost * cells.size;
        if (total <= surplus[index]) selfFunded.push([index, cells, total]);
        else {
          contested.push([index, cells, total]);
          needed += total - surplus[index];
        }
      }

      // All or none, twice over: a whole cost class within a grid, and a whole
      // set of contenders for the reserve. Anything less would mean picking
      // between equals, which is the one thing the rule must never do.
      const funding = needed <= reserve ? selfFunded.concat(contested) : selfFunded;
      if (funding.length === 0) continue;
      if (contested.length > 0 && needed <= reserve) {
        reserve -= needed;
        drawn += needed;
      }

      for (const [index, cells, total] of funding) {
        surplus[index] = Math.max(0, surplus[index] - total);
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
      }
      progressed = true;
    }
    // A class skipped this round may become affordable once a generator the
    // wave just reached starts contributing, so keep going while anything
    // changes.
    if (!progressed) break;
  }

  // A grid with no generator of its own has no origin for a wave to start
  // from, so it can't cascade — it runs straight off the reserve, all of it or
  // none of it. That's what lets you spend banked energy on a cluster you
  // haven't wired up yet, at the price of paying for every tile of it every
  // turn. (rules.js lights these at once, for the same reason.)
  //
  // Settled *after* the wave, deliberately: switching on a remote cluster you
  // can't afford should fail on its own terms, not black out the grid you
  // already had running.
  const orphans = [];
  let orphanNeed = 0;
  grids.forEach((grid, index) => {
    if (grid.some((cell) => powered.has(cell))) return;
    const total = grid.reduce((sum, cell) => sum + costOf(buildingFor(cell)), 0);
    orphans.push([grid, total]);
    orphanNeed += total;
  });
  if (orphans.length > 0 && orphanNeed <= reserve) {
    reserve -= orphanNeed;
    drawn += orphanNeed;
    for (const [grid, total] of orphans) {
      consumed += total;
      for (const cell of grid) {
        const building = buildingFor(cell);
        powered.add(cell);
        if (paysPool(building)) poolIncome += generationOf(building);
        else produced += generationOf(building);
      }
    }
  }

  const dark = new Set();
  for (const cell of world.cells) {
    if (cell.enabled && buildingFor(cell).conducts && !powered.has(cell)) dark.add(cell);
  }

  return { powered, dark, produced, consumed, fromPool: drawn, poolIncome };
}
