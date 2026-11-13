// 舞台交互：拖光、日 / 火 / 灯、石材、浮雕高度、亮场、存图、拍 / 传、千年时间轴。
import { ReliefRenderer } from "./relief.js";
import { steleLayout, extendRelief, extendReg, carveText, carveStrokes, planStrokes, insFrame, headState, strikes } from "./inscription.js";
import { nicheLayout, buildNiche, cutStele, placeReg } from "./niche.js";
import { makeRubbing, fromContactBytes, contactBytes, dab, paint, autoDabs, makeSheet } from "./rubbing.js";
import { makeSTL, makeRecord } from "./export.js";
import { KEFA, applyKefa, applyKefaNiche } from "./kefa.js";
import { startHoldLamp } from "./holdlamp.js";

const cv = document.getElementById("stage");
const R = new ReliefRenderer(cv);
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// 光源预设（光色按色温取近似：日约 5500K，火把约 1900K，展柜射灯约 4000K）。
// shadowK：软阴影的硬度，火把是一团火、光源大，影子最软；太阳最硬
const LIGHTS = {
  sun: { point: false, col: [1.0, 0.96, 0.9], amb: 0.14, ambCol: [0.82, 0.88, 1.0], shadowK: 14, oldGain: 1.0 },
  torch: { point: true, col: [1.0, 0.58, 0.26], amb: 0.045, ambCol: [1.0, 0.7, 0.45], z: 0.32, flicker: true, home: [0.12, 0.42], shadowK: 5, oldGain: 2.2 },
  lamp: { point: true, col: [1.0, 0.92, 0.8], amb: 0.06, ambCol: [1.0, 0.95, 0.9], z: 0.45, home: [0.42, -0.12], cone: 0.75, shadowK: 8, oldGain: 1.6 },
};
// 嵌在用户测试页里时：把受试者做到的事（刻名、拖到某年、揭拓片、光的位置）告诉外面那页，任务自动计时
const EMBED = window.parent !== window;
function emit(type, data = {}) { if (EMBED) try { window.parent.postMessage({ ykqn: 1, type, ...data }, location.origin); } catch (e) { /* 外面不是同源页 */ } }
let lightT = 0;
function emitLight() {
  const t = performance.now(); if (!EMBED || t - lightT < 150) return; lightT = t;
  emit("light", { mode: state.mode, dir: state.dir.map((v) => +v.toFixed(3)), xy: state.ptxy && R.w ? [+(state.ptxy[0] / R.w).toFixed(3), +(state.ptxy[1] / R.h).toFixed(3)] : null, z: +state.zMul.toFixed(2) });
}
const state = { mode: "lamp", rect: [0, 0, 1, 1], dpr: 1, ptr: null, dir: [-0.55, -0.65, 0.52], ptxy: null, zMul: 1, dirty: true, work: null, lastFlick: 0,
  year: 483, env: 0, tween: null, seed: 1 };

// ---------- 千年时间轴（方案 4.3(4)）----------
// 关键年份和轨道上的位置：年份不均匀（1651 以后事多），轨道按关键年份分段线性
const KEYS = [483, 1651, 1907, 1991, 2026, 2526];
const POS = [0, 0.24, 0.44, 0.6, 0.74, 1];
const EVENTS = { 483: "开凿", 1651: "重妆", 1907: "留影", 1991: "煤尘", 2026: "今日" };
const lerpTab = (x, xs, ys) => {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
};
const yearAt = (pos) => lerpTab(pos, POS, KEYS);
const posAt = (year) => lerpTab(year, KEYS, POS);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 风化剂量：基线 1/年；1950–1998 煤尘酸雨 ×4；1998 国道改线后 ×1.5；2026 以后治水 ×0.7、不治水 ×2.5；归一到 2026 = 1。
// 系数是我们定的（没有公开的速率数据），趋势有文献：煤尘观测、国道改线、“保护以治水为主”
function dose(year, env) {
  const seg = [[483, 1950, 1], [1950, 1998, 4], [1998, 2026, 1.5], [2026, 1e9, env ? 2.5 : 0.7]];
  let d = 0; for (const [a, b, r] of seg) if (year > a) d += (Math.min(year, b) - a) * r;
  return d / 1701;
}
// 水痕：每件作品按编号定 4 条（位置、起点、宽），2026 只有第一条在渗（2025 年第 18 窟渗水），不治水全开
function streakSeeds(seed) {
  let s = seed >>> 0; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  // 渗水斑：源头位置每件不同（x 0.1–0.9，y 0.05–0.45），半径 60–130 像素
  return [0, 1, 2, 3].map((i) => [0.1 + 0.8 * r(), 0.05 + 0.4 * r(), 60 + 70 * r(), (i === 0 ? 1 : 0.6 + 0.4 * r())]);
}
function sunAt(day, hour, lat = 40.09) {
  const r = Math.PI / 180, dec = 23.44 * Math.sin(2 * Math.PI * (284 + day) / 365) * r, H = 15 * (hour - 12) * r, phi = lat * r;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  let az = Math.acos(Math.max(-1, Math.min(1, (Math.sin(dec) - Math.sin(alt) * Math.sin(phi)) / (Math.cos(alt) * Math.cos(phi)))));
  if (H > 0) az = 2 * Math.PI - az;   // 方位角从北顺时针
  const E = Math.cos(alt) * Math.sin(az), N = Math.cos(alt) * Math.cos(az), U = Math.sin(alt);
  return { dir: [E, -U, -N], alt: alt / r };
}

