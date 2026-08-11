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
//   error    — the whole message, for a field the default phrasing misfits
const LEVEL_NUMBERS = {
  energyBudget: {
    required: true, integer: true, min: 0,
    // 0 is legitimate now: a level can hand you a grid that pays for itself
    // and no reserve at all.
    label: "a non-negative integer energyBudget",
  },
  // The colony economy's knobs — see colony.js. Cost and generation are no
  // longer level-tunable: they're properties of what a tile *is* (see
  // buildings.js), and having them in two places was half the confusion.
  foodPerFarm: { default: 1, min: 0, label: "foodPerFarm" },
  starvationPenalty: { default: 1, min: 0, label: "starvationPenalty" },
  // How far visibility reaches from anything that provides it, in plain
  // Manhattan steps — see visibility.js. -1 means no fog at all, which is how
  // every level behaved before fog existed, so omitting it changes nothing.
  fogDistance: {
    default: -1, integer: true, min: -1, label: "fogDistance",
    error: "Level's fogDistance must be -1 (no fog) or a whole number of tiles",
  },
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
        spec.error ??
        (spec.required
          ? `Level needs ${spec.label}`
          : `Level's ${spec.label} must be a non-negative number`)
      );
    }
    out[key] = raw;
  }
  return out;
}

// Flags the cells named by a sparse [x, y] list. Sparse rather than a second
// full-board grid: it's usually a handful of tiles, and a mask of mostly-blank
// rows would be noise to read and to diff.
function markCells(cells, size, pairs, field) {
  if (pairs === undefined) return;
  if (!Array.isArray(pairs)) {
    throw new Error(`Level's ${field} must be an array of [x, y] pairs`);
  }
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isInteger)) {
      throw new Error(`Level's ${field} entries must be [x, y] pairs`);
    }
    const [x, y] = pair;
    if (x < 0 || y < 0 || x >= size.width || y >= size.height) {
      throw new Error(`Level's ${field} has (${x},${y}) outside the board`);
    }
    cells[y * size.width + x][field] = true;
  }
}

// What a level asks for. `powered` is a snapshot — how much of the board's
// power demand is running right now — and is the systems-shaped goal.
// `revealed` is monotonic, counting anything ever seen.
const GOAL_KINDS = new Set(["powered", "revealed"]);

const DEFAULT_GOAL = { kind: "powered", value: 0.2 };

function parseGoal(goal) {
  if (goal === undefined) return { ...DEFAULT_GOAL };
  if (!goal || typeof goal !== "object") throw new Error("Level's goal must be an object");
  if (!GOAL_KINDS.has(goal.kind)) {
    throw new Error(`Level's goal.kind must be one of: ${[...GOAL_KINDS].join(", ")}`);
  }
  if (typeof goal.value !== "number" || goal.value <= 0 || goal.value > 1) {
    throw new Error("Level's goal.value must be between 0 (exclusive) and 1 (inclusive)");
  }
  return { kind: goal.kind, value: goal.value };
}

// Parses and validates a level record into an immutable level definition.
// Its `cells` are plain {x, y, type} — the board's *shape*, with none of the
// per-attempt state that createRun adds.
export function parseLevel(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Level is not an object");
  }

  const { name, size, legend, grid, startsVisible, startsEnabled, goal } = data;

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
      cells.push({ x, y, type: typeId, startsVisible: false, startsEnabled: false });
    }
  }

  // Cells that provide visibility from the outset, as [x, y] pairs. A fogged
  // level needs at least one or nothing is visible, so nothing is tappable,
  // and the run can't begin — see visibility.js. A sparse coordinate list
  // rather than a second grid: it's usually one or two tiles, and a
  // full-board mask of mostly-blank rows would be noise to read and to diff.
  markCells(cells, size, startsVisible, "startsVisible");
  // Tiles already switched on when the run begins. This is what lets a level
  // open mid-situation — a grid already running at a deficit, with just enough
  // pool to fix it before the lights go out.
  markCells(cells, size, startsEnabled, "startsEnabled");

  return {
    name: name || "Untitled",
    width: size.width,
    height: size.height,
    cells,
    // Kept around (not just consumed above) so tools like the level editor
    // can know which building types this level's author actually chose.
    legend,
    ...parseNumbers(data),
    goal: parseGoal(goal),
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
      // Mutable: the level editor retypes cells in place on the live run, and
      // can toggle which ones seed visibility.
      type: cell.type,
      startsVisible: cell.startsVisible,
      startsEnabled: cell.startsEnabled,
      // The player's switch, and whether the grid is actually carrying it.
      // Two different questions: an enabled tile in an over-committed
      // component is switched on but dark (see power.js).
      enabled: cell.startsEnabled,
      powered: false,
      // Energy this tile has banked across turn boundaries. A generator refills
      // its own storage out of its output and spends it to come up the next
      // turn, so a run starting at 0 means the first click is always a
      // jump-start you pay for (power.js).
      stored: 0,
      litAt: null,
      // Whether this cell has ever been visible this run. Fog gates what you
      // can *do*, but hiding what you've already seen would only tax memory —
      // see visibility.js and the renderer.
      seen: false,
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
  // Only written when the level actually uses it, so an unfogged level's
  // record stays exactly as small as it was before fog existed.
  const seeds = world.cells.filter((cell) => cell.startsVisible).map((cell) => [cell.x, cell.y]);
  if (seeds.length > 0) record.startsVisible = seeds;
  const on = world.cells.filter((cell) => cell.startsEnabled).map((cell) => [cell.x, cell.y]);
  if (on.length > 0) record.startsEnabled = on;
  record.goal = level.goal;
  return record;
}
