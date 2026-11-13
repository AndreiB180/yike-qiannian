// 刻法（方案 C3）：同一块几何，按北宋《营造法式》卷三“石作制度”里雕镌制度的四等（剔地起突、压地隐起华、减地平钑、素平）的前三等改刻。
// 都在 CPU 上、载入作品时做一次（约 0.2–0.5 秒）。龛楣、龛沿也跟着同一刻法改（applyKefaNiche）。
//   剔地起突：现在的样子（深，6–10 mm，体积强）——不改
//   压地隐起：地子压下，纹样圆润微起，最高处不出石面：大起伏用 tanh 软封顶（高处压平、低处基本照旧），总高约四成，细节照留
//   减地平钑：人像成一块顶面平的薄台（1–2 mm），四周地子减下去；细节全靠阴刻线：两盏灯（左上、右上）下的几何明暗做 XDoG
//             （Winnemöller 2012）→ 二值 → 去掉小连通块 → Zhang–Suen 细化成骨架 → 按统一宽度刻 V 形槽（汉画像石、云冈一期供养人）
// 输入：f 高度（像素单位，作品自己的裁剪坐标），w × h；reg 区域概率（半分辨率 RGBA：头发、皮肤、衣服、配饰）；faces 脸框 [[x0,y0,x1,y1]...]

export const KEFA = ["剔地起突", "压地隐起", "减地平钑"];

