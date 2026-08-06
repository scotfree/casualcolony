// Level loading, validation, and starting a run.
//
// A level is a JSON record: a size, a legend mapping characters to building
// type ids, and the grid as an array of row strings. Row strings mean a level
// can be read and hand-edited in a text editor, which matters more than
// tidiness for a puzzle game.
//
// Levels ship as a *set* — a JSON array of these records, each named — not
// one file per level, so the game can offer a list to choose from without a
// separate index. serializeLevel() below is the inverse of parseLevel(): it
// turns a live, possibly-edited run back into the same record shape, for the
// level editor to hand to storage.js.
//
// **Level and run are separate objects, on purpose.** parseLevel returns a
// *level*: the immutable definition (size, legend, tile types, goal, budget,
// tuning knobs). createRun turns one into a *world*: the mutable state of one
// attempt at it (energy left, which cells are active). Replaying a level is
// then just another createRun on the same level — no re-reading JSON, no
// revalidating, and no chance of inheriting stale per-cell state from the
// previous attempt. It also means a run can be snapshotted (energy plus one
// boolean per cell) without dragging the whole level definition along, which
// is what any future undo would need.
//
// Validation is strict and loud. A malformed level should fail at load with a
// message naming the problem, not render as a mysteriously wrong board.

import { BUILDINGS } from "./buildings.js";

// Every numeric field a level carries, declared once. Adding a knob means one
// entry here — parsing, validation, defaulting and serialization all read
// this table, rather than each growing another near-identical stanza.
//
//   required — must be present; otherwise `default` is used when omitted
//   integer  — must be a whole number
//   min/max  — inclusive bounds, unless exclusiveMin says otherwise
//   label    — how the field is described in an error message
const LEVEL_NUMBERS = {
  energyBudget: {
    required: true, integer: true, min: 1,
    label: "a positive integer energyBudget",
  },
  completionGoal: {
    required: true, min: 0, max: 1, exclusiveMin: true,
    label: "completionGoal between 0 (exclusive) and 1 (inclusive)",
  },
  // How much a power plant boosts signal passing through it. Unlike
  // activation cost, which is a property of the building *type* (see
  // buildings.js), boost stays level-tunable: "how far can a plant reach" is
  // a real level-design lever.
  powerPlantBoost: { default: 5, min: 0, label: "powerPlantBoost" },
  // The colony economy's knobs — see colony.js for how they combine, and
  // buildings.js for which building refers to which by name.
  foodPerFarm: { default: 1, min: 0, label: "foodPerFarm" },
  mineYield: { default: 2, min: 0, label: "mineYield" },
  starvationPenalty: { default: 1, min: 0, label: "starvationPenalty" },
};

function parseNumbers(data) {
  const out = {};
  for (const [key, spec] of Object.entries(LEVEL_NUMBERS)) {
    const raw = data[key];
    if (raw === undefined) {
      if (spec.required) throw new Error(`Level needs ${spec.label}`);
      out[key] = spec.default;
      continue;
    }
    const ok =
      typeof raw === "number" &&
      Number.isFinite(raw) &&
      (!spec.integer || Number.isInteger(raw)) &&
      (spec.min === undefined || (spec.exclusiveMin ? raw > spec.min : raw >= spec.min)) &&
      (spec.max === undefined || raw <= spec.max);
    if (!ok) {
      throw new Error(
        spec.required
          ? `Level needs ${spec.label}`
          : `Level's ${spec.label} must be a non-negative number`
      );
    }
    out[key] = raw;
  }
  return out;
}

// Parses and validates a level record into an immutable level definition.
// Its `cells` are plain {x, y, type} — the board's *shape*, with none of the
// per-attempt state that createRun adds.
export function parseLevel(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Level is not an object");
  }

  const { name, size, legend, grid } = data;

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
      cells.push({ x, y, type: typeId });
    }
  }

  return {
    name: name || "Untitled",
    width: size.width,
    height: size.height,
    cells,
    // Kept around (not just consumed above) so tools like the level editor
    // can know which building types this level's author actually chose.
    legend,
    ...parseNumbers(data),
  };
}

// Starts a fresh attempt at `level`: full energy, nothing activated. The
// level itself is shared by reference (it's never mutated by play), while
// every cell gets its own mutable state.
//
// A cell's `active` is the simulation's truth — whether it counts, feeds,
// mines, or conducts. `litAt` and `drainedAt` are presentation only: when the
// cell should *appear* to light up, and when a drain last flashed. Keeping
// those apart means the rules never depend on the animation clock, and a run
// can be reasoned about (or replayed, or snapshotted) with no clock at all.
export function createRun(level) {
  return {
    level,
    energy: level.energyBudget,
    cells: level.cells.map((cell) => ({
      x: cell.x,
      y: cell.y,
      // Mutable: the level editor retypes cells in place on the live run.
      type: cell.type,
      active: false,
      litAt: null,
      drainedAt: null,
    })),
  };
}

// Loads and validates every record in a level set up front — a malformed
// level anywhere in the set fails loudly at startup, not confusingly later
// when a player happens to pick it. Returns the raw records, not parsed
// levels: each one is parsed only once actually selected.
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

// The inverse of parseLevel: turns a live run (whose cells may have been
// retyped in place by the level editor) back into a plain JSON-shaped level
// record under the given name. Only tile types can differ from the level this
// run started from — every number is carried through unchanged, since editing
// never touches them.
export function serializeLevel(world, name) {
  const { level } = world;
  const charFor = {};
  for (const [char, typeId] of Object.entries(level.legend)) {
    if (!(typeId in charFor)) charFor[typeId] = char;
  }

  const grid = [];
  for (let y = 0; y < level.height; y++) {
    let row = "";
    for (let x = 0; x < level.width; x++) {
      row += charFor[world.cells[y * level.width + x].type];
    }
    grid.push(row);
  }

  const record = {
    name,
    size: { width: level.width, height: level.height },
  };
  for (const key of Object.keys(LEVEL_NUMBERS)) record[key] = level[key];
  record.legend = level.legend;
  record.grid = grid;
  return record;
}
