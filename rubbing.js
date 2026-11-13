// 传拓（方案 F4、4.3(7)）：湿宣纸蒙在石面上，拓包拍墨，墨只上到纸贴着石头高处的地方，刻槽、凹处、像的轮廓根部留白。
//
// 1 纸面贴合：湿纸是石面的平滑版本 p = G_σ * h（纸进不了太细的凹处）
// 2 拓包够得着的地方：拓包是一团软的平面，从上面压下去，能“搭桥”跨过比它窄的凹处——就是灰度闭运算 top = 腐蚀(膨胀(p))
//   （平面和斜坡闭运算后不变，比拓包窄的槽、像的轮廓根部被填平）；纸面比 top 低 d = top − p，越低越碰不到：c = sigmoid((tol − d)/s)
// 3 持水场（Xiang 2025 的宣纸含水不匀）：低频噪声 m，湿处墨洇得开、颜色也略淡
// 4 拍一下：足迹是不规则边缘的平顶团（超高斯 × 边缘噪声），墨量 × 接触 × 纸纤维；再在足迹窗口里按持水场洇几步（扩散）
// 5 显色：Beer–Lambert，透过率 exp(−k·墨)；乌金 k 大、墨色黑亮，蝉翼 k 小、淡灰
// 6 Otsu：类间方差最大的阈值，出黑白二值版（给观照记录、打印）
// 都在 CPU 上，场取浮雕高度的缩小版（长边约 1100 像素），每拍只更新足迹那一小块。

// 高斯模糊（可分离）。σ 小（≤ 3）直接卷积；σ 大用三次盒式模糊近似（Kovesi 2010 的盒宽），每像素的计算量和 σ 无关
function blur1(src, w, h, sig, out) {
  if (sig > 3) return blurBox3(src, w, h, sig, out);
  const r = Math.max(1, Math.ceil(3 * sig)), k = new Float32Array(2 * r + 1); let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sig * sig)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -r; i <= r; i++) a += k[i + r] * src[y * w + Math.min(w - 1, Math.max(0, x + i))]; tmp[y * w + x] = a; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -r; i <= r; i++) a += k[i + r] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x]; out[y * w + x] = a; }
  return out;
}
function boxSizes(sig, n) {   // n 次盒式模糊逼近 σ 的高斯：盒宽取 wl、wl+2 两种
  const wIdeal = Math.sqrt(12 * sig * sig / n + 1); let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2, m = Math.round((12 * sig * sig - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}
function boxLine(src, dst, off, stride, n, r) {   // 一行（或一列）的滑动平均，边上按夹紧取值，和卷积版一致
  const inv = 1 / (2 * r + 1), at = (i) => src[off + Math.min(n - 1, Math.max(0, i)) * stride];
  let acc = 0; for (let i = -r; i <= r; i++) acc += at(i);
  for (let i = 0; i < n; i++) { dst[off + i * stride] = acc * inv; acc += at(i + r + 1) - at(i - r); }
}
function blurBox3(src, w, h, sig, out) {
  let a = Float32Array.from(src), b = new Float32Array(w * h);
  for (const bw of boxSizes(sig, 3)) {
    const r = (bw - 1) >> 1;
    for (let y = 0; y < h; y++) boxLine(a, b, y * w, 1, w, r);
    for (let x = 0; x < w; x++) boxLine(b, a, x, w, h, r);
  }
  out.set(a); return out;
}
// 可分离最大 / 最小值滤波（方窗：先横后竖）；sgn = 1 膨胀，-1 腐蚀。van Herk / Gil–Werman：每像素约 3 次比较，和半径无关
function mfilt(src, w, h, r, sgn) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const line = (S, D, off, stride, n, sg) => {   // 两遍前缀 / 后缀最大，窗口 [x − r, x + r]；sg：读进来时乘的符号（只在第一遍取反）
    const ext = n + 2 * r, k = 2 * r + 1, f = new Float32Array(ext), bk = new Float32Array(ext), v = new Float32Array(ext);
    for (let i = 0; i < ext; i++) { const x = i - r; v[i] = x >= 0 && x < n ? sg * S[off + x * stride] : -Infinity; }
    for (let i = 0; i < ext; i++) f[i] = i % k === 0 ? v[i] : Math.max(f[i - 1], v[i]);
    for (let i = ext - 1; i >= 0; i--) bk[i] = (i % k === k - 1 || i === ext - 1) ? v[i] : Math.max(bk[i + 1], v[i]);
    for (let x = 0; x < n; x++) { const a = x, b = x + 2 * r; D[off + x * stride] = Math.max(bk[a], f[b]); }
  };
  for (let y = 0; y < h; y++) line(src, tmp, y * w, 1, w, sgn);
  for (let x = 0; x < w; x++) line(tmp, out, x, w, h, 1);
  if (sgn < 0) for (let i = 0; i < out.length; i++) out[i] = -out[i];
  return out;
}
function hash2(x, y, s) { let t = Math.imul(x * 374761393 + y * 668265263 + s * 2147483647 | 0, 0x27d4eb2d); t ^= t >>> 15; t = Math.imul(t, 0x85ebca6b); t ^= t >>> 13; return (t >>> 0) / 4294967296; }
function vnoise(w, h, cell, seed) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    out[y * w + x] = a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
  }
  return out;
}