function timeState(year, env) {
  const tau = dose(year, env), tauP = dose(1651, env);
  const f = Math.max(0, (year - 2026) / 500);
  const good = env ? 0 : f, bad = env ? f : 0;
  const now = smooth(1950, 2026, year) * 0.55 * (1 - 0.8 * good);
  const streaks = new Float32Array(16);
  streakSeeds(state.seed).forEach(([x, y0, w, k], i) => {
    const on = (i === 0 ? now : 0) + (i < 2 ? bad ** 0.7 * k : 0);   // 不治水：再多开一处渗水，一共两处
    streaks.set([x, y0, w, Math.min(on, 1)], 4 * i);
  });
  // 泥皮、彩画掉到哪一步（保护度低于这个数的地方已经掉了；保护度：凹处、转角约 +1～+2.5，平处 0，凸处、脸上约 −1）。
  // 按年份排：1780 起像身凸起的边棱先掉，1870 像身平处掉一半，1907 像身只剩褶缝、地子还红（退进去的平底留得最久），
  // 1958 地子淡掉一半，1991 只剩转角，2026 只剩最深的转角
  const fut = f * (env ? 2.0 : 0.5);
  const paLoss = (year < 1651 ? -3 : lerpTab(year, [1651, 1780, 1835, 1870, 1907, 1930, 1958, 1991, 2026], [-3, -1.3, -0.6, 0.0, 0.5, 0.8, 1.05, 1.35, 1.6])) + fut;
  const plLoss = (year < 1651 ? -3 : lerpTab(year, [1651, 1835, 1907, 1958, 1991, 2026], [-3, -1.2, -0.4, 0.4, 0.9, 1.3])) + fut;
  return {
    tau, tauP, age: Math.max(0, (tau - tauP) / (1 - tauP)), paint: smooth(1636, 1651, year), plLoss, paLoss,
    dust: lerpTab(year, [483, 1900, 1950, 1975, 1991, 1998, 2026, 2526], [0.04, 0.06, 0.1, 0.42, 0.62, 0.55, 0.18, env ? 0.35 : 0.12]),
    coal: smooth(1950, 1998, year), good, bad, old: 1 - smooth(5, 26, Math.abs(year - 1907)), streaks,
  };
}
function setYear(y, redraw = true) {
  state.year = Math.round(Math.min(2526, Math.max(483, y)));
  const p = posAt(state.year);
  $("#year").textContent = state.year;
  const k = KEYS.find((K) => Math.abs(K - state.year) <= (K === 2526 ? 0 : 2));
  $("#event").textContent = k === 2526 ? (state.env ? "不治" : "治水") : (EVENTS[k] || "");
  $("#knob").style.left = `${p * 100}%`;
  const fill = $("#fill"); fill.style.width = `${p * 100}%`;
  fill.classList.toggle("good", p > POS[4] && !state.env); fill.classList.toggle("bad", p > POS[4] && !!state.env);
  fill.style.setProperty("--cut", `${POS[4] / Math.max(p, 1e-6) * 100}%`);
  $$(".ticks span").forEach((s, i) => s.classList.toggle("past", POS[i] <= p + 1e-6));
  $("#fork").classList.toggle("live", state.year >= 2026);
  const old = 1 - smooth(4, 18, Math.abs(state.year - 1907));
  if (!$("#relic").hidden) $("#relic").style.opacity = old.toFixed(3);
  if (R.w) R.setTime(timeState(state.year, state.env));
  if (redraw) state.dirty = true;
  if (state.year !== state.yearSent) { state.yearSent = state.year; emit("year", { y: state.year }); }
}
function setEnv(e) {
  state.env = e ? 1 : 0;
  $$("#fork .chip").forEach((b) => b.classList.toggle("on", +b.dataset.env === state.env));
  setYear(state.year);
}
// 关键年份之间滑过去（键盘、录视频用）：缓入缓出
function glideTo(y, ms = 900) {
  const y0 = state.year, p0 = posAt(y0), p1 = posAt(y), t0 = performance.now();
  state.tween = (t) => { const k = Math.min(1, (t - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; setYear(yearAt(p0 + (p1 - p0) * e)); return k < 1; };
}
function buildTicks() {
  const box = $("#ticks"); box.innerHTML = "";
  KEYS.forEach((y, i) => {
    const s = document.createElement("span"); s.style.left = `${POS[i] * 100}%`; box.appendChild(s);
    const l = document.createElement("label"); l.style.left = `${POS[i] * 100}%`; l.textContent = y; box.appendChild(l);
  });
}
function onTrack(e) {
  const r = $("#track").getBoundingClientRect();
  let p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const near = POS.find((q) => Math.abs(q - p) < 0.012); if (near !== undefined) p = near;   // 关键年份附近吸附
  state.tween = null; setYear(yearAt(p));
}
$("#track").addEventListener("pointerdown", (e) => { $("#track").setPointerCapture(e.pointerId); state.tptr = e.pointerId; onTrack(e); });
$("#track").addEventListener("pointermove", (e) => { if (state.tptr === e.pointerId) onTrack(e); });
for (const ev of ["pointerup", "pointercancel"]) $("#track").addEventListener(ev, () => { state.tptr = null; });
$$("#fork .chip").forEach((b) => b.addEventListener("click", () => setEnv(+b.dataset.env)));

// ---------- 题名（C9）----------
// 碑上预刻“太和七年”；名字：平板交来的笔迹（服务端 /api/name），没有平板时可以用 ?name=文字 拿字体刻一个示范
// animate：一笔一笔刻出来（新交来的名字）；换作品、刚打开页面时直接是刻好的样子
function carveName(animate = false) {
  const L = state.L; if (!R.w) return;
  const ins = new Float32Array(R.w * R.h * 4);
  if (state.frame) for (let i = 0; i < state.frame.length; i++) ins[4 * i + 3] = state.frame[i];   // 第 4 通道：龛的帧代码（像 / 壁面 / 龛沿 / 楣面 / 火焰）
  state.insAnim = null;
  if (!L) { R.setInscription(state.frame ? ins : null); state.dirty = true; return; }
  carveText(ins, R.w, "太和七年", L.era, { d0: 4.2, img: state.eraImg });
  state.insAnim = null; clearFx();
  if (state.nameStrokes && state.nameStrokes.length) {
    const P = planStrokes(state.nameStrokes, L.name, { dmax: 7.5, k: 1.05 });   // 名字刻深、槽壁陡一点（评审：比“太和七年”浅、软，像笔压的）
    if (animate && P.total > 0) {
      // 碑上别的刻字在题名区包围盒里的部分（“太和七年”离得远，一般是空的）
      const base = new Float32Array(P.bw * P.bh * 3);
      for (let y = 0; y < P.bh; y++) for (let x = 0; x < P.bw; x++) {
        const X = P.bx0 + x, Y = P.by0 + y; if (X < 0 || Y < 0 || X >= R.w || Y >= R.h) continue;
        const j = (Y * R.w + X) * 4, i = (y * P.bw + x) * 3; base[i] = ins[j]; base[i + 1] = ins[j + 1]; base[i + 2] = ins[j + 3];
      }
      // 刻名字发生在 483（和像一起刻成）：时间轴不在 483 就先滑回去再下刀
      const back = state.year > 484 && state.insT === undefined;
      if (back) glideTo(483, 900);
      state.insAnim = { P, base, out: new Float32Array(P.bw * P.bh * 4), t0: performance.now() + (back ? 1000 : 150), lastStrike: -1 };
    } else carveStrokes(ins, R.w, null, null, { plan: P });
  } else if (state.nameText) carveText(ins, R.w, state.nameText, L.name, { d0: 2.8, weight: 900, jitter: 1 });
  R.setInscription(ins); state.dirty = true;
}

// 刻字动画的一帧（t 秒，从下第一刀算）：刻槽按刀头走到哪儿更新；凿子、碎石、粉雾画在上面一层透明画布上；实时播放时每下凿击出一声。
// 时间线：0..total 刻；+0.4 秒起用 1 秒把槽里的石粉吹掉（看得见一股粉往右上飘）；再停 1 秒看干净的字；实时播放这时镜头拉回整幅
const BLOW0 = 0.4, BLOW1 = 1.4, HOLD = 2.4;
function insStep(now) {
  const A = state.insAnim; if (!A) return false;
  const t = state.insT !== undefined ? state.insT : (now - A.t0) / 1000;
  if (t < 0) { state.insFocus = null; return true; }
  const P = A.P, hs = headState(P, t);
  const blow = Math.min(1, Math.max(0, (t - P.total - BLOW0) / (BLOW1 - BLOW0)));
  insFrame(P, t, hs.H, A.out, A.base, blow);
  R.updateInscription(P.bx0, P.by0, P.bw, P.bh, A.out);
  const sk = strikes(P, t, 1.2);
  // 镜头跟着刀走：取最近 0.8 秒刀头高度的平均（平滑、录视频逐帧一样）；刻完停在最后的位置，慢慢回到碑中间
  let fy = 0, nf = 0;
  for (let k = 0; k < 6; k++) { const c = headState(P, Math.min(t, P.total) - k * 0.16).cur; if (c) { fy += c.y; nf++; } }
  const mid = (state.L.y0 + state.L.y1) / 2, back = Math.min(1, Math.max(0, (t - P.total) / 1.0));
  state.insFocus = nf ? fy / nf + (mid - fy / nf) * back * back * (3 - 2 * back) : mid;
  // 每下凿击画面抖一下（1–2 像素，30 毫秒衰减）
  const last = sk.length ? sk[sk.length - 1] : null, age = last ? t - last.t : 9;
  state.shake = age < 0.12 ? [Math.cos(last.id * 2.1), Math.sin(last.id * 1.7)].map((v) => (last.last ? 2.2 : 1.3) * v * Math.exp(-age / 0.03) * state.dpr) : null;
  applyView();
  drawFx(t, P, hs, sk, blow);
  if (state.insT === undefined && audio.ctx) for (const s of sk) if (s.t > A.lastStrike && t - s.t < 0.1) { chiselHit(s.last ? 1.3 : s.first ? 1 : 0.55 + 0.45 * hash01(s.t * 977)); A.lastStrike = s.t; }
  if (state.insT === undefined) state.viewT = t < P.total + BLOW1 ? 1 : t < P.total + HOLD + 0.8 ? 0.4 : 0;   // 实时刻字：推到碑上刻，吹完退到能看全碑的中景停一下，再拉回整幅
  if (t > P.total + HOLD + 1.8 && state.insT === undefined) { state.insAnim = null; state.insFocus = null; state.shake = null; clearFx(); applyView(); }
  return true;
}

// 凿子、碎石、粉雾。都是凿击时刻和编号的确定函数（录视频逐帧一样）。尺寸按浮雕像素定，跟着镜头放大
const fx = document.getElementById("fx"), fg = fx.getContext("2d");
const hash01 = (x) => { const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
function clearFx() { fg.clearRect(0, 0, fx.width, fx.height); }
function drawFx(t, P, hs, sk, blow) {
  if (fx.width !== cv.width || fx.height !== cv.height) { fx.width = cv.width; fx.height = cv.height; }
  clearFx();
  const c0 = R.clip || state.rect0 || state.rect; fg.save(); fg.beginPath(); fg.rect(c0[0], c0[1], c0[2], c0[3]); fg.clip();
  const [rx, ry, rw] = state.rect, sx = rw / R.w;
  const X = (x) => rx + x * sx, Y = (y) => ry + y * sx;
  // 颜色跟着画面走：上一帧在刀头旁边石面上取的颜色（光色、曝光、年代都已经在里面）
  const base = state.fxBase || [150, 132, 105], lumB = (base[0] * 0.3 + base[1] * 0.5 + base[2] * 0.2) / 255;
  const lit = (c, k = 1) => c.map((v, i) => Math.round(Math.min(255, v * k)));
  const stone = lit(base, 1.2), shade = lit(base, 0.62), dust = base.map((v) => Math.round(Math.min(255, v * 1.22 + 18)));
  const NW = state.L.name.x1 - state.L.name.x0;   // 题名区宽：凿子、碎石的尺寸跟着字的大小走
  for (const s of sk) {
    const a = t - s.t; if (a < 0) continue;
    const r = (k) => hash01(s.id * 31.7 + k * 17.31);
    const big = s.last ? 1.6 : s.first ? 1.25 : 1;
    // 粉雾：三团错开的暖色粉，边扩散边往下沉（0.7 秒）
    if (a < 0.7) {
      for (let m = 0; m < 3; m++) {
        const rad = (0.05 + 0.2 * (a / 0.7) ** 0.6) * NW * (0.7 + 0.5 * r(40 + m)) * big * sx, al = 0.4 * (1 - a / 0.7) ** 1.2 * (m ? 0.6 : 1);
        const cx = X(s.x + (r(41 + m) - 0.5) * 0.12 * NW - s.dy * 0.05 * NW * (m - 1)), cy = Y(s.y + (r(44 + m) - 0.3) * 0.08 * NW + 0.25 * NW * a);
        const gr = fg.createRadialGradient(cx, cy, 0, cx, cy, rad);
        gr.addColorStop(0, `rgba(${dust},${al})`); gr.addColorStop(0.5, `rgba(${dust},${al * 0.5})`); gr.addColorStop(1, `rgba(${dust},0)`);
        fg.fillStyle = gr; fg.beginPath(); fg.arc(cx, cy, rad, 0, 6.2832); fg.fill();
      }
    }
    // 碎石：3–6 粒、有棱角的小块，大小拉开（每下一两粒大的），新鲜石面色、背光面暗；崩起来、落到槽下沿附近；每两下有一粒卡在槽下沿，吹的时候才掉
    const n = (s.first ? 5 : 3) + Math.floor(3 * r(0));
    for (let q = 1; q <= n; q++) {
      const stick = q === 1 && s.id % 2 === 0;
      const side = r(q * 7 + 2) < 0.5 ? -1 : 1, sp = (0.25 + 0.6 * r(q * 7 + 3)) * NW;
      const px = -s.dy * side, py = s.dx * side;
      const vx = (px * (0.5 + 0.5 * r(q * 7 + 4)) - s.dx * 0.3) * sp, vy = (py * (0.5 + 0.5 * r(q * 7 + 4)) - s.dy * 0.3) * sp - (0.4 + 0.5 * r(q * 7 + 6)) * NW;
      let x, y, al = 1;
      if (stick) {
        const k = Math.min(1, a / 0.12), restX = s.x + px * 0.05 * NW, restY = s.y + 0.04 * NW;
        x = s.x + (restX - s.x) * k; y = s.y + (restY - s.y) * k;
        if (blow > 0) { const bt = blow * (BLOW1 - BLOW0); x += 1.2 * NW * bt; y += -0.2 * NW * bt + 2.5 * NW * bt * bt; al = Math.max(0, 1 - 2.2 * blow); }   // 一吹就走（评审：吹完还卡着一块像坏点）
        if (al <= 0.02) continue;
      } else {
        const life = 0.32 + 0.25 * r(q * 7 + 1); if (a > life) continue;
        x = s.x + vx * a; y = s.y + vy * a + 0.5 * 7 * NW * a * a; al = Math.min(1, (life - a) / 0.1);
      }
      const size = (q === 2 || (q === 3 && s.first) ? 0.05 + 0.02 * r(q * 7 + 8) : 0.018 + 0.03 * r(q * 7 + 8)) * NW * big * sx;
      const rot = r(q * 7 + 9) * 6.28 + a * (6 + 10 * r(q * 7 + 10)), nv = 4 + Math.floor(2 * r(q * 7 + 11));
      fg.save(); fg.translate(X(x), Y(y)); fg.rotate(rot); fg.globalAlpha = al;
      const pts = []; for (let v = 0; v < nv; v++) { const ang = (v + 0.4 * r(q * 13 + v + 50)) / nv * 6.2832, rr = size * (0.45 + 0.75 * r(q * 13 + v)); pts.push([rr * Math.cos(ang), rr * Math.sin(ang)]); }
      fg.beginPath(); pts.forEach(([u, v], j) => (j ? fg.lineTo(u, v) : fg.moveTo(u, v))); fg.closePath(); fg.fillStyle = `rgb(${stone})`; fg.fill();
      fg.beginPath(); fg.moveTo(0, 0); for (let j = Math.floor(nv / 2) + 1; j <= nv; j++) { const [u, v] = pts[j % nv]; fg.lineTo(u, v); } fg.closePath(); fg.fillStyle = `rgb(${stick ? stone.map((c) => Math.round(c * 0.92)).join(",") : shade})`; fg.fill();   // 背光面约三分之一（卡在槽里那粒是新茬口，亮）
      fg.restore();
    }
  }
  fg.restore(); fg.save();   // 下面吹起来的粉和凿子在镜头前，不裁在浮雕框里（不然粉雾、凿尾被框边齐齐切断）
  // 吹石粉：三缕粉雾从字上往右上飘走（1 秒，飘出去约 2 个字宽），带一些细粉粒
  if (blow > 0 && blow < 1) {
    const last = P.path[P.path.length - 1].pts, mid = last[last.length >> 1];
    for (let m = 0; m < 3; m++) {
      const k = Math.min(1, blow * 1.1 - 0.08 * m); if (k <= 0) continue;
      const x = mid[0] + (0.2 + 1.8 * k) * NW + (m - 1) * 0.25 * NW, y = mid[1] - (0.3 + 0.2 * m) * NW * k - (m - 1) * 0.35 * NW;
      const rad = (0.5 + 0.9 * k) * NW * sx, al = 0.72 * Math.sin(Math.PI * Math.min(1, k * 1.15)) * (1 - 0.2 * m);   // 吹起来是一团（评审：只有零星几点）
      const gr = fg.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), rad);
      gr.addColorStop(0, `rgba(${dust},${al})`); gr.addColorStop(0.6, `rgba(${dust},${al * 0.4})`); gr.addColorStop(1, `rgba(${dust},0)`);
      fg.fillStyle = gr; fg.beginPath(); fg.arc(X(x), Y(y), rad, 0, 6.2832); fg.fill();
    }
    let id = 0;
    for (const st of P.path) for (let i = 0; i < st.pts.length; i += 6) {
      id++; const p = st.pts[i], st0 = hash01(id * 3.3) * 0.35, a = (blow - st0) / 0.65; if (a <= 0 || a > 1) continue;
      const x = p[0] + (0.9 + 0.9 * hash01(id * 5.1)) * NW * a, y = p[1] - (0.15 + 0.35 * hash01(id * 7.7)) * NW * a + 0.2 * NW * a * a;
      if (id % 4 === 0) {
        const rad = (0.05 + 0.14 * a) * NW * sx, al = 0.32 * (1 - a);
        const gr = fg.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), rad); gr.addColorStop(0, `rgba(${dust},${al})`); gr.addColorStop(1, `rgba(${dust},0)`);
        fg.fillStyle = gr; fg.beginPath(); fg.arc(X(x), Y(y), rad, 0, 6.2832); fg.fill();
      }
      fg.fillStyle = `rgba(${dust},${(0.8 * (1 - a)).toFixed(3)})`;
      const sz = (0.01 + 0.016 * hash01(id * 9.9)) * NW * sx; fg.fillRect(X(x) - sz / 2, Y(y) - sz / 2, sz, sz);
    }
  }
  // 凿子：方钢、刃口是一道平楔，刃抵在刀头上，钢身往右上伸出画外；一笔之内角度不变；每下打完沿刀身退一点（带一帧拖影）再打回去；两笔之间抬起来挪过去
  const c = hs.cur;
  if (c) state.fxProbe = [X(c.x + 0.22 * NW), Y(c.y + 0.1 * NW)];
  if (c) {
    const f = c.k >= 0 ? P.path[c.k].f : 6, kk = c.k >= 0 ? c.k : 0;
    const ang = 2.3 + 0.07 * (hash01(kk * 3.7) - 0.5), ax = Math.cos(ang), ay = Math.sin(ang);   // 柄往左下：从上往下刻，左下是还没刻的石面，不挡刻好的字，也不挡右边的“太和七年”
    const nx = -ay, ny = ax, alpha = c.leave ? 1 - c.lift : 1;
    const W0 = 0.14 * NW, Lg = 3.0 * NW, Lch = 14 * NW, taper = 1.2 * W0, grow = 2.3;   // 柄端粗到刃口的 2.3 倍（离镜头近）；钢身够长，推近时也一直伸出画外（11-11 评审：尾端停在画里像纸片）
    const recoil = (sn) => c.k >= 0 ? 0.09 * NW * Math.sin(Math.PI * Math.min(1, sn * f)) ** 0.6 : 0;
    const draw = (off, al, shadow) => {
      const tx = c.x + ax * off, ty = c.y + ay * off;
      const wid = (u) => 1 + (grow - 1) * Math.min(1, u / Lg);   // 透视：越往柄越粗
      // 投影：光从左上来，影子往右下；刃口贴着石面时影子和刃口接上（回弹抬起时拉开），越往柄离墙越远、影子偏得越多
      const sh = (u) => shadow ? (0.03 * NW + 0.5 * off + 0.16 * u) : 0;
      const pt = (u, v) => [X(tx + ax * u + nx * v * wid(u) + sh(u) * 0.55), Y(ty + ay * u + ny * v * wid(u) + sh(u) * 0.83)];
      const poly = (P2) => { fg.beginPath(); P2.forEach(([u, v], j) => { const [px, py] = pt(u, v); j ? fg.lineTo(px, py) : fg.moveTo(px, py); }); fg.closePath(); };
      const body = [[0, -0.42 * W0], [taper, -W0 / 2], [Lch, -W0 / 2 * 1.15], [Lch, W0 / 2 * 1.15], [taper, W0 / 2], [0, 0.42 * W0]];
      fg.save(); fg.globalAlpha = al;
      if (shadow) { fg.filter = `blur(${Math.max(1, 0.025 * NW * sx).toFixed(1)}px)`; poly(body); fg.fillStyle = "rgba(0,0,0,0.55)"; fg.fill(); fg.restore(); return; }
      // 三个面：背光面、亮棱、迎光面
      const st = (k) => [150, 158, 168].map((v) => Math.round(Math.min(255, v * k * (0.45 + 0.9 * lumB)))).join(",");
      poly(body); fg.fillStyle = `rgb(${st(0.55)})`; fg.fill();
      poly([[0, 0.42 * W0], [taper, W0 / 2], [Lch, W0 / 2 * 1.15], [Lch, W0 * 0.1], [taper, W0 * 0.12], [0, 0.1 * W0]]); fg.fillStyle = `rgb(${st(1.15)})`; fg.fill();   // 朝左上的面：迎光
      poly([[0, 0.1 * W0], [taper, W0 * 0.12], [Lch, W0 * 0.1], [Lch, W0 * 0.02], [taper, W0 * 0.04], [0, 0.04 * W0]]); fg.fillStyle = `rgb(${st(1.6)})`; fg.fill();       // 棱上的高光
      poly([[0, -0.42 * W0], [0.08 * taper, -0.43 * W0], [0.08 * taper, 0.43 * W0], [0, 0.42 * W0]]); fg.fillStyle = `rgb(${st(1.5)})`; fg.fill();   // 刃口：一条细亮线
      fg.restore();
    };
    const off = recoil(c.since) + 0.25 * NW * c.lift;
    draw(off, 0.85 * alpha, true);
    if (c.k >= 0 && c.since < 0.06) draw(recoil(c.since + 0.03), 0.3 * alpha, false);   // 回弹时的一帧拖影
    draw(off, alpha, false);
  }
  fg.restore();
}