function boxLine(src, dst, off, stride, n, r) {
  const inv = 1 / (2 * r + 1), at = (i) => src[off + Math.min(n - 1, Math.max(0, i)) * stride];
  let acc = 0; for (let i = -r; i <= r; i++) acc += at(i);
  for (let i = 0; i < n; i++) { dst[off + i * stride] = acc * inv; acc += at(i + r + 1) - at(i - r); }
}
// 高斯模糊：三次盒式模糊逼近（σ ≥ 0.8），每像素计算量和 σ 无关
export function blur(src, w, h, sig) {
  let a = Float32Array.from(src); if (sig < 0.5) return a;
  const b = new Float32Array(w * h), n = 3, wIdeal = Math.sqrt(12 * sig * sig / n + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--; const wu = wl + 2, m = Math.round((12 * sig * sig - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  for (let k = 0; k < n; k++) {
    const r = ((k < m ? wl : wu) - 1) >> 1;
    for (let y = 0; y < h; y++) boxLine(a, b, y * w, 1, w, r);
    for (let x = 0; x < w; x++) boxLine(b, a, x, w, h, r);
  }
  return a;
}
const sm = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
function quantile(arr, q, step = 7) { const v = []; for (let i = 0; i < arr.length; i += step) v.push(arr[i]); v.sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : 0; }

function ground(f) { const gv = []; for (let i = 0; i < f.length; i += 7) if (f[i] < 2) gv.push(f[i]); gv.sort((a, b) => a - b); return gv.length ? gv[gv.length >> 1] : 0; }
function faceWidth(faces, w, h) {
  const fws = (faces || []).map((b) => b[2] - b[0]).filter((v) => v > 4).sort((a, b) => a - b);
  return fws.length ? fws[fws.length >> 1] : 0.25 * Math.min(w, h);
}
// 区域概率（0..1）按全分辨率取：c 是通道（0 头发 1 皮肤 2 衣服 3 配饰），双线性
function regPlane(reg, w, h, c) {
  const out = new Float32Array(w * h); if (!reg) return out;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(reg.h - 1, y / 2), y0 = Math.floor(fy), y1 = Math.min(reg.h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(reg.w - 1, x / 2), x0 = Math.floor(fx), x1 = Math.min(reg.w - 1, x0 + 1), tx = fx - x0;
      const g = (xx, yy) => reg.data[(yy * reg.w + xx) * 4 + c];
      out[y * w + x] = ((g(x0, y0) * (1 - tx) + g(x1, y0) * tx) * (1 - ty) + (g(x0, y1) * (1 - tx) + g(x1, y1) * tx) * ty) / 255;
    }
  }
  return out;
}

export function applyKefa(kind, f, w, h, reg, faces, lm = null) {
  if (!kind || kind === "剔地起突") return f;
  const g0 = ground(f), fw = faceWidth(faces, w, h), N = w * h;
  const r = new Float32Array(N); for (let i = 0; i < N; i++) r[i] = Math.max(0, f[i] - g0);
  const P = quantile(r.filter((v) => v > 0.5), 0.995, 3) || 1;
  const out = new Float32Array(N);
  if (kind === "压地隐起") {
    const base = blur(r, w, h, 0.08 * fw), Hc = 0.24 * P;   // v3：封顶点更低，脸颊、额头、衣面成片压平（评审：“看不出高点削平”）
    const fig = new Float32Array(N); for (let i = 0; i < N; i++) fig[i] = r[i] > 0.04 * P ? 1 : 0;
    const round = blur(fig, w, h, 0.06 * fw);   // 轮廓圆润：边上缓缓起来（斜坡宽 0.06 脸宽），不在龛壁上落投影
    for (let i = 0; i < N; i++) { const m = Math.pow(round[i], 0.6); out[i] = g0 + (Hc * Math.tanh(base[i] / Hc) + 0.65 * (r[i] - base[i])) * m; }   // 高处压平（“隐起”不出石面）
    return out;
  }
  // 减地平钑
  const mask = new Float32Array(N); for (let i = 0; i < N; i++) mask[i] = r[i] > 0.04 * P ? 1 : 0;
  const edgeFade = cutFade(mask, w, h, 0.3 * fw);   // 照片上、左、右边沿切到人像的地方，台面和线都渐渐沉回地子
  const mSoft = blur(mask, w, h, 0.9), mIn = blur(mask, w, h, 0.012 * fw);
  const clothW = blur(regPlane(reg, w, h, 2), w, h, 0.02 * fw), rf = blur(r, w, h, Math.max(0.8, 0.004 * fw)), rc = blur(r, w, h, 0.015 * fw);
  const rb = new Float32Array(N); for (let i = 0; i < N; i++) { const c = sm(0.3, 0.6, clothW[i]); rb[i] = rf[i] * (1 - c) + rc[i] * c; }   // 衣服先抹平：布纹不提成麻点，只留大褶
  const inner = new Uint8Array(N); for (let i = 0; i < N; i++) inner[i] = mIn[i] > 0.6 ? 1 : 0;
  const hairW = regPlane(reg, w, h, 0), skinW = regPlane(reg, w, h, 1), accW = blur(regPlane(reg, w, h, 3), w, h, 0.01 * fw);
  const G = groove(rb, w, h, fw, inner, 0.07, (bin) => lmLines(bin, w, h, fw, lm, inner, hairW, skinW, rf, accW));
  const Hp = 0.12 * P, d0 = 0.6 * Hp;   // v3：台面薄一半（“平钑”是薄平台，投影只剩几个像素）
  for (let i = 0; i < N; i++) out[i] = g0 + (Hp * mSoft[i] - d0 * G[i]) * edgeFade[i];
  return out;
}

// 阴刻线：高度 → 两盏灯下的明暗 → XDoG → 二值 → 去小连通块 → Zhang–Suen 细化 → 统一宽度的 V 形槽（0..1）
function groove(hgt, w, h, fw, inner, density = 0.07, post = null) {
  const N = w * h, s = Math.max(1.2, 0.009 * fw), ex = 2.5, lines = new Float32Array(N);
  for (const [lx, ly, lz] of [[-0.6, -0.6, 0.53], [0.6, -0.6, 0.53]]) {
    const S = new Float32Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gx = (hgt[y * w + Math.min(w - 1, x + 1)] - hgt[y * w + Math.max(0, x - 1)]) / 2 * ex, gy = (hgt[Math.min(h - 1, y + 1) * w + x] - hgt[Math.max(0, y - 1) * w + x]) / 2 * ex;
      S[y * w + x] = Math.max(0, (-gx * lx - gy * ly + lz) / Math.sqrt(gx * gx + gy * gy + 1));
    }
    const a = blur(S, w, h, s), b = blur(S, w, h, 1.6 * s), E = new Float32Array(N), v = [];
    for (let i = 0; i < N; i++) { E[i] = a[i] - 0.98 * b[i]; if (inner[i] && i % 5 === 0) v.push(E[i]); }
    v.sort((p, q) => p - q); const eps = v.length ? v[Math.floor(density * v.length)] : 0, phi = 6 / (Math.abs(eps) + 1e-3);
    for (let i = 0; i < N; i++) { const l = E[i] < eps ? -Math.tanh(phi * (E[i] - eps)) : 0; if (l > lines[i]) lines[i] = l; }
  }
  const L2 = blur(lines, w, h, 1.0), bin = new Uint8Array(N);
  for (let i = 0; i < N; i++) bin[i] = inner[i] && L2[i] > 0.45 ? 1 : 0;
  dropSmall(bin, w, h, Math.max(40, 0.002 * fw * fw));   // 碎点、碎块不要（v3 门槛提高：眼睛、头发里的碎块）
  thin(bin, w, h);                                         // 细化成一像素宽的骨架
  dropSmall(bin, w, h, Math.max(12, 0.12 * fw));           // 细化后短于 0.12 脸宽的线段不要
  if (post) post(bin);                                     // v5：脸上按关键点刻、头发按发流刻（有关键点时）
  const d = chamfer(bin, w, h), rw = Math.max(1.3, 0.0065 * fw), G = new Float32Array(N);
  for (let i = 0; i < N; i++) G[i] = d[i] < rw ? Math.pow(1 - d[i] / rw, 0.8) : 0;   // V 形截面
  return G;
}
function dropSmall(bin, w, h, minA) {   // 8 邻域连通块，面积小于 minA 的清掉
  const N = w * h, lab = new Int32Array(N), st = new Int32Array(N); let nl = 0;
  for (let s0 = 0; s0 < N; s0++) {
    if (!bin[s0] || lab[s0]) continue;
    nl++; let sp = 0, cnt = 0; st[sp++] = s0; lab[s0] = nl; const pix = [];
    while (sp) {
      const i = st[--sp], x = i % w, y = (i / w) | 0; cnt++; pix.push(i);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx; if (bin[j] && !lab[j]) { lab[j] = nl; st[sp++] = j; }
      }
    }
    if (cnt < minA) for (const i of pix) bin[i] = 0;
  }
}
function thin(bin, w, h) {   // Zhang–Suen 细化
  let changed = true; const del = [];
  const P = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : bin[y * w + x]);
  let pts = []; for (let i = 0; i < w * h; i++) if (bin[i]) pts.push(i);
  while (changed) {
    changed = false;
    for (const pass of [0, 1]) {
      del.length = 0;
      for (const i of pts) {
        if (!bin[i]) continue;
        const x = i % w, y = (i / w) | 0;
        const p2 = P(x, y - 1), p3 = P(x + 1, y - 1), p4 = P(x + 1, y), p5 = P(x + 1, y + 1), p6 = P(x, y + 1), p7 = P(x - 1, y + 1), p8 = P(x - 1, y), p9 = P(x - 1, y - 1);
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9; if (B < 2 || B > 6) continue;
        const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]; let A = 0; for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) A++;
        if (A !== 1) continue;
        if (pass === 0 ? (p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0) : (p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0)) del.push(i);
      }
      if (del.length) { changed = true; for (const i of del) bin[i] = 0; }
    }
    pts = pts.filter((i) => bin[i]);
  }
}
function chamfer(bin, w, h) {   // 到最近骨架像素的距离（3-4 倒角距离 / 3）
  const N = w * h, d = new Float32Array(N).fill(1e9);
  for (let i = 0; i < N; i++) if (bin[i]) d[i] = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 3); if (y > 0) { v = Math.min(v, d[i - w] + 3); if (x > 0) v = Math.min(v, d[i - w - 1] + 4); if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4); } d[i] = v; }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; let v = d[i];
    if (x < w - 1) v = Math.min(v, d[i + 1] + 3); if (y < h - 1) { v = Math.min(v, d[i + w] + 3); if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4); if (x > 0) v = Math.min(v, d[i + w - 1] + 4); } d[i] = v; }
  for (let i = 0; i < N; i++) d[i] /= 3;
  return d;
}
// 照片上、左、右边沿切到人像：这条边往里 FD 内渐渐沉回地子（和龛里的做法一样）；下沿有坛基挡着
function cutFade(mask, w, h, FD) {
  const hit = (get, n) => { let c = 0; for (let k = 0; k < n; k++) if (get(k)) c++; return c > 0.04 * n; };
  const T = hit((k) => mask[k], w), Lf = hit((k) => mask[k * w], h), Rt = hit((k) => mask[k * w + w - 1], h);
  const f = new Float32Array(w * h).fill(1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 1; if (T) v = Math.min(v, sm(0, FD, y)); if (Lf) v = Math.min(v, sm(0, FD, x)); if (Rt) v = Math.min(v, sm(0, FD, w - 1 - x));
    f[y * w + x] = v;
  }
  return f;
}

