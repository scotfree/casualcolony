// The HUD, the outcome screen, and the load-failure screen.
//
// Layout is computed separately from drawing. It used to happen *during*
// drawing — drawHud measured its labels and assigned the button hitboxes as a
// side effect — which meant input depended on a frame having already been
// rendered, and the hitboxes silently didn't exist before the first one.
// hudLayout() now returns them, and the caller keeps them.

export const HUD_HEIGHT = 58;
export const BOARD_MARGIN = 10;

const LABEL_FONT = "13px ui-monospace, monospace";
const MUTED = "#8ea3b5";
// Brighter than plain body text, same as the modal's own option labels
// (style.css's .option) — a tappable button should never read as dimmer than
// static text.
const BUTTON = "#c7d3de";
const GOOD = "#5eead4";
const BAD = "#f87171";

// Where the HUD's buttons sit, measured against their current labels (which
// change in edit mode). Pure: give it a context to measure with and it tells
// you the rects, changing nothing.
//
// Legend sits on the *left*, immediately after the level name — it's a
// reference for what's on the board, so it belongs with the board's identity
// rather than crowded in with the two buttons that change what you're
// playing.
export function hudLayout(ctx, width, editMode, name = "") {
  ctx.font = LABEL_FONT;
  const rects = {};

  const legendLeft = 14 + ctx.measureText(name).width + 16;
  const legendWidth = ctx.measureText("legend").width;
  rects.legend = {
    label: "legend",
    align: "left",
    textAt: legendLeft,
    x: legendLeft - 10,
    y: 0,
    w: legendWidth + 20,
    h: HUD_HEIGHT,
  };

  // Laid out right to left. During a run these are only about the run you're
  // in: replay it, or leave it. Choosing a *different* level and opening the
  // editor both live on the title screen (title.js), because they throw the
  // run away and shouldn't sit a tap from the board.
  //
  // `log` explains the turn you just took, so it's hidden while editing —
  // there are no turns in there to explain, and dropping it keeps the
  // edit-mode labels from crowding the name.
  const rightButtons = [
    ["menu", "menu", 26],
    ["reset", editMode ? "save as" : "retry", 24],
  ];
  if (editMode) rightButtons.push(["edit", "play", 24]);
  else rightButtons.push(["log", "log", 24]);

  let right = width - 14;
  for (const [key, label, padding] of rightButtons) {
    const textWidth = ctx.measureText(label).width;
    rects[key] = {
      label,
      align: "right",
      textAt: right,
      x: right - textWidth - padding / 2,
      y: 0,
      w: textWidth + padding,
      h: HUD_HEIGHT,
    };
    right = rects[key].x - 6;
  }
  return rects;
}

// The stats row, laid out as separate segments rather than one centred string.
//
// It's one string to read but three different facts, and two of them are level
// parameters the editor can change — so they need their own hitboxes. Same
// split as hudLayout: pure, called with the current numbers, changing nothing.
// The caller can therefore compute it at click time and never worry about a
// layout that went stale between frames.
const STATS_GAP = 22;

// Which segments are level parameters, and so tappable in edit mode. The
// colony readout is derived from what's on the board, not a knob, so it isn't
// here.
export const EDITABLE_STATS = new Set(["goal", "energy"]);

export function statsLayout(ctx, width, view) {
  ctx.font = LABEL_FONT;
  const target = view.goalTarget === null || view.goalTarget === undefined
    ? "" : ` · ${view.goalTarget}%`;
  const segments = [
    ["goal", `${view.activated} / ${view.total} ${view.goalKind ?? "powered"}${target}`],
    ["energy", `⚡ ${view.energy}`],
  ];
  if (view.colony) {
    segments.push(["colony", `👥 ${view.colony.population}/${view.colony.foodCapacity}`]);
  }

  const widths = segments.map(([, text]) => ctx.measureText(text).width);
  const total = widths.reduce((a, b) => a + b, 0) + STATS_GAP * (segments.length - 1);

  let x = Math.round((width - total) / 2);
  const rects = {};
  segments.forEach(([key, label], i) => {
    rects[key] = {
      label,
      textAt: x,
      // The box is the whole lower band of the HUD, not the text's own line
      // height — a 13px target is not something you can hit with a thumb.
      x: x - STATS_GAP / 2,
      y: Math.round(HUD_HEIGHT * 0.52),
      w: widths[i] + STATS_GAP,
      h: Math.round(HUD_HEIGHT * 0.48),
      width: widths[i],
    };
    x += widths[i] + STATS_GAP;
  });
  return rects;
}

export function hitsButton(button, x, y) {
  if (!button) return false;
  return x >= button.x && x <= button.x + button.w && y >= button.y && y <= button.y + button.h;
}

