// Casual Colony — board rendering, input and the cascade animation.
// Bump VERSION on each deploy so you can tell a fresh deploy from a cached one.

import { loadLevelSet, parseLevel, serializeLevel } from "./level.js";
import { loadSavedLevels, saveLevel } from "./storage.js";
import { computeCascade, triggeredDrains } from "./cascade.js";
import { resolveColony } from "./colony.js";
import { cellAt } from "./grid.js";
import { buildingFor, BUILDINGS } from "./buildings.js";

const VERSION = "0.9.0";
const LEVEL_SET_URL = "./levels/levels.json";

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
// True while the level editor is open. Tapping a cell then edits its type
// instead of playing a turn — see the tile picker below.
let editMode = false;
// Every level available to play: the shipped set plus anything saved to
// localStorage, merged by name (a saved name shadows a shipped one with the
// same name). Raw records, not parsed worlds — see loadLevelByRecord.
let levelList = [];

// Whether any remaining tap could still change the board — recomputed after
// every successful tap (see applyColonyTick), not every frame, since taps
// are the only thing that ever changes it. Mining income means energy can
// climb instead of only draining toward the old "game over at 0" trigger
// (see updateOutcome), so a colony level needs a second way to end: running
// out of anything left to productively tap.
let boardExhausted = false;

// Board geometry, recomputed on resize.
let width = 0;
let height = 0;
let cellSize = 0;
let originX = 0;
let originY = 0;
let resetButton = null;
let editButton = null;

// One modal, reused for the tile picker, the level picker, and the
// save-as-new name prompt — see style.css for why it's plain DOM.
const modal = document.getElementById("modal");
const modalPanel = document.getElementById("modal-panel");
// The cell the open tile picker is editing, or null the rest of the time
// (including while the level picker or save prompt is open instead).
let pickerCell = null;

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

function hitsButton(button, clientX, clientY) {
  if (!button) return false;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  return x >= button.x && x <= button.x + button.w && y >= button.y && y <= button.y + button.h;
}

// Resolves the colony economy against the board's current state and applies
// it — called after every successful tap (see pointerdown below), which is
// this game's only notion of a tick. Clamped at 0: a starving colony can't
// go anywhere energy running out doesn't already take it.
//
// A free cull (see the toggle branch below) can run even at 0 energy and
// pull it back above 0 by fixing "fed" status — if that happens, the run
// isn't over after all, so clear any outcome already reached for it.
function applyColonyTick() {
  const { energyDelta } = resolveColony(world);
  world.energy = Math.max(0, world.energy + energyDelta);
  if (world.energy > 0) outcome = null;
  boardExhausted = !hasProductiveMove(world);
}

// Makes `record` the level actually being played: parses it fresh (so its
// cells' mutable state starts clean, never reused from whatever was loaded
// before) and leaves edit mode, since loading a level and editing the
// previous one are two different things.
function loadLevelByRecord(record) {
  world = parseLevel(record);
  outcome = null;
  boardExhausted = false;
  editMode = false;
  resize();
}

// Adds `record` to the in-memory level list, or replaces the existing entry
// with the same name — keeps the level picker in sync with storage.js
// immediately, without needing a reload.
function upsertLevelList(record) {
  const index = levelList.findIndex((r) => r.name === record.name);
  if (index === -1) levelList.push(record);
  else levelList[index] = record;
}

function saveAsCurrent() {
  const record = serializeLevel(world, world.name);
  saveLevel(record);
  upsertLevelList(record);
  loadLevelByRecord(record);
}

function saveAsNew(name) {
  const record = serializeLevel(world, name);
  saveLevel(record);
  upsertLevelList(record);
  loadLevelByRecord(record);
}

// --- Modal: tile picker, level picker, save-as-new prompt -------------------
// A plain DOM overlay, not canvas-drawn — see style.css for why.

function openTilePicker(cell) {
  pickerCell = cell;
  modalPanel.innerHTML = "";
  const types = [...new Set(Object.values(world.legend))];
  for (const typeId of types) {
    const building = BUILDINGS[typeId];
    const button = document.createElement("button");
    button.className = "option" + (typeId === cell.type ? " selected" : "");
    const swatchColor = building.lit || building.icon || building.fill;
    button.innerHTML =
      `<span class="swatch" style="background:${swatchColor}"></span>${building.name}`;
    button.addEventListener("click", () => selectType(typeId));
    modalPanel.appendChild(button);
  }
  modal.classList.remove("hidden");
}