// 龛也跟着刻法改：龛沿、楣带、火焰（帧代码 2、3、4）比壁面 Hw 高出来的部分——压地隐起压一半；减地平钑压成一块平台再刻轮廓线
export function applyKefaNiche(kind, H, frame, w, h, Hw, fw) {
  if (!kind || kind === "剔地起突") return H;
  const N = w * h, arch = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const c = Math.floor(frame[i] + 1e-4); arch[i] = c >= 2 && c <= 4 && H[i] > Hw ? 1 : 0; }
  if (kind === "压地隐起") { for (let i = 0; i < N; i++) if (arch[i]) H[i] = Hw + 0.5 * (H[i] - Hw); return H; }
  const up = new Float32Array(N); for (let i = 0; i < N; i++) up[i] = arch[i] ? H[i] - Hw : 0;
  const top = quantile(up.filter((v) => v > 0), 0.9, 5) || 1;
  // v3：每条火舌、楣带、龛沿各是一块“区”（帧代码整数部分 + 火舌编号），区和区的分界就是要刻的轮廓线——一条火舌一道双勾，不对高度提线（评审：“像草或乱线”）
  const lab = new Int16Array(N); for (let i = 0; i < N; i++) { const c = Math.floor(frame[i] + 1e-4); lab[i] = arch[i] ? (c === 4 ? 40 + Math.round((frame[i] - 4) * 10) : c * 10) : 0; }
  const bin = new Uint8Array(N);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (!arch[i]) continue;
    if (lab[i] !== lab[i + 1] || lab[i] !== lab[i + w]) bin[i] = 1;
  }
  const d = chamfer(bin, w, h), rw = Math.max(1.3, 0.006 * fw), aSoft = blur(Float32Array.from(arch), w, h, 0.9);
  for (let i = 0; i < N; i++) if (aSoft[i] > 0.01) { const g = d[i] < rw ? Math.pow(1 - d[i] / rw, 0.8) : 0; H[i] = Hw + (0.3 * top * aSoft[i] - 0.2 * top * g); }
  return H;
}

