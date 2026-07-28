# Casual Colony — Design

Working design document. Expect this to change; it's a thinking surface, not a spec.

## Vision

A casual colony re-builder. The map is a grid of buildings representing a dead
city. The player spends **energy** to activate buildings, subject to
constraints. An activated building does something useful — houses workers,
produces food, generates more energy, or activates its neighbours — which in
turn lets the player activate more buildings.

The feel is a puzzle, not a simulation. There is no real-time pressure and no
resource ticking while you think. A turn is a decision: *which building do I
activate next, and what does that unlock?* A level is a search for a good
activation sequence. You win by bringing enough of the map under control before
you run out of energy.

## Core loop

1. Look at the board and the energy remaining.
2. Choose a building to activate and pay its energy cost.
3. That activation cascades — neighbours light up, resources are produced,
   new options open.
4. Repeat until you exceed the control threshold (win) or can no longer afford
   any useful activation (lose).

The interesting decisions come from cascades. Activating the *right* building
sets off a chain that pays for itself several times over; activating the wrong
one strands a cluster and wastes energy. Ordering matters more than raw
resource count.

## Concepts

### The map

A 2D grid. Every cell holds exactly one building. There are no empty cells —
"empty" is represented by an inert building type (rubble, desert, ruins).

Grid size should suit a phone held in portrait: taller than it is wide, and
large enough that a cascade feels like it travels somewhere. Currently 10×14,
fixed per level so that every player sees the same puzzle.

Adjacency is **orthogonal only** — no diagonals. See the percolation note under
Milestone 1; this choice is load-bearing, not cosmetic.

### Levels are files, not randomness

Levels are authored JSON, loaded at runtime. The game contains no random number
generation at all: any randomness happens once, at authoring time, and the
result is baked into a file. The same level always plays the same way.

The format uses row strings and a legend so a level can be read and edited in a
text editor:

```json
{
  "name": "Random Crystal Forest",
  "size": { "width": 10, "height": 14 },
  "legend": { ".": "desert", "C": "crystal" },
  "grid": ["..C..CC..C", "CC.CCC.CCC"]
}
```

A legend entry maps one character to one building type id. Adding a building
type means one entry in the building table and one legend character — nothing
else.

### Buildings

A building **type** is data, not code branching. Each type has:

- `id` — internal key
- `name` — display name
- `icon` — glyph or sprite
- `activate(cell, world)` — what happens when it becomes active
- cost, and any constraints on whether it *may* be activated

Adding a building type should mean adding one entry to a table. If it means
editing a switch statement in three files, the model is wrong.

### Energy

The player's single spendable currency, and the source of all pressure. Every
activation costs energy. Some buildings return more energy than they cost —
those are the engine of a run, and finding them is the puzzle.

A level starts with a fixed energy budget. Running out with the control
threshold unmet is the loss condition.

### Activation and cascades

Buildings are **inactive** or **active**. Activation is currently permanent —
once lit, a building stays lit. (Decay, upkeep, or deactivation are possible
later, but they turn a puzzle into a simulation, so not now.)

Activation propagates. A building's `activate` may activate others, which may
activate others in turn. This is a graph traversal from the clicked cell, and
it is where the game's character lives.

### Control

Win condition: fraction of the map activated exceeds some threshold. Exactly
how "control" is measured — raw active count, contiguous territory, weighted by
building value — is open.

## Building taxonomy (sketch)

Not committed to, just mapping the space:

| Role | Does | Tension it creates |
|---|---|---|
| **Inert** | Nothing. Occupies space, blocks propagation. | Shapes the board topology |
| **Conductor** | Activates neighbours | The cascade engine |
| **Power** | Refunds or generates energy | Extends the run |
| **Housing** | Provides workers | Gates other buildings |
| **Farm** | Produces food | Upkeep for workers |
| **Infrastructure** | Extends activation range, bridges gaps | Connects stranded clusters |

The general shape: conductors spread, power sustains, housing and farms gate
each other, infrastructure fixes topology problems. Most types should both give
something and demand something.

## Milestone 1 — Crystals and Desert

Deliberately minimal: the smallest thing that produces a real cascade, so we
can validate the board, input, rendering and deploy pipeline before layering on
mechanics.

**Two types:**

