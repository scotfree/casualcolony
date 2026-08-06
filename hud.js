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

// Where the HUD's three buttons sit, right-aligned and measured against their
// current labels (which change in edit mode). Pure: give it a context to
// measure with and it tells you the rects, changing nothing.
export function hudLayout(ctx, width, editMode) {
  ctx.font = LABEL_FONT;
  const rects = {};
  let right = width - 14;

  const buttons = [
    ["reset", editMode ? "save as" : "retry", 26],
    ["edit", editMode ? "restart" : "edit", 24],
    ["legend", "legend", 24],
  ];
  for (const [key, label, padding] of buttons) {
    const textWidth = ctx.measureText(label).width;
    rects[key] = {
      label,
      textRight: right,
      x: right - textWidth - padding / 2,
      y: 0,
      w: textWidth + padding,
      h: HUD_HEIGHT,
    };
    right = rects[key].x - 6;
  }
  return rects;
}

export function hitsButton(button, x, y) {
  if (!button) return false;
  return x >= button.x && x <= button.x + button.w && y >= button.y && y <= button.y + button.h;
}

// view: { name, activated, total, energy, colony, editMode }
export function drawHud(ctx, width, view, layout) {
  // Two rows: name + buttons on top, activation/energy stats below. A single
  // row overlapped the name with the stats on narrow phones.
  const row1 = HUD_HEIGHT * 0.36;
  const row2 = HUD_HEIGHT * 0.76;
  ctx.textBaseline = "middle";
  ctx.font = LABEL_FONT;

  ctx.fillStyle = MUTED;
  ctx.textAlign = "left";
  ctx.fillText(view.name, 14, row1);

  let statsText = `${view.activated} / ${view.total} activated   ⚡ ${view.energy}`;
  if (view.colony) statsText += `   👥 ${view.colony.population}/${view.colony.foodCapacity}`;
  // The whole line goes warning-red when the colony is starving — simpler and
  // just as legible as splitting it into separately-colored segments.
  ctx.fillStyle = view.colony && !view.colony.fed ? BAD : GOOD;
  ctx.textAlign = "center";
  ctx.fillText(statsText, width / 2, row2);

  ctx.textAlign = "right";
  ctx.fillStyle = BUTTON;
  ctx.fillText(layout.reset.label, layout.reset.textRight, row1);
  ctx.fillStyle = view.editMode ? GOOD : BUTTON;
  ctx.fillText(layout.edit.label, layout.edit.textRight, row1);
  ctx.fillStyle = BUTTON;
  ctx.fillText(layout.legend.label, layout.legend.textRight, row1);
}

// outcome: { result: "win" | "lose", reason: "energy" | "exhausted" }
//
// The headline names what actually ended the run. Board exhaustion can end a
// run with energy still in the pool (a self-sustaining colony runs out of
// things to do long before it runs out of energy), so reporting every loss as
// "Out of energy" would be plainly false half the time.
export function drawOutcome(ctx, width, height, outcome, fraction, completionGoal) {
  ctx.fillStyle = "#12161ccc";
  ctx.fillRect(0, HUD_HEIGHT, width, height - HUD_HEIGHT);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = outcome.result === "win" ? GOOD : BAD;
  ctx.font = "20px ui-monospace, monospace";
  const headline =
    outcome.result === "win"
      ? "You win"
      : outcome.reason === "energy"
        ? "Out of energy"
        : "Nothing left to do";
  ctx.fillText(headline, width / 2, height / 2 - 14);

  ctx.fillStyle = MUTED;
  ctx.font = LABEL_FONT;
  const goalPct = Math.round(completionGoal * 100);
  const gotPct = Math.round(fraction * 100);
  ctx.fillText(`${gotPct}% activated · goal was ${goalPct}%`, width / 2, height / 2 + 14);
  ctx.fillText("tap retry to try again", width / 2, height / 2 + 36);
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
