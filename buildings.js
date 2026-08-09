// The building type table.
//
// Adding a building type should mean adding one entry here and one legend
// character in a level file — nothing else. If a new type needs a branch
// somewhere else in the codebase, this table is the wrong shape.
//
// **One currency.** Everything below is energy. There used to be two — an
// energy "pool" the player spent on taps, and an ephemeral "signal" that
// decayed as a cascade travelled — which was a comprehension tax with no
// payoff. Now a tile has a cost, maybe some generation, maybe some storage,
// and the grid either affords itself or it doesn't (see power.js).
//
//   cost       — energy this tile consumes every turn while it's powered.
//   generation — energy it produces every turn while powered. 0 for most.
//   storage    — energy it can hold across a turn boundary. This is what
//                lets a generator start *itself*: energy can't pay for the
//                turn that produces it, so a generator needs enough banked
//                to cover its own cost, or it only ever fires once from the
//                click that enabled it. storage >= cost means "runs forever
//                once switched on"; storage 0 with big generation would be a
//                one-shot flare. (Batteries that buffer energy for *other*
//                tiles are a later feature — see design.md.)
//   output     — where generation goes: "grid" (default, pays for the
//                component's own costs) or "pool" (the player's reserve).
//                A mine is the only thing that pays into the pool, which is
//                exactly what makes it the refill.
//
// conducts says which neighbours this tile is wired to, and it's symmetric:
// "all" for the ordinary case, "vertical"/"horizontal" for red/green
// crystal, and omitted for inert tiles that aren't part of any grid.
//
// What that buys is **parallel buses with no gap between them**: a 2x2 block
// of red crystal is two independent vertical runs, touching, rather than one
// blob — where plain crystal would merge it. That's the dense-layout win.
// Note it does *not* let two runs cross: a green row lying across a red run
// breaks it, because the tile at the junction has only one axis. A true
// crossover would need a tile carrying both axes as separate channels, which
// is a different feature (see design.md).
//
// colony describes how an activated building participates in the colony
// economy (see colony.js), as declared resources rather than named flags:
// `stocks` are recounted from the board every turn (population, food
// capacity), and `requiresLabor` marks a job that only runs while the colony
// is fed and someone actually lives there.
//
// legendChar is the character this type is written as in a level file's grid.
//
// Nothing here is switchable off. The only move is feeding a tile — putting
// your reserve behind it so it runs and a cascade starts there — so a building
// never needs a per-type flag about what clicking it does.
//
// shape names the glyph the renderer draws at a tile's center — "plus",
// "bolt", "person", "leaf", "dollar", "x", or omitted for no icon (desert).
// iconColor is that glyph's color, always at full brightness: powering never
// dims it, so a tile's *type* reads at a glance whether or not it's lit.

export const BUILDINGS = {
  desert: {
    id: "desert",
    name: "Desert",
    legendChar: ".",
    inert: true,
    fill: "#181e27",
    stroke: "#20283340",
  },

  crystal: {
    id: "crystal",
    name: "Crystal",
    legendChar: "C",
    inert: false,
    fill: "#1b2732",
    stroke: "#35505f",
    activeFill: "#23414e",
    glow: "#2dd4bf",
    iconColor: "#f3f7fa",
    shape: "plus",
    cost: 1,
    conducts: "all",
  },

  redCrystal: {
    id: "redCrystal",
    name: "Red Crystal",
    legendChar: "R",
    inert: false,
    fill: "#2a1c20",
    stroke: "#5c2a34",
    activeFill: "#3a2830",
    glow: "#ef4444",
    iconColor: "#f87171",
    shape: "plus",
    cost: 1,
    // Wired north/south only, so two adjacent columns of it stay separate.
    conducts: "vertical",
  },

  greenCrystal: {
    id: "greenCrystal",
    name: "Green Crystal",
    legendChar: "G",
    inert: false,
    fill: "#1a2015",
    stroke: "#3d4d22",
    activeFill: "#26301c",
    glow: "#84cc16",
    iconColor: "#a3e635",
    shape: "plus",
    cost: 1,
    conducts: "horizontal",
  },

  powerPlant: {
    id: "powerPlant",
    name: "Power Plant",
    legendChar: "P",
    inert: false,
    fill: "#2a2415",
    stroke: "#5b4c22",
    activeFill: "#40341a",
    glow: "#f59e0b",
    iconColor: "#fbbf24",
    shape: "bolt",
    cost: 1,
    generation: 5,
    // Enough banked to cover its own cost, so it restarts itself every turn
    // rather than needing a click. Net +4 to whatever it's wired into.
    storage: 1,
    conducts: "all",
  },

  residential: {
    id: "residential",
    name: "Residential",
    legendChar: "H",
    inert: false,
    fill: "#131f2c",
    stroke: "#2c5170",
    activeFill: "#1c3245",
    glow: "#0ea5e9",
    iconColor: "#38bdf8",
    shape: "person",
    cost: 2,
    conducts: "all",
    colony: { stocks: { population: 1 } },
  },

  farm: {
    id: "farm",
    name: "Farm",
    legendChar: "F",
    inert: false,
    fill: "#131f16",
    stroke: "#29572f",
    activeFill: "#1c3922",
    glow: "#22c55e",
    iconColor: "#4ade80",
    shape: "leaf",
    cost: 2,
    conducts: "all",
    colony: { stocks: { food: "foodPerFarm" } },
  },

  mine: {
    id: "mine",
    name: "Mine",
    legendChar: "M",
    inert: false,
    fill: "#24141a",
    stroke: "#5c2a34",
    activeFill: "#3a1e26",
    glow: "#dc2626",
    iconColor: "#ef4444",
    shape: "dollar",
    cost: 3,
    // Paid into the player's reserve rather than back into the grid — the
    // only thing that refills what you spend.
    generation: 2,
    output: "pool",
    conducts: "all",
    colony: { requiresLabor: true },
  },

  drain: {
    id: "drain",
    name: "Drain",
    legendChar: "D",
    inert: false,
    fill: "#241c2c",
    stroke: "#3c2d47",
    activeFill: "#372a45",
    glow: "#c084fc",
    iconColor: "#a855f7",
    shape: "x",
    // Expensive to keep powered and gives nothing back — it still "costs you
    // progress", but now as upkeep rather than as a special-cased mechanic
    // that reached out and switched neighbours off.
    cost: 4,
    conducts: "all",
  },
};

export function buildingFor(cell) {
  return BUILDINGS[cell.type];
}

// What a tile costs to run, produces, and can bank. Defaults keep the table
// terse: most tiles only declare a cost.
export function costOf(building) {
  return building.cost ?? 0;
}

export function generationOf(building) {
  return building.generation ?? 0;
}

export function storageOf(building) {
  return building.storage ?? 0;
}

// Whether generation feeds the grid it sits in, or the player's pool.
export function paysPool(building) {
  return building.output === "pool";
}

// Whether a building can bring itself up each turn.
//
// This only bites on things that feed the *grid they sit in*: energy can't pay
// for the turn that produces it, so such a generator needs enough banked to
// cover its own cost or it can never restart. Anything that exports to the
// pool is, from its grid's point of view, just a load like any other — the
// grid powers it and it ships its output elsewhere, so there's nothing to
// bootstrap. Same for tiles that generate nothing at all.
export function selfStarting(building) {
  if (paysPool(building)) return true;
  return generationOf(building) === 0 || storageOf(building) >= costOf(building);
}
