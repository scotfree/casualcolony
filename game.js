// Casual Colony — board rendering, input and the cascade animation.
// Bump VERSION on each deploy so you can tell a fresh deploy from a cached one.

import { loadLevel } from "./level.js";
import { computeCascade } from "./cascade.js";
import { cellAt } from "./grid.js";
import { buildingFor } from "./buildings.js";

const VERSION = "0.2.0";
const LEVEL_URL = "./levels/random-crystal-forest.json";

// Milliseconds between successive rings of a cascade, and how long a single
// cell takes to pop in. Together these set the whole feel of a chain reaction.
const RIPPLE_STEP = 70;
const LIGHT_TIME = 220;

const HUD_HEIGHT = 44;
const BOARD_MARGIN = 10;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

let world = null;
let loadError = null;

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
    for (const cell of world.cells) cell.activateAt = null;
    return;
  }

  const cell = cellFromPoint(event.clientX, event.clientY);
  if (!cell) return;

  // Schedule the whole chain up front: each cell lights when the clock reaches
  // its activateAt. No timers to manage, and the ripple falls out of BFS depth.
  const now = performance.now();
  for (const { cell: target, depth } of computeCascade(world, cell)) {
    target.activateAt = now + depth * RIPPLE_STEP;
  }
});

// --- Rendering --------------------------------------------------------------

// 0 while dormant, ramping to 1 as the cell finishes lighting up.
function litProgress(cell, now) {
  if (cell.activateAt === null || now < cell.activateAt) return 0;
  return Math.min((now - cell.activateAt) / LIGHT_TIME, 1);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
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

  if (building.inert) return;

  const t = litProgress(cell, now);
  const eased = easeOutCubic(t);
  // Swell past full size and settle back, so a cascade reads as a series of
  // small pops rather than a wave of colour.
  const pop = Math.sin(eased * Math.PI) * 0.14;
  const scale = (0.55 + 0.45 * eased) * (1 + pop);
  const gem = size * 0.44 * scale;
  const cx = x + cellSize / 2;
  const cy = y + cellSize / 2;

  if (t > 0) {
    ctx.shadowColor = building.glow;
    ctx.shadowBlur = 18 * eased;
  }
  ctx.fillStyle = t > 0 ? building.lit : building.dormant;

  // Diamond.
  ctx.beginPath();
  ctx.moveTo(cx, cy - gem);
  ctx.lineTo(cx + gem, cy);
  ctx.lineTo(cx, cy + gem);
  ctx.lineTo(cx - gem, cy);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawHud(now) {
  let active = 0;
  let total = 0;
  for (const cell of world.cells) {
    if (buildingFor(cell).inert) continue;
    total++;
    if (litProgress(cell, now) > 0) active++;
  }

  const y = HUD_HEIGHT / 2;
  ctx.textBaseline = "middle";

  ctx.fillStyle = "#8ea3b5";
  ctx.textAlign = "left";
  ctx.font = "13px ui-monospace, monospace";
  ctx.fillText(world.name, 14, y);

  ctx.fillStyle = "#5eead4";
  ctx.textAlign = "center";
  ctx.fillText(`${active} / ${total}`, width / 2, y);

  const label = "reset";
  ctx.fillStyle = "#4a5568";
  ctx.textAlign = "right";
  ctx.fillText(label, width - 14, y);

  // Generous tap target around the label — 13px text is far too small to hit.
  const textWidth = ctx.measureText(label).width;
  resetButton = { x: width - 14 - textWidth - 12, y: 0, w: textWidth + 26, h: HUD_HEIGHT };
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
  drawHud(now);
}

// --- Loop -------------------------------------------------------------------

function frame(now) {
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
