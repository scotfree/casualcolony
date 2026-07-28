// Client-side persistence for levels created or edited in the level editor.
//
// There's no backend — this game is static files, nothing it can write to.
// "Saving" a level means writing it into localStorage, keyed by name, so it
// survives a reload and shows up in the level list alongside the shipped
// set. A saved name that matches a shipped level's name overrides it there;
// that's how editing the current level and saving it "as current" works.

const STORAGE_KEY = "casualcolony:levels";

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Corrupt or inaccessible storage shouldn't take the game down with it —
    // treat it as if nothing had been saved yet.
    return {};
  }
}

// Every saved level record, in the order they were first saved.
export function loadSavedLevels() {
  return Object.values(readAll());
}

// Saves (or overwrites, if the name already exists) one level record.
export function saveLevel(record) {
  const all = readAll();
  all[record.name] = record;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}
