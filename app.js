// ===== Utilidades =====
const $ = (sel) => document.querySelector(sel);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const rand = (min, max) => Math.random() * (max - min) + min;

// ===== Colores =====
const COLORS = {
  green: '#10b981',  // Índice levantado (Emerald)
  red: '#ef4444',  // Índice+medio (Red)
  yellow: '#f59e0b',  // Mano abierta (Amber)
  blue: '#3b82f6',  // Índice+anular (Blue)
  accent: '#6366f1',  // Indigo/Premium
  gray: '#94a3b8'   // Obstáculos (Slate-400)
};

// ===== DOM =====
const videoEl = "#inputVideo";
const canvasSel = "#gameCanvas";
const startBtnSel = "#startBtn";
const resetBtnSel = "#resetBtn";
const exportBtnSel = "#exportBtn";
const helpBtnSel = "#helpBtn";
const helpPanelSel = "#helpPanel";
const helpCloseSel = "#helpClose";
const toggleMoveBtnSel = "#toggleMoveBtn";
const timeSel = "#time";
const scoreSel = "#score";
const accuracySel = "#accuracy";
const attemptsSel = "#attempts";
const difficultySel = "#difficulty";
const gestureLabelSel = "#gestureLabel";

const canvas = $(canvasSel);
const ctx = canvas.getContext("2d");
const timeEl = $(timeSel);
const scoreEl = $(scoreSel);
const accuracyEl = $(accuracySel);
const attemptsEl = $(attemptsSel);
const gestureLabelEl = $(gestureLabelSel);

// ===== Estado del juego =====
let running = false;
let t0 = null;
let gestureColor = COLORS.accent;
let gestureLabel = "—";
let moveEnabled = false;

const state = {
  object: { x: 0, y: 0, r: 16 },
  goal: { x: 0, y: 0, r: 24 },
  pathStart: { x: 0, y: 0 },
  pathEnd: { x: 0, y: 0 },
  score: 0,
  attempts: 0,
  log: [],
  snap: 0.22,
  goalTol: 28,
  obstacleCount: 0,
  obstacles: [],
  obstacleSpeed: 1.0,
  pathType: 'straight' // 'straight', 'sin', 'zig'
};

function resize() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * devicePixelRatio);
  canvas.height = Math.floor(rect.height * devicePixelRatio);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(devicePixelRatio, devicePixelRatio);
}
window.addEventListener("resize", resize);
resize();

function applyDifficulty(level) {
  if (level === "easy") { state.snap = 0.35; state.goalTol = 34; state.obstacleCount = 2; state.obstacleSpeed = 1.0; }
  else if (level === "medium") { state.snap = 0.22; state.goalTol = 28; state.obstacleCount = 3; state.obstacleSpeed = 1.6; }
  else { state.snap = 0.16; state.goalTol = 22; state.obstacleCount = 5; state.obstacleSpeed = 2.4; }

  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  state.obstacles = Array.from({ length: state.obstacleCount }, () => {
    const r = 14 + Math.random() * 18; // Reducción de radio (antes 18+22)
    const angle = rand(0, Math.PI * 2);
    const speed = state.obstacleSpeed * rand(0.85, 1.15);
    return {
      x: clamp(rand(r + 20, cw - r - 20), r, cw - r),
      y: clamp(rand(r + 20, ch - r - 20), r, cw - r),
      r,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed
    };
  });
}

function resetPositions() {
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  state.pathStart = { x: Math.round(cw * 0.15), y: Math.round(ch * 0.75) };
  state.pathEnd = { x: Math.round(cw * 0.85), y: Math.round(ch * 0.25) };
  state.object.x = state.pathStart.x;
  state.object.y = state.pathStart.y;
  state.goal.x = state.pathEnd.x;
  state.goal.y = state.pathEnd.y;
}

function resetMetrics() {
  state.log = []; state.score = 0; state.attempts = 0; t0 = null; updateHUD();
}