// heights：Float32Array（像素单位），w × h（已经缩到场的分辨率）；scale：场像素对应几个浮雕像素（高度也按它缩，坡度不变）
// 两种尺度的“搭桥”：细（r 约 3 像素）的跨过刻字、凿痕、粉化坑——比纸面低 tolS 就留白，边是利的；
// 粗（padR）的跨过像的轮廓根部、龛里深处——越深越淡，渐变，不是一圈等宽的白边
export function makeRubbing(heights, w, h, { tolS = 0.2, sS = 0.08, rS = 2, padR = 10, d0 = 0.6, d1 = 4.0, soft = 0.7, g0 = 0.36, conv = 0.4, seed = 3 } = {}) {
  const p = blur1(heights, w, h, soft, new Float32Array(w * h));
  const topS = mfilt(mfilt(p, w, h, rS, 1), w, h, rS, -1);
  const topL = mfilt(mfilt(p, w, h, padR, 1), w, h, padR, -1);
  const loc = blur1(p, w, h, 3 * padR, new Float32Array(w * h));   // 局部平均面：高于它的是凸处，拓包压得实
  const env = blur1(mfilt(p, w, h, 6 * padR, 1), w, h, 4 * padR, new Float32Array(w * h));   // 很大尺度的包络：比它低得多的（龛里深处）纸压不实，淡一档
  const contact = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const gx = (p[y * w + Math.min(w - 1, x + 1)] - p[y * w + Math.max(0, x - 1)]) / 2, gy = (p[Math.min(h - 1, y + 1) * w + x] - p[Math.max(0, y - 1) * w + x]) / 2;
    const slope = 1 / (1 + (gx * gx + gy * gy) / (g0 * g0));         // 圆面转过去、陡坡上纸悬着，拓包只擦到一点：渐淡
    const cvx = 1 / (1 + Math.exp(-(p[i] - loc[i]) / 1.5));            // 凸处 → 1，凹处 → 0
    const cS = 1 / (1 + Math.exp((topS[i] - p[i] - tolS) / sS));
    const t = Math.min(1, Math.max(0, (topL[i] - p[i] - d0) / (d1 - d0))), cL = 1 - t * t * (3 - 2 * t);
    const deep = Math.min(1, Math.max(0, (env[i] - p[i] - 4) / 24));
    contact[i] = cS * cL * slope * (1 - conv + conv * cvx) * (1 - 0.35 * deep);
  }
  return fromContact(contact, w, h, seed);
}

// 平板上：舞台交来的接触图（0..255 字节）→ 同一张纸（纤维、持水按同一个种子生成，拍同样的墨出来一模一样）
export function fromContactBytes(bytes, w, h, seed = 3) {
  const c = new Float32Array(w * h); for (let i = 0; i < w * h; i++) c[i] = bytes[i] / 255;
  return fromContact(c, w, h, seed);
}
export function contactBytes(T) { const b = new Uint8Array(T.w * T.h); for (let i = 0; i < b.length; i++) b[i] = Math.round(Math.min(1, Math.max(0, T.contact[i])) * 255); return b; }

