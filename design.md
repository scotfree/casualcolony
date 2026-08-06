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
building type, with the cell's current type highlighted. Picking a different
one changes that cell on the spot. Toggling edit mode back off restarts the
level in normal play — full energy, nothing activated — but keeps every edit
made, so the point of editing is to then play the level you just changed, not
just to preview it.

**The picker is a plain DOM modal, not canvas UI.** Everything else in this
game is canvas-drawn, but a list of clickable, labeled options with a
selected state is exactly what HTML buttons already are — hand-rolling that
in canvas would mean reimplementing hit-testing, focus, and text layout for
no benefit. `index.html` gets a single `#modal` overlay (hidden by default,
reused for the tile picker, the level picker, the save-as-new name prompt —
see Milestone 5 — and the legend popup — see Milestone 7) and `game.js`
populates it with real `<button>` elements built from `BUILDINGS`, each
showing a small color swatch (its `iconColor` or `fill`) next to its name.
This is the first departure from "everything is canvas" in the whole
project, and it's a narrow, deliberate one — the picker doesn't touch game
state directly, it just calls back into the same `cell.type = ...`
assignment editing would use regardless of how the UI were built.

**Originally scoped to the level's own legend; now the whole table.** The
picker first only offered types already in *this level's* legend, on the
theory that a level about crystals shouldn't offer buildings it never
declared. That held up fine with five types on one level, but stopped
working the moment most levels didn't declare the newer colony types at all
(Milestone 6) — editing "simple test" couldn't add a residential even though
residential is a perfectly normal building. The picker now always offers
every type in `BUILDINGS`, and `ensureLegendChar` (`game.js`) grows the
level's `legend` the first time a type new to it gets picked, assigning it
the same character every other level already uses for that type where
possible, so `serializeLevel` always has something to write that cell back
out as.

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

## Milestone 6 — Colony economy: residential, farms, and mines

Up through Milestone 5 every building was part of one system: the crystal
signal network, activated by cascades and gated by a strictly-draining energy
budget. This milestone adds a second system alongside it — a small colony
economy — without touching the first. **Residential** houses population,
**farm** grows food capacity, and **mine** converts a fed population into
energy income. None of the three propagate; each only ever activates itself
(the same single-cell activation an isolated crystal gets from a tap), so
they never interact with cascades or attenuation. `colony.js`'s
`resolveColony(world)` counts them fresh from board state — population, food
capacity, and mining income are all *derived*, the same way `updateOutcome`
already derived the activated fraction, rather than separately-tracked
counters that could drift from what's actually on the board.

**Resolved on every tap, not on a clock.** There's no notion of time besides
taps in this game, so the colony doesn't need its own tick — `applyColonyTick`
(`game.js`) runs `resolveColony` and applies its `energyDelta` to
`world.energy` after every successful tap, the same beat cascades and drains
already resolve on. A fed colony (`population <= foodCapacity`) earns
`mineYield` energy per activated mine; an unfed one bleeds `starvationPenalty`
energy per person over capacity. Three level knobs — `foodPerFarm`,
`mineYield`, `starvationPenalty` — join `attenuation` and `powerPlantBoost` as
optional, validated, non-negative numbers on the level file, defaulting to 1,
2, and 1 respectively.

**Culling is free and always available — the one exception to "everything
costs 1 energy."** Residential is the only `toggle: true` building: tapping
an already-active one deactivates it instead of no-opping. That's the
player's tool for fixing a starving colony themselves, rather than the game
picking who starves — directly answering the design question of what a
player is avoiding by managing population by hand. It was built ungated and
free (not costing energy, not blocked by the `energy <= 0` input gate that
stops every other action) after a hand-simulated adversarial sequence — build
farms, then overbuild residential past food capacity on the very tap that
also spends the last energy — showed that a *paid, gated* cull could lock a
starving colony permanently: the only fix would itself require the energy the
colony no longer has, and be blocked by the same zero-energy gate meant to
end the run. A hard, unrecoverable lock like that is functionally a forced
loss, which contradicts the whole point of "lose worker pool, not the game."
Because a free cull can pull energy back above 0, `applyColonyTick` also
clears `outcome` when that happens — `outcome` is otherwise permanent once
set (Milestone 2), which would otherwise leave a stale "Out of energy" screen
stuck on top of a colony that had actually recovered.

