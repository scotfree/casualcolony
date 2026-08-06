// Explaining the last turn.
//
// The board shows *what* changed — tiles light, the energy number moves —
// but not why any of it followed from the tile you touched. Several of this
// game's rules are only visible in their consequences: that propagation past
// the tapped tile is free, that a mine with nobody living on the board earns
// nothing, that a tile next to a drain can never stay lit. A player can be
// surprised by all three and have nowhere to look.
//
// So each line pairs an effect with the short reason it happened. Only the
// most recent turn: this is "what did that do", not a history to scroll.
//
// Reads the turn record applyTap already produced (rules.js) rather than
// diffing the board — the turn knows exactly what it did, and re-deriving it
// afterwards would be guesswork dressed up as fact.

import { buildingFor } from "./buildings.js";

function at(cell) {
  return `(${cell.x},${cell.y})`;
}

function nameOf(cell) {
  return buildingFor(cell).name;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// How many cells currently earning-capable buildings are active — used to
// explain income, or the lack of it.
function activeEarners(world) {
  return world.cells.filter((cell) => cell.active && buildingFor(cell).colony?.flows).length;
}

// [{ what, why }] describing `turn`, most important first. Empty if no turn
// has happened yet.
export function describeTurn(world, turn) {
  if (!turn) return [];
  const lines = [];
  const { level } = world;

  // --- What you touched, and what it cost.
  if (turn.kind === "cull") {
    lines.push({
      what: `Culled ${nameOf(turn.cell)} at ${at(turn.cell)} — free`,
      why: "turning an active residential back off never costs energy, so a starving colony can always be fixed",
    });
  } else if (turn.kind === "drain") {
    lines.push({
      what: `Tapped Drain at ${at(turn.cell)} — spent ${turn.energySpent} ⚡`,
      why: "a drain has its own flat cost, and only charges when it actually clears something",
    });
    lines.push({
      what: `Cleared ${plural(turn.cleared.length, "tile")}`,
      why: "a drain deactivates every activated neighbour, whatever type it is",
    });
  } else {
    lines.push({
      what: `Tapped ${nameOf(turn.cell)} at ${at(turn.cell)} — spent ${turn.energySpent} ⚡`,
      why: "a direct tap pays that tile's own activation cost out of the energy pool",
    });

    const boost = buildingFor(turn.cell).boostKey ? level[buildingFor(turn.cell).boostKey] : 0;
    if (turn.lit.length === 1) {
      lines.push({
        what: "Lit 1 tile",
        why: "a tap hands a tile exactly its own cost, so there was nothing left over to reach a neighbour",
      });
    } else {
      lines.push({
        what: `Lit ${plural(turn.lit.length, "tile")}`,
        why: boost
          ? `${nameOf(turn.cell)} adds ${boost} signal, and everything past the tapped tile is free`
          : "each neighbour got enough signal to cover its own activation cost",
      });
    }

    if (turn.reactedDrains > 0) {
      lines.push({
        what: `${plural(turn.reactedDrains, "drain")} took back ${plural(turn.cleared.length, "tile")}`,
        why: "a drain absorbs a neighbour the instant it lights, so a tile beside one can never stay lit",
      });
    }
  }

  // --- What it did to the colony.
  // Only what actually moved — reporting "population 0 → 0" because the food
  // count changed is noise dressed up as information.
  const { before, colony } = turn;
  const changes = [];
  if (before.population !== colony.population) {
    changes.push(`Population ${before.population} → ${colony.population}`);
  }
  if (before.foodCapacity !== colony.foodCapacity) {
    changes.push(`${changes.length ? "f" : "F"}ood capacity ${before.foodCapacity} → ${colony.foodCapacity}`);
  }
  if (changes.length > 0) {
    lines.push({
      what: changes.join(", "),
      why: "counted fresh from the board every turn, not tracked — culling drops it the same turn",
    });
  }

  const delta = colony.energyDelta;
  const earners = activeEarners(world);
  if (delta > 0) {
    lines.push({
      what: `+${delta} ⚡ income`,
      why: `${plural(earners, "mine")} working, colony fed (${colony.population}/${colony.foodCapacity})`,
    });
  } else if (delta < 0) {
    lines.push({
      what: `${delta} ⚡ starvation`,
      why: `${colony.population} people but food for only ${colony.foodCapacity} — culling a residential stops it`,
    });
  } else if (earners > 0 && colony.population === 0) {
    // The single most confusing "nothing happened": mines that look active
    // and are producing nothing at all.
    lines.push({
      what: "No income",
      why: `${plural(earners, "mine")} active but nobody lives here — a mine needs a resident to work it`,
    });
  }

  lines.push({
    what: `Energy ${turn.energyBefore} → ${turn.energyAfter}`,
    why: turn.energyAfter === 0 ? "at zero, the run ends once nothing is still animating" : "cost first, then income",
  });

  return lines;
}
