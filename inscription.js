// 题记碑与题名（方案 C9、4.3(8)）：
//   extendRelief：高度图向右扩出一块地子，刻一块凹进去的碑面（第 11 窟太和七年造像记就是刻在壁面上凹进去的长方框里）
//   carveText：用字体出字形 → 字形内部的距离变换 → V 形刻槽（预刻“太和七年”；没有平板时也用它刻名字）
//   carveStrokes：观众的笔迹 → Catmull–Rom 插值、等弧长重采样 → 笔压定深浅、刀口角定宽窄的 V 形槽，起收笔方头
// 刻槽存三样：深（像素）、半宽（像素）、石粉（刻字动画时刚刻出的槽里那层，0..1）。风化时按半宽定波长 ℓ = 2w，深度按 exp(−2π²σ²/ℓ²) 衰减：细浅的先没，重笔留得久。

// 碑的位置（相对浮雕高度 H）
export function steleLayout(w, h) {
  const H = h, gap = Math.round(0.05 * H), pw = Math.round(0.24 * H), ph = Math.round(0.58 * H), margin = Math.round(0.07 * H);
  const x0 = w + gap, y0 = Math.round(0.30 * H);
  return { w2: x0 + pw + margin, x0, y0, x1: x0 + pw, y1: y0 + ph,
    // 题名区：碑面左半；“太和七年”在右边一行
    name: { x0: x0 + Math.round(0.08 * pw), y0: y0 + Math.round(0.06 * ph), x1: x0 + Math.round(0.56 * pw), y1: y0 + Math.round(0.94 * ph) },
    era: { x0: x0 + Math.round(0.6 * pw), y0: y0 + Math.round(0.06 * ph), x1: x0 + Math.round(0.92 * pw), y1: y0 + Math.round(0.62 * ph) } };
}

// heights：Float32（像素），w × h → 扩宽后的高度（碑面凹 depth 像素，边是 bev 像素宽的斜坡）
export function extendRelief(heights, w, h, L, depth = 3.0, bev = 5) {
  const w2 = L.w2, out = new Float32Array(w2 * h);
  for (let y = 0; y < h; y++) out.set(heights.subarray(y * w, y * w + w), y * w2);
  // 照片右边沿切到人像（肩、胳膊伸出画外）时，扩出来的地子上会立起一道竖崖。按右沿那一列的高度往外收一个四分之一椭圆的圆边，
  // 像浮雕别处的外轮廓一样转下去（横向半径约为高度的 1.6 倍，限 4–0.05H 像素）；行间先平滑一下，免得一行一行参差
  const edge = new Float32Array(h);
  for (let y = 0; y < h; y++) { let m = 0; for (let k = 1; k <= 3; k++) m += heights[y * w + w - k]; edge[y] = m / 3; }
  const sm = new Float32Array(h), r = 6;
  for (let y = 0; y < h; y++) { let a = 0, n = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { a += edge[yy]; n++; } } sm[y] = a / n; }
  for (let y = 0; y < h; y++) {
    const e = Math.min(edge[y], sm[y] * 1.15); if (e < 0.3) continue;
    const Rx = Math.min(0.05 * h, Math.max(4, 1.6 * e));
    for (let x = 0; x < Rx && w + x < w2; x++) { const q = (x + 0.5) / Rx; out[y * w2 + w + x] = Math.max(out[y * w2 + w + x], e * Math.sqrt(Math.max(0, 1 - q * q))); }
  }
  for (let y = L.y0 - bev; y < L.y1 + bev; y++) {
    if (y < 0 || y >= h) continue;
    for (let x = L.x0 - bev; x < L.x1 + bev; x++) {
      const dx = Math.max(L.x0 - x, x - L.x1 + 1, 0), dy = Math.max(L.y0 - y, y - L.y1 + 1, 0);
      const d = Math.max(dx, dy);   // 到碑面框的距离（框外）
      const inside = x >= L.x0 && x < L.x1 && y >= L.y0 && y < L.y1;
      const k = inside ? 1 : Math.max(0, 1 - d / bev);
      out[y * w2 + x] -= depth * k * k * (3 - 2 * k);
    }
  }
  return out;
}

