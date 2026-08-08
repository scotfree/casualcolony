// Explaining the last turn.
//
// The board shows *what* changed but not why it followed from the tile you
// touched, and under grid budgets the most confusing moments are exactly the
// ones with no visible cause: a whole component going dark because one more
// tile tipped it over its generation, or a mine sitting powered and paying
// nothing because nobody lives there. Each line pairs an effect with the short
// reason behind it.
//
// Reads the record applyTurn already produced (rules.js) rather than diffing
// the board — the turn knows what it did, and re-deriving it afterwards would
// be guesswork.

import { buildingFor, costOf, generationOf, paysPool } from "./buildings.js";

const at = (cell) => `(${cell.x},${cell.y})`;
const nameOf = (cell) => buildingFor(cell).name;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// [{ what, why }] describing `turn`, most important first.
export function describeTurn(world, turn) {
  if (!turn) return [];
  const lines = [];
  const building = buildingFor(turn.cell);

  lines.push({
    what: `Fed ${nameOf(turn.cell)} at ${at(turn.cell)}`,
    why: generationOf(building) > 0
      ? `it makes ${generationOf(building)}${paysPool(building) ? " into your pool" : ""} against a cost of ${costOf(building)}, and a cascade now starts here`
      : `your reserve covers its ${costOf(building)} every turn, and a cascade now starts here`,
  });

  lines.push({
    what: `Grid makes ${turn.produced}, draws ${turn.consumed}`,
    why: "energy flows outward from what you've fed, paying for the dearest tiles it reaches first",
  });

  if (turn.darkened.length > 0) {
    lines.push({
      what: `${plural(turn.darkened.length, "tile")} went dark`,
      why: "generation ran out before it got there — feed a tile nearer them, or wire in another plant",
    });
  } else if (turn.lit.length > 0) {
    lines.push({
      what: `${plural(turn.lit.length, "tile")} came on`,
      why: "the pulse spreads out from the generators feeding that grid",
    });
  }

  if (turn.fromPool > 0) {
    lines.push({
      what: `−${turn.fromPool} ⚡ upkeep`,
      why: "your grid draws more than it makes, so the reserve is covering the difference every turn",
    });
  }

  const { colony } = turn;
  if (turn.income > 0) {
    lines.push({
      what: `+${turn.income} ⚡ mined`,
      why: `colony fed and staffed (${colony.population}/${colony.foodCapacity})`,
    });
  } else if (colony.population === 0 && [...turn.dark].length === 0 && hasPoweredMine(world)) {
    lines.push({
      what: "No income",
      why: "a mine needs somebody living on the board to work it",
    });
  }

  if (turn.starvation > 0) {
    lines.push({
      what: `−${turn.starvation} ⚡ starvation`,
      why: `${colony.population} people, food for ${colony.foodCapacity} — it stops when a farm comes online`,
    });
  }

  lines.push({
    what: `Energy ${turn.energyBefore} → ${turn.energyAfter}`,
    why: turn.energyAfter === 0
      ? "empty: nothing you've fed can be carried now"
      : "upkeep on everything you've fed, then what the mines paid back",
  });

  return lines;
}

function hasPoweredMine(world) {
  return world.cells.some((cell) => cell.powered && paysPool(buildingFor(cell)));
}