function fromContact(contact, w, h, seed) {
  // 宣纸：纤维（细长亮暗纹，用两层各向异性的值噪声近似）+ 帘纹（竖向细条）+ 持水场
  const f1 = vnoise(w, h, 2.2, seed), f2 = vnoise(w, h, 7, seed + 1), wet = vnoise(w, h, 90, seed + 2), wet2 = vnoise(w, h, 31, seed + 3);
  const fiber = new Float32Array(w * h), moist = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, chain = 0.5 + 0.5 * Math.sin(x * 0.55 + 2 * f2[i]);
    fiber[i] = 0.78 + 0.16 * f1[i] + 0.1 * f2[i] - 0.05 * chain * chain;
    moist[i] = 0.55 * wet[i] + 0.45 * wet2[i];
  }
  return { w, h, contact, fiber, moist, ink: new Float32Array(w * h), seed, dabs: 0 };
}

// 拍一下：(x, y) 场像素坐标，R 拓包半径（场像素），amt 墨量（0..1，笔压 / 拍的力度）。返回改动的窗口
export function dab(T, x, y, R, amt) {
  const { w, h, contact, fiber, moist, ink } = T; T.dabs++;
  const k = T.dabs * 7.31 + T.seed;
  const x0 = Math.max(0, Math.floor(x - 1.6 * R)), x1 = Math.min(w - 1, Math.ceil(x + 1.6 * R));
  const y0 = Math.max(0, Math.floor(y - 1.6 * R)), y1 = Math.min(h - 1, Math.ceil(y + 1.6 * R));
  if (x1 < x0 || y1 < y0) return null;
  const ww = x1 - x0 + 1, hh = y1 - y0 + 1, dep = new Float32Array(ww * hh);
  const rot = hash2(k | 0, 1, 9) * 6.283, ecc = 0.85 + 0.3 * hash2(k | 0, 2, 9);
  for (let yy = 0; yy < hh; yy++) for (let xx = 0; xx < ww; xx++) {
    const X = x0 + xx, Y = y0 + yy, i = Y * w + X;
    const dx = X - x, dy = Y - y, u = (dx * Math.cos(rot) + dy * Math.sin(rot)) * ecc, v = (-dx * Math.sin(rot) + dy * Math.cos(rot)) / ecc;
    const sz = 0.82 + 0.36 * hash2(k | 0, 3, 9), edge = sz * (1 + 0.08 * (hash2(X >> 2, Y >> 2, k | 0) - 0.5));
    const r2 = (u * u + v * v) / (R * R * edge * edge);
    const foot = Math.exp(-r2 * r2);                            // 近圆的一团，边是软的
    const hs = hash2(X, Y, (k * 3) | 0), speck = hs < 0.4 ? 0.08 : 0.5 + 1.1 * (hs - 0.4);   // 拓包布纹：一团细点，有的点没沾上（中心密、边上稀）
    dep[yy * ww + xx] = amt * foot * speck * contact[i] * fiber[i];
  }
  // 洇：湿处多扩散两步（四邻域平均，权重按持水）
  for (let it = 0; it < 2; it++) for (let yy = 1; yy < hh - 1; yy++) for (let xx = 1; xx < ww - 1; xx++) {
    const j = yy * ww + xx, m = moist[(y0 + yy) * w + x0 + xx] * 0.35 * contact[(y0 + yy) * w + x0 + xx];
    dep[j] = dep[j] * (1 - m) + m * 0.25 * (dep[j - 1] + dep[j + 1] + dep[j - ww] + dep[j + ww]);
  }
  for (let yy = 0; yy < hh; yy++) for (let xx = 0; xx < ww; xx++) ink[(y0 + yy) * w + x0 + xx] += dep[yy * ww + xx];
  return [x0, y0, ww, hh];
}

// 墨色：乌金（黑亮、拍得厚）/ 蝉翼（淡灰、薄而透）。rgba：Uint8ClampedArray(w·h·4)，只画窗口 win（不给就整张）。
// wetPaper：还没揭的湿纸，半透明（底下石头的明暗透上来），揭下来以后不透明；shade：平板上用接触图给纸面一点明暗
const PAPER = [242, 236, 222], INK = { 乌金: { k: 3.4, c: [10, 10, 12] }, 蝉翼: { k: 0.5, c: [80, 80, 86] } };
export function paint(T, rgba, style = "乌金", win = null, wetPaper = true, shade = false) {
  const { w, h, ink, fiber, moist, contact } = T, S = INK[style] || INK.乌金;
  const [x0, y0, ww, hh] = win || [0, 0, w, h];
  for (let y = y0; y < y0 + hh; y++) for (let x = x0; x < x0 + ww; x++) {
    const i = y * w + x, t = Math.exp(-S.k * ink[i] * (1.02 - 0.1 * moist[i]));
    const pf = (0.94 + 0.06 * fiber[i]) * (shade ? 0.86 + 0.14 * contact[i] : 1);   // shade：平板上纸底下没有石头，湿纸贴着的地方略深，看得出像在哪
    for (let c = 0; c < 3; c++) rgba[4 * i + c] = S.c[c] + (PAPER[c] * pf - S.c[c]) * t;
    rgba[4 * i + 3] = wetPaper ? Math.round(255 * (0.8 + 0.2 * (1 - t))) : 255;
  }
}