- **Desert** — inert. Does nothing. Blocks propagation.
- **Crystal** — when activated, activates every adjacent crystal.

Two color variants restrict propagation to one axis, trading flood size for
directional control: **red crystal** only activates north/south neighbours,
**green crystal** only activates east/west neighbours.

Color is cosmetic, not a compatibility gate: all three (plain, red, green)
activate each other freely — a plain crystal next to a red one lights it just
like it would another plain crystal. Only the *axis* is per-color; who counts
as a valid neighbour is shared across the whole crystal family
(`CRYSTAL_TYPES` in `buildings.js`). Reachability, from any given cell, is
always that cell's own axis — a red crystal reaches north/south regardless of
what color sits there, but a green crystal two steps further west is only
reached if something along the way had an axis that pointed that way.

**Setup:** each cell is a crystal with probability ~0.5, otherwise desert.

**Interaction:** tap a crystal. It activates, and the activation floods through
its connected group of crystals. Active crystals are highlighted.

**No energy, no win condition yet** — this milestone is about making the
cascade feel good. (Energy and win/lose arrive in Milestone 2, below.)

### The ripple

A cascade is a breadth-first walk from the tapped cell. The BFS *depth* is what
makes it feel good: rather than lighting the whole group at once, each cell is
stamped with `activateAt = now + depth × RIPPLE_STEP` and lights when the clock
reaches it. Rendering just compares against the clock — no timers, no animation
queue, and the activation visibly travels outward from the player's finger.

This also means a cascade is scheduled entirely at tap time. The traversal is a
pure function of the board (`computeCascade`), which keeps it testable.

### Why 50% is the right number

Tapping a crystal activates its entire connected component, so cluster size
distribution *is* the game feel. That distribution is governed by site
percolation on a square lattice, and it changes sharply around a critical
density:

- **4-neighbour** (orthogonal) adjacency: critical density ≈ **0.593**
- **8-neighbour** (incl. diagonals) adjacency: critical density ≈ **0.407**

Below critical, clusters are finite and mostly small — tapping lights up a
satisfying local patch and stops. Above it, a single cluster spans the whole
board — one tap lights nearly everything and there is no game.

At the proposed 50%, these two adjacency rules land on **opposite sides** of
their thresholds. With 4-neighbour adjacency, 0.5 sits comfortably below 0.593:
mostly modest clusters, occasional big satisfying one. With 8-neighbour, 0.5 is
well above 0.407 and the board will tend to light up in a single tap.

So the intuition that 50% gives "a few neighbours, then an isolated cluster" is
right — but specifically for orthogonal adjacency. Density and adjacency have
to be chosen together, and density is the main dial for tuning cascade size
later.

## Milestone 2 — Energy budget and win/lose

Turns the sandbox into a puzzle with a real end state, still with no ticking
and no runtime randomness.

**Level data gains two fields:**

- `energyBudget` — a positive integer. Each tap that actually activates
  something (a non-empty cascade) spends exactly 1, regardless of how many
  cells the cascade lights — the player pays for the decision, not the
  payoff. A tap on desert or an already-lit cell is a no-op and free.
- `completionGoal` — a fraction between 0 (exclusive) and 1 (inclusive) of
  **every** cell on the board, inert ones included. This caps what's
  actually reachable at the board's crystal density, which is the point: the
  goal has to be chosen relative to what the level's clusters can deliver.

**Game over** is reached once energy hits 0 *and* every scheduled cascade has
finished its ripple animation — the last chain reaction still gets to play
out before the outcome screen appears. At that point the fraction of
activated cells is compared to `completionGoal`: meet or beat it and it's a
win, fall short and it's a loss. Reset clears the board and restores the
budget so the level replays deterministically.

The shipped level's `energyBudget` and `completionGoal` are re-verified by
the "completion goal is reachable" test in `test.html` against the level
file itself, so the two can't silently drift apart — see Milestone 3 below
for why that test looks different than a simple cluster-size sum now.

### Drain — the first tile that costs you progress

Every other building only adds to the activated count. **Drain** is the
inverse: it deactivates whichever of its orthogonal neighbours are currently
activated, of any type, and never activates anything itself (`inert: true`,
its gem is a fixed marker color, not a dormant/lit pair). It fires two ways:

- **Tapped directly** — costs 1 energy, but only if it actually drains
  something; tapping it with no lit neighbours is a free no-op, same rule as
  tapping desert.