function updateHUD() {
  const t = t0 ? ((performance.now() - t0) / 1000).toFixed(1) : "0.0";
  timeEl.textContent = `${t} s`;
  scoreEl.textContent = state.score.toString();
  attemptsEl.textContent = state.attempts.toString();
  gestureLabelEl.textContent = gestureLabel;

  if (state.log.length > 0) {
    // Cálculo de precisión: promedio de error inverso al camino ideal
    const avgErr = state.log.reduce((a, f) => a + (f.path_error || 0), 0) / state.log.length;
    accuracyEl.textContent = `${(Math.max(0, 100 - avgErr)).toFixed(0)}%`;
  } else { accuracyEl.textContent = "—"; }
}

function pointLineDistance(px, py, x1, y1, x2, y2) {
  const A = px - x1, B = py - y1, C = x2 - x1, D = y2 - y1;
  const dot = A * C + B * D, len = C * C + D * D || 1;
  const t = clamp(dot / len, 0, 1);
  const lx = x1 + t * C, ly = y1 + t * D;
  return dist(px, py, lx, ly);
}

// --- Detección de dedos ---
function isFingerExtended(lm, tipIdx, pipIdx, mcpIdx) {
  const tip = lm[tipIdx], pip = lm[pipIdx], mcp = lm[mcpIdx];
  const margin = 0.02;
  return (tip.y < pip.y - margin) && (pip.y < mcp.y - margin);
}
function computeGesture(lm) {
  const idxUp = isFingerExtended(lm, 8, 6, 5);
  const midUp = isFingerExtended(lm, 12, 10, 9);
  const ringUp = isFingerExtended(lm, 16, 14, 13);
  const pinkUp = isFingerExtended(lm, 20, 18, 17);

  if (idxUp && midUp && ringUp && pinkUp) return { color: COLORS.yellow, label: "Mano abierta" };
  if (idxUp && !midUp && !ringUp && !pinkUp) return { color: COLORS.green, label: "Índice" };
  if (idxUp && midUp && !ringUp && !pinkUp) return { color: COLORS.red, label: "Índice + medio" };
  if (idxUp && !midUp && ringUp && !pinkUp) return { color: COLORS.blue, label: "Índice + anular" };
  return { color: COLORS.accent, label: "Otro gesto" };
}