**Mining income breaks the one invariant the outcome screen relied on.**
Milestone 2 defined game over as "energy hits 0" — true by construction back
then, since every tap only ever *spent* energy. Mining breaks that: a fed
colony's income can outpace what taps cost, so energy can climb instead of
draining to 0. Playing the "recolonized" level's intended sequence in the
browser confirmed this wasn't hypothetical — after farms, residential, mines,
and the power plant were all up and the colony was earning more than it
spent, the completion goal was already met but no outcome screen ever
appeared, because energy stayed positive with nothing left to productively
tap. `updateOutcome` now has a second path to a decision: `hasProductiveMove`
(`game.js`) scans for any inactive cell that would still do something if
tapped — light a cascade, or clear something as a drain — and the outcome
resolves once energy hits 0 *or* the board is exhausted, whichever comes
first. Deliberately ignores the free residential toggle: a cullable tile
shouldn't keep a run "in progress" forever just because culling is always
technically available. The check runs once per tap (cached in
`boardExhausted`), not every animation frame, matching the rest of the
codebase's rule that state only ever changes in direct response to a tap.

**The "recolonized" level exercises the whole loop end to end.** An 8×10
board: 4 residential (3 fit `foodPerFarm: 1` × 3 farms exactly — the 4th is a
deliberate trap, built to make overbuilding and culling relevant to a player
who taps all four), 3 farms, 3 mines, one power plant feeding an 8-cell
crystal ring with a hole in it, `energyBudget: 8`, `completionGoal: 0.2`.
Hand-simulated and then browser-verified: farms → residential → mines in that
order keeps the colony fed throughout (mining income arrives before the
budget would otherwise run out), tapping the trap residential drops the HUD's
population/food readout into red and visibly drains energy, culling it is
free and immediately restores the teal "fed" state and resumes mining income,
and — now that `hasProductiveMove` exists — finishing off every remaining
cell (including re-tapping the trap tile one last time) reaches "You win"
with energy still well above 0, confirming the board-exhaustion path is what
actually closes out a self-sustaining colony run.

**Consequence for level design:** a level with mining no longer needs to
spend its `energyBudget` down to 0 to end — it ends when nothing productive
remains to tap, which for a well-fed colony can happen with a large energy
surplus still on the HUD. `energyBudget` on a colony level is better read as
"how much runway to survive an early mistake," not "how many total taps this
run gets."

## Milestone 7 — Icon shapes, and a legend

With eight tile-owning building types on the board at once (Milestone 6 added
three more to the original five), "every tile is a colored diamond" stopped
being enough to tell them apart at a glance — color alone was carrying all
the weight. Each building now draws its own glyph — crystal a plus, power
plant a lightning bolt, residential a person outline, farm a leaf, mine a
dollar sign, drain an ×, desert nothing — so shape and color both identify a
type, redundantly.

**The icon is always at full brightness; activation moved to the frame.**
Previously a tile's gem was dim (`dormant`) until tapped, then switched to a
brighter `lit` color — meaning a tile's *type* was hardest to read exactly
when it hadn't been tapped yet, which is backwards. Now the icon color never
changes; only the tile's border (a color and width that ease toward the
type's `glow` color) and its background fill (easing toward a brighter
`activeFill`) change with activation. `paintTile` (`game.js`) takes an
`activeAmount` 0..1 and drives exactly those two things — the icon draw call
is identical regardless. "What is this" and "is it active" are back to being
two separate questions with two separate answers, not one dimmer switch
answering both.

**`paintTile` is shared, not duplicated.** The board (`drawCell`) and the new
legend popup both call it, so the legend can never drift out of sync with
what a tile actually looks like on screen — there's no second, hand-copied
rendering path to keep matching by hand.

**A legend button, because eight types is too many to hold in your head.**
The HUD gained a third button (`legend`, next to `edit`/`retry`) that opens
the same shared modal the tile picker and level picker already use (Milestone
4), with its own content: one row per building, each with a live canvas
swatch (via `paintTile`, at full activation) and its name. Desert is the one
exception shown at rest — it never activates, so `paintTile` would otherwise
be asked for a glow color it doesn't have.

## Milestone 8 — A pixel editor for icons