// 凿击声（Web Audio 现合成）：铁锤敲凿子的“叮”（两个高频分音，短衰减）+ 刀口崩石的“嚓”（带通噪声）+ 一点闷响。
// 浏览器要用户先点一下页面才许出声：第一次按键或点击时建 AudioContext
const audio = { ctx: null, noise: null };
function initAudio() {
  if (audio.ctx || state.mute) return;
  try {
    const c = new (window.AudioContext || window.webkitAudioContext)();
    const n = c.createBuffer(1, Math.round(c.sampleRate * 0.3), c.sampleRate), d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    audio.ctx = c; audio.noise = n;
  } catch (e) { /* 没有声音也能用 */ }
}
for (const ev of ["pointerdown", "keydown"]) window.addEventListener(ev, initAudio, { once: true, capture: true });
function chiselHit(g = 1) {
  const c = audio.ctx; if (!c || c.state !== "running") { if (c) c.resume(); return; }
  const t = c.currentTime + 0.005, p = 0.92 + 0.16 * Math.random(), out = c.createGain(); out.gain.value = 0.35 * g; out.connect(c.destination);
  const env = (node, a, dec, peak) => { const gn = c.createGain(); gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(peak, t + a); gn.gain.exponentialRampToValueAtTime(0.0008, t + a + dec); node.connect(gn); gn.connect(out); return gn; };
  for (const [f, amp, dec] of [[2650, 0.22, 0.09], [4120, 0.12, 0.06], [6900, 0.05, 0.03]]) {
    const o = c.createOscillator(); o.frequency.value = f * p; env(o, 0.001, dec, amp); o.start(t); o.stop(t + 0.2);
  }
  const ns = c.createBufferSource(); ns.buffer = audio.noise; const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3200 * p; bp.Q.value = 0.8;
  ns.connect(bp); env(bp, 0.001, 0.05, 0.9); ns.start(t); ns.stop(t + 0.12);
  const o2 = c.createOscillator(); o2.frequency.value = 170 * p; env(o2, 0.002, 0.04, 0.35); o2.start(t); o2.stop(t + 0.1);
}

