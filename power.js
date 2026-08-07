// Which tiles are powered, this turn.
//
// This replaces the old cascade-with-decay. That model handed a tapped cell
// some "signal" which shrank by each tile's cost as it travelled outward, and
// crucially *wasn't conserved* — a branch handed the same remaining amount to
// every neighbour, so a wide network cost no more than a narrow one. Reach
// depended on distance and nothing else.
//
// Now energy is conserved and the unit is the **component**: everything wired
// together shares one budget. A grid runs if what it generates covers what it
// costs, and the shortfall (if any) comes out of the player's pool. So a plant
// making 5 supports 5 tiles' worth of load *in total*, wherever they sit —
// which makes topology, not distance, the thing that matters. Wire is tiles
// and tiles cost, so distance still costs; it just isn't a separate rule.
//
// Two things fall out of that and are load-bearing:
//
//   **Brownout is all-or-nothing per component.** Partial power would mean
//   choosing which tiles to drop, and the engine must never make a geographic
//   choice the player can't predict. It also keeps the maths well-defined:
//   generation comes from powered tiles, so "which subset runs" would be
//   circular, while "would the whole thing afford itself" is a plain question.
//
//   **Generators need storage to restart themselves.** Energy can't pay for
//   the turn that produces it, so a generator covers its own cost from what it
//   banked last turn (see buildings.js's `selfStarting`). A plant with storage
//   >= its cost runs forever once switched on; one without would fire once and
//   go dark.
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

// Two enabled tiles are wired together only if *both* agree to conduct along
// the axis between them. That symmetry is what lets parallel runs sit flush
// against each other without merging — two adjacent columns of red crystal are
// two grids, not one. (It doesn't let runs *cross*: a green tile in a red run
// breaks it, since one tile has one axis.)
function wiredNeighbours(world, cell) {
  const building = buildingFor(cell);
  const axis = AXES[building.conducts];
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
    // Both ends must conduct along this direction.
    if (!theirAxis.some(([ndx, ndy]) => ndx === -dx && ndy === -dy)) continue;
    out.push(neighbour);
  }
  return out;
}

// Every connected group of enabled, conducting tiles. A disabled tile is off
// the grid entirely — it neither draws nor carries.
export function components(world) {
  const seen = new Set();
  const groups = [];
  for (const cell of world.cells) {
    if (!cell.enabled || seen.has(cell)) continue;
    if (!buildingFor(cell).conducts) continue;
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

// What one component costs, makes, and therefore needs from the pool.
function budget(group) {
  let cost = 0;
  let generation = 0;
  let poolIncome = 0;
  for (const cell of group) {
    const building = buildingFor(cell);
    cost += costOf(building);
    if (!selfStarting(building)) continue; // can't restart itself, makes nothing
    if (paysPool(building)) poolIncome += generationOf(building);
    else generation += generationOf(building);
  }
  return { cost, generation, poolIncome, shortfall: Math.max(0, cost - generation) };
}

// Solves the whole board for this turn.
//
// Returns { powered, dark, shortfall, poolIncome, groups } — `powered` and
// `dark` are Sets of cells, `shortfall` is what the pool must cover for the
// powered set to run, and `poolIncome` is what the powered mines pay back.
//
// `available` is what the pool can spend. Components whose grids pay for
// themselves always run; the rest run only if the pool covers *all* of their
// shortfalls together. Covering some and not others would be the engine
// choosing which grid to sacrifice.
export function solvePower(world, available = world.energy) {
  const groups = components(world);
  const scored = groups.map((group) => ({ group, ...budget(group) }));

  const totalShortfall = scored.reduce((sum, s) => sum + s.shortfall, 0);
  const canAffordAll = totalShortfall <= available;

  const powered = new Set();
  const dark = new Set();
  let shortfall = 0;
  let poolIncome = 0;

  for (const entry of scored) {
    const runs = entry.shortfall === 0 || canAffordAll;
    for (const cell of entry.group) (runs ? powered : dark).add(cell);
    if (!runs) continue;
    shortfall += entry.shortfall;
    poolIncome += entry.poolIncome;
  }

  return { powered, dark, shortfall, poolIncome, groups: scored };
}
