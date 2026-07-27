// Grid geometry helpers. Kept separate from buildings.js and level.js so both
// can use them without importing each other.

export function cellAt(world, x, y) {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return null;
  return world.cells[y * world.width + x];
}

const HORIZONTAL = [[1, 0], [-1, 0]];
const VERTICAL = [[0, 1], [0, -1]];
const ORTHOGONAL = [...HORIZONTAL, ...VERTICAL];

function neighboursAlong(world, cell, vectors) {
  return vectors
    .map(([dx, dy]) => cellAt(world, cell.x + dx, cell.y + dy))
    .filter((c) => c !== null);
}

// Deliberately no diagonals. At ~50% density, orthogonal adjacency keeps
// crystal clusters below the percolation threshold and therefore finite;
// including diagonals would light most of the board from a single tap.
// See design.md.
export function orthogonalNeighbours(world, cell) {
  return neighboursAlong(world, cell, ORTHOGONAL);
}

// East/west only — used by green crystal, which propagates along one axis.
export function horizontalNeighbours(world, cell) {
  return neighboursAlong(world, cell, HORIZONTAL);
}

// North/south only — used by red crystal, which propagates along one axis.
export function verticalNeighbours(world, cell) {
  return neighboursAlong(world, cell, VERTICAL);
}
