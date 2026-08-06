// Tile glyphs — the vector shapes buildings.js names by string, plus the
// bitmap path a player-drawn icon takes instead.
//
// One shape per building "family" (see buildings.js's `shape`), each drawn
// centered at (cx, cy) inside a roughly 2r-wide box. These draw at constant
// full brightness regardless of activation — see tiles.js's paintTile — so a
// tile's *type* is always legible; only the frame and background around them
// change with state.
//
// buildings.js refers to shapes by name rather than importing these directly,
// which is what keeps canvas drawing out of the building table entirely.

// Pixel resolution of a custom icon: a type's player-drawn icon is always
// this many rows and columns, regardless of how big it's later drawn.
export const ICON_GRID_SIZE = 10;

function drawPlus(ctx, cx, cy, r) {
  const arm = r * 0.62;
  const thick = r * 0.44;
  ctx.beginPath();
  ctx.moveTo(cx - thick, cy - arm);
  ctx.lineTo(cx + thick, cy - arm);
  ctx.lineTo(cx + thick, cy - thick);
  ctx.lineTo(cx + arm, cy - thick);
  ctx.lineTo(cx + arm, cy + thick);
  ctx.lineTo(cx + thick, cy + thick);
  ctx.lineTo(cx + thick, cy + arm);
  ctx.lineTo(cx - thick, cy + arm);
  ctx.lineTo(cx - thick, cy + thick);
  ctx.lineTo(cx - arm, cy + thick);
  ctx.lineTo(cx - arm, cy - thick);
  ctx.lineTo(cx - thick, cy - thick);
  ctx.closePath();
  ctx.fill();
}

// Classic lightning-bolt zigzag, normalized to roughly [-0.75, 0.83] and
// scaled by r.
const BOLT_POINTS = [
  [0.083, -0.833], [-0.75, 0.167], [-0.25, 0.167],
  [-0.333, 0.833], [0.5, -0.333], [0, -0.333],
];
function drawBolt(ctx, cx, cy, r) {
  ctx.beginPath();
  BOLT_POINTS.forEach(([px, py], i) => {
    const x = cx + px * r;
    const y = cy + py * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
}

// A head (stroked circle) over shoulders (the top half of a larger circle,
// left open) — deliberately an outline, not a filled silhouette.
function drawPerson(ctx, cx, cy, r) {
  ctx.lineWidth = Math.max(1.4, r * 0.24);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.4, r * 0.32, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.95, r * 0.62, Math.PI, Math.PI * 2);
  ctx.stroke();
}

// Same trick as a diamond gem, but with only two opposite corners rounded
// instead of all four — a square with one pair of corners left sharp reads as
// a leaf (or petal) once rotated 45°.
function drawLeaf(ctx, cx, cy, r) {
  const w = r * 1.3;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.beginPath();
  ctx.roundRect(-w / 2, -w / 2, w, w, [w / 2, 0, w / 2, 0]);
  ctx.fill();
  ctx.restore();
}

function drawDollar(ctx, cx, cy, r) {
  ctx.font = `800 ${Math.round(r * 1.7)}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("$", cx, cy + r * 0.05);
}

function drawX(ctx, cx, cy, r) {
  const a = r * 0.62;
  ctx.lineWidth = Math.max(1.6, r * 0.26);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - a, cy - a);
  ctx.lineTo(cx + a, cy + a);
  ctx.moveTo(cx + a, cy - a);
  ctx.lineTo(cx - a, cy + a);
  ctx.stroke();
}

export const ICON_SHAPES = {
  plus: drawPlus,
  bolt: drawBolt,
  person: drawPerson,
  leaf: drawLeaf,
  dollar: drawDollar,
  x: drawX,
};

// Draws a custom icon (an ICON_GRID_SIZE-row array of "#"/"." strings — see
// storage.js) the same way the vector shapes draw: centered at (cx, cy),
// sized off r. Filled squares tile a box roughly the same footprint as the
// vector icons' own reach, so swapping between a default shape and a custom
// one doesn't change a tile's apparent icon size.
export function drawBitmapIcon(ctx, cx, cy, r, rows) {
  const n = rows.length;
  const boxSide = r * 2.3;
  const cell = boxSide / n;
  const startX = cx - boxSide / 2;
  const startY = cy - boxSide / 2;
  for (let gy = 0; gy < n; gy++) {
    const row = rows[gy];
    for (let gx = 0; gx < row.length; gx++) {
      if (row[gx] !== "#") continue;
      // Slightly overpainted so adjacent "on" pixels don't leave hairline gaps
      // between them from sub-pixel rounding.
      ctx.fillRect(startX + gx * cell, startY + gy * cell, cell + 0.6, cell + 0.6);
    }
  }
}

// What a type's icon editor opens with when that type has never been
// customized: its default vector shape, rendered oversized onto an offscreen
// canvas and then sampled down into an ICON_GRID_SIZE grid, so editing starts
// from what the type already looks like rather than a blank square. Desert
// (no shape) rasterizes to blank, which is exactly its real icon.
export function rasterizeIcon(shape) {
  const draw = ICON_SHAPES[shape];
  if (!draw) return Array.from({ length: ICON_GRID_SIZE }, () => ".".repeat(ICON_GRID_SIZE));

  const scale = 20; // offscreen px per grid cell — coarse shapes still sample cleanly
  const size = ICON_GRID_SIZE * scale;
  const off = document.createElement("canvas");
  off.width = size;
  off.height = size;
  const offCtx = off.getContext("2d");
  offCtx.fillStyle = "#fff";
  offCtx.strokeStyle = "#fff";
  draw(offCtx, size / 2, size / 2, size * 0.27);

  const { data } = offCtx.getImageData(0, 0, size, size);
  const rows = [];
  for (let gy = 0; gy < ICON_GRID_SIZE; gy++) {
    let row = "";
    for (let gx = 0; gx < ICON_GRID_SIZE; gx++) {
      let covered = 0;
      for (let py = 0; py < scale; py++) {
        for (let px = 0; px < scale; px++) {
          const x = gx * scale + px;
          const y = gy * scale + py;
          if (data[(y * size + x) * 4 + 3] > 40) covered++;
        }
      }
      row += covered / (scale * scale) > 0.25 ? "#" : ".";
    }
    rows.push(row);
  }
  return rows;
}