// 区域图（半分辨率 RGBA8）跟着扩宽：右边补 0
export function extendReg(reg, w2) {
  if (!reg) return null;
  const rw2 = Math.ceil(w2 / 2), out = new Uint8Array(rw2 * reg.h * 4);
  for (let y = 0; y < reg.h; y++) out.set(reg.data.subarray(y * reg.w * 4, (y + 1) * reg.w * 4), y * rw2 * 4);
  return { w: rw2, h: reg.h, data: out };
}

// 两遍倒角距离变换（3-4 近似欧氏），mask 内部到边界的距离
function chamfer(mask, w, h) {
  const INF = 1e9, d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!d[i]) continue;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 1);
    if (y > 0) { v = Math.min(v, d[i - w] + 1); if (x > 0) v = Math.min(v, d[i - w - 1] + 1.414); if (x < w - 1) v = Math.min(v, d[i - w + 1] + 1.414); }
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; if (!d[i]) continue;
    let v = d[i];
    if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
    if (y < h - 1) { v = Math.min(v, d[i + w] + 1); if (x < w - 1) v = Math.min(v, d[i + w + 1] + 1.414); if (x > 0) v = Math.min(v, d[i + w - 1] + 1.414); }
    d[i] = v;
  }
  return d;
}

// 竖排文字刻进 rect：每个像素的槽深 = d0 × 到字形边的距离 / 该笔画的半宽（V 形，中线最深）
// ins：Float32Array(w2·h·4)，[深, 半宽, 石粉, 0] 交错；取深的那个
// img：字形模板图（白字黑底，竖排一列；“太和七年”用魏碑字体预先渲染好的 assets/era_taihe.png，各台机器上一样），按比例放进 rect
export function carveText(ins, W, text, rect, { d0 = 3.0, font = '"Weibei SC","STWeibei","Songti SC","STSong","Noto Serif SC",serif', weight = 600, jitter = 0, img = null } = {}) {
  const rw = rect.x1 - rect.x0, rh = rect.y1 - rect.y0, n = [...text].length;
  const size = Math.min(rw * 0.8, rh / n * 0.86);
  const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(rw, rh) : Object.assign(document.createElement("canvas"), { width: rw, height: rh });
  const g = cv.getContext("2d");
  if (img) {
    const s = Math.min(rw / img.width, rh / img.height) * 0.98, dw = img.width * s, dh = img.height * s;
    // 笔画加粗一点（错开几次画）：魏碑字形在这个尺寸下笔画太细，V 槽窄、几百年就风化没了；第 11 窟的太和七年造像记刻得深，到今天还清楚
    const o2 = Math.max(1, 0.014 * rw);
    for (const [ox, oy] of [[0, 0], [-o2, 0], [o2, 0], [0, -o2], [0, o2]]) g.drawImage(img, (rw - dw) / 2 + ox, oy, dw, dh);
  } else {
    g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.font = `${weight} ${Math.round(size)}px ${font}`;
    [...text].forEach((ch, i) => g.fillText(ch, rw / 2, rh / n * (i + 0.5)));
  }
  const px = g.getImageData(0, 0, rw, rh).data, mask = new Uint8Array(rw * rh);
  for (let i = 0; i < rw * rh; i++) mask[i] = (img ? px[4 * i] : px[4 * i + 3]) > 110 ? 1 : 0;
  const dist = chamfer(mask, rw, rh);
  // 每个像素所在笔画的半宽：距离图在邻域里的最大值（灰度膨胀，方窗 r）
  const r = Math.max(2, Math.round(size * 0.06)), hw = new Float32Array(rw * rh), tmp = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) { let m = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < rw) m = Math.max(m, dist[y * rw + xx]); } tmp[y * rw + x] = m; }
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) { let m = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < rh) m = Math.max(m, tmp[yy * rw + x]); } hw[y * rw + x] = m; }
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const i = y * rw + x; if (!mask[i]) continue;
    const w = Math.max(hw[i], 1), dd = d0 * (0.8 + 0.4 * (jitter ? Math.sin(x * 0.05 + y * 0.031) * 0.5 + 0.5 : 0.5)) * Math.min(1, dist[i] / w);
    const j = ((rect.y0 + y) * W + rect.x0 + x) * 4;
    if (dd > ins[j]) { ins[j] = dd; ins[j + 1] = w; }
  }
}

