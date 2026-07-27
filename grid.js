// Grid geometry helpers. Kept separate from buildings.js and level.js so both
// can use them without importing each other.

export function cellAt(world, x, y) {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return null;
  return world.cells[y * world.width + x];
}

const ORTHOGONAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Deliberately no diagonals. At ~50% density, orthogonal adjacency keeps
// crystal clusters below the percolation threshold and therefore finite;
// including diagonals would light most of the board from a single tap.
// See design.md.
export function orthogonalNeighbours(world, cell) {
  return ORTHOGONAL
    .map(([dx, dy]) => cellAt(world, cell.x + dx, cell.y + dy))
    .filter((c) => c !== null);
}