// Otsu：灰度直方图上类间方差最大的阈值；返回阈值（0..255）
export function otsu(gray) {
  const hist = new Float64Array(256); for (const g of gray) hist[g]++;
  const N = gray.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wB = 0, sB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = N - wB; if (!wF) break;
    sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; th = t; }
  }
  return th;
}

// 自动拍满（录视频、没有平板时的示范）：按蛇形行走 + 抖动，返回拍的序列 [x, y, amt]
// order = "patch"：一片一片拍（3×3 个拓包大的一片，片的先后打乱，片里来回拍），像人手拍墨
export function autoDabs(T, R, passes = 2, seed = 5, order = "rows") {
  const out = []; let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const rows = Math.ceil(T.h / (R * 1.0)), n = Math.ceil(T.w / (R * 0.95));
  for (let p = 0; p < passes; p++) for (let r = 0; r < rows; r++) {
    const y = (r + 0.5 + 0.5 * p) / rows * T.h;
    for (let q = 0; q < n; q++) {
      const xx = ((r % 2 ? n - 1 - q : q) + 0.5 * p) / (n - 1) * T.w;
      const px = xx + (rnd() - 0.5) * R * 0.7, py = y + (rnd() - 0.5) * R * 0.7, edge = Math.min(px, py, T.w - px, T.h - py) / R;
      if (edge < 0.8 && rnd() > 0.35 + 0.4 * Math.max(0, edge)) continue;   // 纸边上拍得少，墨边不齐
      out.push([px, py, 0.14 + 0.12 * rnd()]);
    }
  }
  if (order === "patch") {
    const tile = 3 * R, nx = Math.ceil(T.w / tile), rank = new Map();
    const key = ([x, y]) => Math.floor(y / tile) * nx + Math.floor(x / tile);
    for (const d of out) { const k = key(d); if (!rank.has(k)) rank.set(k, rnd() + 0.35 * Math.hypot(d[0] / T.w - 0.5, d[1] / T.h - 0.45)); }   // 大致从中间往外
    out.forEach((d, i) => { d.push(i); });
    out.sort((p, q) => rank.get(key(p)) - rank.get(key(q)) || p[3] - q[3]);
    out.forEach((d) => d.pop());
  }
  return out;
}

