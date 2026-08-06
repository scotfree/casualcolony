// Casual Colony — wiring. Input, board rendering, and the frame loop.
//
// The rules live in rules.js, the economy in colony.js, the traversal in
// cascade.js, and everything DOM-shaped in modals.js. What's left here is the
// part that can only be done with a canvas and a pointer: turning a tap into
// a cell, drawing the board, and holding the handful of pieces of view state
// (edit mode, outcome) that aren't part of a run.
//
// Bump VERSION on each deploy so you can tell a fresh deploy from a cached one.

import { loadLevelSet, parseLevel, createRun, serializeLevel } from "./level.js";
import {
  loadSavedLevels, saveLevel, saveLevels, loadIconOverrides, saveIconOverride,
  saveIconOverrides, clearLocalEdits, hasLocalEdits,
} from "./storage.js";
import { SHIPPED_ICONS } from "./icons-data.js";
import {
  exportLevelsText, exportIconsText, parseImport, LEVELS_FILENAME, ICONS_FILENAME,
} from "./exchange.js";
import { resolveColony, hasColony } from "./colony.js";
import { resolveTap, applyTap, hasProductiveMove, activatedFraction } from "./rules.js";
import { cellAt } from "./grid.js";
import { buildingFor, BUILDINGS } from "./buildings.js";
import { paintTile } from "./tiles.js";
import * as modals from "./modals.js";
import {
  HUD_HEIGHT, BOARD_MARGIN, hudLayout, outcomeLayout, hitsButton,
  drawHud, drawOutcome, drawError,
} from "./hud.js";

const VERSION = "0.17.0";
const LEVEL_SET_URL = "./levels/levels.json";

// How long a single cell takes to pop in once its litAt arrives. (The gap
// *between* rings is RIPPLE_STEP, in rules.js, since that falls out of BFS
// depth rather than out of rendering.)
const LIGHT_TIME = 220;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// The run in progress: mutable state over an immutable level (see level.js).
let world = null;
let loadError = null;
// null while playing; { result, reason } once the run has resolved.
let outcome = null;
// True while the level editor is open. Tapping a cell then edits its type
// instead of playing a turn.
let editMode = false;
// Every level available to play: the shipped set plus anything saved to
// localStorage, merged by name. Raw records, not parsed levels.
let levelList = [];

// Custom-drawn icons, keyed by building type id: whatever ships with the game
// (icons-data.js, a static import so it's ready before the first frame),
// with this device's own saved edits layered on top. Both are synchronous —
// an icon that arrived late would show as a visible flash of the default
// shape, unlike the level set, which can be fetched.
let iconOverrides = { ...SHIPPED_ICONS, ...loadIconOverrides() };

// Whether any remaining tap could still change the board — recomputed after
// every successful tap, not every frame, since taps are the only thing that
// ever changes it. Mining income means energy can climb instead of only
// draining toward the old "game over at 0" trigger, so a colony level needs a
// second way to end: running out of anything left to productively tap.
let boardExhausted = false;

// Board geometry, recomputed on resize.
let width = 0;
let height = 0;
let cellSize = 0;
let originX = 0;
let originY = 0;
// HUD button rects, recomputed whenever their labels could have changed.
let buttons = { reset: null, edit: null, legend: null };
// Outcome-screen button rects, or null while a run is still in progress.
let outcomeButtons = null;

// The cell the open tile picker is editing, or null the rest of the time.
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
  relayoutHud();
  relayoutOutcome();

  if (!world) return;

  const availableWidth = width - BOARD_MARGIN * 2;
  const availableHeight = height - HUD_HEIGHT - BOARD_MARGIN;
  cellSize = Math.floor(
    Math.min(availableWidth / world.level.width, availableHeight / world.level.height)
  );
  const boardWidth = cellSize * world.level.width;
  const boardHeight = cellSize * world.level.height;
  originX = Math.round((width - boardWidth) / 2);
  originY = Math.round(HUD_HEIGHT + (availableHeight - boardHeight) / 2);
}

