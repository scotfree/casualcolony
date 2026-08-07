// Fog — what you can currently see, and therefore what you can currently do.
//
// Visibility gates *action*, not just knowledge: a tile you can't see can't
// be tapped (see rules.js). That's what keeps fog meaningful on a
// deterministic board — knowing exactly where the mine is doesn't help until
// you've got sight out to it. What fog does *not* do is make you re-learn the
// board: a cell that has ever been visible stays drawn, dimmed, forever
// (`cell.seen`). Hiding what you already saw would tax memory, not skill.
//
// **Deliberately unlike signal reach.** Cascades travel through connected,
// activatable tiles and pay each tile's own activationCost, so their range
// depends entirely on what's in the way. Fog is the opposite: a flat Manhattan
// radius that ignores terrain completely and crosses desert freely. That's
// what stops it being a second, redundant reach limit — it shows you across
// the gaps your network can't conduct across, which is exactly where a direct
// tap is worth spending.
//
// Manhattan rather than a square radius because everything in this game is
// orthogonal-adjacency on purpose (see Milestone 1's percolation note); a
// square would smuggle diagonals in through the back door.

import { buildingFor } from "./buildings.js";

// Anything that provides sight. Powered cells always qualify — which is what
// guarantees a powered cell is always visible (it's zero steps from itself),
// so fog can never hide a running grid, and can never block switching off the
// thing that's draining you.
//
// Cells flagged startsVisible stay sources for the whole run, not just the
// first turn: they're the level's guaranteed foothold, and a seed that
// stopped counting the moment you activated something could strand a run
// that later lost its other sources.
function sightSources(world) {
  return world.cells.filter((cell) => cell.powered || cell.startsVisible);
}

// How far a cell sees. Buildings can extend it locally via `sight` (a tower);
// everything else sees exactly as far as the level's fog allows.
function reachOf(cell, fogDistance) {
  return fogDistance + (buildingFor(cell).sight ?? 0);
}

// The set of cells currently visible. A multi-source walk outward from every
// sight source, which is O(cells) regardless of how many sources there are —
// it ignores terrain entirely, so a plain flood outward *is* the Manhattan
// distance field.
//
// fogDistance -1 means no fog: everything is visible, which is how every
// level behaved before this existed.
export function visibleCells(world) {
  const { fogDistance } = world.level;
  if (fogDistance < 0) return new Set(world.cells);

  const visible = new Set();
  // frontier holds cells still able to spread sight, with how much reach is
  // left. A cell can be reached twice with different budgets, so it's kept if
  // the new budget is larger — a tower's longer reach must win over an
  // ordinary cell's.
  const budget = new Map();
  let frontier = [];
  for (const cell of sightSources(world)) {
    const reach = reachOf(cell, fogDistance);
    if (reach < 0) continue;
    if ((budget.get(cell) ?? -1) >= reach) continue;
    budget.set(cell, reach);
    frontier.push(cell);
  }

  const { width, height } = world.level;
  const at = (x, y) =>
    x < 0 || y < 0 || x >= width || y >= height ? null : world.cells[y * width + x];

  while (frontier.length > 0) {
    const next = [];
    for (const cell of frontier) {
      visible.add(cell);
      const left = budget.get(cell);
      if (left <= 0) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const neighbour = at(cell.x + dx, cell.y + dy);
        if (!neighbour) continue;
        if ((budget.get(neighbour) ?? -1) >= left - 1) continue;
        budget.set(neighbour, left - 1);
        next.push(neighbour);
      }
    }
    frontier = next;
  }

  return visible;
}

// Marks everything currently visible as seen, so the renderer can keep
// drawing it once it falls back into the dark. Call after anything that
// changes the board.
export function rememberVisible(world, visible = visibleCells(world)) {
  for (const cell of visible) cell.seen = true;
  return visible;
}