let nameVer = -1;
async function pollName() {
  try {
    const r = await fetch("api/name", { cache: "no-store" });
    if (!r.ok) return;   // 静态服务（没有后端）就不轮询了
    const j = await r.json();
    if (j.version !== nameVer) { const first = nameVer === -1; nameVer = j.version; state.nameStrokes = j.strokes; carveName(!first); if (!first) emit("name"); }
    setTimeout(pollName, 700);
  } catch (e) { /* 没有后端 */ }
}

// 浮雕放在标题、光源钮、面板、时间轴之外的空处（按它们实际占的位置算，不写死边距）
function layout() {
  const W = innerWidth, H = innerHeight, narrow = W < 760;
  if (state.clean) {   // 录视频：浮雕居中，四周留边；clean=2 下面留时间轴
    const bot = state.clean === 2 ? H - 22 - $("#time").offsetHeight - 18 : H - 50, top = 50;
    const s = Math.min((W - 120) / R.w, (bot - top) / R.h), w = R.w * s, h = R.h * s;
    return [(W - w) / 2, top + (bot - top - h) / 2, w, h];
  }
  const tb = $("#title").getBoundingClientRect(), lb = $("#lights").getBoundingClientRect(), pb = $("#panel").getBoundingClientRect();
  const g = narrow ? 12 : 28;
  const bot = H - (narrow ? pb.height + 10 : 22) - $("#time").offsetHeight - (narrow ? 8 : 14);
  const cands = narrow
    ? [[16, Math.max(tb.bottom, lb.bottom) + g, W - 16, bot]]
    : [[Math.max(lb.right, tb.right) + g, 24, pb.left - g, bot],      // 和标题并排
       [lb.right + g, tb.bottom + 16, pb.left - g, bot]];             // 标题下面
  let best = null;
  for (const [x0, y0, x1, y1] of cands) {
    const s = Math.min((x1 - x0) / R.w, (y1 - y0) / R.h);
    if (!best || s > best.s) best = { s, x0, y0, x1, y1 };
  }
  const w = R.w * best.s, h = R.h * best.s;
  return [best.x0 + (best.x1 - best.x0 - w) / 2, best.y0 + (best.y1 - best.y0 - h) / 2, w, h];
}

// 时间轴放在浮雕正下方、和浮雕一样宽（窄屏铺满，压在面板上面）
function placeTime(rc) {
  const t = $("#time"), narrow = innerWidth < 760;
  if (narrow) {
    t.style.left = "16px"; t.style.width = `${innerWidth - 32}px`; t.style.transform = "none";
    t.style.bottom = `${$("#panel").getBoundingClientRect().height + 10}px`;
  } else {
    const w = Math.min(Math.max(rc ? rc[2] : 640, 560), 820);
    t.style.width = `${w}px`; t.style.left = `${rc ? rc[0] + rc[2] / 2 : innerWidth / 2}px`; t.style.transform = "translateX(-50%)"; t.style.bottom = "22px";
  }
}

// 1907 的老照片：assets/relic.json 写 { "src": "1907_xx.jpg", "cap": "沙畹 摄 1907" }；没有这个文件就不显示
async function initRelic() {
  try {
    const r = await fetch("assets/relic.json", { cache: "no-store" }); if (!r.ok) return;
    const j = await r.json(); $("#relicImg").src = `assets/${j.src}`; $("#relicCap").textContent = j.cap || ""; $("#relic").hidden = false;
  } catch (e) { /* 没有就算了 */ }
}
function placeRelic(rc) {
  const f = $("#relic"); if (f.hidden || !rc) return;
  if (state.L && R.niche) {   // 带龛：放在碑上方那块空壁面上（龛外右上），不压龛
    const s = rc[2] / R.w, L = state.L, w = Math.min(0.85 * (L.x1 - L.x0) * s * 1.6, 230, (R.w - L.x0) * s - 24);
    f.style.width = `${w}px`; f.style.left = `${rc[0] + (L.x0 + L.x1) / 2 * s - w / 2}px`; f.style.top = `${rc[1] + Math.max(12, L.y0 * s - w * 1.45 - 20)}px`;
    return;
  }
  const lb = $("#lights").getBoundingClientRect();
  const narrow = innerWidth < 760, room = rc[0] - (narrow ? 0 : lb.right) - 40;
  if (room >= 200) {   // 浮雕左边的空处
    const w = Math.min(room, 300); f.style.width = `${w}px`; f.style.left = `${rc[0] - w - 26}px`; f.style.top = `${rc[1] + rc[3] * 0.08}px`;
  } else if (!narrow) {   // 横幅作品左边放不下：放到标题下面、光源钮上面那块空处，不压浮雕
    const tb = $("#title").getBoundingClientRect(), w = Math.min(210, (lb.top - tb.bottom - 40) / 1.45, rc[0] - 36 - 16);
    if (w >= 120) { f.style.width = `${w}px`; f.style.left = "36px"; f.style.top = `${tb.bottom + 16}px`; }
    else { const w2 = Math.min(rc[2] * 0.22, 200); f.style.width = `${w2}px`; f.style.left = `${rc[0] + 12}px`; f.style.top = `${rc[1] + 12}px`; }
  } else {   // 窄屏：压在浮雕左上角
    const w = Math.min(rc[2] * 0.4, 180); f.style.width = `${w}px`; f.style.left = `${rc[0] + 8}px`; f.style.top = `${rc[1] + 8}px`;
  }
}

