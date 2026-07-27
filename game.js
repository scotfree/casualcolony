// Casual Colony — board rendering, input and the cascade animation.
// Bump VERSION on each deploy so you can tell a fresh deploy from a cached one.

import { loadLevel } from "./level.js";
import { computeCascade, triggeredDrains } from "./cascade.js";
import { cellAt } from "./grid.js";
import { buildingFor } from "./buildings.js";

const VERSION = "0.6.0";
const LEVEL_URL = "./levels/random-crystal-forest.json";

// Milliseconds between successive rings of a cascade, and how long a single
// cell takes to pop in. Together these set the whole feel of a chain reaction.
const RIPPLE_STEP = 70;
const LIGHT_TIME = 220;

const HUD_HEIGHT = 58;
const BOARD_MARGIN = 10;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

let world = null;
let loadError = null;
// null while playing, "win" or "lose" once energy runs out and the last
// cascade has finished animating.
let outcome = null;

// Board geometry, recomputed on resize.
let width = 0;
let height = 0;
let cellSize = 0;
let originX = 0;
let originY = 0;
let resetButton = null;

// --- Layout -----------------------------------------------------------------
// The canvas fills its safe-area-inset stage; the board is square-celled and
// letterboxed inside it, so cells stay geometrically correct on every device.

function resize() {
  const dpr = window.devicePixelRatio || 1;
  width = canvas.clientWidth;
  height = canvas.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (!world) return;

  const availableWidth = width - BOARD_MARGIN * 2;
  const availableHeight = height - HUD_HEIGHT - BOARD_MARGIN;
  cellSize = Math.floor(
    Math.min(availableWidth / world.width, availableHeight / world.height)
  );
  const boardWidth = cellSize * world.width;
  const boardHeight = cellSize * world.height;
  originX = Math.round((width - boardWidth) / 2);
  originY = Math.round(HUD_HEIGHT + (availableHeight - boardHeight) / 2);
}

// A ResizeObserver watches the canvas box itself, so geometry can't go stale
// when the box changes without a window resize event — which is exactly what
// happens when mobile Safari collapses its address bar.
new ResizeObserver(resize).observe(canvas);

// --- Input ------------------------------------------------------------------
// Pointer Events cover touch, mouse and stylus in one path.

function cellFromPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((clientX - rect.left - originX) / cellSize);
  const y = Math.floor((clientY - rect.top - originY) / cellSize);
  return cellAt(world, x, y);
}

function hitsResetButton(clientX, clientY) {
  if (!resetButton) return false;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  return (
    x >= resetButton.x &&
    x <= resetButton.x + resetButton.w &&
    y >= resetButton.y &&
    y <= resetButton.y + resetButton.h
  );
}

canvas.addEventListener("pointerdown", (event) => {
  if (!world) return;

  if (hitsResetButton(event.clientX, event.clientY)) {
    for (const cell of world.cells) {
      cell.activateAt = null;
      cell.drainedAt = null;
    }
    world.energy = world.energyBudget;
    outcome = null;
    return;
  }

  // No taps once the budget is spent — the run is over, win or lose.
  if (world.energy <= 0) return;

  const cell = cellFromPoint(event.clientX, event.clientY);
  if (!cell) return;

  const building = buildingFor(cell);
  if (building.drain) {
    const drained = building.drain(world, cell);
    if (drained.length === 0) return; // nothing to drain, so no energy spent
    for (const target of drained) target.activateAt = null;
    world.energy -= 1;
    cell.drainedAt = performance.now(); // brief self-pulse, see drawCell
    return;
  }

  const cascade = computeCascade(world, cell);
  if (cascade.length === 0) return; // nothing activated, so no energy spent

  // Schedule the whole chain up front: each cell lights when the clock reaches
  // its activateAt. No timers to manage, and the ripple falls out of BFS depth.
  const now = performance.now();
  for (const { cell: target, depth } of cascade) {
    target.activateAt = now + depth * RIPPLE_STEP;
  }
  world.energy -= 1;

  // Any drain adjacent to a cell this cascade just lit reacts immediately —
  // it can't create a new trigger for another drain (draining only removes
  // activation), so one pass over the whole board is enough.
  for (const { sink, targets } of triggeredDrains(world)) {
    for (const target of targets) target.activateAt = null;
    sink.drainedAt = now;
  }
});

// --- Rendering --------------------------------------------------------------

// 0 while dormant, ramping to 1 as the cell finishes lighting up.
function litProgress(cell, now) {
  if (cell.activateAt === null || now < cell.activateAt) return 0;
  return Math.min((now - cell.activateAt) / LIGHT_TIME, 1);
}

// 1 right when a drain fires, fading to 0 over LIGHT_TIME — a self-pulse so
// tapping a drain reads as "this did something" even before you spot the
// neighbour it drained going dark.
function drainPulse(cell, now) {
  if (cell.drainedAt === null) return 0;
  return Math.max(0, 1 - (now - cell.drainedAt) / LIGHT_TIME);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function drawDiamond(cx, cy, gem) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - gem);
  ctx.lineTo(cx + gem, cy);
  ctx.lineTo(cx, cy + gem);
  ctx.lineTo(cx - gem, cy);
  ctx.closePath();
  ctx.fill();
}

// Settles the win/lose outcome once energy is spent and every scheduled
// cascade has finished animating — not the instant energy hits zero, so the
// last ripple still gets to play out.
function updateOutcome(now) {
  if (!world || outcome || world.energy > 0) return;
  for (const cell of world.cells) {
    if (cell.activateAt !== null && now < cell.activateAt + LIGHT_TIME) return;
  }
  const activated = world.cells.filter((cell) => cell.activateAt !== null).length;
  const fraction = activated / world.cells.length;
  outcome = fraction >= world.completionGoal ? "win" : "lose";
}