// The buttons' hitboxes depend on their labels — which change with edit mode,
// and on the level's name, since legend sits just past it. So this runs on
// resize, on every mode change, and whenever the level changes; never as a
// side effect of drawing.
function relayoutHud() {
  buttons = hudLayout(ctx, width, editMode, world ? world.level.name : "");
}

// Likewise for the outcome screen's own buttons, which only exist while an
// outcome is showing and depend on whether there's a next level to offer.
function relayoutOutcome() {
  outcomeButtons = outcome
    ? outcomeLayout(ctx, width, height, outcome, nextLevelRecord() !== null)
    : null;
}

function setEditMode(on) {
  editMode = on;
  relayoutHud();
}

// The level after the current one in the list, or null if this is the last —
// "next level" is only offered when there's somewhere to go.
function nextLevelRecord() {
  if (!world) return null;
  const index = levelList.findIndex((record) => record.name === world.level.name);
  if (index === -1 || index + 1 >= levelList.length) return null;
  return levelList[index + 1];
}

// A ResizeObserver watches the canvas box itself, so geometry can't go stale
// when the box changes without a window resize event — which is exactly what
// happens when mobile Safari collapses its address bar.
new ResizeObserver(resize).observe(canvas);

// --- Run lifecycle ----------------------------------------------------------

// Starts a fresh run of `level`, leaving edit mode: loading a level and
// editing the previous one are two different things. Replaying is just this
// again with the same level — no re-reading the level file (see level.js).
function startRun(level) {
  world = createRun(level);
  outcome = null;
  boardExhausted = false;
  setEditMode(false);
  resize();
}

function loadLevelByRecord(record) {
  startRun(parseLevel(record));
}

// Adds `record` to the in-memory level list, or replaces the entry with the
// same name — keeps the level picker in sync with storage.js immediately,
// without needing a reload.
function upsertLevelList(record) {
  const index = levelList.findIndex((r) => r.name === record.name);
  if (index === -1) levelList.push(record);
  else levelList[index] = record;
}

function saveAs(name) {
  const record = serializeLevel(world, name);
  saveLevel(record);
  upsertLevelList(record);
  loadLevelByRecord(record);
}

// --- Modal wiring -----------------------------------------------------------

function showLevelPicker() {
  modals.openLevelPicker({
    levels: levelList,
    currentName: world.level.name,
    onPick: (record) => { loadLevelByRecord(record); modals.closeModal(); },
    onManageData: showDataMenu,
  });
}

// Getting edits out of this device and into the repo, and back again — see
// exchange.js for why that's the shape of it.
function showDataMenu() {
  modals.openDataMenu({
    hasLocal: hasLocalEdits(),
    // Both texts are built now, before any handler awaits anything: Safari
    // drops the user-gesture token across an await, and a clipboard write
    // without it fails silently.
    onExportLevels: () => modals.openTextExport({
      title: "export levels",
      hint: "The whole of levels/levels.json — shipped levels with this device's edits merged in. Replace that file with this and commit.",
      text: exportLevelsText(levelList),
      filename: LEVELS_FILENAME,
    }),
    onExportIcons: () => modals.openTextExport({
      title: "export icons",
      hint: "The whole of icons-data.js. Replace that file with this and commit, and the icons ship for everyone.",
      text: exportIconsText(iconOverrides),
      filename: ICONS_FILENAME,
    }),
    onImport: () => modals.openTextImport({
      onLoad: (text) => {
        // parseImport throws with a reason; openTextImport shows it.
        const result = parseImport(text);
        if (result.kind === "levels") {
          saveLevels(result.levels);
          levelList = mergeLevelLists(levelList, result.levels);
          // Re-enter whichever level is now current, so an edited copy of the
          // level being played takes effect rather than sitting unused.
          const current = levelList.find((r) => r.name === world.level.name);
          if (current) loadLevelByRecord(current);
        } else {
          saveIconOverrides(result.icons);
          iconOverrides = { ...iconOverrides, ...result.icons };
        }
        modals.closeModal();
      },
    }),
    onClearLocal: () => {
      clearLocalEdits();
      // Simplest honest way back to "the repo is the truth": reload, so every
      // shipped level and icon is re-read from scratch with nothing shadowing.
      location.reload();
    },
  });
}