function fit() {
  placeTime(null);
  if (!R.w) { cv.width = innerWidth; cv.height = innerHeight; return; }
  const rc = layout();
  placeTime(rc); placeRelic(rc); placeRub();
  // 设备像素不超过高度图本身的分辨率：再多也只是同一个高度图像素被算好几遍（Retina 上省一半以上）
  const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.max(1, R.w / rc[2]));
  cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
  state.dpr = dpr; state.rect0 = rc.map((v) => v * dpr); applyView(); state.dirty = true;
}

// 镜头推近题记碑（刻字时）：view 0 = 整幅，1 = 碑放大到占浮雕区约 85% 高、尽量移到中间。
// 放大只发生在原来浮雕那块框里（画的时候裁到原框），框里不露出浮雕以外的底色
function applyView() {
  const r0 = state.rect0 || state.rect, v = state.view || 0, L = state.L;
  R.clip = null;
  const sh = state.shake && v > 0.5 ? state.shake : [0, 0];
  if (!L || v < 1e-3 || !R.w) { state.rect = r0; return; }
  const e = v * v * (3 - 2 * v);
  // 画框：录视频（clean）铺满整个画布，平时就是浮雕原来那块（不压住面板）
  const F = state.clean ? [0, 0, cv.width, cv.height] : r0;
  // 推近后：碑高是画框高的 1.25 倍（字大约画框高的 1/5），名字那一列在画框 55% 处、“太和七年”留在画面里；刻的时候镜头跟着刀走
  const s1 = 1.25 * F[3] / (L.y1 - L.y0), fxr = (L.name.x0 + L.name.x1) / 2;
  const fyr = state.insFocus != null ? state.insFocus : (L.y0 + L.y1) / 2;
  let zx = F[0] + F[2] * 0.55 - fxr * s1, zy = F[1] + F[3] / 2 - fyr * s1;
  const zw = R.w * s1, zh = R.h * s1;
  zx = zw >= F[2] ? Math.min(F[0], Math.max(F[0] + F[2] - zw, zx)) : F[0] + (F[2] - zw) / 2;
  zy = zh >= F[3] ? Math.min(F[1], Math.max(F[1] + F[3] - zh, zy)) : F[1] + (F[3] - zh) / 2;
  const mix = (a, b) => a + (b - a) * e;
  state.rect = [mix(r0[0], zx) + sh[0], mix(r0[1], zy) + sh[1], mix(r0[2], zw), mix(r0[3], zh)];
  R.clip = state.clean ? null : [mix(r0[0], F[0]), mix(r0[1], F[1]), mix(r0[2], F[2]), mix(r0[3], F[3])];   // 录视频不裁：浮雕四边自己淡出
}
function stepView(dt) {
  const tg = state.viewT || 0, v = state.view || 0;
  if (Math.abs(tg - v) < 1e-3) { if (v !== tg) { state.view = tg; applyView(); return true; } return false; }
  state.view = v + (tg - v) * (1 - Math.exp(-dt / 280)); applyView(); return true;
}

function toRelief(px, py) {
  const [x, y, w, h] = state.rect;
  return [(px - x) / w * R.w, (py - y) / h * R.h];
}

function applyLight(t, home = false) {
  const P = LIGHTS[state.mode], L = R.light;
  L.point = P.point; L.amb = P.amb; L.ambCol = P.ambCol; L.shadowK = P.shadowK; R.oldGain = P.oldGain || 1;
  let k = 1;
  if (P.flicker && !home) {
    // 火把：几个频率叠起来的闪烁
    if (state.filmT !== undefined) t = state.filmT;   // 录视频：按录制时间闪，每次录出来一样
    k = 0.86 + 0.08 * Math.sin(t * 0.011) + 0.05 * Math.sin(t * 0.027 + 1.3) + 0.03 * Math.sin(t * 0.063 + 0.4);
  }
  if (state.lampOn != null && state.mode === "lamp" && !home) k *= state.lampK;   // 执灯：没认到手电就熄灯（只剩一点环境光看得见轮廓）
  L.col = P.col.map((c) => c * k);
  if (P.point) {
    const xy = (!home && state.ptxy) || [R.w * P.home[0], R.h * P.home[1]];
    const z = P.z * Math.max(R.w, R.h) * (home ? 1 : state.zMul);
    L.pos = [xy[0], xy[1], z];
    L.fall = Math.hypot(R.w * 0.5, R.h * 0.5, z) * 0.9;
    L.cone = P.cone || 0;
    // 射灯对准浮雕中心；推镜头到碑上时跟着转向碑
    const v = state.view || 0, S = state.L;
    L.aim = S && v > 0 ? [R.w / 2 + ((S.x0 + S.x1) / 2 - R.w / 2) * v, R.h / 2 + ((S.y0 + S.y1) / 2 - R.h / 2) * v] : null;
  } else {
    L.dir = state.dir;
  }
}

// 点光源的曝光按灯在默认位置时定一次，之后灯拿远了就是暗，和真的一样；换模式、作品、石材、高度时重定
function meterPoint() {
  if (!R.w || !LIGHTS[state.mode].point) return;
  applyLight(0, true); R.meterExposure(1, 0.995); state.dirty = true;
}

let frames = 0, fpsT = 0;
function frame(t) {
  if (state.tween && !state.tween(t)) state.tween = null;
  const P = LIGHTS[state.mode];
  const flick = P.flicker && t - state.lastFlick > 33;      // 火把闪烁 30 Hz 就够，不跟 120 Hz 屏满帧重画
  const anim = R.w && insStep(t);
  const moved = R.w && stepView(t - (state.lastT || t));
  if (state.lampOn != null) {   // 执灯的亮灭：亮起来 0.15 秒，熄下去 0.6 秒
    const dt = Math.min(0.1, (t - (state.lastT || t)) / 1000), tau = state.lampOn ? 0.15 : 0.6;
    const k1 = state.lampK + (state.lampOn - state.lampK) * (1 - Math.exp(-dt * 3 / tau));
    if (Math.abs(k1 - state.lampOn) > 0.002) { state.lampK = k1; state.dirty = true; } else if (state.lampK !== state.lampOn) { state.lampK = state.lampOn; state.dirty = true; }
  }
  state.lastT = t;
  if (moved) state.dirty = true;
  if (R.w && (state.dirty || flick || anim)) {
    if (flick) state.lastFlick = t;
    applyLight(t);
    let more = false;
    if (state.expoLock != null) R.expo = state.expoLock;   // 录视频时锁曝光（冬至、夏至的明暗差要看得出来）
    else if (!P.point) more = R.meterExposure(0.35) > 0.01;    // 日：自动曝光，松手后继续收敛到位
    R.draw(state.rect);
    if (state.insAnim && state.fxProbe) {   // 刻字动画：在刀头旁边的石面上取一个像素的颜色，给碎石、粉雾、凿子配色
      const px = new Uint8Array(4), [qx, qy] = state.fxProbe;
      if (qx >= 0 && qy >= 0 && qx < cv.width && qy < cv.height) { R.gl.readPixels(Math.round(qx), Math.round(cv.height - qy), 1, 1, R.gl.RGBA, R.gl.UNSIGNED_BYTE, px); state.fxBase = [px[0], px[1], px[2]]; }
    }
    state.dirty = more;
    frames++;
  }
  if (R.dbg && t - fpsT > 1000) { $("#fps").textContent = `${frames} fps`; frames = 0; fpsT = t; }
  requestAnimationFrame(frame);
}

// 拖光：日 = 指针相对浮雕中心的位置映到半球上（浮雕边上就是掠射光）；火、灯 = 指针就是灯的位置，滚轮或上下键调远近
function onPointer(e) {
  const px = e.clientX * state.dpr, py = e.clientY * state.dpr;
  if (LIGHTS[state.mode].point) {
    state.ptxy = toRelief(px, py);
  } else {
    const [x, y, w, h] = state.rect;
    const dx = (px - (x + w / 2)) / (w * 0.5), dy = (py - (y + h / 2)) / (h * 0.5);
    const r = Math.hypot(dx, dy), rc = Math.min(r, 0.985);
    const s = r > 1e-6 ? rc / r : 0;
    state.dir = [dx * s, dy * s, Math.sqrt(1 - rc * rc)];
  }
  state.dirty = true; emitLight();
}
cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); state.ptr = e.pointerId; onPointer(e); });
cv.addEventListener("pointermove", (e) => { if (state.ptr === e.pointerId) onPointer(e); });
for (const ev of ["pointerup", "pointercancel"]) cv.addEventListener(ev, () => { state.ptr = null; });
function nudgeZ(f) {
  if (!LIGHTS[state.mode].point) return;
  state.zMul = Math.min(3, Math.max(0.25, state.zMul * f)); state.dirty = true;
}
cv.addEventListener("wheel", (e) => { nudgeZ(Math.exp(e.deltaY * 0.001)); e.preventDefault(); }, { passive: false });