function drawCell(cell, now) {
  const building = buildingFor(cell);
  const x = originX + cell.x * cellSize;
  const y = originY + cell.y * cellSize;
  const pad = Math.max(1, Math.round(cellSize * 0.06));
  const size = cellSize - pad * 2;
  const radius = Math.round(cellSize * 0.18);

  ctx.fillStyle = building.fill;
  ctx.strokeStyle = building.stroke;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x + pad, y + pad, size, size, radius);
  ctx.fill();
  ctx.stroke();

  const cx = x + cellSize / 2;
  const cy = y + cellSize / 2;

  // A static marker gem for buildings with no on/off state of their own
  // (drain): always visible at a fixed size, with a brief brighter pulse
  // the moment it actually does something.
  if (building.icon) {
    const pulse = drainPulse(cell, now);
    const gem = size * 0.44 * (1 + Math.sin(pulse * Math.PI) * 0.14);
    if (pulse > 0) {
      ctx.shadowColor = building.glow;
      ctx.shadowBlur = 18 * pulse;
    }
    ctx.fillStyle = building.icon;
    drawDiamond(cx, cy, gem);
    ctx.shadowBlur = 0;
    return;
  }

  if (building.inert) return;

  const t = litProgress(cell, now);
  const eased = easeOutCubic(t);
  // Swell past full size and settle back, so a cascade reads as a series of
  // small pops rather than a wave of colour.
  const pop = Math.sin(eased * Math.PI) * 0.14;
  const scale = (0.55 + 0.45 * eased) * (1 + pop);
  const gem = size * 0.44 * scale;

  if (t > 0) {
    ctx.shadowColor = building.glow;
    ctx.shadowBlur = 18 * eased;
  }
  ctx.fillStyle = t > 0 ? building.lit : building.dormant;
  drawDiamond(cx, cy, gem);
  ctx.shadowBlur = 0;
}

function drawHud() {
  // Counted the same way as the win condition — a fraction of every cell on
  // the board, not just the activatable ones — so this number and the
  // completion goal shown on the outcome screen never disagree.
  const active = world.cells.filter((cell) => cell.activateAt !== null).length;
  const total = world.cells.length;

  // Two rows: name + reset on top, activation/energy stats below. A single
  // row overlapped the name with the stats on narrow phones.
  const row1 = HUD_HEIGHT * 0.36;
  const row2 = HUD_HEIGHT * 0.76;
  ctx.textBaseline = "middle";

  ctx.fillStyle = "#8ea3b5";
  ctx.textAlign = "left";
  ctx.font = "13px ui-monospace, monospace";
  ctx.fillText(world.name, 14, row1);

  ctx.fillStyle = "#5eead4";
  ctx.textAlign = "center";
  ctx.fillText(`${active} / ${total} activated   ⚡ ${world.energy}`, width / 2, row2);

  const label = "reset";
  ctx.fillStyle = "#4a5568";
  ctx.textAlign = "right";
  ctx.fillText(label, width - 14, row1);

  // Generous tap target around the label — 13px text is far too small to hit.
  const textWidth = ctx.measureText(label).width;
  resetButton = { x: width - 14 - textWidth - 12, y: 0, w: textWidth + 26, h: HUD_HEIGHT };
}

function drawOutcome() {
  const activated = world.cells.filter((cell) => cell.activateAt !== null).length;
  const fraction = activated / world.cells.length;

  ctx.fillStyle = "#12161ccc";
  ctx.fillRect(0, HUD_HEIGHT, width, height - HUD_HEIGHT);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = outcome === "win" ? "#5eead4" : "#f87171";
  ctx.font = "20px ui-monospace, monospace";
  ctx.fillText(outcome === "win" ? "You win" : "Out of energy", width / 2, height / 2 - 14);

  ctx.fillStyle = "#8ea3b5";
  ctx.font = "13px ui-monospace, monospace";
  const goalPct = Math.round(world.completionGoal * 100);
  const gotPct = Math.round(fraction * 100);
  ctx.fillText(`${gotPct}% activated · goal was ${goalPct}%`, width / 2, height / 2 + 14);
  ctx.fillText("tap reset to try again", width / 2, height / 2 + 36);
}

function drawError(message) {
  ctx.fillStyle = "#12161c";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#f87171";
  ctx.font = "13px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Level failed to load", width / 2, height / 2 - 30);
  ctx.fillStyle = "#8ea3b5";
  ctx.fillText(message, width / 2, height / 2);
  ctx.fillText("Serving over http?", width / 2, height / 2 + 30);
}

function render(now) {
  ctx.fillStyle = "#12161c";
  ctx.fillRect(0, 0, width, height);

  if (loadError) {
    drawError(loadError);
    return;
  }
  if (!world) return;

  for (const cell of world.cells) drawCell(cell, now);
  drawHud();
  if (outcome) drawOutcome();
}

// --- Loop -------------------------------------------------------------------

function frame(now) {
  updateOutcome(now);
  render(now);
  requestAnimationFrame(frame);
}

// --- Start ------------------------------------------------------------------

document.getElementById("version").textContent = "v" + VERSION;
resize();
requestAnimationFrame(frame);

loadLevel(LEVEL_URL)
  .then((loaded) => {
    world = loaded;
    resize();
  })
  .catch((error) => {
    loadError = error.message;
    console.error(error);
  });
