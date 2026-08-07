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

  if (turn.kind === "enable") {
    lines.push({
      what: `Switched on ${nameOf(turn.cell)} at ${at(turn.cell)}`,
      why: `it draws ${costOf(building)} from its grid every turn` +
        (generationOf(building) > 0
          ? `, and makes ${generationOf(building)}${paysPool(building) ? " into your pool" : ""}`
          : ""),
    });
  } else {
    lines.push({
      what: `Switched off ${nameOf(turn.cell)} at ${at(turn.cell)}`,
      why: "switching off is free and immediate — it's how you cut load a grid can't carry",
    });
  }

  // The grids, and whether they can pay for themselves.
  const strained = turn.groups.filter((g) => g.shortfall > 0);
  if (turn.groups.length > 0) {
    const biggest = [...turn.groups].sort((a, b) => b.group.length - a.group.length)[0];
    lines.push({
      what: `${plural(turn.groups.length, "grid")}, largest ${plural(biggest.group.length, "tile")}` +
        ` (makes ${biggest.generation}, costs ${biggest.cost})`,
      why: "everything wired together shares one budget — a grid runs only if the whole of it is affordable",
    });
  }

  if (turn.darkened.length > 0) {
    lines.push({
      what: `${plural(turn.darkened.length, "tile")} went dark`,
      why: "a grid that can't cover its own cost browns out entirely — never partly, so the game never picks which tiles to drop",
    });
  } else if (turn.lit.length > 0) {
    lines.push({
      what: `${plural(turn.lit.length, "tile")} came on`,
      why: "the pulse spreads out from the generators feeding that grid",
    });
  }

  if (turn.shortfall > 0) {
    lines.push({
      what: `−${turn.shortfall} ⚡ upkeep`,
      why: `${plural(strained.length, "grid")} can't pay for ${strained.length === 1 ? "itself" : "themselves"} — your pool is covering the difference`,
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
      why: `${colony.population} people, food for ${colony.foodCapacity} — switch a residential off to stop it`,
    });
  }

  lines.push({
    what: `Energy ${turn.energyBefore} → ${turn.energyAfter}`,
    why: turn.energyAfter === 0
      ? "empty: any grid that isn't paying for itself goes dark now"
      : "upkeep first, then what the mines paid back",
  });

  return lines;
}

function hasPoweredMine(world) {
  return world.cells.some((cell) => cell.powered && paysPool(buildingFor(cell)));
}
