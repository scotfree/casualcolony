// The building type table.
//
// Adding a building type should mean adding one entry here and one legend
// character in a level file — nothing else. If a new type needs a branch
// somewhere else in the codebase, this table is the wrong shape.
//
// propagate(world, cell) returns the cells this building *could* hand signal
// to when it activates — every orthogonal neighbour capable of activating at
// all (see activatable() below), restricted to an axis for red/green
// crystal. Whether a given neighbour actually activates depends on whether
// enough signal survives to cover its own activationCost — see cascade.js.
// Omit propagate for buildings that never spread (desert, drain).
//
// activationCost is how much signal a cell must receive to activate when
// reached via propagation — a property of the *type*, not the level, so a
// crystal (cheap, 1) can carry a signal much further than a mine (steep, 3)
// ever could. It only gates propagated activation: the cell you actually
// tap always activates, full stop — that certainty is what spending the
// energy on a tap buys. A building with no activationCost can never be a
// propagation target (desert, drain — see activatable()).
//
// drain(world, cell) returns the already-activated cells this building
// deactivates when tapped. It's the inverse of propagate — a tap here
// undoes neighbours' activation instead of spreading its own. Omit it for
// buildings that don't drain.
//
// boostKey names a field on the level itself holding how much this building
// adds to the signal when it activates, before that signal is spent on
// whatever it reaches next. Omit it for buildings that don't amplify — see
// cascade.js. Boost lives on the level, not a hardcoded number here, so
// different levels can tune it without a new building type.
//
// houses/feeds/mines are capability flags for the colony economy (see
// colony.js): an activated houses building counts toward population, feeds
// toward food capacity, mines toward energy income when the colony is fed.
// The colony economy itself is still resolved fresh every tap, separately
// from cascades — resolveColony only ever reads activateAt, so it doesn't
// care whether a cell got there by direct tap or by propagation.
//
// toggle: true means tapping an already-activated cell of this type
// deactivates it instead of no-opping — see game.js. Residential is the
// only one: it's how a player fixes a starving colony themselves, rather
// than the game picking who starves.
//
// shape names the glyph game.js draws at a tile's center — "plus", "bolt",
// "person", "leaf", "dollar", "x", or omitted for no icon (desert). iconColor
// is that glyph's color, always at full brightness: activation never dims
// it, so a tile's *type* reads at a glance whether or not it's lit. Only
// fill/stroke (at rest) versus activeFill/glow (once active) change with
// state — see game.js's paintTile. That split is deliberate: "what is this"
// and "is it active" are two different questions and shouldn't share one
// visual signal.

import { orthogonalNeighbours, verticalNeighbours, horizontalNeighbours } from "./grid.js";

// A cell can only ever be a propagation target if it's capable of
// activating at all — desert and drain are permanently excluded (inert),
// but every other type is now fair game for a neighbour's signal to reach,
// not just same-family ones. Whether it actually *does* activate is a
// separate question, decided in cascade.js by comparing what's left of the
// signal against the target's own activationCost.
function activatable(neighbours) {
  return neighbours.filter((n) => !buildingFor(n).inert);
}

// Shared by every type whose signal reaches evenly in all 4 directions
// (everything except red/green crystal, which are axis-locked).
function propagateOrthogonal(world, cell) {
  return activatable(orthogonalNeighbours(world, cell));
}

export const BUILDINGS = {
  desert: {
    id: "desert",
    name: "Desert",
    inert: true,
    fill: "#181e27",
    stroke: "#20283340",
  },

  crystal: {
    id: "crystal",
    name: "Crystal",
    inert: false,
    fill: "#1b2732",
    stroke: "#35505f",
    activeFill: "#23414e",
    glow: "#2dd4bf",
    iconColor: "#f3f7fa",
    shape: "plus",
    activationCost: 1,
    propagate: propagateOrthogonal,
  },

  redCrystal: {
    id: "redCrystal",
    name: "Red Crystal",
    inert: false,
    fill: "#2a1c20",
    stroke: "#5c2a34",
    activeFill: "#3a2830",
    glow: "#ef4444",
    iconColor: "#f87171",
    shape: "plus",
    activationCost: 1,

    // Same as crystal, but only reaches along the north/south axis.
    propagate(world, cell) {
      return activatable(verticalNeighbours(world, cell));
    },
  },

  greenCrystal: {
    id: "greenCrystal",
    name: "Green Crystal",
    inert: false,
    fill: "#1a2015",
    stroke: "#3d4d22",
    activeFill: "#26301c",
    glow: "#84cc16",
    iconColor: "#a3e635",
    shape: "plus",
    activationCost: 1,

    // Same as crystal, but only reaches along the east/west axis.
    propagate(world, cell) {
      return activatable(horizontalNeighbours(world, cell));
    },
  },

  powerPlant: {
    id: "powerPlant",
    name: "Power Plant",
    inert: false,
    fill: "#2a2415",
    stroke: "#5b4c22",
    activeFill: "#40341a",
    glow: "#f59e0b",
    iconColor: "#fbbf24",
    shape: "bolt",
    activationCost: 1,
    // See world.powerPlantBoost (level.js) for the actual amount.
    boostKey: "powerPlantBoost",
    propagate: propagateOrthogonal,
  },

  residential: {
    id: "residential",
    name: "Residential",
    inert: false,
    fill: "#131f2c",
    stroke: "#2c5170",
    activeFill: "#1c3245",
    glow: "#0ea5e9",
    iconColor: "#38bdf8",
    shape: "person",
    // Costlier than crystal on purpose: a crystal network can spill into a
    // colony cluster, but rarely deep — see mine's activationCost below.
    activationCost: 2,
    houses: true,
    toggle: true,
    propagate: propagateOrthogonal,
  },

  farm: {
    id: "farm",
    name: "Farm",
    inert: false,
    fill: "#131f16",
    stroke: "#29572f",
    activeFill: "#1c3922",
    glow: "#22c55e",
    iconColor: "#4ade80",
    shape: "leaf",
    activationCost: 2,
    feeds: true,
    propagate: propagateOrthogonal,
  },

  mine: {
    id: "mine",
    name: "Mine",
    inert: false,
    fill: "#24141a",
    stroke: "#5c2a34",
    activeFill: "#3a1e26",
    glow: "#dc2626",
    iconColor: "#ef4444",
    shape: "dollar",
    // The steepest activation cost on the board: a mine can still be
    // *reached* by a strong enough crystal chain, but it eats most of
    // whatever signal is left, so propagation rarely survives past one.
    activationCost: 3,
    mines: true,
    propagate: propagateOrthogonal,
  },

  drain: {
    id: "drain",
    name: "Drain",
    inert: true,
    fill: "#241c2c",
    stroke: "#3c2d47",
    activeFill: "#372a45",
    // Static marker — a drain never activates, so its icon is always
    // visible at rest, with only a brief brighter pulse (glow) the moment
    // it actually drains something.
    glow: "#c084fc",
    iconColor: "#a855f7",
    shape: "x",

    // Tapping a drain deactivates every orthogonally adjacent activated
    // cell, regardless of type. It never activates anything itself.
    drain(world, cell) {
      return orthogonalNeighbours(world, cell).filter((n) => n.activateAt !== null);
    },
  },
};

export function buildingFor(cell) {
  return BUILDINGS[cell.type];
}