- **Reactively** — the instant any tap's cascade activates a cell next to a
  drain, the drain fires on its own, for free, clearing that cell along with
  any other already-activated neighbour it has. One neighbour lighting up is
  enough, the same way one lit neighbour is enough to spread a normal
  crystal — a drain doesn't wait for a second neighbour before reacting, it
  absorbs the first one immediately. In practice this means a cell adjacent
  to a drain can never *stay* lit: the moment a cascade would light it, the
  same synchronous pass that scheduled it also clears it, so it never even
  pops in on screen.

`triggeredDrains(world)` (`cascade.js`) is what makes the reactive half
possible: a pure scan of the whole board for any drain with 1+ activated
neighbour, called after every cascade is scheduled. It can't loop or need a
fixed point — clearing a cell never creates a new trigger for some *other*
drain, since draining only removes activation, never adds it — so one pass
always catches everything. The direct-tap path (`building.drain(world,
cell)` in the table, same as `propagate`) is unchanged and still exists
independently, though in practice it's almost always a no-op now: anything
it could drain, the reactive pass already caught the moment it lit.

Both paths stay *local* — neither is a flood-fill that chases activation
through a whole connected cluster. A cascading drain (unraveling an entire
lit cluster from one tap) is a bigger, higher-stakes mechanic worth trying
later, but needs its own traversal, since `propagate`-style reachability
only makes sense outward from a single tapped cell — draining instead has to
start from *every* currently-lit cell within a cluster at once. Starting
local means finding out whether "losing progress" is fun at all before
building that.

Because it removes cells from the activated count, a drain permanently
undercuts whatever cluster it borders — the one on the shipped level (row 9,
column 9) touches a lone crystal and one cell of what was, before signal
attenuation, the board's second-biggest cluster; neither can ever actually be
banked while it's tapped anywhere nearby. Once Milestone 3 replaced "flood
the whole connected cluster" with signal-limited reach, this stopped being a
distinct problem to solve — see below.

## Milestone 3 — Signal attenuation and the power plant

Every crystal type up to this point spread activation for free: tap one cell
and the whole connected cluster lights up, no matter how big. That made
*which* cluster you tapped the only decision — never *how much* a tap was
worth. Signal attenuation makes activation a resource that runs out as it
travels, so reach becomes something the board design controls directly.

**The rule:** a tap hands the tapped cell one unit of signal. Every cell that
activates passes along whatever signal it received, plus its own boost (0 for
ordinary crystals) minus the level's `attenuation` (a number in the level
file, defaulting to 1 if omitted). Once that reaches zero, the signal is
spent and the cascade stops spreading from there — the cell itself still
activates (it got a positive signal to exist at all), it just can't hand
anything further on. With the default attenuation of 1, a plain tap's signal
is exactly enough to activate the tapped cell and nothing else: 1 (tap) − 1
(attenuation) = 0 for every neighbour. Every crystal type built so far —
plain, red, green — behaves this way by default. This is the headline
consequence: **without something that adds signal back, no tap spreads
beyond the single cell you tapped.**

**Power plant** is that something: a new building, same shape as plain
crystal (activates every orthogonal crystal-family neighbour, participates in
`CRYSTAL_TYPES` the same as red and green do), except it adds 5 to the signal
the moment it activates, before that hop's attenuation is subtracted. Tap a
power plant directly and its neighbours receive 1 (tap) + 5 (boost) − 1
(attenuation) = 5 — enough to travel up to 5 further hops (5, 4, 3, 2, 1, then
0) before dying out, activating everything within that reach, colors mixed
freely. A second power plant encountered along the way re-boosts whatever
signal is left when it activates, extending the chain further still.

Boost amount lives in the level file too, the same as attenuation —
`powerPlantBoost`, defaulting to 5 if omitted. (First cut had this as a fixed
`boost: 5` on the building, deliberately asymmetric with attenuation on the
theory that boost is "what a tile does" and belongs in code, not a level
parameter — but there was no real reason a level shouldn't get to tune both
knobs, so it moved.) The building table still only holds a *reference* to
where its boost lives: `boostKey: "powerPlantBoost"` on the power plant
entry, and `cascade.js` looks up `world[building.boostKey]`. That indirection
means a future second booster type can point at its own level field without
`cascade.js` ever needing to know building ids by name — it stays generic
over "does this building have a boostKey," not "is this building a power
plant."