// Catmull–Rom 插值（过每个采样点）+ 等弧长重采样（间距 step 像素）
function resample(pts, step) {
  if (pts.length < 2) return pts.slice();
  const dense = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, pts.length - 1)];
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), m = Math.max(2, Math.ceil(segLen / (step * 0.5)));
    for (let k = 0; k < m; k++) {
      const t = k / m, t2 = t * t, t3 = t2 * t;
      const c = (a, b, cc, d) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      dense.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1]), p1[2] + (p2[2] - p1[2]) * t]);
    }
  }
  dense.push(pts[pts.length - 1]);
  const out = [dense[0]]; let acc = 0;
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1], b = dense[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    acc += l;
    while (acc >= step) { acc -= step; const t = 1 - acc / Math.max(l, 1e-6); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
  }
  if (out.length === 1 || Math.hypot(out[out.length - 1][0] - dense[dense.length - 1][0], out[out.length - 1][1] - dense[dense.length - 1][1]) > 0.3) out.push(dense[dense.length - 1]);
  return out;
}

// 一维值噪声（槽边宽窄的微小起伏用）
function noise1(x, seed) {
  const h = (n) => { let t = Math.imul((n | 0) ^ seed, 0x27d4eb2d); t ^= t >>> 15; t = Math.imul(t, 0x85ebca6b); t ^= t >>> 13; return (t >>> 0) / 4294967296; };
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

// strokes：[[[u, v, 笔压], ...], ...]，u、v 是题名区里的相对坐标（0..1）。
// 深 d = dmax·p^0.7；刀口角 100°，半宽 w = d·tan(50°)·k；多笔重叠取最深。
// 起笔是一刀斜切进去的尖头（头 18% 长度里半宽从 0.35 涨到 1），收笔方头（末段不越过端点）——刀刻的魏碑笔画就是这个样子。
// 槽边：半宽沿笔画有 ±6% 的起伏；槽口两侧按蓝噪声间距（沿笔 1.4–2.6 倍半宽一个）随机崩掉一小块（方案 C9 “槽边崩口”）。
//
// 刻字过程（动画）：按书写顺序一笔一笔刻。每一笔凿 n 下（按笔画长短 2–7 下），每下刀头往前推一格（L/n 像素，40 毫秒推到）；
// 头一两笔刻得慢（每秒 3.5 下，看得清怎么刻），后面加快（最快每秒 11 下），笔与笔之间抬刀挪过去停 0.1 秒。
// 每个像素记它属于哪一笔（k）和在那一笔中线上的位置（弧长 s）；刀头在第 k 笔走到 H 时，这个像素的深度是 V 形槽前端的斜面：
//   D = s − H（还差多少到刀头），depth = g − (√(r² + D²) − r)/tanθ，r = w − g·tanθ（它到中线的距离，由 g、w 反推）。
// 交叉处一个像素可能先被前一笔刻浅、后一笔刻深，所以记两层：最先刻到它的那一笔、最深的那一笔，取两层的大者。
export function planStrokes(strokes, rect, { dmax = 5.2, k = 1.3, chips = true, seed = 7, step = 15, fmin = 3.5, fmax = 11, maxT = 12, gap = 0.1 } = {}) {
  const rw = rect.x1 - rect.x0, rh = rect.y1 - rect.y0, tanH = Math.tan(50 * Math.PI / 180) * k;
  const wmax = dmax * tanH * 1.08 + 2;
  const bx0 = Math.floor(rect.x0 - wmax), by0 = Math.floor(rect.y0 - wmax);
  const bw = Math.ceil(rw + 2 * wmax) + 1, bh = Math.ceil(rh + 2 * wmax) + 1, N = bw * bh;
  // 1 插值、重采样，每一笔凿几下
  const S = [];
  for (const s of strokes) {
    const pts = resample(s.map(([u, v, p]) => [rect.x0 + u * rw, rect.y0 + v * rh, p ?? 0.5]), 0.6);
    if (pts.length < 2) continue;
    let L = 0; const arc = [0];
    for (let i = 1; i < pts.length; i++) { L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); arc.push(L); }
    S.push({ pts, arc, L, n: Math.min(7, Math.max(2, Math.round(L / step))) });
  }
  // 2 定节奏：前三笔从 fmin 涨到 f1；f1 取能让总时长不超过 maxT 的值（不超过 fmax，不低于 7）
  const tot = (f1) => S.reduce((a, st, i) => a + st.n / (fmin + (f1 - fmin) * Math.min(1, i / 3)) + gap, 0);
  let f1 = 7; while (f1 < fmax && tot(f1) > maxT) f1 += 0.25;
  // 笔画很多（三四个字、几十笔）时每笔少凿几下、抬刀停得短一点，总时长封顶（现场一个名字刻 15 秒以内）
  while (tot(f1) > maxT + 2 && S.some((st) => st.n > 1)) { for (const st of S) st.n = Math.max(1, st.n - 1); gap = Math.max(0.05, gap * 0.85); }
  let t = 0;
  S.forEach((st, i) => {
    st.f = fmin + (f1 - fmin) * Math.min(1, i / 3);
    if (i === S.length - 1) { st.f = Math.min(st.f, 3.0); st.n = Math.max(st.n, 3); }   // 最后一笔放慢，最后一下重一点
    st.a = t; st.b = t + st.n / st.f; t = st.b + gap;
  });
  const total = Math.max(0, t - gap);
  // 3 光栅化：每一笔先在临时层里取本笔最深（和它的弧长位置），一笔画完再并进两层
  const g1 = new Float32Array(N), w1 = new Float32Array(N), k1 = new Int16Array(N).fill(-1), s1 = new Float32Array(N);
  const g2 = new Float32Array(N), w2 = new Float32Array(N), k2 = new Int16Array(N).fill(-1), s2 = new Float32Array(N);
  const gT = new Float32Array(N), wT = new Float32Array(N), sT = new Float32Array(N), stamp = new Int32Array(N).fill(-1);
  const R = rng(seed);
  S.forEach((st, si) => {
    const touched = [], pts = st.pts, nSeg = pts.length - 1;
    const put = (x, y, g, w, sa) => {
      if (x < bx0 || y < by0 || x >= bx0 + bw || y >= by0 + bh) return;
      const j = (y - by0) * bw + (x - bx0);
      if (stamp[j] !== si) { stamp[j] = si; gT[j] = 0; touched.push(j); }
      if (g > gT[j]) { gT[j] = g; wT[j] = w; sT[j] = sa; }
    };
    const wj = (sa) => (1 + 0.12 * (noise1(sa / 9, seed * 31 + si) - 0.5)) * (0.35 + 0.65 * Math.min(1, sa / Math.max(0.18 * st.L, 1)) ** 0.8);   // 槽边起伏 × 入刀尖头
    for (let i = 0; i < nSeg; i++) {
      const A = pts[i], B = pts[i + 1];
      const dA = dmax * Math.pow(Math.max(A[2], 0.05), 0.7), dB = dmax * Math.pow(Math.max(B[2], 0.05), 0.7);
      const fA = wj(st.arc[i]), fB = wj(st.arc[i + 1]);
      const wA = dA * tanH * fA, wB = dB * tanH * fB, wm = Math.max(wA, wB);
      const x0 = Math.floor(Math.min(A[0], B[0]) - wm - 1), x1 = Math.ceil(Math.max(A[0], B[0]) + wm + 1);
      const y0 = Math.floor(Math.min(A[1], B[1]) - wm - 1), y1 = Math.ceil(Math.max(A[1], B[1]) + wm + 1);
      const ex = B[0] - A[0], ey = B[1] - A[1], L2 = Math.max(ex * ex + ey * ey, 1e-6);
      const first = i === 0, last = i === nSeg - 1;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        let tt = ((x - A[0]) * ex + (y - A[1]) * ey) / L2;
        if ((first && tt < 0) || (last && tt > 1)) continue;   // 起笔、收笔不往外圆出去
        tt = Math.min(1, Math.max(0, tt));
        const r = Math.hypot(A[0] + ex * tt - x, A[1] + ey * tt - y);
        const w = wA + (wB - wA) * tt; if (r >= w) continue;
        const d = (dA + (dB - dA) * tt) * Math.min(1, 0.55 + 0.45 * (fA + (fB - fA) * tt));   // 入刀那一截也浅一点
        put(x, y, d * (1 - r / w), w, st.arc[i] + (st.arc[i + 1] - st.arc[i]) * tt);
      }
    }
    // 槽边崩口：沿笔画按蓝噪声间距取点，两侧各自随机崩一小块（浅勺形，深 0.3–0.5 倍槽深，半径 0.3–0.55 倍半宽）
    if (chips && st.L > 6) {
      let sa = (0.5 + R()) * 4, i = 0;
      while (sa < st.L - 2) {
        while (i < nSeg - 1 && st.arc[i + 1] < sa) i++;
        const A = pts[i], B = pts[i + 1], f = (sa - st.arc[i]) / Math.max(st.arc[i + 1] - st.arc[i], 1e-6);
        const px = A[0] + (B[0] - A[0]) * f, py = A[1] + (B[1] - A[1]) * f, pp = A[2] + (B[2] - A[2]) * f;
        const d = dmax * Math.pow(Math.max(pp, 0.05), 0.7), w = d * tanH * wj(sa);
        const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, nx = -(B[1] - A[1]) / L, ny = (B[0] - A[0]) / L;
        for (const side of [-1, 1]) {
          if (R() > 0.42) continue;
          const rc = w * (0.3 + 0.25 * R()), dc = d * (0.3 + 0.2 * R()), off = w * (0.8 + 0.15 * R());
          const cx = px + side * nx * off + (R() - 0.5) * rc, cy = py + side * ny * off + (R() - 0.5) * rc;
          for (let y = Math.floor(cy - rc); y <= Math.ceil(cy + rc); y++) for (let x = Math.floor(cx - rc); x <= Math.ceil(cx + rc); x++) {
            const q = Math.hypot(x - cx, y - cy) / rc; if (q >= 1) continue;
            put(x, y, dc * Math.pow(1 - q, 1.3), rc, sa);
          }
        }
        sa += w * (1.4 + 1.2 * R());
      }
    }
    for (const j of touched) {
      if (k1[j] < 0) { g1[j] = gT[j]; w1[j] = wT[j]; k1[j] = si; s1[j] = sT[j]; }      // 最先刻到它的那一笔
      if (gT[j] > g2[j]) { g2[j] = gT[j]; w2[j] = wT[j]; k2[j] = si; s2[j] = sT[j]; }   // 最深的那一笔
    }
  });
  const path = S.map((st) => ({ a: st.a, b: st.b, n: st.n, f: st.f, L: st.L, pts: st.pts, arc: st.arc }));
  return { bx0, by0, bw, bh, g1, w1, k1, s1, g2, w2, k2, s2, tanH, dmax, total, path };
}

