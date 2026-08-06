// Painting one tile — the single rendering path every tile in the game goes
// through, wherever it appears.
//
// The board, the legend popup, the tile picker's swatches and the icon
// editor's preview all call paintTile, so none of them can drift out of sync
// with what a tile actually looks like. There is deliberately no second,
// hand-copied version anywhere.

import { ICON_SHAPES, drawBitmapIcon } from "./icons.js";

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Linearly interpolates between two "#rrggbb" colors — canvas has no CSS
// transitions, so easing a fill or stroke color means doing this by hand.
export function lerpColor(hexA, hexB, t) {
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

// Paints one tile — background, frame, and icon — into any 2D context at
// (0, 0)–(size, size).
//
// activeAmount is 0..1: how "on" this tile currently reads. It drives the
// frame (a brighter, thicker border with a glow) and a brightened background
// fill — the *only* two things activation changes. The icon itself is drawn
// at constant full brightness regardless, on purpose: type should always be
// legible, whether or not the tile has been tapped yet.
//
// iconOverrides is passed in rather than reached for, so this stays a pure
// function of its arguments and the same call renders identically anywhere.
export function paintTile(ctx, size, building, activeAmount, iconOverrides = {}) {
  const pad = Math.max(1, Math.round(size * 0.06));
  const inner = size - pad * 2;
  const radius = Math.round(size * 0.2);
  const cx = size / 2;
  const cy = size / 2;
  const eased = easeOutCubic(activeAmount);

  ctx.fillStyle =
    building.activeFill && activeAmount > 0
      ? lerpColor(building.fill, building.activeFill, eased)
      : building.fill;
  ctx.strokeStyle = activeAmount > 0 ? lerpColor(building.stroke, building.glow, eased) : building.stroke;
  ctx.lineWidth = activeAmount > 0 ? 1 + eased : 1;
  ctx.beginPath();
  ctx.roundRect(pad, pad, inner, inner, radius);
  ctx.fill();
  if (activeAmount > 0) {
    ctx.shadowColor = building.glow;
    ctx.shadowBlur = 16 * eased;
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  const override = iconOverrides[building.id];
  if (override) {
    ctx.fillStyle = building.iconColor || "#c7d3de";
    drawBitmapIcon(ctx, cx, cy, inner * 0.27, override);
    return;
  }

  const draw = ICON_SHAPES[building.shape];
  if (!draw) return; // desert: no icon at all

  ctx.fillStyle = building.iconColor;
  ctx.strokeStyle = building.iconColor;
  draw(ctx, cx, cy, inner * 0.27);
}

// A standalone canvas showing one building type, used wherever the DOM needs
// a tile swatch (the legend, the tile picker). Same paintTile as the board,
// so a custom icon shows up here too — which is exactly why these are live
// canvases rather than flat CSS color squares.
export function tileSwatch(building, size, iconOverrides) {
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + "px";
  canvas.style.height = size + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  // Full brightness for anything that can actually light up; desert never
  // does, so it's shown the one way it ever really looks.
  paintTile(ctx, size, building, building.glow ? 1 : 0, iconOverrides);
  return canvas;
}
