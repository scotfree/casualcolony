// What a click does, and what a turn does. The game's actual rules.
//
// A click **toggles a tile on or off** — that's the whole of the player's
// vocabulary. It's free in itself; you pay for what you *run*, every turn,
// which is what makes switching something off the way you fix an
// over-committed grid. (Residential's old "free cull" was a special case of
// this before everything became toggleable.)
//
// A turn happens whenever a click actually changes the board. Solving it is:
//
//   1. work out which components can run (power.js)
//   2. take their shortfall out of the pool
//   3. resolve the colony against whatever came out powered
//   4. add what the powered mines pay back, take off any starvation
//
// resolveTap is pure — it answers "what would this click do" without doing
// it — which is what lets the same rule serve the input handler, the tests
// and the outcome check. applyTurn is the only thing that mutates.

import { solvePower } from "./power.js";
import { resolveColony, poolIncome, starvationCost } from "./colony.js";
import { buildingFor, generationOf } from "./buildings.js";
import { visibleCells } from "./visibility.js";

// Milliseconds between successive rings of the pulse. Lives here because
// applyTurn is what stamps it, and it falls out of distance from a generator,
// which is a rules-side idea.
export const RIPPLE_STEP = 70;

// What clicking `cell` would do, without doing it. `ok` says whether it would
// change anything; `reason` on a failure is "inert" (nothing to switch),
// "hidden" (out of sight — see visibility.js) or "noop".
export function resolveTap(world, cell, visible = visibleCells(world)) {
  if (!cell) return { kind: "none", ok: false, reason: "noop" };

  // Fog gates what you can *do*. An enabled cell is always visible (it's zero
  // steps from itself), so this can never trap you into being unable to switch
  // off the thing that's draining you.
  if (!visible.has(cell)) return { kind: "none", ok: false, reason: "hidden", cell };

  const building = buildingFor(cell);
  if (!building.conducts) return { kind: "none", ok: false, reason: "inert", cell };

  return cell.enabled
    ? { kind: "disable", ok: true, cell }
    : { kind: "enable", ok: true, cell };
}

// How far each powered cell is from the nearest generator feeding its grid.
// Only used to stagger the pulse — every powered cell lights either way, so
// this decides timing, never outcome.
function pulseDepths(world, powered) {
  const depth = new Map();
  let frontier = [];
  for (const cell of powered) {
    if (generationOf(buildingFor(cell)) > 0) {
      depth.set(cell, 0);
      frontier.push(cell);
    }
  }
  // A grid with no generator of its own (running purely on the pool) has no
  // natural origin, so it just lights at once.
  if (frontier.length === 0) {
    for (const cell of powered) depth.set(cell, 0);
    return depth;
  }
  const { width, height } = world.level;
  let d = 1;
  while (frontier.length > 0) {
    const next = [];
    for (const cell of frontier) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = cell.x + dx;
        const y = cell.y + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const neighbour = world.cells[y * width + x];
        if (!powered.has(neighbour) || depth.has(neighbour)) continue;
        depth.set(neighbour, d);
        next.push(neighbour);
      }
    }
    frontier = next;
    d++;
  }
  for (const cell of powered) if (!depth.has(cell)) depth.set(cell, 0);
  return depth;
}

// Applies a resolved click and then runs the turn. Returns a record of
// everything that happened, which is what makes the turn explainable
// afterwards (see log.js) rather than something the UI has to reconstruct.
//
// `now` only stamps presentation state — when each cell should appear to
// pulse. Pass nothing and everything lands at once, which is what a test or a
// simulation wants.
export function applyTurn(world, tap, now = 0) {
  if (!tap.ok) return null;

  const wasPowered = new Set(world.cells.filter((cell) => cell.powered));
  const energyBefore = world.energy;
  tap.cell.enabled = tap.kind === "enable";

  const solved = solvePower(world, world.energy);
  world.energy -= solved.shortfall;

  const colony = resolveColony(world, solved.powered);
  const income = poolIncome(world, solved.powered, colony);
  const starvation = starvationCost(world, colony);
  world.energy = Math.max(0, world.energy + income - starvation);

  // Stamp the pulse. Cells that were already powered keep their existing
  // timestamp so a steady grid doesn't re-flash from scratch every turn;
  // newly powered ones ripple out from their generator.
  const depths = pulseDepths(world, solved.powered);
  for (const cell of world.cells) {
    const powered = solved.powered.has(cell);
    if (powered && !wasPowered.has(cell)) cell.litAt = now + depths.get(cell) * RIPPLE_STEP;
    else if (!powered) cell.litAt = null;
    cell.powered = powered;
    if (powered) cell.seen = true;
  }

  return {
    kind: tap.kind,
    cell: tap.cell,
    energyBefore,
    energyAfter: world.energy,
    shortfall: solved.shortfall,
    income,
    starvation,
    lit: [...solved.powered].filter((c) => !wasPowered.has(c)),
    darkened: [...wasPowered].filter((c) => !solved.powered.has(c)),
    dark: solved.dark,
    colony,
    groups: solved.groups,
  };
}

// Convenience for tests and simulations: resolve and apply in one call.
export function tap(world, cell, now = 0) {
  const resolved = resolveTap(world, cell);
  applyTurn(world, resolved, now);
  return resolved;
}

// Solves the board without a click — used to settle the opening position, so
// a level that starts with tiles already enabled is powered before turn one.
export function settle(world) {
  const solved = solvePower(world, world.energy);
  for (const cell of world.cells) {
    cell.powered = solved.powered.has(cell);
    if (cell.powered) cell.seen = true;
  }
  return solved;
}

// How much of the board is powered right now, as a fraction of every cell —
// inert ones included, which is what ties a level's goal to its density.
export function poweredFraction(world) {
  return world.cells.filter((cell) => cell.powered).length / world.cells.length;
}

// How much of the board has ever been seen. Monotonic, unlike powered.
export function revealedFraction(world) {
  return world.cells.filter((cell) => cell.seen).length / world.cells.length;
}
