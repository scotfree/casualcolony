// Casual Colony — mobile-first canvas skeleton.
// Bump VERSION on each deploy so you can tell a fresh deploy from a cached one.
const VERSION = "0.1.0";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// --- Sizing -----------------------------------------------------------------
// The canvas is stretched to the viewport by CSS. Here we match the backing
// store to the device's real pixels so nothing looks soft on retina screens.
// After scaling, all drawing code can work in plain CSS pixels.

let width = 0;
let height = 0;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  width = canvas.clientWidth;
  height = canvas.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener("resize", resize);
window.addEventListener("orientationchange", resize);

// --- Input ------------------------------------------------------------------
// Pointer Events cover touch, mouse and stylus in one path, so there is no
// separate touch/mouse branching anywhere else in the game.

const input = {
  x: 0,
  y: 0,
  down: false,
};

function pointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  input.x = e.clientX - rect.left;
  input.y = e.clientY - rect.top;
}

canvas.addEventListener("pointerdown", (e) => {
  input.down = true;
  pointerPos(e);
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  pointerPos(e);
});

canvas.addEventListener("pointerup", () => {
  input.down = false;
});

canvas.addEventListener("pointercancel", () => {
  input.down = false;
});

// --- Game state -------------------------------------------------------------
// Placeholder only: a dot that eases toward wherever you are touching.
// Enough to prove the loop runs, input works and the deploy is live.

const dot = {
  x: 0,
  y: 0,
  radius: 28,
};

function update(dt) {
  if (input.down) {
    // Ease toward the pointer. The 1 - e^(-k*dt) form keeps the easing rate
    // consistent regardless of frame rate.
    const k = 8;
    const t = 1 - Math.exp(-k * dt);
    dot.x += (input.x - dot.x) * t;
    dot.y += (input.y - dot.y) * t;
  }
}

function render() {
  ctx.fillStyle = "#12161c";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = input.down ? "#5eead4" : "#334155";
  ctx.beginPath();
  ctx.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#4a5568";
  ctx.font = "13px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("touch and drag", width / 2, height / 2 - 80);
}

// --- Loop -------------------------------------------------------------------

let lastTime = performance.now();

function frame(now) {
  // Clamp dt so returning from a backgrounded tab doesn't produce one huge
  // step that teleports everything.
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  update(dt);
  render();

  requestAnimationFrame(frame);
}

// --- Start ------------------------------------------------------------------

resize();
dot.x = width / 2;
dot.y = height / 2;
document.getElementById("version").textContent = "v" + VERSION;
requestAnimationFrame(frame);
