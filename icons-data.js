// Custom icons that ship with the game.
//
// Icons drawn in the in-game pixel editor (Milestone 8) previously lived
// *only* in localStorage, which meant they existed on exactly one device and
// vanished the moment Safari cleared its storage — nobody else ever saw them,
// and there was no way to make one part of the game. This file is where an
// icon becomes permanent: export it from the game (see exchange.js) and paste
// the result here.
//
// Deliberately a static ES module rather than JSON fetched at runtime. A
// custom icon has to be ready before the very first frame or tiles visibly
// flash their default shape on load; a static import is resolved before any
// of that, a fetch isn't.
//
// localStorage still layers on top of this at startup (see game.js), so
// editing an icon on a device overrides the shipped one there without
// touching what everyone else sees.
//
// { [buildingId]: string[] } — one row-string per pixel row, "#" on and "."
// off, ICON_GRID_SIZE rows of ICON_GRID_SIZE characters. Same row-string
// convention level grids already use.

export const SHIPPED_ICONS = {};