// --- Dibujo ---
function drawScene(handPt = null) {
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  ctx.clearRect(0, 0, cw, ch);

  // Camino ideal (Línea suave)
  ctx.lineWidth = 2; ctx.strokeStyle = "#e2e8f0";
  ctx.setLineDash([10, 5]);
  ctx.beginPath(); ctx.moveTo(state.pathStart.x, state.pathStart.y); ctx.lineTo(state.pathEnd.x, state.pathEnd.y); ctx.stroke();
  ctx.setLineDash([]);

  // Obstáculos (Esferas Grises pequeñas)
  ctx.shadowBlur = 4; ctx.shadowColor = "rgba(0,0,0,0.1)";
  for (const o of state.obstacles) {
    ctx.fillStyle = COLORS.gray; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.shadowBlur = 0;

  // Objetivo (Meta)
  ctx.fillStyle = COLORS.green; ctx.beginPath(); ctx.arc(state.goal.x, state.goal.y, state.goal.r, 0, Math.PI * 2); ctx.fill();

  // Objeto principal (Avatar coordinado)
  ctx.fillStyle = gestureColor;
  ctx.beginPath(); ctx.arc(state.object.x, state.object.y, state.object.r, 0, Math.PI * 2); ctx.fill();
  // Borde blanco para contraste
  ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke();

  if (handPt) {
    ctx.strokeStyle = "rgba(0,0,0,.2)"; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(handPt.x, handPt.y, 14, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
}

function updateObstaclesMotion() {
  if (!moveEnabled) return;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  for (const o of state.obstacles) {
    o.x += o.vx; o.y += o.vy;
    if (o.x - o.r < 0) { o.x = o.r; o.vx *= -1; }
    if (o.x + o.r > cw) { o.x = cw - o.r; o.vx *= -1; }
    if (o.y - o.r < 0) { o.y = o.r; o.vy *= -1; }
    if (o.y + o.r > ch) { o.y = ch - o.r; o.vy *= -1; }
  }
}

function updateGame(handPt) {
  if (handPt) {
    state.object.x += (handPt.x - state.object.x) * state.snap;
    state.object.y += (handPt.y - state.object.y) * state.snap;
  }

  updateObstaclesMotion();

  let collided = false;
  for (const o of state.obstacles) {
    if (dist(state.object.x, state.object.y, o.x, o.y) < (state.object.r + o.r)) {
      collided = true;
      // Retroceso suave por colisión
      state.object.x += (state.pathStart.x - state.object.x) * 0.12;
      state.object.y += (state.pathStart.y - state.object.y) * 0.12;
    }
  }

  const reached = dist(state.object.x, state.object.y, state.goal.x, state.goal.y) < state.goalTol;
  const err = pointLineDistance(state.object.x, state.object.y, state.pathStart.x, state.pathStart.y, state.pathEnd.x, state.pathEnd.y);

  state.log.push({
    t_ms: t0 ? Math.round(performance.now() - t0) : 0,
    obj_x: Math.round(state.object.x),
    obj_y: Math.round(state.object.y),
    path_error: Math.round(err),
    collided, reached, moveEnabled
  });

  if (reached) {
    state.score += 100 - Math.min(90, Math.round(err));
    state.attempts += 1;
    // Intercambiar inicio y fin para bucle continuo
    const tmp = { ...state.pathStart }; state.pathStart = { ...state.pathEnd }; state.pathEnd = tmp;
    state.goal.x = state.pathEnd.x; state.goal.y = state.pathEnd.y;
  }

  updateHUD(); drawScene(handPt);
}

let lastHandPt = null;
function loop() { requestAnimationFrame(loop); updateGame(lastHandPt); }

let hands = null;
async function initHands() {
  hands = new Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
  hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
  hands.onResults(onResults);
  const cam = new Camera($("#inputVideo"), { onFrame: async () => { await hands.send({ image: $("#inputVideo") }); }, width: 640, height: 480 });
  await cam.start();
}

function onResults(results) {
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const lm = results.multiHandLandmarks[0];
    const tip = lm[8]; // índice
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    lastHandPt = { x: Math.round((1 - tip.x) * cw), y: Math.round(tip.y * ch) };
    const g = computeGesture(lm);
    gestureColor = g.color; gestureLabel = g.label;
  } else {
    lastHandPt = null; gestureColor = COLORS.accent; gestureLabel = "—";
  }
}

// Controles UI
document.addEventListener('click', (e) => {
  const id = e.target.id;
  if (id === 'startBtn') {
    if (running) return;
    applyDifficulty(document.getElementById('difficulty').value);
    resetPositions(); resetMetrics();
    if (!hands) initHands();
    t0 = performance.now(); running = true; loop();
  } else if (id === 'resetBtn') {
    if (!running) return; state.attempts += 1; resetPositions(); updateHUD();
  } else if (id === 'exportBtn') {
    if (!state.log.length) return;
    const patient = document.getElementById('patientName').value || "Anónimo";
    const obs = document.getElementById('observations').value || "";

    const data = {
      meta: {
        patient,
        observations: obs,
        created_at: new Date().toISOString(),
        difficulty: document.getElementById('difficulty').value
      },
      summary: {
        duration_s: t0 ? ((performance.now() - t0) / 1000).toFixed(2) : "0",
        score: state.score,
        attempts: state.attempts,
        accuracy: accuracyEl.textContent
      },
      frames: state.log
    };

    const jsonBlob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    downloadBlob(jsonBlob, `handmov-session-${patient}-${Date.now()}.json`);

    const csv = ["t_ms,obj_x,obj_y,path_error,collided,reached,moveEnabled", ...state.log.map(f => [f.t_ms, f.obj_x, f.obj_y, f.path_error, f.collided, f.reached, f.moveEnabled].join(","))].join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `handmov-session-${patient}-${Date.now()}.csv`);
  } else if (id === 'helpBtn') {
    document.getElementById('helpPanel').classList.toggle('hidden');
  } else if (id === 'helpClose') {
    document.getElementById('helpPanel').classList.add('hidden');
  } else if (id === 'toggleMoveBtn') {
    moveEnabled = !moveEnabled;
    document.getElementById('toggleMoveBtn').textContent = moveEnabled ? "Esferas: Detener" : "Esferas: Iniciar";
  }
});

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Inicialización
applyDifficulty("medium");
resetPositions(); drawScene(); updateHUD();