**Consequence for level design:** a crystal cluster is no longer inherently
valuable — only a cluster *reachable from a power plant* is. The shipped
level places one power plant (row 1, column 2) with a single-tap reach of 16
cells; every other tap is worth exactly 1 unless routed through it. Finding
and using the power plant stopped being optional the moment this landed — it
went from "one more tile" to "the only tile that matters," which is exactly
the kind of asymmetry a level can now be designed around.

This also changed what "is this level winnable" means to check. The old test
summed the sizes of the N biggest *connected components* and compared that to
`completionGoal`, which implicitly assumed every tap floods its whole
cluster — no longer true. The rewritten test is a *constructive* check
instead of an optimality proof: it simulates one concrete sequence a player
could actually make (tap the power plant, then tap one more untouched
crystal) using the real, signal-aware `computeCascade`, and confirms that
alone clears the goal. It proves the level *can* be won, not that this is the
best way to win it — good enough for now, and honest about the difference.
`energyBudget: 4` / `completionGoal: 0.12` were chosen the same way: the
power plant alone reaches 16 of 140 cells (11%); one more ordinary tap
reaches 17 (12.1%), just clearing the goal with two energy still spare for a
wrong guess or two.

## Milestone 4 — Level editor

A toggle, next to reset in the HUD, that turns tapping-to-play into
tapping-to-retype. In edit mode, tapping a cell opens a picker listing every
building type in *this level's own legend* (not the whole `BUILDINGS` table —
a level about crystals shouldn't offer you buildings it never declared), with
the cell's current type highlighted. Picking a different one changes that
cell on the spot. Toggling edit mode back off restarts the level in normal
play — full energy, nothing activated — but keeps every edit made, so the
point of editing is to then play the level you just changed, not just to
preview it.

**The picker is a plain DOM modal, not canvas UI.** Everything else in this
game is canvas-drawn, but a list of clickable, labeled options with a
selected state is exactly what HTML buttons already are — hand-rolling that
in canvas would mean reimplementing hit-testing, focus, and text layout for
no benefit. `index.html` gets a single `#modal` overlay (hidden by default,
reused for the tile picker, the level picker, and the save-as-new name
prompt — see Milestone 5) and `game.js` populates it with real `<button>`
elements built from `BUILDINGS`, one per legend type, each showing a small
color swatch (its `lit`, `icon`, or `fill`, whichever exists) next to its
name. This is the first departure from "everything is canvas" in the whole
project, and it's a narrow, deliberate one — the picker doesn't touch game
state directly, it just calls back into the same `cell.type = ...`
assignment editing would use regardless of how the UI were built.

**Why the legend, not the full building table:** `parseLevel` now keeps the
level's `legend` (character → type id) on the returned world object
specifically so the editor has something scoped to ask. This also means the
picker doubles as a legend viewer — if a level uses five types, editing shows
exactly those five, in the order the level file declared them.

**What editing doesn't do:** touch `energyBudget`, `completionGoal`,
`attenuation`, or `powerPlantBoost`. Only tile types change. Those four are
level physics, set once at authoring time; retuning them live isn't part of
what "edit" means here, and conflating the two would make it much harder to
tell whether a level felt different because of a layout change or a rules
change. If level-wide tuning ever needs its own UI, that's a separate
control, not an extension of the tile picker.

## Milestone 5 — A set of levels, and saving what you edit

Up through Milestone 4 there was exactly one level, loaded from one file. This
turns that into a *set*: `levels/levels.json` is now a JSON array of level
records — the same shape as before, just collected — and the game offers a
level picker (behind the same button that used to just restart the current
level) instead of always loading the one file. The shipped level itself was
renamed "simple test" and is the first (and so far only) entry.

**There's no backend, so "saving" means localStorage.** This is still a
static site with nothing to POST to — `storage.js` writes edited or
newly-named levels into `localStorage`, keyed by name, and reads them back
into the level list alongside the shipped set. A saved level with the same
name as a shipped one shadows it — that's the entire mechanism behind "save
as current": it's really always "save as [this name]," and updating the
current level is just the case where that name already exists. `game.js`
merges shipped + saved by name at startup (saved wins) so a player's edits
survive a reload without needing anything server-side at all.