// ---------------- v5：五官按关键点、头发按发流（11-11 夜，评审：“不像本人、头发碎网格、显老”） ----------------
// MediaPipe 478 点。右 = 照片里人的右边（画面左边）
const BROW_U = [[70, 63, 105, 66, 107], [300, 293, 334, 296, 336]], BROW_L = [[46, 53, 52, 65, 55], [276, 283, 282, 295, 285]];
const EYE_U = [[33, 246, 161, 160, 159, 158, 157, 173, 133], [263, 466, 388, 387, 386, 385, 384, 398, 362]];
const EYE_D = [[33, 7, 163, 144, 145, 153, 154, 155, 133], [263, 249, 390, 373, 374, 380, 381, 382, 362]];
const LIP_IU = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308], LIP_ID = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308];
const LIP_OU = [40, 39, 37, 0, 267, 269, 270], LIP_OD = [181, 84, 17, 314, 405];
const BRIDGE = [6, 197, 195, 5, 4], NOSE_W = [[49, 48, 64, 98], [327, 294, 278, 279]], NOSE_B = [97, 2, 326];   // 鼻梁（留几何线的地方）；两边鼻翼各一弧、鼻底一小笔
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

function drawSpline(bin, w, h, pts) {   // Catmull–Rom 过点，逐半像素点亮
  if (pts.length < 2) return;
  const P = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2), n = Math.max(2, Math.ceil(2 * Math.hypot(p2[0] - p1[0], p2[1] - p1[1])));
    for (let k = 0; k <= n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const c = (a, b, c_, d) => 0.5 * (2 * b + (-a + c_) * t + (2 * a - 5 * b + 4 * c_ - d) * t2 + (-a + 3 * b - 3 * c_ + d) * t3);
      const x = Math.round(c(p0[0], p1[0], p2[0], p3[0])), y = Math.round(c(p0[1], p1[1], p2[1], p3[1]));
      if (x >= 0 && y >= 0 && x < w && y < h) bin[y * w + x] = 1;
    }
  }
}
function polyFill(w, h, pts) {   // 多边形内部（扫描线，奇偶规则）
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const xs = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y)) xs.push(xi + (y - yi) / (yj - yi) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(w - 1, Math.floor(xs[k + 1])); x++) m[y * w + x] = 1;
  }
  return m;
}
function discs(w, h, pts, r) {
  const m = new Uint8Array(w * h), r2 = r * r;
  for (const [cx, cy] of pts) for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) m[y * w + x] = 1;
  return m;
}