function showTilePicker(cell) {
  pickerCell = cell;
  modals.openTilePicker({
    currentType: cell.type,
    iconOverrides,
    onSelect: (typeId) => {
      ensureLegendChar(world.level, typeId);
      cell.type = typeId;
      cell.active = false;
      cell.litAt = null;
      cell.drainedAt = null;
      pickerCell = null;
      modals.closeModal();
    },
    onEditIcon: (typeId) => showTileEditor(typeId),
  });
}

function showTileEditor(typeId) {
  modals.openTileEditor({
    typeId,
    iconOverrides,
    onSave: (rows) => {
      iconOverrides[typeId] = rows;
      saveIconOverride(typeId, rows);
      // Straight back to the picker, so the change is visible where it matters.
      showTilePicker(pickerCell);
    },
  });
}

// serializeLevel writes a cell's type back out via the level's legend, so
// picking a type this level has never seen needs a character added for it
// first. A type's usual character lives on the type itself (buildings.js), so
// a level that gains one picks up the same letter every other level uses.
function ensureLegendChar(level, typeId) {
  if (Object.values(level.legend).includes(typeId)) return;
  let char = BUILDINGS[typeId].legendChar;
  if (!char || char in level.legend) {
    char = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].find((c) => !(c in level.legend));
  }
  if (char) level.legend[char] = typeId;
}

// --- Input ------------------------------------------------------------------
// Pointer Events cover touch, mouse and stylus in one path.

function cellFromPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((clientX - rect.left - originX) / cellSize);
  const y = Math.floor((clientY - rect.top - originY) / cellSize);
  return cellAt(world, x, y);
}

canvas.addEventListener("pointerdown", (event) => {
  if (!world) return;
  const rect = canvas.getBoundingClientRect();
  const hudX = event.clientX - rect.left;
  const hudY = event.clientY - rect.top;

  if (hitsButton(buttons.legend, hudX, hudY)) {
    modals.openLegend({ iconOverrides });
    return;
  }

  if (hitsButton(buttons.edit, hudX, hudY)) {
    // "Restart" while editing: save over the level as currently loaded, then
    // start playing the freshly-saved version.
    if (editMode) saveAs(world.level.name);
    else setEditMode(true);
    return;
  }

  if (hitsButton(buttons.reset, hudX, hudY)) {
    // Same button, different job depending on mode: outside the editor it
    // picks which level to (re)play; inside it, there's nothing to "pick" —
    // tapping it means "save what I've built" under a new name instead.
    if (editMode) {
      modals.openSavePrompt({
        currentName: world.level.name,
        onSave: (name) => { saveAs(name); modals.closeModal(); },
      });
    } else {
      showLevelPicker();
    }
    return;
  }

  // The outcome screen's own buttons take priority over the board underneath
  // them. A tap that *misses* them still falls through, on purpose: a run that
  // ended at 0 energy with a starving colony can still be rescued by culling a
  // residential (free and never gated — see below), which restarts mining
  // income and clears the outcome. Swallowing every tap here would quietly
  // turn that recovery into a forced loss.
  if (outcome && !editMode && outcomeButtons) {
    if (hitsButton(outcomeButtons.retry, hudX, hudY)) {
      startRun(world.level);
      return;
    }
    if (hitsButton(outcomeButtons.next, hudX, hudY)) {
      const next = nextLevelRecord();
      if (next) loadLevelByRecord(next);
      return;
    }
  }

  const cell = cellFromPoint(event.clientX, event.clientY);
  if (!cell) return;

  if (editMode) {
    showTilePicker(cell);
    return;
  }

  // The whole turn, in one call each way: what would this do, then do it.
  const resolved = resolveTap(world, cell);
  if (!resolved.ok) return;
  applyTap(world, resolved, performance.now());

  // A free cull can pull energy back above 0 by fixing "fed" status — if that
  // happens the run isn't over after all, so clear any outcome reached for it
  // (and the buttons that came with it).
  if (world.energy > 0 && outcome) {
    outcome = null;
    relayoutOutcome();
  }
  boardExhausted = !hasProductiveMove(world);
});

