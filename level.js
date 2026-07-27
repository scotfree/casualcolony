// Level loading and validation.
//
// A level is a JSON file: a size, a legend mapping characters to building type
// ids, and the grid as an array of row strings. Row strings mean a level can be
// read and hand-edited in a text editor, which matters more than tidiness for a
// puzzle game.
//
// Validation is strict and loud. A malformed level should fail at load with a
// message naming the problem, not render as a mysteriously wrong board.

import { BUILDINGS } from "./buildings.js";

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
      cells.push({
        x,
        y,
        type: typeId,
        // null until the cell is scheduled to light up. Once set, it holds the
        // timestamp at which the cell becomes active — see cascade.js.
        activateAt: null,
      });
    }
  }

  return { name: name || "Untitled", width: size.width, height: size.height, cells };
}

export async function loadLevel(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url}: HTTP ${response.status}`);
  }
  return parseLevel(await response.json());
}