function lmLines(bin, w, h, fw, lm, inner, hairW, skinW, hgt, accW) {
  const N = w * h;
  // 1) 头发：碎线全去掉，换成发际线 + 顺发流的长线
  const hair = new Uint8Array(N); let nh = 0;
  for (let i = 0; i < N; i++) if (inner[i] && hairW[i] > 0.5) { hair[i] = 1; nh++; }
  if (nh > 0.02 * fw * fw) {
    for (let i = 0; i < N; i++) if (hair[i]) bin[i] = 0;
    hairFlow(bin, w, h, fw, hair, hgt);
    // 发际线：头发挨着脸上皮肤的那条边
    const hl = new Uint8Array(N);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x; if (!hair[i]) continue;
      if (skinW[i - 1] > 0.5 && !hair[i - 1] || skinW[i + 1] > 0.5 && !hair[i + 1] || skinW[i - w] > 0.5 && !hair[i - w] || skinW[i + w] > 0.5 && !hair[i + w]) hl[i] = 1;
    }
    dropSmall(hl, w, h, Math.max(12, 0.15 * fw));
    for (let i = 0; i < N; i++) if (hl[i]) bin[i] = 1;
  }
  if (!lm || !lm.length) return;
  for (const flat of lm) {
    const p = (k) => [flat[2 * k], flat[2 * k + 1]];
    const f = Math.hypot(flat[2 * 454] - flat[2 * 234], flat[2 * 454 + 1] - flat[2 * 234 + 1]) || fw;   // 这张脸自己的宽
    // 2) 脸内部：只留鼻子附近的几何线（个人的鼻形），颊、额、眼下、法令纹的线不刻（显老）
    const oval = polyFill(w, h, OVAL.map(p)), nose = discs(w, h, BRIDGE.map(p), 0.05 * f);
    const ovIn = blurIn(oval, w, h, 0.03 * f), fb = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (ovIn[i] && accW[i] < 0.3) { if (!nose[i]) bin[i] = 0; else fb[i] = bin[i]; }   // 眼镜（配饰）上的线照留
    const keep = Uint8Array.from(fb); dropSmall(keep, w, h, Math.max(10, 0.06 * f));   // 鼻梁上只留成段的线
    for (let i = 0; i < N; i++) if (fb[i] && !keep[i]) bin[i] = 0;
    for (const wg of NOSE_W) drawSpline(bin, w, h, wg.map(p));
    drawSpline(bin, w, h, NOSE_B.map(p));
    // 3) 五官按关键点：眉（上下沿的中线）、眼（上下睑）、嘴（缝或张口的内唇线 + 上唇峰 + 下唇一段弧）
    for (let s = 0; s < 2; s++) {
      drawSpline(bin, w, h, BROW_U[s].map((k, j) => { const a = p(k), b = p(BROW_L[s][j]); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }));
      drawSpline(bin, w, h, EYE_U[s].map(p)); drawSpline(bin, w, h, EYE_D[s].map(p));
    }
    const gap = Math.hypot(flat[2 * 13] - flat[2 * 14], flat[2 * 13 + 1] - flat[2 * 14 + 1]), open = gap > 0.035 * f;
    if (gap > 0.07 * f) {   // 张大嘴笑：开口上下沿都刻，里面一道上齿下沿（只取中间六成），不然大笑成了抿嘴
      drawSpline(bin, w, h, LIP_IU.map(p)); drawSpline(bin, w, h, LIP_ID.map(p));
      drawSpline(bin, w, h, LIP_IU.slice(2, 9).map((k, j) => { const a = p(k), c = p(LIP_ID.slice(2, 9)[j]); return [a[0] + 0.38 * (c[0] - a[0]), a[1] + 0.38 * (c[1] - a[1])]; }));
    } else if (open) drawSpline(bin, w, h, LIP_ID.map(p));   // 微张的笑：画开口的下沿（嘴角上翘的 U），上沿是拱形、单画像撇嘴
    else drawSpline(bin, w, h, LIP_IU.map((k, j) => { const a = p(k), b = p(LIP_ID[j]); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }));
    drawSpline(bin, w, h, LIP_OD.map(p));   // 下唇一段弧；上唇峰不画（和鼻底连起来像胡子）
    // 眼镜（配饰）：脸框外扩 15% 里，配饰区域的内外轮廓刻成双线（11-11 评审：t09 的眼镜框成了第二道眉毛）
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    for (let k = 0; k < 478; k++) { bx0 = Math.min(bx0, flat[2 * k]); bx1 = Math.max(bx1, flat[2 * k]); by0 = Math.min(by0, flat[2 * k + 1]); by1 = Math.max(by1, flat[2 * k + 1]); }
    const ex = 0.15 * (bx1 - bx0), ey = 0.15 * (by1 - by0);
    const X0 = Math.max(1, Math.floor(bx0 - ex)), X1 = Math.min(w - 2, Math.ceil(bx1 + ex)), Y0 = Math.max(1, Math.floor(by0 - ey)), Y1 = Math.min(h - 2, Math.ceil(by1 + ey));
    const gl = new Uint8Array(N); let ng = 0;
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
      const i = y * w + x; if (accW[i] <= 0.5) continue;
      if (accW[i - 1] <= 0.5 || accW[i + 1] <= 0.5 || accW[i - w] <= 0.5 || accW[i + w] <= 0.5) { gl[i] = 1; ng++; }
    }
    if (ng > 0.3 * f) { dropSmall(gl, w, h, Math.max(10, 0.08 * f)); for (let i = 0; i < N; i++) if (gl[i]) bin[i] = 1; }
  }
}
function blurIn(m, w, h, r) {   // 往里缩 r（二值图模糊后取 > 0.95）
  const f = new Float32Array(m.length); for (let i = 0; i < m.length; i++) f[i] = m[i];
  const b = blur(f, w, h, r / 2), o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = b[i] > 0.95 ? 1 : 0; return o;
}