function setMode(m) {
  state.mode = m;
  $$(".lights button").forEach((b) => b.classList.toggle("on", b.dataset.light === m));
  meterPoint(); state.dirty = true; lightT = 0; emitLight();
}
$$(".lights button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.light)));

function setStone(s) {
  R.setStone(s); $$(".swatch").forEach((b) => b.classList.toggle("on", b.dataset.stone === s));
  meterPoint(); state.dirty = true;
}
$$(".swatch").forEach((b) => b.addEventListener("click", () => setStone(b.dataset.stone)));

$("#scale").addEventListener("input", (e) => { R.setScale(parseFloat(e.target.value)); state.dirty = true; });
$("#scale").addEventListener("change", meterPoint);

function setTheme(t) {
  document.body.dataset.theme = t;
  $("#themeBtn").classList.toggle("on", t === "light");
  const c = getComputedStyle(document.body).getPropertyValue("--stage").trim();
  R.bg = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  R.gain = t === "light" ? 1.3 : 1.0;
  fit();
}
$("#themeBtn").addEventListener("click", () => setTheme(document.body.dataset.theme === "light" ? "dark" : "light"));

$("#savePng").addEventListener("click", () => {
  // 画布不保留上一帧（省一次拷贝），所以在同一个任务里现画一帧再取
  applyLight(performance.now()); R.draw(state.rect);
  const [x, y, w, h] = state.rect.map(Math.round);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d").drawImage(cv, x, y, w, h, 0, 0, w, h);
  const a = document.createElement("a");
  a.download = `一刻千年_${state.work || "浮雕"}.png`; a.href = c.toDataURL("image/png"); a.click();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "1") setMode("sun"); else if (e.key === "2") setMode("torch"); else if (e.key === "3") setMode("lamp");
  else if (e.key === "m") setStone(R.stone === "云冈砂岩" ? "汉白玉" : "云冈砂岩");
  else if (e.key === "ArrowUp") nudgeZ(1.12); else if (e.key === "ArrowDown") nudgeZ(1 / 1.12);
  else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    // 到下一个 / 上一个关键年份
    const p = posAt(state.year), right = e.key === "ArrowRight";
    const i = right ? POS.findIndex((q) => q > p + 1e-6) : POS.map((q, j) => (q < p - 1e-6 ? j : -1)).filter((j) => j >= 0).pop();
    if (i !== undefined && i >= 0) glideTo(KEYS[i]);
  } else if (e.key === "w") setEnv(!state.env);
});
window.addEventListener("resize", fit);

// ---------- 拓（F4）----------
// 进入：读回当年风化后的高度 → 算纸面接触图 → 湿纸半透明地蒙在浮雕上；点按（或平板上拍）一下上一团墨；
// 揭：落跋、盖印，放到中间；存：下载 PNG。平板（rub.html）拍的墨经服务转过来，两边用同一份接触图，拍出来一样
const rub = { on: false, T: null, img: null, g: null, style: "乌金", R: 0, seq: 0, ver: 0, sheet: null, ptr: null, last: null };
const rubCv = $("#rub");
function placeRub() {
  if (!rub.on) return;
  const r = (state.rect0 || state.rect).map((v) => v / state.dpr);
  Object.assign(rubCv.style, { left: `${r[0]}px`, top: `${r[1]}px`, width: `${r[2]}px`, height: `${r[3]}px` });
}
function rubRepaint(win) {
  paint(rub.T, rub.img.data, rub.style, win, true);
  if (win) rub.g.putImageData(rub.img, 0, 0, win[0], win[1], win[2], win[3]); else rub.g.putImageData(rub.img, 0, 0);
}
async function enterRub() {
  if (!R.w || rub.on) return;
  state.insAnim = null; clearFx(); state.view = state.viewT = 0; applyView(); R.draw(state.rect);
  const H = R.readHeight(1500);   // 场要够细：碑上的字、凿痕、粉化坑才拓得出来
  const bytes = contactBytes(makeRubbing(H.data, H.w, H.h));
  rub.T = fromContactBytes(bytes, H.w, H.h);   // 和平板上用同一份（量化过的）接触图
  rubCv.width = H.w; rubCv.height = H.h; rub.g = rubCv.getContext("2d"); rub.img = rub.g.createImageData(H.w, H.h);
  rub.R = 0.03 * Math.max(H.w, H.h); rub.on = true; rub.sheet = null;
  rubRepaint(null);
  rubCv.hidden = false; $("#rubBar").hidden = false; $("#rubPeel").hidden = false; $("#rubSave").hidden = true; $("#sheet").hidden = true;
  document.body.dataset.rub = "1"; placeRub();
  try {   // 交给平板（有后端时）
    const r = await fetch(`api/rubsrc?w=${H.w}&h=${H.h}`, { method: "POST", body: bytes });
    if (r.ok) { rub.ver = (await r.json()).version; rub.seq = 0; pollRub(); }
  } catch (e) { /* 静态服务：只能在大屏上点 */ }
}
function exitRub() {
  rub.on = false; rubCv.hidden = true; $("#rubBar").hidden = true; $("#sheet").hidden = true; $("#sheet").replaceChildren();
  delete document.body.dataset.rub; state.dirty = true;
}
function rubDab(u, v, amt) {
  if (!rub.on || rub.sheet) return;
  const win = dab(rub.T, u * rub.T.w, v * rub.T.h, rub.R, amt);
  if (win) rubRepaint(win);
}
function setInk(style) {
  rub.style = style; $$("#rubBar [data-ink]").forEach((b) => b.classList.toggle("on", b.dataset.ink === style));
  if (rub.on && !rub.sheet) rubRepaint(null);
}
function peel() {
  if (!rub.on || rub.sheet) return;
  rub.sheet = makeSheet(rub.T, rub.style, { strokes: state.nameStrokes, nameText: state.nameText, long: Math.max(rub.T.w, rub.T.h) });
  $("#sheet").replaceChildren(rub.sheet); $("#sheet").hidden = false;
  rubCv.hidden = true; $("#rubPeel").hidden = true; $("#rubSave").hidden = false;
  emit("peel");
}
async function pollRub() {
  if (!rub.on) return;
  try {
    const r = await fetch(`api/rub?since=${rub.seq}`, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      if (j.version === rub.ver) {
        for (const e of j.events) { for (const [u, v, q] of e.dabs) rubDab(u, v, q); if (e.cmd === "揭") peel(); else if (e.cmd) setInk(e.cmd); }
        rub.seq = j.seq;
      }
    }
  } catch (e) { /* 没有后端 */ }
  setTimeout(pollRub, 120);
}
// 大屏上直接点：按下拍一下，按着拖动时每走过半个拓包拍一下；笔压（有的话）定墨量
const rubUV = (e) => { const b = rubCv.getBoundingClientRect(); return [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height]; };
const rubAmt = (e) => 0.16 + 0.24 * (e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.55);   // 一下只上一层，拍几遍才黑
rubCv.addEventListener("pointerdown", (e) => { rubCv.setPointerCapture(e.pointerId); rub.ptr = e.pointerId; const p = rubUV(e); rub.last = p; rubDab(p[0], p[1], rubAmt(e)); });
rubCv.addEventListener("pointermove", (e) => {
  if (rub.ptr !== e.pointerId) return;
  const p = rubUV(e), d = Math.hypot((p[0] - rub.last[0]) * rub.T.w, (p[1] - rub.last[1]) * rub.T.h);
  if (d > 0.5 * rub.R) { rub.last = p; rubDab(p[0], p[1], rubAmt(e) * 0.8); }
});
for (const ev of ["pointerup", "pointercancel"]) rubCv.addEventListener(ev, () => { rub.ptr = null; });
// 点下去要算一会儿的按钮：先让光标、按钮变成“在忙”，等浏览器画出来再算（不然看着像没点上）
async function busy(btn, fn) {
  if (document.body.classList.contains("busy")) return;
  document.body.classList.add("busy"); btn?.classList.add("busy");
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  try { return await fn(); } finally { document.body.classList.remove("busy"); btn?.classList.remove("busy"); }
}
$("#rubBtn").addEventListener("click", (e) => busy(e.currentTarget, enterRub));
$("#rubExit").addEventListener("click", exitRub);
$("#rubPeel").addEventListener("click", peel);
$$("#rubBar [data-ink]").forEach((b) => b.addEventListener("click", () => setInk(b.dataset.ink)));
// ---------- 导出（C8）----------
function download(name, blobOrUrl) {
  const a = document.createElement("a"); a.download = name;
  a.href = typeof blobOrUrl === "string" ? blobOrUrl : URL.createObjectURL(blobOrUrl); a.click();
  if (typeof blobOrUrl !== "string") setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
// STL：当前年份风化后的样子（连龛、碑），长边 128 毫米
function saveSTL(opts = {}) {   // opts：makeSTL 的参数（打印件用 { maxSide: 512, reliefMM: 5 }，见 打印/README.md）
  if (!R.w) return;
  const H = R.readHeight(Math.max(900, 2 * (opts.maxSide || 320))), r = makeSTL(H.data, H.w, H.h, opts);
  if (!r.watertight) console.warn("STL 不水密");
  download(`一刻千年_${state.work || "浮雕"}_${state.year}.stl`, new Blob([r.buf], { type: "model/stl" }));
  return { tris: r.tris, watertight: r.watertight, size: r.size };
}
// 观照记录：临时换光、年份、石材，各画一帧截下来，排成 A4；画完恢复原样
function makeRecordPage() {
  if (!R.w) return null;
  const keep = { mode: state.mode, dir: state.dir, year: state.year, env: state.env, stone: R.stone, expo: R.expo, lock: state.expoLock, view: state.view };
  state.view = state.viewT = 0; applyView();
  const grab = () => {
    applyLight(0); R.draw(state.rect);
    const [x, y, w, h] = state.rect, s = Math.min(1, 900 / w), c = document.createElement("canvas");
    c.width = Math.round(w * s); c.height = Math.round(h * s); c.getContext("2d").drawImage(cv, x, y, w, h, 0, 0, c.width, c.height); return c;
  };
  state.mode = "sun"; const L0 = LIGHTS.sun; R.light.point = false; R.light.amb = L0.amb;
  setYear(483, false); setEnv(0);
  // 曝光按冬至正午定一次，之后锁住：夏至正午光贴着崖面掠过、整壁变暗，要看得出来
  const s0 = sunAt(355, 12); state.dir = s0.dir; applyLight(0); for (let k = 0; k < 6; k++) R.meterExposure(0.6);
  const ex = R.expo;
  const day = [];
  for (const [d, nm] of [[355, "冬至"], [172, "夏至"]]) for (const hr of [9, 12, 15]) {
    const s = sunAt(d, hr); state.dir = s.dir; R.expo = ex;
    day.push({ img: grab(), label: `${nm} ${hr} 时  太阳高 ${Math.round(s.alt)}°` });
  }
  state.dir = [-0.6, -0.55, 0.58]; R.expo = ex * 1.15;
  const years = [];
  for (const [y, e, nm] of [[483, 0, "483 开凿"], [1651, 0, "1651 重妆"], [2026, 0, "2026 今日"], [2526, 1, "2526 若不治水"]]) { setEnv(e); setYear(y, false); years.push({ img: grab(), label: nm }); }
  setEnv(0); setYear(483, false);
  const stones = [];
  for (const st of ["云冈砂岩", "汉白玉"]) { R.setStone(st); stones.push({ img: grab(), label: st }); }
  // 恢复
  R.setStone(keep.stone); setEnv(keep.env); setYear(keep.year, false); state.mode = keep.mode; state.dir = keep.dir; R.expo = keep.expo; state.expoLock = keep.lock;
  state.view = state.viewT = keep.view || 0; applyView(); state.dirty = true;
  return makeRecord({ day, years, stones, rubbing: rub.sheet || null, title: "观照记录", sub: "丙午冬  大同云冈" });
}
$("#stlBtn").addEventListener("click", (e) => busy(e.currentTarget, saveSTL));
// 执灯（F1）：摄像头看真手电，灯头的位置就是灯的位置（灯模式，射灯）
let holdLamp = null;
async function setHoldLamp(on) {
  if (!on) { holdLamp?.stop(); holdLamp = null; state.lampOn = null; state.dirty = true; $("#lampPrev").hidden = true; $("#lampBtn").classList.remove("on"); return; }
  if (holdLamp) return;
  try {
    setMode("lamp");
    state.lampOn = 0; state.lampK = 0; state.dirty = true;   // 先熄着：举起手电才亮
    holdLamp = await startHoldLamp($("#lampVideo"), $("#lampPrev"), (u, v, z) => {
      if (!R.w) return;
      if (u === null) { state.lampOn = 0; state.dirty = true; return; }      // 认不到手电：灯慢慢熄掉
      state.lampOn = 1; state.ptxy = [u * R.w, v * R.h]; state.zMul = z; state.dirty = true;
    });
    $("#lampPrev").hidden = false; $("#lampBtn").classList.add("on");
  } catch (e) { console.error("执灯：摄像头打不开", e); }
}
$("#lampBtn").addEventListener("click", () => setHoldLamp(!holdLamp));
// 刻法（C3）：剔地起突 / 压地隐起 / 减地平钑
function setKefa(k) {
  if (!KEFA.includes(k)) return;
  state.kefa = k; $$("#kefa [data-kefa]").forEach((b) => b.classList.toggle("on", b.dataset.kefa === k));
  if (state.src) buildWork();
}
$$("#kefa [data-kefa]").forEach((b) => b.addEventListener("click", () => busy(b, () => setKefa(b.dataset.kefa))));
$("#recBtn").addEventListener("click", (e) => busy(e.currentTarget, () => { const c = makeRecordPage(); if (c) download(`一刻千年_观照记录_${state.work || ""}.png`, c.toDataURL("image/png")); }));

$("#rubSave").addEventListener("click", () => {
  if (!rub.sheet) return;
  const a = document.createElement("a"); a.download = `一刻千年_拓片_${state.work || ""}.png`; a.href = rub.sheet.toDataURL("image/png"); a.click();
});


async function loadWork(id) {
  const meta = await (await fetch(`data/${id}.json`)).json();
  const buf = await (await fetch(`data/${id}.u16`)).arrayBuffer();
  const u = new Uint16Array(buf); const f = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) f[i] = u[i] / 65535 * meta.hmax;
  let reg = null;   // 区域图（头发 / 皮肤 / 衣服 / 配饰的概率）：1651 重妆按它上色；老作品没有就全刷白粉
  if (meta.reg) {
    const rb = await fetch(`data/${id}.reg`);
    if (rb.ok) reg = { w: meta.reg[0], h: meta.reg[1], data: new Uint8Array(await rb.arrayBuffer()) };
  }
  state.src = { id, meta, f0: f, reg };
  buildWork();
}