**`serializeLevel` is `parseLevel` run backward.** The editor mutates
`cell.type` directly on the live, playable `world` — that was already true
in Milestone 4 — but saving needs a plain JSON-shaped record to hand to
`storage.js`, not a `world` with mutable per-cell state. `serializeLevel`
(`level.js`) rebuilds the `grid` row-strings from the current cells by
reversing the level's own `legend` (type → first character that maps to it),
and carries `energyBudget`/`completionGoal`/`attenuation`/`powerPlantBoost`
through untouched. Editing can only ever introduce types already in the
legend (the picker is scoped to it), so the legend itself never needs to
change — reused as-is.

**Two save paths, one button, context-dependent:** the reset/level-picker
button becomes "save as" while editing (opens the name-prompt modal,
prefilled with the current name — confirming with the same name is
indistinguishable from "update current," which is fine, that's what it *is*),
and the edit-toggle button becomes "restart" while editing (saves under the
*current* name unconditionally, no prompt, then restarts play). Both funnel
into `loadLevelByRecord`, which always re-`parseLevel`s rather than reusing
the in-memory `world` — a freshly saved level should never carry over stale
per-cell animation state from the session that created it.

## Decisions so far

| Decision | Why |
|---|---|
| Orthogonal adjacency | Keeps 50% density below the percolation threshold, so clusters stay finite |
| Levels as JSON files, no runtime RNG | Reproducible boards; levels become authorable content |
| Fixed grid, letterboxed square cells | Every player sees the same puzzle; a grid with non-square cells looks wrong |
| Ripple via BFS depth + timestamps | Cascade feel, with no timers and a pure, testable traversal |
| Sandbox before energy | Get the cascade feeling right before adding pressure |
| Energy costs 1 per tap, not per cell lit | Rewards finding big connected clusters instead of counting cells |
| Completion goal is a fraction of the whole board | Ties level design directly to crystal density instead of a second hidden number |
| Signal attenuates per hop; only a power plant's boost extends reach | Turns "which cluster" into "how far can this reach" — reach becomes a level-design lever, not just density |
| Boost lives in the level file, referenced from the building via `boostKey` | Same level-tunable status as attenuation, without `cascade.js` needing to know building ids by name |
| Tile picker is a DOM modal, not canvas-drawn | Buttons with labels and a selected state are what HTML already does well; no reason to reimplement that in canvas |
| Editor scoped to the level's own legend, and only edits tile types | Keeps the picker relevant per-level and keeps "layout change" separate from "rules change" (energy/goal/attenuation/boost) |
| Levels ship as one JSON array, not one file each | The game can offer a list to pick from without a separate index file to keep in sync |
| Saved levels live in localStorage, keyed by name, shadowing shipped names | The only persistence a static site can have without a backend; matches "save as current" being "save as [this name]" |
| `serializeLevel` reuses the level's existing legend rather than inventing characters | Editing can only introduce types already in the legend, so the legend never needs to change |

## Open questions

- How is control measured — active cell count, or something spatial? *(Now:
  fraction of all cells activated, checked once at game over. Spatial /
  contiguous-territory measures are still open.)*
- Do buildings ever deactivate?
- Are levels hand-authored, or generated offline and then curated? *(The
  editor makes hand-authoring interactive — still no offline generation.)*
- Does the player ever *place* buildings, or only activate what's there?
  *(Now: yes, but only in the separate edit mode, not as a move within a
  normal run — retyping a tile costs no energy and isn't part of the puzzle
  being solved. Placement as a real gameplay mechanic, spent from the energy
  budget mid-run, is still open.)*
- Where does energy come from at the start of a level — fixed budget, or seeded
  by a starting building? *(Now: a fixed `energyBudget` per level.)*

## Explicitly not doing yet

- Real-time ticking of any kind
- Progression between levels (unlocks, a "next level" flow, tracking which
  ones you've won). Milestone 5 added save/load, but only of level *content*
  (localStorage, via the editor) — there's still no notion of player state
  or progress across levels
- Sound
- Building placement as a *gameplay* mechanic (spent from the energy budget,
  part of a run) — the level editor added authoring-time placement, which is
  a different thing: it happens outside a run and costs nothing
