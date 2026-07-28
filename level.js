// Level loading and validation.
//
// A level is a JSON record: a size, a legend mapping characters to building
// type ids, and the grid as an array of row strings. Row strings mean a level
// can be read and hand-edited in a text editor, which matters more than
// tidiness for a puzzle game.
//
// Levels ship as a *set* — a JSON array of these records, each named — not
// one file per level, so the game can offer a list to choose from without a
// separate index. serializeLevel() below is the inverse of parseLevel(): it
// turns a live, possibly-edited world back into the same record shape, for
// the level editor to hand to storage.js.
//
// Validation is strict and loud. A malformed level should fail at load with a
// message naming the problem, not render as a mysteriously wrong board.

import { BUILDINGS } from "./buildings.js";

export function parseLevel(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Level is not an object");
  }

  const {
    name, size, legend, grid, energyBudget, completionGoal, attenuation, powerPlantBoost,
    foodPerFarm, mineYield, starvationPenalty,
  } = data;

  if (!size || !Number.isInteger(size.width) || !Number.isInteger(size.height)) {
    throw new Error("Level needs integer size.width and size.height");
  }
  if (size.width < 1 || size.height < 1) {
    throw new Error(`Level size must be positive, got ${size.width}x${size.height}`);
  }
  if (!legend || typeof legend !== "object") {
    throw new Error("Level needs a legend");
  }
  if (!Array.isArray(grid)) {
    throw new Error("Level needs a grid array");
  }
  if (grid.length !== size.height) {
    throw new Error(`Level declares height ${size.height} but grid has ${grid.length} rows`);
  }

  for (const [char, typeId] of Object.entries(legend)) {
    if (!BUILDINGS[typeId]) {
      throw new Error(`Legend maps '${char}' to unknown building type '${typeId}'`);
    }
  }

  const cells = [];
  for (let y = 0; y < size.height; y++) {
    const row = grid[y];
    if (typeof row !== "string") {
      throw new Error(`Grid row ${y} is not a string`);
    }
    if (row.length !== size.width) {
      throw new Error(
        `Grid row ${y} has ${row.length} characters, expected ${size.width}`
      );
    }
    for (let x = 0; x < size.width; x++) {
      const char = row[x];
      const typeId = legend[char];
      if (!typeId) {
        throw new Error(`Unknown character '${char}' at row ${y}, column ${x}`);
      }
      cells.push({
        x,
        y,
        type: typeId,
        // null until the cell is scheduled to light up. Once set, it holds the
        // timestamp at which the cell becomes active — see cascade.js.
        activateAt: null,
        // null except briefly after a drain tile fires — holds the timestamp
        // of that tap, purely for the self-pulse animation. See game.js.
        drainedAt: null,
      });
    }
  }

  if (!Number.isInteger(energyBudget) || energyBudget < 1) {
    throw new Error("Level needs a positive integer energyBudget");
  }
  if (typeof completionGoal !== "number" || completionGoal <= 0 || completionGoal > 1) {
    throw new Error("Level needs completionGoal between 0 (exclusive) and 1 (inclusive)");
  }
  // Optional: how much signal a hop costs. Unlike energyBudget/completionGoal
  // there's no reason every level should have to choose one, so it defaults
  // rather than being required.
  const resolvedAttenuation = attenuation === undefined ? 1 : attenuation;
  if (typeof resolvedAttenuation !== "number" || resolvedAttenuation < 0) {
    throw new Error("Level's attenuation must be a non-negative number");
  }
  // Optional, same reasoning as attenuation: a building-specific number that
  // varies per level rather than being fixed in the building table.
  const resolvedPowerPlantBoost = powerPlantBoost === undefined ? 5 : powerPlantBoost;
  if (typeof resolvedPowerPlantBoost !== "number" || resolvedPowerPlantBoost < 0) {
    throw new Error("Level's powerPlantBoost must be a non-negative number");
  }
  // Optional, same reasoning again: the colony economy's three knobs. See
  // colony.js for how they combine.
  const resolvedFoodPerFarm = foodPerFarm === undefined ? 1 : foodPerFarm;
  if (typeof resolvedFoodPerFarm !== "number" || resolvedFoodPerFarm < 0) {
    throw new Error("Level's foodPerFarm must be a non-negative number");
  }
  const resolvedMineYield = mineYield === undefined ? 2 : mineYield;
  if (typeof resolvedMineYield !== "number" || resolvedMineYield < 0) {
    throw new Error("Level's mineYield must be a non-negative number");
  }
  const resolvedStarvationPenalty = starvationPenalty === undefined ? 1 : starvationPenalty;
  if (typeof resolvedStarvationPenalty !== "number" || resolvedStarvationPenalty < 0) {
    throw new Error("Level's starvationPenalty must be a non-negative number");
  }

  return {
    name: name || "Untitled",
    width: size.width,
    height: size.height,
    cells,
    // Kept around (not just consumed above) so tools like the level editor
    // can know which building types this level's author actually chose.
    legend,
    energyBudget,
    completionGoal,
    attenuation: resolvedAttenuation,
    powerPlantBoost: resolvedPowerPlantBoost,
    foodPerFarm: resolvedFoodPerFarm,
    mineYield: resolvedMineYield,
    starvationPenalty: resolvedStarvationPenalty,
    // Mutable: energy spent tapping cells. Reset to energyBudget to replay.
    energy: energyBudget,
  };
}

// Loads and validates every record in a level set up front — a malformed
// level anywhere in the set fails loudly at startup, not confusingly later
// when a player happens to pick it. Returns the raw records, not parsed
// worlds: each one gets parsed fresh (via parseLevel) only once actually
// selected, so playing/resetting a level never reuses another's mutable
// per-cell state.
export async function loadLevelSet(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url}: HTTP ${response.status}`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error(`Level set at ${url} must be a JSON array`);
  }
  data.forEach((record, i) => {
    if (!record || typeof record.name !== "string" || !record.name) {
      throw new Error(`Level set entry ${i} needs a non-empty name`);
    }
    parseLevel(record); // throws with a specific reason if this entry is broken
  });
  return data;
}

// The inverse of parseLevel: turns a live world (cells may have had their
// type edited in place by the level editor) back into a plain JSON-shaped
// level record under the given name. Only tile types can differ from the
// record this world was parsed from — energyBudget, completionGoal,
// attenuation, powerPlantBoost, foodPerFarm, mineYield and
// starvationPenalty are carried through unchanged, since editing never
// touches them.
export function serializeLevel(world, name) {
  const charFor = {};
  for (const [char, typeId] of Object.entries(world.legend)) {
    if (!(typeId in charFor)) charFor[typeId] = char;
  }

  const grid = [];
  for (let y = 0; y < world.height; y++) {
    let row = "";
    for (let x = 0; x < world.width; x++) {
      row += charFor[world.cells[y * world.width + x].type];
    }
    grid.push(row);
  }

  return {
    name,
    size: { width: world.width, height: world.height },
    energyBudget: world.energyBudget,
    completionGoal: world.completionGoal,
    attenuation: world.attenuation,
    powerPlantBoost: world.powerPlantBoost,
    foodPerFarm: world.foodPerFarm,
    mineYield: world.mineYield,
    starvationPenalty: world.starvationPenalty,
    legend: world.legend,
    grid,
  };
}