// 按当前刻法把作品放上舞台（换刻法时只重做这一步，不重新下载）
function buildWork() {
  const { id, meta, f0, reg } = state.src;
  const f = applyKefa(state.kefa, f0, meta.w, meta.h, reg, meta.faces, meta.lm);   // lm：人脸关键点（减地平钑按它刻五官，旧作品没有就照旧）
  state.frame = null; R.niche = false;
  if (state.niche) {   // 放进圆拱龛（C4），龛外右边壁面上刻题记碑（C9）
    const L = nicheLayout(f0, meta.w, meta.h, { stele: state.stele, faces: meta.faces });   // 龛按原来的几何定（换刻法时龛不变，只换龛里的像）
    const N = buildNiche(f, meta.w, meta.h, L);
    if (L.stele) cutStele(N.heights, L.w2, L);
    applyKefaNiche(state.kefa, N.heights, N.frame, L.w2, L.h2, L.Hw, L.fw);   // 龛楣、龛沿也按同一刻法改
    R.setRelief(N.heights, L.w2, L.h2, placeReg(reg, L));
    R.niche = true; state.frame = N.frame; state.L = L.stele ? L : null; R.stele = L.stele ? [L.x0, L.y0, L.x1, L.y1] : null; carveName();
  } else if (state.stele) {   // 右边扩出地子，刻一块凹进去的题记碑（C9）
    const L = steleLayout(meta.w, meta.h);
    R.setRelief(extendRelief(f, meta.w, meta.h, L), L.w2, meta.h, extendReg(reg, L.w2));
    state.L = L; R.stele = [L.x0, L.y0, L.x1, L.y1]; carveName();
  } else { R.setRelief(f, meta.w, meta.h, reg); state.L = null; R.stele = null; }
  state.seed = [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  R.seedOff = [(state.seed % 997) * 13.7, (Math.floor(state.seed / 997) % 991) * 7.3];   // 噪声花纹按作品错开
  setYear(state.year, false);
  state.work = meta.name || id; state.workId = id; state.ptxy = null;
  $$(".works button").forEach((b) => b.classList.toggle("on", b.dataset.id === id));
  fit(); meterPoint();
}

async function renderWorks() {
  const list = await (await fetch("data/index.json", { cache: "no-store" })).json();
  const box = $("#works"); box.innerHTML = "";
  list.forEach((it, i) => {
    const b = document.createElement("button"); b.dataset.id = it.id; b.title = it.name || it.id;
    if (it.thumb) { b.className = "thumb"; b.style.backgroundImage = `url(data/${it.id}.jpg)`; }
    else { b.className = "chip"; b.textContent = String(i + 1); }
    b.classList.toggle("on", it.id === state.workId);
    b.addEventListener("click", () => busy(b, () => loadWork(it.id))); box.appendChild(b);
  });
  return list;
}

// 题名板（网上、没有平板时）：write.html 嵌进来写，点“刻”把笔迹交回舞台。有后端时照旧交给服务（平板那条路），由轮询来刻
function openPad() {
  const f = $("#namePadFrame"); if (!f.src) f.src = "write.html?embed=1";
  $("#namePad").hidden = false; f.focus();
}
function closePad() { $("#namePad").hidden = true; }
$("#nameBtn").addEventListener("click", openPad);
$("#namePadClose").addEventListener("click", closePad);
$("#namePad").addEventListener("pointerdown", (e) => { if (e.target === e.currentTarget) closePad(); });
window.addEventListener("message", async (e) => {
  if (e.origin !== location.origin || !e.data || e.data.ykqn !== 1 || e.data.type !== "write" || !Array.isArray(e.data.strokes)) return;
  closePad();
  const strokes = e.data.strokes;
  if (state.server) {
    try {
      const r = await fetch("api/name", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ strokes }) });
      if (r.ok) { emit("name"); return; }
    } catch (err) { /* 服务断了：就在本页刻 */ }
  }
  state.nameStrokes = strokes; state.nameText = ""; carveName(true); emit("name");
});

