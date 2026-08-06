// The DOM overlay: tile picker, icon editor, level picker, save prompt, and
// legend.
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
export function openTilePicker({ currentType, iconOverrides, onSelect, onEditIcon }) {
  open((parent) => {
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

export function openLevelPicker({ levels, currentName, onPick }) {
  open((parent) => {
    addTitle(parent, "choose a level");
    for (const record of levels) {
      const button = document.createElement("button");
      button.className = "option" + (record.name === currentName ? " selected" : "");
      button.textContent = record.name;
      button.addEventListener("click", () => onPick(record));
      parent.appendChild(button);
    }
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