// 刻完的样子写进 ins（[深, 半宽, 石粉, 帧代码] 交错，宽 W）：两层取深的
export function carveStrokes(ins, W, strokes, rect, opt) {
  const P = opt && opt.plan ? opt.plan : planStrokes(strokes, rect, opt);
  for (let y = 0; y < P.bh; y++) for (let x = 0; x < P.bw; x++) {
    const i = y * P.bw + x, X = P.bx0 + x, Y = P.by0 + y; if (X < 0 || X >= W || Y < 0) continue;
    const g = Math.max(P.g1[i], P.g2[i]); if (!(g > 0)) continue;
    const j = (Y * W + X) * 4;
    if (g > ins[j]) { ins[j] = g; ins[j + 1] = P.g2[i] >= P.g1[i] ? P.w2[i] : P.w1[i]; }
  }
  return P;
}

// 刀头在第几笔、走到哪：每一笔第 q 下在 a + q/f 落刀，40 毫秒里把槽往前推一格（L/n）。返回每一笔的 H（弧长），
// 和当前刀头的状态 { k 第几笔, q 第几下, since 离这一下落刀多久, x, y, dx, dy 刀走的方向, lift 抬刀挪向下一笔 }
function strokePos(st, sa) {
  let i = 1; while (i < st.arc.length - 1 && st.arc[i] < sa) i++;
  const A = st.pts[i - 1], B = st.pts[i], f = Math.min(1, Math.max(0, (sa - st.arc[i - 1]) / Math.max(st.arc[i] - st.arc[i - 1], 1e-6)));
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
  return [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, (B[0] - A[0]) / L, (B[1] - A[1]) / L];
}
export function headState(P, t) {
  const H = new Float32Array(P.path.length);
  let cur = null;
  P.path.forEach((st, i) => {
    if (t < st.a) { H[i] = -1e9; return; }
    if (t >= st.b) { H[i] = 1e9; return; }
    const u = (t - st.a) * st.f, q = Math.min(st.n - 1, Math.floor(u)), since = (u - q) / st.f;
    const e = Math.min(1, since / 0.04), ee = 1 - (1 - e) ** 2;
    H[i] = st.L * (q + ee) / st.n;
    const [x, y, dx, dy] = strokePos(st, Math.min(st.L, H[i]));
    cur = { k: i, q, since, x, y, dx, dy, lift: 0 };
  });
  if (!cur) {   // 两笔之间：刀抬起来从上一笔末端挪到下一笔起点
    const nx = P.path.findIndex((st) => st.a > t);
    if (nx < 0 && P.path.length && t < P.total + 0.35) {   // 最后一笔刻完：刀抬起来离开
      const pv = P.path[P.path.length - 1], [x, y, dx, dy] = strokePos(pv, pv.L);
      cur = { k: -1, q: -1, since: 9, x, y, dx, dy, lift: Math.min(1, (t - pv.b) / 0.35), leave: true };
    } else if (nx > 0 && t < P.total) {
      const pv = P.path[nx - 1], st = P.path[nx], g = Math.min(1, (t - pv.b) / Math.max(st.a - pv.b, 1e-3)), e = g * g * (3 - 2 * g);
      const [x0, y0, dx0, dy0] = strokePos(pv, pv.L), [x1, y1, dx1, dy1] = strokePos(st, 0);
      cur = { k: -1, q: -1, since: 9, x: x0 + (x1 - x0) * e, y: y0 + (y1 - y0) * e, dx: dx0 + (dx1 - dx0) * e, dy: dy0 + (dy1 - dy0) * e, lift: Math.sin(Math.PI * g) };
    }
  }
  return { H, cur };
}