// 新照片 → 后端建浮雕 → 载入。拍：摄像头；传：选文件
async function carve(blob) {
  $("#busy").hidden = false;
  try {
    const r = await fetch("api/relief", { method: "POST", body: blob });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || r.status);
    state.tween = null; state.year = 483;   // 新刻的从“刚刻成”开始
    state.nameStrokes = null; state.nameText = "";   // 新观众：碑上题名位空着，等他在平板上写
    await renderWorks(); await loadWork(j.id);
  } catch (e) {
    console.error(e); $("#busy span").textContent = "未成"; await new Promise((ok) => setTimeout(ok, 1400));
  } finally { $("#busy").hidden = true; $("#busy span").textContent = "开凿"; }
}
$("#upload").addEventListener("click", () => $("#file").click());
$("#file").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) carve(f); e.target.value = ""; });
let stream = null;
$("#shoot").addEventListener("click", async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: "user" } });
    $("#video").srcObject = stream; $("#cam").hidden = false;
  } catch (e) { console.error(e); }
});
function closeCam() { $("#cam").hidden = true; if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; }
$("#camClose").addEventListener("click", closeCam);
$("#snap").addEventListener("click", () => {
  const v = $("#video"); const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
  const g = c.getContext("2d"); g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(v, 0, 0);   // 存镜像后的，和观众在屏幕上看到的一致
  closeCam(); c.toBlob((b) => carve(b), "image/jpeg", 0.93);
});

async function init() {
  const q = new URLSearchParams(location.search);
  R.dbg = parseInt(q.get("dbg") || "0");
  $("#fps").hidden = !R.dbg;
  if (q.get("still")) LIGHTS.torch.flicker = false;   // 无头截图（软件 WebGL）用：不连续重绘
  if (q.get("flicker")) LIGHTS.torch.flicker = true;   // 录视频：火把照样闪（按 filmT）
  state.clean = +(q.get("clean") || 0); if (state.clean) document.body.dataset.clean = state.clean;
  R.edge = state.clean ? 0.12 : 0;   // 录视频：浮雕四边淡进底色（拉回全景时不露出一块硬边的长方形）
  state.kefa = KEFA.includes(q.get("kefa")) ? q.get("kefa") : KEFA[0]; $$("#kefa [data-kefa]").forEach((b) => b.classList.toggle("on", b.dataset.kefa === state.kefa));
  state.stele = q.get("stele") !== "0"; state.niche = q.get("niche") !== "0"; state.nameText = q.get("name") || ""; state.mute = !!q.get("mute");
  try { state.server = (await fetch("api/name", { cache: "no-store" })).ok; } catch (e) { state.server = false; }
  document.body.classList.toggle("static", !state.server);   // 静态网站：没有后端建浮雕，拍 / 传藏起来
  buildTicks(); await initRelic();
  try { const im = new Image(); im.src = "assets/era_taihe.png"; await im.decode(); state.eraImg = im; } catch (e) { console.warn("题记模板图没载入", String(e)); }
  // 截图、录视频用：?year=1651&env=1（不治水）；?sun=x,y,z 定太阳方向
  if (q.get("env")) setEnv(q.get("env") === "1" || q.get("env") === "不治水");
  if (q.get("year")) state.year = +q.get("year");
  if (q.get("sun")) state.dir = q.get("sun").split(",").map(Number);
  const list = await renderWorks();
  setTheme(q.get("theme") === "light" ? "light" : "dark");
  if (q.get("stone")) R.stone = q.get("stone");
  setStone(R.stone);
  state.mode = q.get("light") || "lamp";
  await loadWork(q.get("work") || list[0].id);
  if (!state.server && !state.nameText && state.workId === "lead") {   // 网上：组长那件碑上是他自己写的名字（演示机上由服务给）
    try { state.nameStrokes = (await (await fetch("assets/name_demo.json")).json()).strokes; carveName(); } catch (e) { /* 没有就空着 */ }
  }
  setMode(state.mode);
  if (q.get("bench")) bench();   // 测完把结果贴在画面上，页面照常能用
  requestAnimationFrame(frame);
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__ready = true; }));   // 截图脚本等这个
  pollName();
}

function gpuName() {
  const gl = R.gl, e = gl.getExtension("WEBGL_debug_renderer_info");
  return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
}

// 帧时测量（?bench=1）：每种光各同步画 30 帧，结果写进页面标题，并用一次 GET 落到服务的访问日志里（无头浏览器读）
function bench() {
  const gl = R.gl, out = {}, px = new Uint8Array(4), keep = { mode: state.mode, year: state.year, dir: state.dir.slice(), ptxy: state.ptxy };
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);   // Chrome 里 gl.finish 不等 GPU，读一个像素才会真等
  for (const m of ["sun", "torch", "lamp"]) {
    setMode(m); applyLight(0); R.draw(state.rect); sync();
    const t0 = performance.now();
    for (let k = 0; k < 30; k++) {
      const a = k / 30 * 6.283; state.dir = [0.6 * Math.cos(a), 0.6 * Math.sin(a), 0.5];
      state.ptxy = [R.w * (0.5 + 0.3 * Math.cos(a)), R.h * (0.5 + 0.3 * Math.sin(a))];
      applyLight(k * 16); if (!LIGHTS[m].point) R.meterExposure(0.35);
      R.draw(state.rect); sync();
    }
    out[m] = ((performance.now() - t0) / 30).toFixed(2);
  }
  const t1 = performance.now(); R._aoDirty = true; R.draw(state.rect); sync();
  out.ao = (performance.now() - t1).toFixed(1);
  // 拖时间轴：每帧重算风化 + 遮蔽 + 主画面
  setMode("sun"); const t2 = performance.now();
  for (let k = 0; k < 30; k++) { setYear(483 + k * 68, false); R.draw(state.rect); sync(); }
  out.time = ((performance.now() - t2) / 30).toFixed(2);
  const res = JSON.stringify({ canvas: [cv.width, cv.height], dpr: state.dpr, relief: [R.w, R.h], ms: out, gpu: gpuName() });
  document.title = "BENCH " + res;
  fetch("bench?" + encodeURIComponent(res)).catch(() => {});
  state.dir = keep.dir; state.ptxy = keep.ptxy; setMode(keep.mode); setYear(keep.year, false); state.dirty = true;
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:50%;top:5vh;transform:translateX(-50%);z-index:50;padding:12px 22px;border:1px solid var(--line);border-radius:10px;background:rgba(18,16,13,0.92);color:var(--sand);font:16px/1.7 var(--font);text-align:center;cursor:pointer";
  box.textContent = `每帧毫秒　日光 ${out.sun}　火把 ${out.torch}　射灯 ${out.lamp}　拖时间轴 ${out.time}　画布 ${cv.width}×${cv.height}`;
  box.title = "点一下关掉"; box.addEventListener("click", () => box.remove()); document.body.appendChild(box);
}

fit();
init();
window.__R = R; window.__state = state; window.__api = {
  setYear, setEnv, glideTo, setMode, setStone,
  setSun: (d) => { const l = Math.hypot(...d); state.dir = d.map((v) => v / l); state.dirty = true; },
  setLamp: (u, v, z) => { state.ptxy = [u * R.w, v * R.h]; if (z) state.zMul = z; state.dirty = true; },
  setScale: (k) => { R.setScale(k); state.dirty = true; },
  setCarve: (c) => { R.carve = c; R._wxDirty = true; state.dirty = true; },
  setExpo: (v) => { state.expoLock = v; state.dirty = true; },
  setFilmT: (ms) => { state.filmT = ms; state.dirty = true; },
  setName: (strokes, text, animate) => { state.nameStrokes = strokes; if (text !== undefined) state.nameText = text; carveName(!!animate); },
  // 录视频：刻字动画的时钟由脚本给（秒，从下第一刀算）；undefined 交回实时
  setInsT: (sec) => { state.insT = sec; state.dirty = true; },
  setView: (v) => { state.view = state.viewT = v; applyView(); state.dirty = true; },
  // 拓：进入、拍墨（u, v 0..1）、换墨、揭、退；自动拍满（录视频、示范）
  rubEnter: () => enterRub(), rubDab: (u, v, a) => rubDab(u, v, a ?? 0.4), rubInk: (st) => setInk(st), rubPeel: () => peel(), rubExit: () => exitRub(),
  setKefa: (k) => setKefa(k), holdLamp: (on) => setHoldLamp(on), saveSTL: (o) => saveSTL(o || {}), recordPage: () => { const c = makeRecordPage(); return c && c.toDataURL("image/jpeg", 0.9); },
  rubAutoList: (passes = 2, order = "rows") => (rub.on ? autoDabs(rub.T, rub.R, passes, 5, order).map(([x, y, q]) => [x / rub.T.w, y / rub.T.h, q]) : []),
  insPlan: () => state.insAnim && { total: state.insAnim.P.total, strikes: strikes(state.insAnim.P, 1e9) },
  sunAt: (day, hour) => { const s = sunAt(day, hour); state.dir = s.dir; state.dirty = true; return s.alt; },
};
