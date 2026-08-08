// The title screen — where a run comes from.
//
// Everything about *which* level you're playing lives here: the level list,
// the way into the editor, and getting edits on and off the device. None of
// that belongs in the HUD, which is for the run in front of you; mixing them
// meant the two most destructive buttons on screen ("load a different level",
// "start editing") sat one tap away from the board you were playing.
//
// It's a screen rather than a modal on purpose. A modal sits over a run and
// closes back to it — this is what a run comes out of, so it's opaque and it's
// the thing you return to when you're done.
//
// Like modals.js, this touches no game state: it takes a list and some
// callbacks and calls them.

const screen = document.getElementById("title");
const levelsBox = document.getElementById("title-levels");
const actionsBox = document.getElementById("title-actions");

function button(className, label, onClick) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}

function heading(text) {
  const element = document.createElement("div");
  element.className = "title-heading";
  element.textContent = text;
  return element;
}

// levels: the raw level records. onPlay/onEdit take one of them.
export function showTitle({ levels, onPlay, onEdit, onManageData }) {
  levelsBox.innerHTML = "";
  actionsBox.innerHTML = "";

  levelsBox.appendChild(heading(levels.length > 0 ? "choose a level" : "no levels"));
  for (const record of levels) {
    const row = document.createElement("div");
    row.className = "title-level";
    row.appendChild(button("title-play", record.name, () => onPlay(record)));
    // A separate target, not a mode you have to be in first: opening a level
    // to edit it and opening it to play it are different intentions, and
    // going through a run to reach the editor made every edit start with a
    // board you had to ignore.
    const edit = button("title-edit", "edit", () => onEdit(record));
    edit.setAttribute("aria-label", `Edit ${record.name}`);
    row.appendChild(edit);
    levelsBox.appendChild(row);
  }

  actionsBox.appendChild(button("title-action", "levels & icons…", onManageData));
  screen.classList.remove("hidden");
}

export function hideTitle() {
  screen.classList.add("hidden");
}

export function titleShowing() {
  return !screen.classList.contains("hidden");
}