// 刻到第 t 秒的样子：填 out（题名区包围盒，bw × bh × 4：深、半宽、石粉、帧代码）。base：这块里原有的 [深, 半宽, 帧代码]。
// 石粉：只沉在槽底（中线附近），刚凿出来最多（0.4），1.5 秒里慢慢淡；blow（0..1）：刻完以后吹掉
export function insFrame(P, t, H, out, base, blow) {
  const { bw, bh, g1, w1, k1, s1, g2, w2, k2, s2, tanH, path } = P, n = bw * bh;
  const lay = (g, w, k, s) => {
    if (!(g > 0) || k < 0) return 0;
    const h = H[k]; if (h <= -1e8) return 0;
    if (s <= h) return g;
    const r = Math.max(0, w - g * tanH), D = s - h;
    return Math.max(0, g - (Math.sqrt(r * r + D * D) - r) / tanH);
  };
  for (let i = 0; i < n; i++) {
    const a = lay(g1[i], w1[i], k1[i], s1[i]), b = lay(g2[i], w2[i], k2[i], s2[i]);
    const d = Math.max(a, b), j = 4 * i;
    const bd = base ? base[3 * i] : 0;
    if (bd >= d) { out[j] = bd; out[j + 1] = base[3 * i + 1]; out[j + 2] = 0; }
    else {
      const useB = b >= a, w = useB ? w2[i] : w1[i], k = useB ? k2[i] : k1[i], s = useB ? s2[i] : s1[i], g = useB ? g2[i] : g1[i];
      out[j] = d; out[j + 1] = w;
      // 这一处是第几下凿出来的、凿了多久
      const st = path[k], q = Math.min(st.n - 1, Math.floor(s / st.L * st.n)), tc = st.a + q / st.f;
      const centre = 1 - Math.max(0, w - g * tanH) / w;
      const late = k >= path.length - 4, keep = late ? 1 : Math.exp(-(t - tc) / 2.5);   // 最后几笔的石粉留到吹的时候
      out[j + 2] = d > 0.3 && t >= tc ? (late ? 0.65 : 0.42) * Math.min(1, (centre - 0.25) / 0.45) * keep * (1 - blow) : 0;
      if (out[j + 2] < 0) out[j + 2] = 0;
    }
    out[j + 3] = base ? base[3 * i + 2] : 0;
  }
}

// 凿击事件（石粉、碎石、凿击声用）：到 t 为止的每一下 { t, x, y, dx, dy（刀走的方向）, k, q, first（一笔的第一下）, id }；
// win：只要最近 win 秒的（不给就全部）
export function strikes(P, t, win = 0) {
  const out = [];
  P.path.forEach((st, k) => {
    for (let q = 0; q < st.n; q++) {
      const ts = st.a + q / st.f; if (ts > t) break; if (win && ts < t - win) continue;
      const [x, y, dx, dy] = strokePos(st, st.L * (q + 1) / st.n);
      out.push({ t: ts, x, y, dx, dy, k, q, first: q === 0, last: k === P.path.length - 1 && q === st.n - 1, id: k * 16 + q });
    }
  });
  return out;
}
