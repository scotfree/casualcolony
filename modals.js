// The DOM overlay: tile picker, icon editor, save prompt, legend, log, and the
// import/export screens.
//
// Choosing a level isn't here — that's the title screen (title.js), which is a
// screen you come *from* rather than an overlay on a run you're in.
//
// Everything else in this game is canvas-drawn, but a list of clickable,
// labeled options with a selected state is exactly what HTML buttons already
// are — hand-rolling that in canvas would mean reimplementing hit-testing,
// focus and text layout for no benefit. One `#modal` overlay is reused by all
// five screens; each is just a different way of filling its panel.
//
// None of these touch game state directly. They take what they need and call
// back, so the rules never depend on which screen happens to be open.

import { BUILDINGS } from "./buildings.js";
import { tileSwatch } from "./tiles.js";
import { ICON_GRID_SIZE, rasterizeIcon } from "./icons.js";

const modal = document.getElementById("modal");
const panel = document.getElementById("modal-panel");

// A click that lands on the dimmed backdrop (not the panel itself) cancels
// without changing anything.
modal.addEventListener("click", () => closeModal());
panel.addEventListener("click", (event) => event.stopPropagation());

let onClose = null;

export function closeModal() {
  modal.classList.add("hidden");
  const callback = onClose;
  onClose = null;
  if (callback) callback();
}

// Clears the panel, lets `build` fill it, and shows it.
function open(build, closeCallback = null) {
  onClose = closeCallback;
  panel.innerHTML = "";
  build(panel);
  modal.classList.remove("hidden");
}

function addTitle(parent, text) {
  const title = document.createElement("div");
  title.className = "modal-title";
  title.textContent = text;
  parent.appendChild(title);
}

// Every building type is offered, not just the ones this level's legend
// already uses — scoping to the level's own legend meant a level authored
// before residential/farm/mine existed could never gain one through the
// editor.
export function openTilePicker({
  currentType, startsVisible, iconOverrides, onSelect, onEditIcon, onToggleStartsVisible,
}) {
  open((parent) => {
    // A fogged level needs somewhere to start — nothing visible means nothing
    // tappable — so which cells seed sight is part of laying a board out, not
    // a separate screen. Toggling doesn't close the picker: it's a property
    // of the cell, independent of which building sits on it.
    const seed = document.createElement("button");
    seed.className = "option check" + (startsVisible ? " selected" : "");
    seed.innerHTML = "";
    const box = document.createElement("span");
    box.className = "checkbox";
    box.textContent = startsVisible ? "✓" : "";
    seed.appendChild(box);
    const seedLabel = document.createElement("span");
    seedLabel.textContent = "starts visible";
    seed.appendChild(seedLabel);
    seed.addEventListener("click", () => {
      const now = onToggleStartsVisible();
      seed.classList.toggle("selected", now);
      box.textContent = now ? "✓" : "";
    });
    parent.appendChild(seed);

    for (const building of Object.values(BUILDINGS)) {
      const row = document.createElement("div");
      row.className = "option-row";

      const button = document.createElement("button");
      button.className = "option" + (building.id === currentType ? " selected" : "");
      button.appendChild(tileSwatch(building, 26, iconOverrides));

      const label = document.createElement("span");
      label.textContent = building.name;
      button.appendChild(label);
      button.addEventListener("click", () => onSelect(building.id));
      row.appendChild(button);

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "edit-icon-btn";
      edit.textContent = "✎"; // pencil
      edit.setAttribute("aria-label", `Edit ${building.name}'s icon`);
      edit.addEventListener("click", () => onEditIcon(building.id));
      row.appendChild(edit);

      parent.appendChild(row);
    }
  });
}

// A small pixel-art editor for one building type's icon. Starts from whatever
// that type already looks like — its saved custom icon if it has one,
// otherwise its default vector shape rasterized down to the grid — so editing
// never starts from a blank square. Tapping a pixel flips it.
export function openTileEditor({ typeId, iconOverrides, onSave }) {
  const building = BUILDINGS[typeId];
  const rows = (iconOverrides[typeId] || rasterizeIcon(building.shape)).map((row) => row.split(""));

  open((parent) => {
    addTitle(parent, `edit ${building.name}`);

    const grid = document.createElement("div");
    grid.className = "pixel-grid";
    grid.style.gridTemplateColumns = `repeat(${ICON_GRID_SIZE}, 1fr)`;
    grid.style.setProperty("--pixel-color", building.iconColor || "#c7d3de");

    for (let y = 0; y < ICON_GRID_SIZE; y++) {
      for (let x = 0; x < ICON_GRID_SIZE; x++) {
        const pixel = document.createElement("div");
        pixel.className = "pixel" + (rows[y][x] === "#" ? " on" : "");
        pixel.addEventListener("pointerdown", () => {
          rows[y][x] = rows[y][x] === "#" ? "." : "#";
          pixel.classList.toggle("on", rows[y][x] === "#");
        });
        grid.appendChild(pixel);
      }
    }
    parent.appendChild(grid);

    const save = document.createElement("button");
    save.className = "modal-save";
    save.textContent = "save";
    save.addEventListener("click", () => onSave(rows.map((row) => row.join(""))));
    parent.appendChild(save);
  });
}

// Every building type, shown exactly as it renders on the board (same
// paintTile the main canvas uses) — the reference for what each shape and
// color means.
export function openLegend({ iconOverrides }) {
  open((parent) => {
    addTitle(parent, "tile key");
    for (const building of Object.values(BUILDINGS)) {
      const row = document.createElement("div");
      row.className = "legend-row";
      row.appendChild(tileSwatch(building, 34, iconOverrides));

      const label = document.createElement("span");
      label.textContent = building.name;
      row.appendChild(label);
      parent.appendChild(row);
    }
  });
}

