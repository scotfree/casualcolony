// Casual Colony — board rendering, input and the cascade animation.
// Bump VERSION on each deploy so you can tell a fresh deploy from a cached one.

import { loadLevelSet, parseLevel, serializeLevel } from "./level.js";
import { loadSavedLevels, saveLevel, loadIconOverrides, saveIconOverride } from "./storage.js";
import { computeCascade, triggeredDrains } from "./cascade.js";
import { resolveColony } from "./colony.js";
import { cellAt } from "./grid.js";
import { buildingFor, BUILDINGS } from "./buildings.js";

const VERSION = "0.12.1";
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

// Custom-drawn icons, keyed by building type id, loaded once up front (a
// synchronous localStorage read, unlike the level set) so even the very
// first frame reflects anything already saved. { [typeId]: string[] } — see
// storage.js.
let iconOverrides = loadIconOverrides();

// Pixel resolution of the custom icon editor (openTileEditor) — a type's
// custom icon is always this many rows/columns, regardless of how big it's
// later drawn.
const ICON_GRID_SIZE = 10;

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
let legendButton = null;

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

// Every building type is offered, not just the ones this level's legend
// already uses — the picker used to scope to the level's own legend, but
// that meant a level authored before residential/farm/mine existed could
// never gain one through the editor. ensureLegendChar (below) is what makes
// picking a type new to this level actually stick.
function openTilePicker(cell) {
  pickerCell = cell;
  modalPanel.innerHTML = "";
  const dpr = window.devicePixelRatio || 1;
  const swatchSize = 26;
  for (const building of Object.values(BUILDINGS)) {
    const row = document.createElement("div");
    row.className = "option-row";

    const button = document.createElement("button");
    button.className = "option" + (building.id === cell.type ? " selected" : "");

    // A live swatch (paintTile, same as the board and the legend), not a
    // flat color square — otherwise a custom icon saved in the editor below
    // would have nothing to show for itself back here.
    const swatch = document.createElement("canvas");
    swatch.className = "swatch";
    swatch.width = swatchSize * dpr;
    swatch.height = swatchSize * dpr;
    swatch.style.width = swatchSize + "px";
    swatch.style.height = swatchSize + "px";
    const swatchCtx = swatch.getContext("2d");
    swatchCtx.scale(dpr, dpr);
    paintTile(swatchCtx, swatchSize, building, building.glow ? 1 : 0);
    button.appendChild(swatch);

    const label = document.createElement("span");
    label.textContent = building.name;
    button.appendChild(label);

    button.addEventListener("click", () => selectType(building.id));
    row.appendChild(button);

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "edit-icon-btn";
    editButton.textContent = "✎"; // pencil
    editButton.setAttribute("aria-label", `Edit ${building.name}'s icon`);
    editButton.addEventListener("click", () => openTileEditor(building.id));
    row.appendChild(editButton);

    modalPanel.appendChild(row);
  }
  modal.classList.remove("hidden");
}

// A small pixel-art editor for one building type's icon — opened via the
// pencil button next to it in the tile picker above. Starts from whatever
// that type already looks like (its saved custom icon if it has one,
// otherwise its default vector shape rasterized down to the grid), so
// editing never starts from a blank square. Tapping a pixel just flips it;
// "save" persists the result (storage.js) and reopens the tile picker for
// the same cell, so the change is immediately visible where it matters.
function openTileEditor(typeId) {
  const building = BUILDINGS[typeId];
  const startRows = iconOverrides[typeId] || rasterizeIcon(building.shape);
  const rows = startRows.map((row) => row.split(""));

  modalPanel.innerHTML = "";
  const title = document.createElement("div");
  title.className = "modal-title";
  title.textContent = `edit ${building.name}`;
  modalPanel.appendChild(title);

  const gridEl = document.createElement("div");
  gridEl.className = "pixel-grid";
  gridEl.style.gridTemplateColumns = `repeat(${ICON_GRID_SIZE}, 1fr)`;
  gridEl.style.setProperty("--pixel-color", building.iconColor || "#c7d3de");

  for (let y = 0; y < ICON_GRID_SIZE; y++) {
    for (let x = 0; x < ICON_GRID_SIZE; x++) {
      const pixel = document.createElement("div");
      pixel.className = "pixel" + (rows[y][x] === "#" ? " on" : "");
      pixel.addEventListener("pointerdown", () => {
        rows[y][x] = rows[y][x] === "#" ? "." : "#";
        pixel.classList.toggle("on", rows[y][x] === "#");
      });
      gridEl.appendChild(pixel);
    }
  }
  modalPanel.appendChild(gridEl);

  const save = document.createElement("button");
  save.className = "modal-save";
  save.textContent = "save";
  save.addEventListener("click", () => {
    const record = rows.map((row) => row.join(""));
    iconOverrides[typeId] = record;
    saveIconOverride(typeId, record);
    openTilePicker(pickerCell);
  });
  modalPanel.appendChild(save);

  modal.classList.remove("hidden");
}

