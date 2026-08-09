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
// **Storage is a third source, and it only ever pays for its own tile.** A tile
// holding at least its own cost spends that and comes up free — no reserve
// draw, no claim on the grid. A powered generator then refills its own storage
// out of its output *before* the remainder joins the cascade, so an engine
// guarantees its own next turn and hands over what's left. Storage banked this
// turn can't be spent until the next one, which is what makes the first click a
// jump-start you pay for.
//
// This is why there's no `selfStarting` predicate any more. Whether something
// can run itself isn't asserted in the building table — it falls out of whether
// its own output refills its own storage. A generator that can't is simply dark
// next turn, which is a one-shot flare, and needs no special case.
//
// Storage never funds a neighbour. That's deliberate: it's a stock, and the
// Milestone 19 disaster was a greedy wave spending a stock as though it were an
// income. Bounded to its own tile, the cascade still only ever sees a flow.
//
// **The wave.** A fed plant spends 1 of its 5 refilling itself and hands its
// grid 4, carrying exactly four crystals. Each step, the wave looks at every
// unpowered tile wired to what's already lit and tries to pay for it out of
// that grid's remaining generation:
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
// **Upkeep is all-or-none.** If the reserve can't carry every tile you've fed
// *and still needs paying for*, none of those come up. Same reason as within a
// cost class: the alternative is the rule choosing which of your tiles matters.
// It makes running out a cliff rather than a slide — but the pool ticking down
// toward your upkeep is the warning, and it arrives many turns ahead.
//
// Tiles running on their own storage aren't part of that bargain, since the
// reserve isn't carrying them. An engine you got going stays going.
//
// Pure: reads the world, changes nothing — including storage, which comes back
// in the result as `stored` for the caller to commit.

import {
  buildingFor, costOf, generationOf, paysPool, storageOf,
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
// Returns { powered, dark, produced, consumed, fromPool, poolIncome, stored,
// selfPowered, perGrid } — `dark` being tiles you fed that the reserve couldn't
// carry, and `stored` the next value of every tile's storage, for the caller to
// commit.
//
// Note fromPool is *not* `consumed - produced`. The three sources never mix: the
// reserve pays for the tiles you fed and nothing else, generation pays for the
// cascade and nothing else, and a tile's storage pays for that tile and nothing
// else. That separation is the whole economy — a grid sitting on unused surplus
// can't subsidise your reserve, a fat reserve can't push a cascade one tile
// further than its generator affords, and a charged battery can't fund a
// neighbour.
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
  const selfPowered = new Set();
  // Next turn's storage for every tile, starting from this turn's. Spending and
  // refilling both land here, so nothing this turn banks can be spent this turn.
  const stored = new Map(world.cells.map((cell) => [cell, cell.stored ?? 0]));
  let produced = 0;   // generation feeding grids, after refills
  let consumed = 0;   // what the powered set draws
  let poolIncome = 0; // generation feeding the player's reserve
  let reserve = pool;
  let drawn = 0;      // how much of the reserve this turn actually spends

  // What each generator handed its grid this turn, after refilling itself.
  // Recorded as it happens rather than reconstructed afterwards, so the budget
  // view can report the same numbers the solve actually used.
  const contributed = new Map();

  // A powered tile refills its own storage out of its own output before any of
  // it reaches the grid, so an engine always buys its own next turn first.
  // Returns what's left over for the cascade.
  function generate(cell) {
    const building = buildingFor(cell);
    const output = generationOf(building);
    if (output === 0) return 0;
    if (paysPool(building)) {
      poolIncome += output;
      return 0;
    }
    const room = Math.max(0, storageOf(building) - stored.get(cell));
    const refill = Math.min(room, output);
    stored.set(cell, stored.get(cell) + refill);
    const spare = output - refill;
    contributed.set(cell, spare);
    produced += spare;
    return spare;
  }

  // Where a wave can start. A tile holding its own cost comes up on that,
  // costing nobody anything; otherwise feeding it puts the bill on your reserve.
  const selfFunded = [];
  const reserveFunded = [];
  grids.forEach((grid, index) => {
    for (const cell of grid) {
      const cost = costOf(buildingFor(cell));
      // cost > 0 so that a hypothetical free tile isn't a spontaneous source
      // just because zero banked meets a zero bill.
      if (cost > 0 && stored.get(cell) >= cost) selfFunded.push({ cell, index });
      else if (cell.enabled) reserveFunded.push({ cell, index });
    }
  });

  // Storage pays for its own tile, so these aren't part of the reserve's
  // all-or-none bargain — an engine you got going keeps going even on a turn
  // your reserve can't carry the rest.
  for (const { cell, index } of selfFunded) {
    const building = buildingFor(cell);
    stored.set(cell, stored.get(cell) - costOf(building));
    powered.add(cell);
    selfPowered.add(cell);
    consumed += costOf(building);
    surplus[index] += generate(cell);
  }

  // All of them or none of them: if the reserve can't carry everything it's
  // still being asked to, none of those come up rather than the rule choosing
  // which of your tiles matters. Running out is meant to be a cliff.
  const upkeep = reserveFunded.reduce((total, { cell }) => total + costOf(buildingFor(cell)), 0);
  if (upkeep <= reserve) {
    reserve -= upkeep;
    drawn += upkeep;
    for (const { cell, index } of reserveFunded) {
      powered.add(cell);
      consumed += costOf(buildingFor(cell));
      surplus[index] += generate(cell);
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
          powered.add(cell);
          consumed += cost;
          // A generator the wave reaches also refills itself first, so next
          // turn it comes up on its own storage and stops billing this grid.
          surplus[index] += generate(cell);
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

  // Per-grid figures, so the budget view can report what each grid made and
  // spent without re-deriving the economy and risking a different answer.
  const perGrid = grids.map((group, index) => ({
    cells: group,
    // What this grid's generators actually handed it, after their own refills.
    generation: group.reduce(
      (total, cell) => total + (contributed.get(cell) ?? 0),
      0
    ),
    // What the cascade spent here. Tiles you fed come out of the reserve and
    // tiles on their own storage cost nobody anything, so neither counts.
    draw: group.reduce(
      (total, cell) => total + (powered.has(cell) && !selfPowered.has(cell) && !cell.enabled
        ? costOf(buildingFor(cell))
        : 0),
      0
    ),
    spare: surplus[index],
  }));

  return {
    powered, dark, produced, consumed, fromPool: drawn, poolIncome,
    stored, selfPowered, perGrid, contributed,
  };
}