The level editor (Milestone 4) already let a player change what a cell
*is*; this milestone adds changing what a building type *looks like*. Every
row in the tile picker gained a pencil button next to it, opening a small
pixel-art editor: an `ICON_GRID_SIZE`×`ICON_GRID_SIZE` (10×10) grid of
squares that just toggle on tap, a live preview of exactly what a custom
icon means (drawn in the type's own `iconColor`), and a `save` button.

**Starts from what the type already looks like, never a blank square.**
Opening the editor for a type that already has a custom icon loads it
directly. Opening it for a type that doesn't loads `rasterizeIcon(shape)`
instead: the type's normal vector icon (`drawPlus`, `drawBolt`, ...) drawn
oversized onto an offscreen canvas, then sampled down into the grid by
checking how much of each cell's area the shape covers. Desert has no shape
at all, so it rasterizes to a blank grid — which is exactly what desert's
real icon is, so that's correct, not a special case.

**A custom icon belongs to the *type*, not a level or a cell.** `BUILDINGS`
is a table shared by every level; a custom icon is stored the same way,
keyed by type id in a new `casualcolony:iconOverrides` localStorage entry
(`storage.js`), loaded synchronously at startup — unlike level records, an
icon override has to be ready before the very first frame, not fetched in.
The consequence: editing "Mine" changes every mine on every level, not just
the cell you happened to have selected when you opened the editor.

**One more consumer of `paintTile`, not a fork of it.** `paintTile` already
had one job — draw a tile's frame, background, and icon consistently for
both the board and the legend (Milestone 7). It now checks
`iconOverrides[building.id]` before falling back to the vector `ICON_SHAPES`
table, so a custom icon shows up everywhere a tile ever renders — board,
legend, and the tile picker's own swatches, which had to stop being flat
CSS color squares and become live canvases (the same upgrade the legend
swatch already got) for exactly this reason: a flat swatch has no way to
show a custom icon, only a custom icon's *color*.

**Why tap-to-toggle and not drag-to-paint:** the editor's whole footprint is
a single `pointerdown` listener per pixel — no drag-state, no distinguishing
a tap from the start of a swipe. Good enough for the size of edit this
supports (a handful of pixels at a time); painting a whole icon by dragging
is a real usability upgrade but a separate feature, not implied by "toggle
when touched."

## Milestone 9 — Activation cost moves to the building, and colony tiles join the cascade

Milestone 6 kept residential/farm/mine deliberately outside the crystal
signal network — no `propagate`, single-cell activation only, "the colony
economy isn't part of the crystal signal network." That was right for what
existed then (colony buildings never touched cascades at all), but it drew
the line in the wrong place once the question became *why not* let a
crystal network wake a nearby mine. The real design intent, all along, was
that propagation exists to trigger working tiles — the crystal-only
restriction was never load-bearing on its own, it was just the shape the
code happened to take before colony buildings existed to test it against.

**Activation cost moves from the level to the building type.** Milestone 3's
`attenuation` was a single number every hop paid, chosen per level. It's
gone now, replaced by `activationCost` on each building in `buildings.js`:
crystal/red/green/power plant all cost 1 (cheap — a network can travel far),
residential/farm cost 2, mine costs 3 (steep — reachable, but it eats most
of whatever signal is left, so propagation rarely survives past one). This
is a property of *what* a tile is, the same way `fill` or `iconColor` are,
not something a level author tunes.

**A neighbour that can't afford to activate is a dead end, not a crash.**
Previously any positive incoming signal was enough to activate a cell —
only *further* propagation was gated. Now the target's own `activationCost`
has to be covered by what's arriving, or it simply doesn't activate; the
cascade just doesn't extend that way. `buildings.js`'s `activatable()`
keeps desert and drain out of the running entirely (no `activationCost` —
they can never be a target), same as before.

**No exemption for the tapped cell — a tap just hands it exactly its own
cost.** The first version of this milestone special-cased the tapped cell
(always activates, cost check skipped entirely) to guarantee a tap on a
mine or residential still works even though the old flat `TAP_SIGNAL` (1)
was smaller than their cost. That reads as two rules pretending to be one.
The fix is simpler: a tap hands the tapped cell *exactly its own
`activationCost`* — which trivially covers it, so it always activates,
through the exact same `signal >= cost` check every other cell goes
through, no exemption anywhere in `cascade.js`. The cost then cancels out
of its own outgoing signal (`cost - cost + boost`), leaving just that
building's boost to hand a neighbour — 0 for everything except a power
plant. That's *why* a bare tap on a crystal, a mine, or a residential only
ever lights the one cell you tapped regardless of what it cost: there was
never anything left over to spend, only a power plant's boost creates a
surplus. "Recolonized"'s tap-by-tap teaching sequence needed no changes
either way — verified by re-running its tests and the interactive
Playwright walkthrough, byte-for-byte the same result before and after this
fix.

**What actually changed, concretely:** tap a power plant next to a mine
with enough boost in reach, and the mine now lights up as part of the same
cascade — confirmed interactively by editing "simple test" to place a mine
next to its power plant and watching one tap light both, mining income
included (`resolveColony` doesn't care *how* a cell activated, so this
needed no changes there at all).

**Testing "unlimited flood" without a level-level knob.** Several existing
cascade tests deliberately ignored decay to test pure connectivity (does a
diagonal connect? does an axis restriction hold?) — they used to pass
`attenuation: 0`. Since cost is no longer level-configurable, `test.html`
gained `withUnlimitedReach()`, which temporarily zeroes every building's
`activationCost`, runs the test, and restores it — a test-only seam, not a
feature real levels can reach for, since no shipped level ever needed a
custom cost and none does now either.

## Milestone 10 — Energy and signal are one pool, and "recolonized" is rebuilt around it

Milestone 9 gave every building an `activationCost`, but only used it inside
`cascade.js`'s signal math — a direct tap still cost a flat 1 energy no
matter what was tapped, same as since Milestone 2. That left two currencies
with the same name: the `⚡` you actually manage, and an ephemeral per-cascade
"signal" number that reset on every tap and never touched it. This milestone
collapses them into one: **a direct tap now pays the tapped tile's own
`activationCost` out of `world.energy`**, and everything a resulting cascade
reaches beyond that tile is still free — paid for by the network's own
signal, exactly as Milestone 9 left it.

**What changed, precisely:** `game.js`'s pointerdown handler no longer does
`world.energy -= 1` unconditionally. It computes `cost =
building.activationCost`, blocks the tap if `world.energy < cost`, and
spends `cost` (not 1) on success. Crystal and the power plant still cost 1
— so a level with only crystal-family buildings (like "simple test") is
numerically untouched, verified by replaying its walkthrough and getting an
identical energy trace. Residential and farm now cost 2 to jump-start
directly, and a mine costs 3.

**Why the tapped cell isn't special-cased here either.** Same principle as
Milestone 9's fix: one rule, not two. A tile you reach through a network
pays its cost out of that network's remaining signal; a tile you reach by
tapping it pays the identical cost out of your energy pool. The *source* of
the payment differs, the *rule* doesn't.

**Drain stays exactly as it was.** It isn't part of the activation network
— it never lights up, it only ever clears neighbours — so tying its cost to
`activationCost` would be answering a question nobody asked. It keeps its
flat 1-energy-if-effective rule, gated only by whether any energy is left
at all.

**`hasProductiveMove` needed the same update.** A cell that would
technically activate if tapped isn't a real option anymore if the player
can't afford its cost — so board-exhaustion detection (Milestone 9) now
checks `world.energy >= cost` before counting a cell as a live move, not
just whether tapping it would do something.

### "Recolonized" rebuilt around the new economy

The old layout couldn't survive this change unmodified: its whole
walkthrough (3 farms + 3 residential + 3 mines + power plant, each a flat-1
direct tap) would have cost `3×2 + 3×2 + 3×3 = 21` energy against an
8-energy budget — not a tuning problem, a different level. Rebuilt from
scratch around what actually makes this economy interesting:

- **The crystal network now reaches into the colony.** Farms sit directly
  on a short crystal spine leading to the power plant, which also feeds the
  usual 8-cell ring. One tap on the power plant (cost 1) activates all of
  it — plant, spine, all 3 farms, and the whole ring — 15 cells for the
  price of 1, since the crystals' and farms' own cost cancels out of what
  they pass on, same arithmetic as Milestone 9. This is the payoff the
  network was always supposed to have, and the old layout (crystal ring
  fully isolated from the colony by a desert gap) never actually
  demonstrated it.
- **Mines and residential stay off the network on purpose**, walled off by
  desert on both sides. If they weren't, a single power-plant tap would
  chain through the whole stacked colony block at once (they're mutually
  orthogonally adjacent), collapsing the entire point of paying for them
  one at a time. Isolating them is what keeps "which order do I tap things
  in" a real, load-bearing decision rather than something a network
  shortcut quietly answers for you.
- **`energyBudget: 5`, `completionGoal: 0.2`** (96 cells now, up from 80,
  after the layout grew to fit the gaps). Verified by direct simulation
  against the real `cascade.js`/`colony.js` (not hand arithmetic): budget 4
  can't afford all three mines; budget 5 can, *if* mines come before
  residential. Tapping residential first — population before any mining
  income exists to pay for it — strands the run at 0 energy roughly 18%
  activated, short of the 20% goal. That failure mode is now a real test
  (`recolonized: tapping residential before any mines are online is a
  losing order`), not just a hoped-for outcome.

**The trap tile can end the run the instant you tap it, before you cull.**
With the network done and 3 mines + 3 residential up, the trap residential
is the *only* untapped, affordable tile left on the whole board — tapping it
exhausts the board immediately (nothing else can be tapped), which resolves
the outcome right then, mid-starvation. Culling it afterward un-starves the
colony *and* makes the tile tappable again, which un-exhausts the board and
clears `outcome` (Milestone 6's reversibility rule) — so the win screen
briefly disappears until you either leave it alone or tap the trap once
more. This wasn't designed in on purpose, but it isn't a bug either: it
falls directly out of rules that already existed (free reversible culling,
board-exhaustion ending a run, outcome clearing when energy recovers), and
it's a legible, even fun thing to discover, not a dead end.

## Milestone 11 — Mines need a population, not just "fed"

Playing through the freshly-shipped Milestone 10 walkthrough surfaced a real
bug: tapping all three mines *before* any residential still generated mining
income. `resolveColony`'s rule was `population <= foodCapacity` — trivially
true at population 0, since 0 is never greater than any capacity — so a
colony with nobody living in it still counted as "fed" and mines paid out
regardless. The design's own words (Milestone 6: "mine converts a **fed
population** into energy income") always implied a population was required;
the code just never actually checked for one.

**The fix is one added condition.** `resolveColony` (`colony.js`) now pays
mine income only when `population > 0` *and* `population <= foodCapacity` —
fed with nobody home produces nothing, same as unfed. Unrelated to anything
about signal or activation cost; this is purely the colony-economy half of
the game, and cascades/energy-per-tap are untouched.

**This invalidated "recolonized"'s freshly-tuned numbers again.** The
Milestone 10 walkthrough (plant, then all 3 mines, then all 3 residential)
relied entirely on the population-0 loophole — with it closed, that order
now stalls after 2 mines with no income ever having arrived. So does the
reverse order (all residential, then mines), which was already a losing
order before this fix and still is. Re-simulated against the real
`cascade.js`/`colony.js` (not hand arithmetic, same discipline as Milestone
10): the *only* order that now works is interleaved — one resident to seed
population, then a mine to start earning, repeated — because a mine can't
pay out until a resident already has, and a resident can't be afforded a
third time without a mine having already paid out. `energyBudget: 7` (up
from 5) is the tightest budget where that interleaved order clears the
20% goal with energy to spare, confirmed both by simulation and by
replaying it in the browser (15 cells for 1 energy from the plant tap, then
alternating 2/3-cost taps with income arriving right on schedule, ending at
21/96 activated with 9 energy left over — the same final activated count as
before, just reached by a different, now-mandatory order). Both wrong orders
(residential-only, mine-only) are now covered by their own tests.

**The trap tile's win/un-win behavior (Milestone 10) is unaffected.**
Tapping it still exhausts the board mid-starvation and wins immediately;
culling it still un-starves the colony, restores mining income, and clears
`outcome` until the trap is retapped — verified again at the new budget.

## Milestone 12 — Rules in one place, presentation in another

Eleven milestones of "add one more thing to `game.js`" had produced a
950-line module that owned layout, input, five DOM modals, six icon
drawing routines, tile painting, outcome logic, level-list management,
the render loop — *and* the actual rules of the game. Nothing here changes
what the game does; it's about where the game lives. Every number in both
shipped levels is byte-for-byte identical before and after, verified by
replaying "recolonized"'s full walkthrough in the browser and getting the
same 21/96 and ⚡9.

**The turn rule existed three times, and that was the real problem.** What
happens when you tap a cell lived inside a `pointerdown` handler; the test
suite had a hand-copied `directTap` that reimplemented it (and silently
omitted the drain and cull branches entirely); and `hasProductiveMove` was
a third partial copy of "would this do something, and can I afford it".
Every rebalance meant editing the same rule in two files and hoping they
agreed. `rules.js` now holds it once:

- `resolveTap(world, cell)` is **pure** — it answers *what would tapping
  here do* without doing it, returning `{ kind, ok, energyCost, ... }`
  where kind is `"cull"`, `"drain"` or `"activate"`, and a failed tap says
  whether it failed for `"noop"` or `"energy"` reasons.
- `applyTap(world, tap, now)` is the only thing that mutates.
- `hasProductiveMove` is now three lines over `resolveTap`, so
  board-exhaustion detection *cannot* disagree with what tapping actually
  does — affordability included.

The tests call the same two functions the player's finger does. The purity
split is also what any future undo would be built on: a resolved tap
already describes exactly what it's about to change.

**Simulation state and animation state are no longer the same field.**
`cell.activateAt` was doing two unrelated jobs — *is this cell active*
(`!== null`) and *when should it appear to light up* (a `performance.now()`
timestamp). That forced tests to write `activateAt = 0` as a magic "active"
sentinel and made the rules quietly depend on the animation clock. Now
`cell.active` is a boolean the rules read, and `cell.litAt` is presentation
only. `applyTap` takes a `now` purely to stamp the ripple; pass nothing and
everything lands at once, which is exactly what a test wants.

**A level and a run of it are separate objects.** `parseLevel` returns an
immutable *level* (size, legend, tile types, goal, budget, knobs);
`createRun(level)` returns the mutable state of one attempt (energy, and
per-cell activation). Replaying is another `createRun` on the same level
rather than re-reading and re-validating JSON, and a run can be
snapshotted as energy plus one boolean per cell without dragging the level
definition along. Everything that needs a knob reads `world.level.X`.

**The colony economy is declared, not branched on.** `resolveColony` used
to name three flags (`houses`/`feeds`/`mines`) and hardcode one arithmetic
expression, which meant `design.md`'s own promise that future jobs could
"opt in the same way mine did" was false — they couldn't. Buildings now
declare resources:

```js
residential: { colony: { stocks: { population: 1 } } }
farm:        { colony: { stocks: { food: "foodPerFarm" } } }
mine:        { colony: { flows: { energy: "mineYield" }, requiresLabor: true } }
```

*Stocks* are recounted from the board every tap (what the colony **is**);
*flows* are added to the energy pool every tap (what it **earns**). An
amount is a literal number or the name of a level knob, so "how much does a
farm feed" stays level-tunable without `colony.js` knowing which knob
belongs to which building. Adding a building that produces a new resource
is one table entry. What deliberately *isn't* generic yet is the
fed/starving rule itself — that's the colony's one piece of real game
design, and it stays concrete until a second rule of the same shape shows
up to generalize against.

**Level numbers are a table, not four near-identical stanzas.** Every
numeric field a level carries is declared once in `LEVEL_NUMBERS` with its
default and bounds; parsing, validation and serialization all read it.
Adding a knob used to be four edits across two files.

**`game.js` split four ways**, and is now roughly wiring only: `icons.js`
(vector glyphs, rasterization, bitmap icons), `tiles.js` (`paintTile` and
the swatch helper every DOM surface uses), `hud.js` (HUD, outcome screen,
error screen), `modals.js` (all five DOM screens behind one small
framework). Three smaller fixes came along with it:

- **HUD button hitboxes are computed, not assigned mid-draw.** `drawHud`
  used to measure its labels and set the hitboxes as a side effect of
  rendering, so input depended on a frame having already happened.
  `hudLayout()` returns them; the caller keeps them and recomputes on
  resize and on edit-mode changes.
- **`paintTile` takes `iconOverrides` as an argument** instead of reaching
  for a module global — it was the only impure thing left in the render
  path.
- **The outcome screen stopped lying.** Every loss said "Out of energy",
  but board exhaustion can end a run with energy still in the pool. A loss
  that way now says "Nothing left to do".
- **A building's usual legend character lives on the building**
  (`legendChar`), not in a lookup table in `game.js` — adding a type had
  quietly required editing two files, against this document's own "one
  entry in the table" rule.

## Milestone 13 — The run ends on a choice, not an instruction

Three small UI changes, all about where a control belongs.

**Legend moved to the left, next to the level name.** It's a reference for
what's on the board, so it belongs with the board's identity — not crowded
in with the two buttons that change *what you're playing*. The right-hand
side is now just `edit` and `level` (`restart` and `save as` while
editing), which reads as one group with one job.

**"Retry" became "level".** It always opened the level picker; calling it
retry described what you'd usually do next, not what the button did. The
picker already highlights the level you're on, so re-picking it is still
the one-tap replay it always was — the label just stopped mis-describing
the mechanism.

**The outcome screen has buttons.** It used to say "tap retry to try
again", which was an instruction to go find a control somewhere else. Now
a loss offers `retry`, and a win offers `retry` and — only when there's
actually a next level in the set — `next level`, styled as the primary
action. Replaying is `createRun` on the level already in memory, which
Milestone 12's level/run split made free.

**They deliberately don't swallow every tap.** The obvious implementation
blocks the board entirely while the outcome is up, on the reasoning that
you shouldn't tap "through" a modal. That would have quietly broken the
recovery Milestone 6 built on purpose: a run that ends at 0 energy with a
starving colony can still be rescued by culling a residential, which
restarts mining income, pushes energy back above 0, and clears the
outcome. Culling is free and ungated precisely so a starving colony is
never permanently locked — and swallowing taps here would have turned that
into a forced loss through the UI instead of through the rules. So the
outcome buttons take priority, and a tap that misses them still reaches
the board underneath.

## Milestone 14 — Edits can leave the device they were made on

The level editor (Milestone 4) and the icon editor (Milestone 8) both wrote
to localStorage, because a static site has nowhere to POST. That worked as
persistence but not as *authoring*: an edit existed on exactly one device,
nobody else ever saw it, and clearing Safari's storage destroyed it. This
milestone builds the bridge back to the repo.

**Export produces the file, not a dump.** The obvious version — copy
localStorage to the clipboard and paste it somewhere — makes the human do a
merge, by hand, into the middle of a file. Instead `exchange.js` emits
*exactly the contents the repo file should have*: `exportLevelsText` returns
the whole of `levels/levels.json` (shipped levels with this device's edits
already merged, since that's what `levelList` holds), and `exportIconsText`
returns the whole of `icons-data.js`. Committing is then a whole-file
replace, and the diff shows only what actually changed. `serializeLevel`
already did the hard part.

**Icons had to become shippable first.** Levels had a repo representation;
icons didn't — they were a localStorage-only concept, so "persist my icon"
had nowhere to persist *to*. `icons-data.js` is that home, and it's a static
ES module rather than fetched JSON on purpose: an icon has to exist before
the first frame or tiles visibly flash their default shape, and a static
import resolves before any of that while a `fetch` doesn't. localStorage
still layers on top at startup (`{ ...SHIPPED_ICONS, ...loadIconOverrides() }`),
so editing an icon on a device still overrides the shipped one there.

**One paste box, no mode to pick.** `parseImport` works out whether it was
handed levels or icons — an array versus an object — so there's no toggle to
set first and therefore no way to set it wrong. It also accepts the whole
`icons-data.js` file, not just the object inside it, because pasting back
the exact text you were handed should work. Every level is validated through
the real `parseLevel` before *any* of them are accepted; a half-imported set
would be worse than a rejected one.

**Delivery is layered, with a floor that always works.** Clipboard
everywhere, plus a share sheet where `navigator.canShare({files})` says
files are supported — which on iOS means AirDrop straight to a laptop, the
thing that actually makes phone-side authoring practical. Underneath both,
the textarea itself: if the clipboard is denied and there's no share sheet,
the text is still on screen and selectable. The export text is built
*before* the click handler awaits anything, because Safari drops the
user-gesture token across an `await` and the clipboard write then fails
silently.

**"Clear local edits" is the step that makes the loop actually close.**
After exporting and committing, the local copies are still there, still
shadowing the now-identical shipped files — so further edits are edits to a
shadow, and later changes to the shipped file are silently ignored on that
device. Clearing them hands authority back to the repo. It takes two taps
and only appears when there's something to clear, because it discards work
that exists nowhere else and is only correct *after* a commit has landed.

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
| Signal costs activation per hop; only a power plant's boost extends reach | Turns "which cluster" into "how far can this reach" — reach becomes a level-design lever, not just density |
| Boost lives in the level file, referenced from the building via `boostKey`; activation cost lives on the building type itself | Boost is a level-design lever ("how far can this reach"); cost is a property of what a tile *is*, the same as its color — different enough knobs that they don't belong in the same place (see Milestone 9) |
| Tile picker is a DOM modal, not canvas-drawn | Buttons with labels and a selected state are what HTML already does well; no reason to reimplement that in canvas |
| Editor offers every building type, and only edits tile types | Scoping to the level's own legend stopped working once most levels didn't declare the colony types (see Milestone 7); keeping edits to tile types only still keeps "layout change" separate from "rules change" (energy/goal/boost) |
| Levels ship as one JSON array, not one file each | The game can offer a list to pick from without a separate index file to keep in sync |
| Saved levels live in localStorage, keyed by name, shadowing shipped names | The only persistence a static site can have without a backend; matches "save as current" being "save as [this name]" |
| `serializeLevel` reuses the level's existing legend rather than inventing characters | Editing can only introduce types already in the legend, so the legend never needs to change |
| Colony economy (population/food/mining) is derived from board state every tap, not tracked as counters | Same "derive, don't track" shape as the activated fraction; can't drift from what's actually on the board |
| Residential culling is free and ungated, the one exception to "everything costs 1 energy" | A paid or gated cull can permanently lock a starving colony that ran out of energy on the same tap that starved it |
| Outcome resolves on board exhaustion as well as energy hitting 0 | Mining income can make energy climb instead of drain, so "energy hits 0" alone can never trigger for a self-sustaining colony |
| A building's icon shape/color is constant; only the frame and background change with activation | With the dormant/lit-gem approach, type was hardest to read on an untapped tile — exactly backwards |
| Custom icons are keyed by building type, not level or cell | `BUILDINGS` is already a shared table; a per-type override matches that, and means one edit fixes a type everywhere it's used |
| Colony buildings propagate and can be reached by crystal networks, gated by their own (steeper) activation cost | Propagation exists to trigger working tiles — keeping colony buildings off the cascade network entirely was never the point, it just predated having a cost mechanism nuanced enough to let them join without collapsing "recolonized"'s tap-by-tap sequencing |
| A tap hands the tapped cell exactly its own activation cost, no exemption | One `signal >= cost` rule everywhere, tapped cell included, rather than a special-cased bypass — the cost cancels itself out, leaving just that building's boost (0 but for a power plant) to reach a neighbour |
| A direct tap spends its tile's `activationCost` from `world.energy`, not a flat 1; propagation beyond the tapped tile stays free | Energy and signal were the same idea wearing two names — a tap "jump starts" a network the same way a power plant does mid-cascade, so it should pay the same currency the same way |
| Drain keeps its own flat cost, not tied to `activationCost` | It isn't part of the activation network — it never lights up, so there's no "its own cost" question to unify |
| "Recolonized" connects the crystal network to farms/ring but walls mines and residential off with desert | Demonstrates the network's payoff (one cheap tap lights 15 cells) while keeping "which colony tile do I afford next" a real decision the network can't shortcut |
| Mine income requires `population > 0`, not just `population <= foodCapacity` | "Fed" was trivially true at population 0, so mines with nobody working them paid out anyway — never the intent, just an unchecked edge of the `<=` comparison |
| The turn rule is one pure `resolveTap` plus one mutating `applyTap` (`rules.js`) | It previously existed three times — in the input handler, hand-copied into tests, and again inside board-exhaustion detection — and they drifted; a pure "what would this do" is also the seam undo would need |
| `cell.active` (simulation) is separate from `cell.litAt` (presentation) | One field was answering both "does this count" and "when does it animate", which made the rules depend on the animation clock and forced tests to use a magic timestamp as a boolean |
| `parseLevel` returns an immutable level; `createRun` returns one attempt at it | Replaying shouldn't mean re-reading and re-validating JSON, and a run worth snapshotting is energy plus one boolean per cell — not the level definition too |
| Colony contributions are declared resources (`stocks`/`flows`), not named capability flags | "New jobs opt in the same way mine did" was only true on paper while the economy was one hardcoded expression over three specific flags |
| Level numbers are declared once in a table with defaults and bounds | Each knob previously needed four near-identical edits across two files to add |
| The outcome screen's buttons take priority over the board but don't block it | Blocking every tap would break the free-cull recovery from a starving colony at 0 energy — a forced loss imposed by the UI rather than the rules |
| "Next level" appears only when the level set actually has one | A dead or wrapping button is a worse answer than not offering the choice |
| Export emits whole file contents, not a localStorage dump | Committing becomes a file replace with a readable diff, instead of a hand-merge into the middle of something |
| Shipped icons are a static ES module, not fetched JSON | An icon must exist before the first frame or the tile flashes its default shape; a static import resolves in time, a fetch doesn't |
| Import auto-detects levels vs icons instead of offering a mode | An array and an object are distinguishable on sight, so there's no setting to get wrong |
| Clearing local edits is offered separately, and only when there are any | Until local copies are cleared they shadow the shipped files, so edits compound on a shadow and shipped changes are silently ignored |

## Open questions

- How is control measured — active cell count, or something spatial? *(Now:
  fraction of all cells activated, checked once at game over. Spatial /
  contiguous-territory measures are still open.)*
- Do buildings ever deactivate? *(Now: yes, but only residential, and only by
  the player's own free choice — see Milestone 6. Nothing deactivates
  automatically or as a side effect of another building.)*
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
- Jobs beyond mining — sensor towers (fog of war), defense against dangers —
  and fog of war itself. Milestone 6 built the colony economy's population/
  food/energy loop generally enough for more job types to opt in later the
  same way mine did (a capability flag in `buildings.js`), but only mining
  exists so far
- Drag-to-paint in the icon editor (Milestone 8) — each pixel takes its own
  tap; painting a stroke across several at once is a real upgrade but a
  separate feature
- Resetting a custom icon back to its default shape — once saved, the only
  way back is to redraw it by hand