function selectType(typeId) {
  if (pickerCell) {
    pickerCell.type = typeId;
    pickerCell.activateAt = null;
    pickerCell.drainedAt = null;
  }
  closeModal();
}

function openLevelPicker() {
  modalPanel.innerHTML = "";
  const title = document.createElement("div");
  title.className = "modal-title";
  title.textContent = "choose a level";
  modalPanel.appendChild(title);
  for (const record of levelList) {
    const button = document.createElement("button");
    button.className = "option" + (record.name === world.name ? " selected" : "");
    button.textContent = record.name;
    button.addEventListener("click", () => {
      loadLevelByRecord(record);
      closeModal();
    });
    modalPanel.appendChild(button);
  }
  modal.classList.remove("hidden");
}

function openSavePrompt() {
  modalPanel.innerHTML = "";
  const title = document.createElement("div");
  title.className = "modal-title";
  title.textContent = "save as new level";
  modalPanel.appendChild(title);

  const input = document.createElement("input");
  input.className = "modal-input";
  input.type = "text";
  input.value = world.name;
  modalPanel.appendChild(input);

  const save = document.createElement("button");
  save.className = "modal-save";
  save.textContent = "save";
  modalPanel.appendChild(save);

  const updateEnabled = () => {
    save.disabled = input.value.trim().length === 0;
  };
  input.addEventListener("input", updateEnabled);
  updateEnabled();

  const commit = () => {
    const name = input.value.trim();
    if (!name) return;
    saveAsNew(name);
    closeModal();
  };
  save.addEventListener("click", commit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") commit();
  });

  modal.classList.remove("hidden");
  input.focus();
  input.select();
}

function closeModal() {
  pickerCell = null;
  modal.classList.add("hidden");
}

// A click that lands on the dimmed backdrop (not the panel itself) cancels
// without changing anything.
modal.addEventListener("click", closeModal);
modalPanel.addEventListener("click", (event) => event.stopPropagation());