// --- Rendering --------------------------------------------------------------

// 0 while dormant, ramping to 1 as the cell finishes lighting up.
function litProgress(cell, now) {
  if (!cell.active || cell.litAt === null || now < cell.litAt) return 0;
  return Math.min((now - cell.litAt) / LIGHT_TIME, 1);
}

// 1 right when a drain fires, fading to 0 over LIGHT_TIME — a self-pulse so
// tapping a drain reads as "this did something" even before you spot the
// neighbour it drained going dark.
function drainPulse(cell, now) {
  if (cell.drainedAt === null) return 0;
  return Math.max(0, 1 - (now - cell.drainedAt) / LIGHT_TIME);
}

function drawCell(cell, now) {
  const building = buildingFor(cell);
  // A drain never activates itself, but still flashes briefly the moment it
  // fires. Everything else uses ordinary lit progress.
  const t = building.drain ? drainPulse(cell, now) : litProgress(cell, now);

  ctx.save();
  ctx.translate(originX + cell.x * cellSize, originY + cell.y * cellSize);
  paintTile(ctx, cellSize, building, t, iconOverrides);
  ctx.restore();
}

// Settles the win/lose outcome once the board can't change any further —
// energy ran out, or nothing productive is left to tap — and every scheduled
// cascade has finished animating, so the last ripple still gets to play out
// before the outcome screen appears.
function updateOutcome(now) {
  if (!world || outcome) return;
  const outOfEnergy = world.energy <= 0;
  if (!outOfEnergy && !boardExhausted) return;
  for (const cell of world.cells) {
    if (cell.active && cell.litAt !== null && now < cell.litAt + LIGHT_TIME) return;
  }
  outcome = {
    result: activatedFraction(world) >= world.level.completionGoal ? "win" : "lose",
    reason: outOfEnergy ? "energy" : "exhausted",
  };
  relayoutOutcome();
}

function render(now) {
  ctx.fillStyle = "#12161c";
  ctx.fillRect(0, 0, width, height);

  if (loadError) {
    drawError(ctx, width, height, loadError);
    return;
  }
  if (!world) return;

  for (const cell of world.cells) drawCell(cell, now);

  drawHud(ctx, width, {
    name: world.level.name,
    activated: world.cells.filter((cell) => cell.active).length,
    total: world.cells.length,
    energy: world.energy,
    // Only shown for levels that actually use the colony economy — no reason
    // to clutter "0/0" onto a level with no colony tiles at all.
    colony: hasColony(world) ? resolveColony(world) : null,
    editMode,
  }, buttons);

  // Not while editing — the outcome screen would otherwise block the board
  // you're trying to click, and edit mode always ends in a reset anyway.
  if (outcome && !editMode) {
    drawOutcome(
      ctx, width, height, outcome,
      activatedFraction(world), world.level.completionGoal, outcomeButtons
    );
  }
}

// --- Loop -------------------------------------------------------------------

function frame(now) {
  updateOutcome(now);
  render(now);
  requestAnimationFrame(frame);
}

// --- Start ------------------------------------------------------------------

// Shipped levels plus locally-saved ones, merged by name — a saved level with
// the same name as a shipped one shadows it (how "save as current" works,
// since there's nowhere to write the shipped file itself).
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