// view: { name, activated, total, energy, colony, editMode }
export function drawHud(ctx, width, view, layout, stats) {
  // Two rows: name + buttons on top, activation/energy stats below. A single
  // row overlapped the name with the stats on narrow phones.
  const row1 = HUD_HEIGHT * 0.36;
  const row2 = HUD_HEIGHT * 0.76;
  ctx.textBaseline = "middle";
  ctx.font = LABEL_FONT;

  ctx.fillStyle = MUTED;
  ctx.textAlign = "left";
  ctx.fillText(view.name, 14, row1);

  // The whole line goes warning-red when the colony is starving — simpler and
  // just as legible as colouring the segments separately.
  const statsColor = view.colony && !view.colony.fed ? BAD : GOOD;
  ctx.textAlign = "left";
  for (const [key, segment] of Object.entries(stats)) {
    const editable = view.editMode && EDITABLE_STATS.has(key);
    ctx.fillStyle = statsColor;
    ctx.fillText(segment.label, segment.textAt, row2);
    // Underlined while editing, because these stop being a readout and become
    // the level's own settings — the same "this does something" cue the
    // buttons above already carry by being labelled with verbs.
    if (!editable) continue;
    ctx.strokeStyle = statsColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(segment.textAt, row2 + 10.5);
    ctx.lineTo(segment.textAt + segment.width, row2 + 10.5);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const [key, color] of [
    ["legend", BUTTON],
    ["log", BUTTON],
    ["menu", BUTTON],
    ["reset", BUTTON],
    // "play" leaves the editor, so it's the way out and reads as the primary.
    ["edit", view.editMode ? GOOD : BUTTON],
  ]) {
    const button = layout[key];
    if (!button) continue; // log is absent while editing
    ctx.textAlign = button.align;
    ctx.fillStyle = color;
    ctx.fillText(button.label, button.textAt, row1);
  }
}

const OUTCOME_BUTTON_HEIGHT = 36;
const OUTCOME_BUTTON_GAP = 10;

// Where the outcome screen's buttons sit. A loss offers "retry"; a win offers
// "retry" and — only when there actually is one — "next level", so the run
// always ends on a real choice rather than an instruction to go find a button
// somewhere else.
export function outcomeLayout(ctx, width, height, outcome, hasNext) {
  ctx.font = LABEL_FONT;
  const labels = [["retry", "retry"]];
  if (outcome.result === "win" && hasNext) labels.push(["next", "next level"]);

  const widths = labels.map(([, label]) => Math.max(96, Math.round(ctx.measureText(label).width) + 36));
  const total = widths.reduce((a, b) => a + b, 0) + OUTCOME_BUTTON_GAP * (labels.length - 1);

  let x = Math.round((width - total) / 2);
  const y = Math.round(height / 2 + 28);
  const rects = {};
  labels.forEach(([key, label], i) => {
    rects[key] = { label, x, y, w: widths[i], h: OUTCOME_BUTTON_HEIGHT, primary: key === "next" };
    x += widths[i] + OUTCOME_BUTTON_GAP;
  });
  return rects;
}

function drawOutcomeButton(ctx, button) {
  const accent = button.primary ? GOOD : BUTTON;
  ctx.beginPath();
  ctx.roundRect(button.x, button.y, button.w, button.h, 9);
  ctx.fillStyle = button.primary ? "#173a37" : "#1b232e";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = button.primary ? "#2f6f66" : "#38485a";
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.font = LABEL_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(button.label, button.x + button.w / 2, button.y + button.h / 2 + 0.5);
}

// outcome: { result: "win" | "lose", reason: "energy" | "exhausted" }
//
// A loss is always a blackout: the pool is empty *and* a grid has gone dark
// for want of funding. Being broke with a grid that pays for itself isn't
// losing, so it never reaches here.
export function drawOutcome(ctx, width, height, outcome, fraction, goal, layout) {
  ctx.fillStyle = "#12161ce6";
  ctx.fillRect(0, HUD_HEIGHT, width, height - HUD_HEIGHT);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = outcome.result === "win" ? GOOD : BAD;
  ctx.font = "20px ui-monospace, monospace";
  const headline = outcome.result === "win" ? "You win" : "Blackout";
  ctx.fillText(headline, width / 2, height / 2 - 30);

  ctx.fillStyle = MUTED;
  ctx.font = LABEL_FONT;
  const goalPct = Math.round(goal.value * 100);
  const gotPct = Math.round(fraction * 100);
  ctx.fillText(`${gotPct}% ${goal.kind} · goal was ${goalPct}%`, width / 2, height / 2 - 2);

  for (const button of Object.values(layout)) drawOutcomeButton(ctx, button);
}

export function drawError(ctx, width, height, message) {
  ctx.fillStyle = "#12161c";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = BAD;
  ctx.font = LABEL_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Level failed to load", width / 2, height / 2 - 30);
  ctx.fillStyle = MUTED;
  ctx.fillText(message, width / 2, height / 2);
  ctx.fillText("Serving over http?", width / 2, height / 2 + 30);
}