// What the last turn did, and why — see log.js for where the lines come from.
export function openLog({ lines }) {
  open((parent) => {
    addTitle(parent, "last turn");

    if (lines.length === 0) {
      const empty = document.createElement("div");
      empty.className = "modal-note";
      empty.textContent = "Nothing yet — tap a tile, then look here to see what it did.";
      parent.appendChild(empty);
      return;
    }

    for (const { what, why } of lines) {
      const row = document.createElement("div");
      row.className = "log-row";

      const effect = document.createElement("div");
      effect.className = "log-what";
      effect.textContent = what;
      row.appendChild(effect);

      const reason = document.createElement("div");
      reason.className = "log-why";
      reason.textContent = why;
      row.appendChild(reason);

      parent.appendChild(row);
    }
  });
}

// --- Export / import --------------------------------------------------------
//
// Delivery is layered by what the device can actually do, best first, with a
// floor that always works. The textarea itself is that floor: even if both
// the clipboard and the share sheet are unavailable or denied, the text is
// on screen and selectable.

function canShareFile(filename) {
  if (!navigator.canShare || typeof File === "undefined") return false;
  try {
    return navigator.canShare({ files: [new File(["{}"], filename, { type: "text/plain" })] });
  } catch {
    return false;
  }
}

// Shows exported text with whatever ways of getting it off the device this
// browser supports. `text` is generated by the caller *before* the click that
// opens this — Safari invalidates the user-gesture token across an `await`,
// so anything generated lazily inside the copy handler would fail silently.
export function openTextExport({ title, hint, text, filename }) {
  open((parent) => {
    addTitle(parent, title);

    const note = document.createElement("div");
    note.className = "modal-note";
    note.textContent = hint;
    parent.appendChild(note);

    const area = document.createElement("textarea");
    area.className = "modal-textarea";
    area.readOnly = true;
    area.value = text;
    parent.appendChild(area);

    const status = document.createElement("div");
    status.className = "modal-note";

    const row = document.createElement("div");
    row.className = "modal-row";

    const copy = document.createElement("button");
    copy.className = "modal-save";
    copy.textContent = "copy";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        status.textContent = "copied";
      } catch {
        // Denied, or no clipboard access — the textarea is still right there.
        area.focus();
        area.select();
        status.textContent = "couldn't copy — text selected, copy it manually";
      }
    });
    row.appendChild(copy);

    if (canShareFile(filename)) {
      const share = document.createElement("button");
      share.className = "modal-save";
      share.textContent = "share";
      share.addEventListener("click", async () => {
        try {
          await navigator.share({
            files: [new File([text], filename, { type: "text/plain" })],
            title: filename,
          });
        } catch (error) {
          // A cancelled share sheet is a normal outcome, not a failure.
          if (error && error.name !== "AbortError") status.textContent = "share failed";
        }
      });
      row.appendChild(share);
    }

    parent.appendChild(row);
    parent.appendChild(status);
  });
}

export function openTextImport({ onLoad }) {
  open((parent) => {
    addTitle(parent, "import");

    const note = document.createElement("div");
    note.className = "modal-note";
    note.textContent = "Paste an exported levels.json or icons-data.js. Which one it is is worked out from the text.";
    parent.appendChild(note);

    const area = document.createElement("textarea");
    area.className = "modal-textarea";
    area.placeholder = "paste here";
    parent.appendChild(area);

    const status = document.createElement("div");
    status.className = "modal-note";

    const load = document.createElement("button");
    load.className = "modal-save";
    load.textContent = "load";
    load.addEventListener("click", () => {
      try {
        onLoad(area.value);
      } catch (error) {
        status.textContent = error.message;
      }
    });
    parent.appendChild(load);
    parent.appendChild(status);

    requestAnimationFrame(() => area.focus());
  });
}

export function openDataMenu({ hasLocal, onExportLevels, onExportIcons, onImport, onClearLocal }) {
  open((parent) => {
    addTitle(parent, "levels & icons");

    const note = document.createElement("div");
    note.className = "modal-note";
    note.textContent = hasLocal
      ? "Edits on this device are shadowing the shipped files. Export them to commit them."
      : "No local edits — this device is playing the shipped files.";
    parent.appendChild(note);

    for (const [label, handler] of [
      ["export levels", onExportLevels],
      ["export icons", onExportIcons],
      ["import…", onImport],
    ]) {
      const button = document.createElement("button");
      button.className = "option";
      button.textContent = label;
      button.addEventListener("click", handler);
      parent.appendChild(button);
    }

    if (!hasLocal) return;

    // Two taps, on purpose: this throws away work that only exists here, and
    // it's only correct *after* an export has actually been committed.
    const clear = document.createElement("button");
    clear.className = "option danger";
    clear.textContent = "clear local edits";
    let armed = false;
    clear.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        clear.textContent = "tap again to discard local edits";
        return;
      }
      onClearLocal();
    });
    parent.appendChild(clear);
  });
}

export function openSavePrompt({ currentName, onSave }) {
  open((parent) => {
    addTitle(parent, "save as new level");

    const input = document.createElement("input");
    input.className = "modal-input";
    input.type = "text";
    input.value = currentName;
    parent.appendChild(input);

    const save = document.createElement("button");
    save.className = "modal-save";
    save.textContent = "save";
    parent.appendChild(save);

    const updateEnabled = () => {
      save.disabled = input.value.trim().length === 0;
    };
    input.addEventListener("input", updateEnabled);
    updateEnabled();

    const commit = () => {
      const name = input.value.trim();
      if (name) onSave(name);
    };
    save.addEventListener("click", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") commit();
    });

    // Focus has to wait for the panel to actually be in the document.
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}