// The character each building type is already known by across the shipped
// levels — reused so a level that gains a type through the editor picks up
// the same letter every other level would use for it, rather than an
// arbitrary one.
const PREFERRED_LEGEND_CHARS = {
  desert: ".", crystal: "C", redCrystal: "R", greenCrystal: "G",
  powerPlant: "P", drain: "D", residential: "H", farm: "F", mine: "M",
};

// serializeLevel writes a cell's type back out via world.legend, so picking
// a type this level's legend has never seen before needs a character added
// for it first — otherwise the saved grid would have nothing to write for
// that cell. No-ops if the type already has one.
function ensureLegendChar(world, typeId) {
  if (Object.values(world.legend).includes(typeId)) return;
  let char = PREFERRED_LEGEND_CHARS[typeId] || typeId[0].toUpperCase();
  if (char in world.legend) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    char = [...alphabet].find((c) => !(c in world.legend));
  }
  world.legend[char] = typeId;
}

function selectType(typeId) {
  if (pickerCell) {
    ensureLegendChar(world, typeId);
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

// Every building type, shown exactly as it renders on the board (same
// paintTile the main canvas uses, at full "active" brightness so the icon
// and its frame both read clearly) — the reference for what each shape and
// color means, available any time via the HUD's legend button.
function openLegend() {
  modalPanel.innerHTML = "";
  const title = document.createElement("div");
  title.className = "modal-title";
  title.textContent = "tile key";
  modalPanel.appendChild(title);

  const dpr = window.devicePixelRatio || 1;
  const size = 34;
  for (const building of Object.values(BUILDINGS)) {
    const row = document.createElement("div");
    row.className = "legend-row";

    const swatch = document.createElement("canvas");
    swatch.className = "legend-swatch";
    swatch.width = size * dpr;
    swatch.height = size * dpr;
    swatch.style.width = size + "px";
    swatch.style.height = size + "px";
    const swatchCtx = swatch.getContext("2d");
    swatchCtx.scale(dpr, dpr);
    // Full brightness for anything that actually can light up; desert never
    // does, so it's shown the one way it ever really looks.
    paintTile(swatchCtx, size, building, building.glow ? 1 : 0);
    row.appendChild(swatch);

    const label = document.createElement("span");
    label.textContent = building.name;
    row.appendChild(label);

    modalPanel.appendChild(row);
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

  if (hitsButton(legendButton, event.clientX, event.clientY)) {
    openLegend();
    return;
  }

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

// Linearly interpolates between two "#rrggbb" colors — canvas has no CSS
// transitions, so easing a fill or stroke color means doing this by hand.
function lerpColor(hexA, hexB, t) {
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

// --- Icon glyphs --------------------------------------------------------
// One shape per building "family" (see buildings.js's `shape`), each drawn
// centered at (cx, cy) inside a roughly 2r-wide box. These draw at constant
// full brightness regardless of activation — see paintTile — so a tile's
// *type* is always legible; only the frame and background around them
// change with state.

function drawPlus(targetCtx, cx, cy, r) {
  const arm = r * 0.62;
  const thick = r * 0.44;
  targetCtx.beginPath();
  targetCtx.moveTo(cx - thick, cy - arm);
  targetCtx.lineTo(cx + thick, cy - arm);
  targetCtx.lineTo(cx + thick, cy - thick);
  targetCtx.lineTo(cx + arm, cy - thick);
  targetCtx.lineTo(cx + arm, cy + thick);
  targetCtx.lineTo(cx + thick, cy + thick);
  targetCtx.lineTo(cx + thick, cy + arm);
  targetCtx.lineTo(cx - thick, cy + arm);
  targetCtx.lineTo(cx - thick, cy + thick);
  targetCtx.lineTo(cx - arm, cy + thick);
  targetCtx.lineTo(cx - arm, cy - thick);
  targetCtx.lineTo(cx - thick, cy - thick);
  targetCtx.closePath();
  targetCtx.fill();
}

// Classic lightning-bolt zigzag, normalized to roughly [-0.75, 0.83] and
// scaled by r.
const BOLT_POINTS = [
  [0.083, -0.833], [-0.75, 0.167], [-0.25, 0.167],
  [-0.333, 0.833], [0.5, -0.333], [0, -0.333],
];
function drawBolt(targetCtx, cx, cy, r) {
  targetCtx.beginPath();
  BOLT_POINTS.forEach(([px, py], i) => {
    const x = cx + px * r;
    const y = cy + py * r;
    if (i === 0) targetCtx.moveTo(x, y);
    else targetCtx.lineTo(x, y);
  });
  targetCtx.closePath();
  targetCtx.fill();
}

// A head (stroked circle) over shoulders (the top half of a larger circle,
// left open) — deliberately an outline, not a filled silhouette.
function drawPerson(targetCtx, cx, cy, r) {
  targetCtx.lineWidth = Math.max(1.4, r * 0.24);
  targetCtx.lineCap = "round";
  targetCtx.beginPath();
  targetCtx.arc(cx, cy - r * 0.4, r * 0.32, 0, Math.PI * 2);
  targetCtx.stroke();
  targetCtx.beginPath();
  targetCtx.arc(cx, cy + r * 0.95, r * 0.62, Math.PI, Math.PI * 2);
  targetCtx.stroke();
}

// Same trick as a diamond gem, but with only two opposite corners rounded
// instead of all four — a square with one pair of corners left sharp reads
// as a leaf (or petal) once rotated 45°.
function drawLeaf(targetCtx, cx, cy, r) {
  const w = r * 1.3;
  targetCtx.save();
  targetCtx.translate(cx, cy);
  targetCtx.rotate(Math.PI / 4);
  targetCtx.beginPath();
  targetCtx.roundRect(-w / 2, -w / 2, w, w, [w / 2, 0, w / 2, 0]);
  targetCtx.fill();
  targetCtx.restore();
}

function drawDollar(targetCtx, cx, cy, r) {
  targetCtx.font = `800 ${Math.round(r * 1.7)}px ui-monospace, monospace`;
  targetCtx.textAlign = "center";
  targetCtx.textBaseline = "middle";
  targetCtx.fillText("$", cx, cy + r * 0.05);
}

function drawX(targetCtx, cx, cy, r) {
  const a = r * 0.62;
  targetCtx.lineWidth = Math.max(1.6, r * 0.26);
  targetCtx.lineCap = "round";
  targetCtx.beginPath();
  targetCtx.moveTo(cx - a, cy - a);
  targetCtx.lineTo(cx + a, cy + a);
  targetCtx.moveTo(cx + a, cy - a);
  targetCtx.lineTo(cx - a, cy + a);
  targetCtx.stroke();
}

const ICON_SHAPES = {
  plus: drawPlus,
  bolt: drawBolt,
  person: drawPerson,
  leaf: drawLeaf,
  dollar: drawDollar,
  x: drawX,
};

// Draws a custom icon (an ICON_GRID_SIZE-row array of "#"/"." strings — see
// storage.js) the same way the vector shapes draw: centered at (cx, cy),
// sized off r. Filled squares tile a box roughly the same footprint as the
// vector icons' own reach, so swapping between a default shape and a custom
// one doesn't change a tile's apparent icon size.
function drawBitmapIcon(targetCtx, cx, cy, r, rows) {
  const n = rows.length;
  const boxSide = r * 2.3;
  const cell = boxSide / n;
  const startX = cx - boxSide / 2;
  const startY = cy - boxSide / 2;
  for (let gy = 0; gy < n; gy++) {
    const row = rows[gy];
    for (let gx = 0; gx < row.length; gx++) {
      if (row[gx] !== "#") continue;
      // Slightly overpainted so adjacent "on" pixels don't leave hairline
      // gaps between them from sub-pixel rounding.
      targetCtx.fillRect(startX + gx * cell, startY + gy * cell, cell + 0.6, cell + 0.6);
    }
  }
}

// What a type's icon editor (openTileEditor) opens with when that type has
// never been customized: its default vector shape, rendered oversized onto
// an offscreen canvas and then sampled down into an ICON_GRID_SIZE grid, so
// editing starts from what the type already looks like rather than a blank
// square. Desert (no shape) starts blank, which is exactly its real icon.
function rasterizeIcon(shape) {
  const draw = ICON_SHAPES[shape];
  if (!draw) return Array.from({ length: ICON_GRID_SIZE }, () => ".".repeat(ICON_GRID_SIZE));

  const scale = 20; // offscreen px per grid cell — coarse shapes still sample cleanly
  const size = ICON_GRID_SIZE * scale;
  const off = document.createElement("canvas");
  off.width = size;
  off.height = size;
  const offCtx = off.getContext("2d");
  offCtx.fillStyle = "#fff";
  offCtx.strokeStyle = "#fff";
  draw(offCtx, size / 2, size / 2, size * 0.27);

  const { data } = offCtx.getImageData(0, 0, size, size);
  const rows = [];
  for (let gy = 0; gy < ICON_GRID_SIZE; gy++) {
    let row = "";
    for (let gx = 0; gx < ICON_GRID_SIZE; gx++) {
      let covered = 0;
      for (let py = 0; py < scale; py++) {
        for (let px = 0; px < scale; px++) {
          const x = gx * scale + px;
          const y = gy * scale + py;
          if (data[(y * size + x) * 4 + 3] > 40) covered++;
        }
      }
      row += covered / (scale * scale) > 0.25 ? "#" : ".";
    }
    rows.push(row);
  }
  return rows;
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

// Paints one tile — background, frame, and icon — into any 2D context at
// (0, 0)–(size, size). Shared by the main board (drawCell, below) and the
// legend popup (openLegend), so the legend always shows the exact same
// rendering a player sees on the board, never a hand-approximated copy.
//
// activeAmount is 0..1: how "on" this tile currently reads. It drives the
// frame (a brighter, thicker border with a glow) and a brightened
// background fill — the *only* two things activation changes. The icon
// itself is drawn at constant full brightness regardless, on purpose: type
// should always be legible, whether or not the tile has been tapped yet.
function paintTile(targetCtx, size, building, activeAmount) {
  const pad = Math.max(1, Math.round(size * 0.06));
  const inner = size - pad * 2;
  const radius = Math.round(size * 0.2);
  const cx = size / 2;
  const cy = size / 2;
  const eased = easeOutCubic(activeAmount);

  targetCtx.fillStyle =
    building.activeFill && activeAmount > 0
      ? lerpColor(building.fill, building.activeFill, eased)
      : building.fill;
  targetCtx.strokeStyle = activeAmount > 0 ? lerpColor(building.stroke, building.glow, eased) : building.stroke;
  targetCtx.lineWidth = activeAmount > 0 ? 1 + eased : 1;
  targetCtx.beginPath();
  targetCtx.roundRect(pad, pad, inner, inner, radius);
  targetCtx.fill();
  if (activeAmount > 0) {
    targetCtx.shadowColor = building.glow;
    targetCtx.shadowBlur = 16 * eased;
  }
  targetCtx.stroke();
  targetCtx.shadowBlur = 0;

  const override = iconOverrides[building.id];
  if (override) {
    targetCtx.fillStyle = building.iconColor || "#c7d3de";
    drawBitmapIcon(targetCtx, cx, cy, inner * 0.27, override);
    return;
  }

  const draw = ICON_SHAPES[building.shape];
  if (!draw) return; // desert: no icon at all

  targetCtx.fillStyle = building.iconColor;
  targetCtx.strokeStyle = building.iconColor;
  draw(targetCtx, cx, cy, inner * 0.27);
}

function drawCell(cell, now) {
  const building = buildingFor(cell);
  const x = originX + cell.x * cellSize;
  const y = originY + cell.y * cellSize;
  // A drain never activates itself, but still flashes briefly the moment it
  // fires (drainPulse), so tapping one reads as "this did something" even
  // before its neighbour visibly goes dark. Everything else uses ordinary
  // lit progress.
  const t = building.drain ? drainPulse(cell, now) : litProgress(cell, now);

  ctx.save();
  ctx.translate(x, y);
  paintTile(ctx, cellSize, building, t);
  ctx.restore();
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

  // Brighter than plain body text, same as the modal's own option labels
  // (style.css's .option) — a tappable button should never read as dimmer
  // than static text.
  const buttonColor = "#c7d3de";

  const resetLabel = editMode ? "save as" : "retry";
  ctx.fillStyle = buttonColor;
  ctx.fillText(resetLabel, width - 14, row1);
  // Generous tap target around the label — 13px text is far too small to hit.
  const resetWidth = ctx.measureText(resetLabel).width;
  resetButton = { x: width - 14 - resetWidth - 12, y: 0, w: resetWidth + 26, h: HUD_HEIGHT };

  const editLabel = editMode ? "restart" : "edit";
  ctx.fillStyle = editMode ? "#5eead4" : buttonColor;
  const editRight = resetButton.x - 6;
  ctx.fillText(editLabel, editRight, row1);
  const editWidth = ctx.measureText(editLabel).width;
  editButton = { x: editRight - editWidth - 12, y: 0, w: editWidth + 24, h: HUD_HEIGHT };

  const legendLabel = "legend";
  ctx.fillStyle = buttonColor;
  const legendRight = editButton.x - 6;
  ctx.fillText(legendLabel, legendRight, row1);
  const legendWidth = ctx.measureText(legendLabel).width;
  legendButton = { x: legendRight - legendWidth - 12, y: 0, w: legendWidth + 24, h: HUD_HEIGHT };
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