// 揭下来的拓片：宣纸留边，左边一行跋“丙午年 ×× 手拓”（名字用观众在平板上写的笔迹），下面一方朱文印“云冈手拓”。返回 canvas
// strokes：题名笔迹（[[u, v, 压], ...]，u、v 是题名区里的坐标）；没有就只写“丙午年手拓”
export function makeSheet(T, style = "乌金", { strokes = null, nameText = "", long = 1800 } = {}) {
  const rgba = new Uint8ClampedArray(T.w * T.h * 4); paint(T, rgba, style, null, false);
  const src = document.createElement("canvas"); src.width = T.w; src.height = T.h;
  src.getContext("2d").putImageData(new ImageData(rgba, T.w, T.h), 0, 0);
  const s = long / Math.max(T.w, T.h), rw = Math.round(T.w * s), rh = Math.round(T.h * s);
  const mL = Math.round(0.16 * rw + 0.06 * rh), mR = Math.round(0.05 * rw), mT = Math.round(0.06 * rh), mB = Math.round(0.08 * rh);
  const cv = document.createElement("canvas"); cv.width = rw + mL + mR; cv.height = rh + mT + mB;
  const g = cv.getContext("2d");
  // 宣纸底：米白，细纤维
  g.fillStyle = "rgb(242,236,222)"; g.fillRect(0, 0, cv.width, cv.height);
  let sd = 7; const rnd = () => ((sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0) / 4294967296);
  g.lineWidth = 1;
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * cv.width, y = rnd() * cv.height, a = rnd() * Math.PI, L = 4 + rnd() * 20;
    g.strokeStyle = `rgba(150,135,110,${0.05 + 0.08 * rnd()})`; g.beginPath(); g.moveTo(x, y); g.lineTo(x + L * Math.cos(a), y + L * Math.sin(a)); g.stroke();
  }
  g.drawImage(src, mL, mT, rw, rh);
  // 跋：左边留白处竖写
  const colX = mL * 0.62, ink = "rgba(24,22,22,0.88)", fs = Math.round(Math.min(mL * 0.3, rh * 0.042));
  g.fillStyle = ink; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = `600 ${fs}px "Kaiti SC","STKaiti","KaiTi","Weibei SC","Songti SC",serif`;
  let y = mT + fs * 0.8;
  for (const ch of "丙午冬") { g.fillText(ch, colX, y); y += fs * 1.12; }
  if (strokes && strokes.length) {
    // 观众的笔迹：题名区是细长竖条（宽高比约 0.23），缩到跋那一行里
    let u0 = 1, u1 = 0, v0 = 1, v1 = 0;
    for (const st of strokes) for (const [u, v] of st) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const zw = 0.23, bw = (u1 - u0) * zw, bh = v1 - v0, k = Math.min(fs * 1.0 / Math.max(bw, 1e-3), fs * 1.12 * 3 / Math.max(bh, 1e-3));   // 名字和跋的字一样大
    const ox = colX - (u0 + u1) / 2 * zw * k, oy = y + fs * 0.1 - v0 * k;
    g.strokeStyle = ink; g.lineCap = "round"; g.lineJoin = "round";
    for (const st of strokes) for (let i = 1; i < st.length; i++) {
      const [ua, va, pa] = st[i - 1], [ub, vb, pb] = st[i];
      g.lineWidth = Math.max(1, fs * 0.075 * Math.pow(Math.max(0.1, (pa + pb) / 2), 0.7) * 1.4);
      g.beginPath(); g.moveTo(ox + ua * zw * k, oy + va * k); g.lineTo(ox + ub * zw * k, oy + vb * k); g.stroke();
    }
    y = oy + v1 * k + fs * 0.75;
  } else if (nameText) { for (const ch of nameText) { g.fillText(ch, colX, y); y += fs * 1.12; } }
  for (const ch of "手拓") { g.fillText(ch, colX, y); y += fs * 1.12; }
  // 印：白文方印“一刻千年”（右列“一刻”、左列“千年”），红底、字是空的；边不齐、印泥不匀
  const S = Math.round(fs * 2.1), sx = colX - S / 2, sy = Math.min(cv.height - S - mB * 0.3, y + fs * 0.6);
  const seal = document.createElement("canvas"); seal.width = seal.height = S; const q = seal.getContext("2d");
  q.fillStyle = "rgb(176,36,28)"; q.beginPath();
  const jag = (u, v) => [u + (rnd() - 0.5) * S * 0.025, v + (rnd() - 0.5) * S * 0.025];
  [[0, 0], [S * 0.5, 0], [S, 0], [S, S * 0.5], [S, S], [S * 0.5, S], [0, S], [0, S * 0.5]].map(([u, v]) => jag(u, v)).forEach(([u, v], i) => (i ? q.lineTo(u, v) : q.moveTo(u, v)));
  q.closePath(); q.fill();
  q.globalCompositeOperation = "destination-out";
  q.font = `${Math.round(S * 0.42)}px "Weibei SC","Kaiti SC","STKaiti","KaiTi",serif`; q.textAlign = "center"; q.textBaseline = "middle";
  [["一", 0.74, 0.27], ["刻", 0.74, 0.73], ["千", 0.26, 0.27], ["年", 0.26, 0.73]].forEach(([c, u, v]) => q.fillText(c, S * u, S * v));
  for (let i = 0; i < 220; i++) { q.globalAlpha = 0.2 + 0.5 * rnd(); q.beginPath(); q.arc(rnd() * S, rnd() * S, 0.4 + 1.6 * rnd(), 0, 6.283); q.fill(); }
  g.save(); g.globalAlpha = 0.92; g.translate(sx + S / 2, sy + S / 2); g.rotate(-0.02); g.drawImage(seal, -S / 2, -S / 2); g.restore();
  return cv;
}
