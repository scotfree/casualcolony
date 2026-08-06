// What a tap does. The game's actual rules, in one place.
//
// This used to live inside game.js's pointerdown handler, which meant the
// rule existed three times: once for real, once hand-copied into the test
// suite, and once more inside "is there anything left worth tapping". They
// drifted, and every balance change had to be made in all three. Now there's
// one rule, and the DOM handler, the tests and the board-exhaustion check are
// all just callers.
//
// resolveTap is *pure* — it answers "what would tapping here do" without
// doing it, which is what makes the other two callers possible. applyTap is
// the only thing that mutates, and the split is what a future undo would be
// built on: a resolved tap already describes exactly what it's about to
// change.
//
// Presentation stays out of both. applyTap takes a `now` purely to stamp when
// cells should *appear* to light; the rules themselves never read a clock.

import { computeCascade, triggeredDrains } from "./cascade.js";
import { resolveColony } from "./colony.js";
import { buildingFor } from "./buildings.js";

// Milliseconds between successive rings of a cascade. Lives here rather than
// in the renderer because applyTap is what stamps the ripple, and the ripple
// falls out of BFS depth, which is a rules-side concept.
export const RIPPLE_STEP = 70;

// Draining isn't part of the activation network — a drain never lights up, it
// only ever clears neighbours — so there's no "its own activation cost" to
// charge. It keeps a flat price of its own.
export const DRAIN_COST = 1;

// What tapping `cell` would do, without doing it. Always returns a result
// object; `ok` says whether the tap would actually change anything.
//
//   kind "cull"     — a toggle building (residential) switching back off
//   kind "drain"    — a drain clearing its activated neighbours
//   kind "activate" — the ordinary case: light a cell, and whatever its
//                     cascade reaches beyond it
//
// `reason` on a failed tap is "noop" (nothing there to change) or "energy"
// (something to change, but not enough energy to pay for it).
export function resolveTap(world, cell) {
  if (!cell) return { kind: "none", ok: false, reason: "noop", energyCost: 0 };
  const building = buildingFor(cell);

  // Tapping an already-active toggle building deactivates it instead of
  // no-opping — the player's tool for fixing a starving colony. Free, and
  // allowed even at 0 energy: the whole point is to recover from starvation,
  // and a cull that itself cost energy (or was blocked by the very shortage
  // it fixes) couldn't always do that.
  if (cell.active && building.toggle) {
    return { kind: "cull", ok: true, energyCost: 0, cell };
  }

  if (building.drain) {
    const targets = building.drain(world, cell);
    if (targets.length === 0) {
      return { kind: "drain", ok: false, reason: "noop", energyCost: 0, cell };
    }
    if (world.energy < DRAIN_COST) {
      return { kind: "drain", ok: false, reason: "energy", energyCost: DRAIN_COST, cell };
    }
    return { kind: "drain", ok: true, energyCost: DRAIN_COST, cell, targets };
  }

  const cascade = computeCascade(world, cell);
  if (cascade.length === 0) {
    return { kind: "activate", ok: false, reason: "noop", energyCost: 0, cell };
  }

  // A direct tap "jump starts" a tile by paying its own activationCost out of
  // the energy pool — the alternative to reaching it for free through an
  // already-powered network (see cascade.js). Can't afford it, can't tap it.
  // Everything past the tapped cell is free, paid for by the network's own
  // signal rather than the pool.
  const energyCost = building.activationCost ?? 1;
  if (world.energy < energyCost) {
    return { kind: "activate", ok: false, reason: "energy", energyCost, cell };
  }
  return { kind: "activate", ok: true, energyCost, cell, cascade };
}

// Applies a resolved tap to the world, then resolves the colony against the
// board it leaves behind. Returns that colony result (the caller may want to
// show it); ignores a tap that wasn't ok, so callers can hand results through
// without checking twice.
//
// `now` only stamps presentation state — when each cell should appear to
// light, and when a drain last flashed. Pass nothing and everything lands at
// once, which is exactly what a test or a simulation wants.
export function applyTap(world, tap, now = 0) {
  if (!tap.ok) return null;

  if (tap.kind === "cull") {
    tap.cell.active = false;
    tap.cell.litAt = null;
  } else if (tap.kind === "drain") {
    for (const target of tap.targets) {
      target.active = false;
      target.litAt = null;
    }
    world.energy -= tap.energyCost;
    tap.cell.drainedAt = now; // brief self-pulse, see the renderer
  } else {
    // Schedule the whole chain up front: each cell lights when the clock
    // reaches its litAt. No timers to manage, and the ripple falls out of
    // BFS depth.
    for (const { cell, depth } of tap.cascade) {
      cell.active = true;
      cell.litAt = now + depth * RIPPLE_STEP;
    }
    world.energy -= tap.energyCost;

    // Any drain adjacent to a cell this cascade just lit reacts immediately —
    // it can't create a new trigger for another drain (draining only removes
    // activation), so one pass over the whole board is enough.
    for (const { sink, targets } of triggeredDrains(world)) {
      for (const target of targets) {
        target.active = false;
        target.litAt = null;
      }
      sink.drainedAt = now;
    }
  }

  const colony = resolveColony(world);
  world.energy = Math.max(0, world.energy + colony.energyDelta);
  return colony;
}

// Convenience for tests and simulations: resolve and apply in one call.
// Returns the resolved tap so a caller can tell whether anything happened.
export function tap(world, cell, now = 0) {
  const resolved = resolveTap(world, cell);
  applyTap(world, resolved, now);
  return resolved;
}

// Whether any tap could still change the board in a way that moves the run
// forward. Deliberately ignores a cull: it's free and reversible, so its mere
// availability shouldn't keep a run "in progress" forever.
//
// Because this asks resolveTap the same question the player's finger does, it
// can't disagree with what tapping actually does — affordability included.
export function hasProductiveMove(world) {
  return world.cells.some((cell) => {
    const resolved = resolveTap(world, cell);
    return resolved.ok && resolved.kind !== "cull";
  });
}

// How much of the board is lit, as a fraction of every cell on it — inert
// ones included, which is what ties a level's completionGoal to its density.
export function activatedFraction(world) {
  const activated = world.cells.filter((cell) => cell.active).length;
  return activated / world.cells.length;
}