canvas.addEventListener("pointerdown", (event) => {
  if (!world) return;

  if (hitsButton(editButton, event.clientX, event.clientY)) {
    if (editMode) {
      // "Restart" while editing: save over the level as currently loaded,
      // then start playing the freshly-saved version.
      saveAsCurrent();
    } else {
      editMode = true;
    }
    return;
  }

  if (hitsButton(resetButton, event.clientX, event.clientY)) {
    // Same button, different job depending on mode: outside the editor it
    // picks which level to (re)play; inside it, there's nothing to "pick" —
    // tapping it means "save what I've built" under a new name instead.
    if (editMode) openSavePrompt();
    else openLevelPicker();
    return;
  }

  const cell = cellFromPoint(event.clientX, event.clientY);
  if (!cell) return;

  if (editMode) {
    openTilePicker(cell);
    return;
  }

  const building = buildingFor(cell);

  // Tapping an already-active toggle building (residential) deactivates it
  // instead of no-opping — the player's tool for fixing a starving colony.
  // Free, and allowed even at 0 energy: the whole point is to recover from
  // starvation, and a cull that itself cost energy (or was blocked by the
  // very energy shortage it fixes) couldn't always do that.
  if (cell.activateAt !== null && building.toggle) {
    cell.activateAt = null;
    applyColonyTick();
    return;
  }

  // No taps once the budget is spent — the run is over, win or lose.
  if (world.energy <= 0) return;

  if (building.drain) {
    const drained = building.drain(world, cell);
    if (drained.length === 0) return; // nothing to drain, so no energy spent
    for (const target of drained) target.activateAt = null;
    world.energy -= 1;
    cell.drainedAt = performance.now(); // brief self-pulse, see drawCell
    applyColonyTick();
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
  applyColonyTick();
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

// Whether any inactive cell would still do something if tapped: light a
// cascade, or clear something as a drain. Ignores residential's free toggle
// cull — it's reversible and costs nothing, so its mere availability
// shouldn't keep a run "in progress" forever.
function hasProductiveMove(world) {
  for (const cell of world.cells) {
    if (cell.activateAt !== null) continue;
    const building = buildingFor(cell);
    if (building.drain) {
      if (building.drain(world, cell).length > 0) return true;
    } else if (computeCascade(world, cell).length > 0) {
      return true;
    }
  }
  return false;
}

// Settles the win/lose outcome once the board can't change any further —
// energy ran out, or the board is exhausted (see boardExhausted) — and every
// scheduled cascade has finished animating, so the last ripple still gets to
// play out before the outcome screen appears.
function updateOutcome(now) {
  if (!world || outcome) return;
  if (world.energy > 0 && !boardExhausted) return;
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

  // Only shown for levels that actually use the colony economy — no reason
  // to clutter "0/0" onto a level with no residential or farm tiles at all.
  const hasColony = world.cells.some((cell) => {
    const b = buildingFor(cell);
    return b.houses || b.feeds || b.mines;
  });
  const colony = hasColony ? resolveColony(world) : null;

  // Two rows: name + reset on top, activation/energy stats below. A single
  // row overlapped the name with the stats on narrow phones.
  const row1 = HUD_HEIGHT * 0.36;
  const row2 = HUD_HEIGHT * 0.76;
  ctx.textBaseline = "middle";

  ctx.fillStyle = "#8ea3b5";
  ctx.textAlign = "left";
  ctx.font = "13px ui-monospace, monospace";
  ctx.fillText(world.name, 14, row1);

  let statsText = `${active} / ${total} activated   ⚡ ${world.energy}`;
  if (colony) statsText += `   👥 ${colony.population}/${colony.foodCapacity}`;
  // The whole line goes warning-red when the colony is starving — simpler
  // and just as legible as splitting it into separately-colored segments.
  ctx.fillStyle = colony && !colony.fed ? "#f87171" : "#5eead4";
  ctx.textAlign = "center";
  ctx.fillText(statsText, width / 2, row2);

  ctx.textAlign = "right";

  const resetLabel = editMode ? "save as" : "retry";
  ctx.fillStyle = "#4a5568";
  ctx.fillText(resetLabel, width - 14, row1);
  // Generous tap target around the label — 13px text is far too small to hit.
  const resetWidth = ctx.measureText(resetLabel).width;
  resetButton = { x: width - 14 - resetWidth - 12, y: 0, w: resetWidth + 26, h: HUD_HEIGHT };

  const editLabel = editMode ? "restart" : "edit";
  ctx.fillStyle = editMode ? "#5eead4" : "#4a5568";
  const editRight = resetButton.x - 6;
  ctx.fillText(editLabel, editRight, row1);
  const editWidth = ctx.measureText(editLabel).width;
  editButton = { x: editRight - editWidth - 12, y: 0, w: editWidth + 24, h: HUD_HEIGHT };
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
  ctx.fillText("tap retry to try again", width / 2, height / 2 + 36);
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
  // Not while editing — the outcome screen would otherwise block the board
  // you're trying to click, and edit mode always ends in a reset anyway.
  if (outcome && !editMode) drawOutcome();
}

// --- Loop -------------------------------------------------------------------

function frame(now) {
  updateOutcome(now);
  render(now);
  requestAnimationFrame(frame);
}

// --- Start ------------------------------------------------------------------

// Shipped levels plus locally-saved ones, merged by name — a saved level
// with the same name as a shipped one shadows it (how "save as current"
// works, since there's nowhere to write the shipped file itself).
function mergeLevelLists(shipped, saved) {
  const byName = new Map(shipped.map((record) => [record.name, record]));
  for (const record of saved) byName.set(record.name, record);
  return [...byName.values()];
}

document.getElementById("version").textContent = "v" + VERSION;
resize();
requestAnimationFrame(frame);

loadLevelSet(LEVEL_SET_URL)
  .then((shipped) => {
    levelList = mergeLevelLists(shipped, loadSavedLevels());
    loadLevelByRecord(levelList[0]);
  })
  .catch((error) => {
    loadError = error.message;
    console.error(error);
  });