// 发流：高度的结构张量（ρ = 0.025 脸宽）给出每点发丝方向（梯度的垂直方向）；等间距流线（Jobard–Lefer 1997）：
// 网格撒种子，两头沿方向场走，离已有的线太近、出了头发、转弯太急就停；短于 0.12 脸宽的不要。
function hairFlow(bin, w, h, fw, hair, hgt) {
  const N = w * h, gx = new Float32Array(N), gy = new Float32Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    gx[i] = (hgt[y * w + Math.min(w - 1, x + 1)] - hgt[y * w + Math.max(0, x - 1)]) / 2;
    gy[i] = (hgt[Math.min(h - 1, y + 1) * w + x] - hgt[Math.max(0, y - 1) * w + x]) / 2;
  }
  const a = new Float32Array(N), b = new Float32Array(N), c = new Float32Array(N);
  for (let i = 0; i < N; i++) { a[i] = gx[i] * gx[i]; b[i] = gx[i] * gy[i]; c[i] = gy[i] * gy[i]; }
  const rho = Math.max(2, 0.025 * fw), A = blur(a, w, h, rho), B = blur(b, w, h, rho), C = blur(c, w, h, rho);
  const dx = new Float32Array(N), dy = new Float32Array(N);
  const coh = new Float32Array(N);   // 方向一致度（λ1−λ2)/(λ1+λ2)：直发、梳过的头发高，卷发低
  for (let i = 0; i < N; i++) { const th = 0.5 * Math.atan2(2 * B[i], A[i] - C[i]) + Math.PI / 2; dx[i] = Math.cos(th); dy[i] = Math.sin(th); const tr = A[i] + C[i], df = Math.sqrt((A[i] - C[i]) ** 2 + 4 * B[i] * B[i]); coh[i] = tr > 1e-6 ? df / tr : 0; }
  let cs = 0, cn = 0; for (let i = 0; i < N; i += 3) if (hair[i]) { cs += coh[i]; cn++; }
  const curly = cn ? Math.min(1, Math.max(0, (0.70 - cs / cn) / 0.12)) : 0;   // 这一头头发整体多卷（0 直 … 1 卷）：实测直发、梳过的 0.69–0.82，卷发 0.57–0.59
  const dsep = Math.max(4, (0.05 - 0.015 * curly) * fw), dtest = 0.5 * dsep, maxL = (0.7 - 0.55 * curly) * fw, minL = (0.12 - 0.07 * curly) * fw;   // 卷发：短弧、密一点
  const occ = new Uint8Array(N);
  const stamp = (x, y, r) => { for (let yy = Math.max(0, Math.floor(y - r)); yy <= Math.min(h - 1, Math.ceil(y + r)); yy++) for (let xx = Math.max(0, Math.floor(x - r)); xx <= Math.min(w - 1, Math.ceil(x + r)); xx++) if ((xx - x) ** 2 + (yy - y) ** 2 <= r * r) occ[yy * w + xx] = 1; };
  const trace = (x0, y0, sx, sy) => {
    const pts = []; let x = x0, y = y0, px = sx, py = sy;
    for (let s = 0; s < maxL; s++) {
      const i = Math.round(y) * w + Math.round(x);
      if (x < 1 || y < 1 || x > w - 2 || y > h - 2 || !hair[i] || (s > 2 && occ[i])) break;
      let vx = dx[i], vy = dy[i]; if (vx * px + vy * py < 0) { vx = -vx; vy = -vy; }
      if (s > 0 && vx * px + vy * py < 0.7 - 0.25 * curly) break;   // 一步转太急就停（卷发容许弯一点）
      x += vx; y += vy; px = vx; py = vy; pts.push([x, y]);
    }
    return pts;
  };
  for (let gy0 = dsep / 2; gy0 < h; gy0 += dsep) for (let gx0 = dsep / 2; gx0 < w; gx0 += dsep) {
    const i = Math.round(gy0) * w + Math.round(gx0); if (!hair[i] || occ[i]) continue;
    const f1 = trace(gx0, gy0, dx[i], dy[i]), f2 = trace(gx0, gy0, -dx[i], -dy[i]);
    const line = f2.reverse().concat([[gx0, gy0]], f1);
    if (line.length < minL) continue;
    const sm = [];   // 轻轻抹顺（发丝是弧线，不要抖）
    for (let k = 0; k < line.length; k += 3) sm.push(line[k]);
    drawSpline(bin, w, h, sm);
    for (let k = 0; k < line.length; k += 2) stamp(line[k][0], line[k][1], dtest);
  }
}
