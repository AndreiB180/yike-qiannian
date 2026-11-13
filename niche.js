// 龛（方案 C4）：把浮雕放进一座圆拱龛里，龛外右侧壁面上是题记碑（C9）。只作画框：不加头光、背光、莲座，火焰纹只在龛楣上。
//
// 云冈北魏中期的小龛（第 9–13 窟壁面上成排的那种）：
//   龛口是圆拱（两边竖直的龛壁 + 上面半个椭圆），龛内是退进去的平底（就是浮雕原来的地子，带凿痕）；
//   龛楣是沿拱口外面一圈的弧带，顶上厚、两头薄，外沿收成尖拱；楣面上刻一排火焰纹，焰舌从拱口往外放射、尖头往拱顶方向卷；
//   两头的龛尾往外卷成涡卷，落在两根龛柱的柱头上；龛柱是方柱，柱面两道竖线；龛下一道坛基挡住半身像被照片切掉的底边。
// 高度：壁面 Hw ≈ 人像 95 分位高度的 0.85 倍（像的鼻尖、额头比壁面略高，和云冈小龛里的像一样“探出龛口”），龛楣、柱、坛基比壁面再高一点。
//
// 拱的大小按人像算：在照片里找人像（高度 > 2 像素），从低往高试拱脚线 ys，要求拱脚线以上的人像全在拱里（留 6% 余量），
// 拱的竖半轴 b 在 0.78a–1.0a 之间（a = 龛口半宽），拱顶超出照片就往上扩画布。

const gs = (x) => Math.exp(-x * x);
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 帧代码（写进刻槽纹理的第 4 个通道，着色器按它区分像和建筑）：0 龛内（像、龛底），1 壁面，2 龛沿（柱、坛基、楣的内外沿、龛尾），3 楣面，4 火焰
export const FRAME = { IN: 0, WALL: 1, RIM: 2, BAND: 3, FLAME: 4 };

// faces：脸框 [[x0, y0, x1, y1], ...]（作品 json 里有就用）。龛按脸定比例，人像去适应龛：
//   龛口宽 = 两边最外的脸再各留 1.25 个脸宽（单人约 3.5 个脸宽，肩膀可以藏到柱子后面），龛口居中对着脸；
//   近半圆拱（b = 0.9a），头顶到拱顶留 0.45 个头高（云冈龛里头顶到拱顶至少半个头高；拱压着头就成了火焰头光，或者像遗像）。
//   没有脸（只有身子的作品）就退回按人像轮廓找拱。
export function nicheLayout(heights, w, h, { stele = true, faces = null } = {}) {
  const vals = [];
  const col = new Int32Array(w).fill(h);   // 每一列人像最高点
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = heights[y * w + x]; if (v > 2) { if (col[x] === h) col[x] = y; if ((x + y) % 3 === 0) vals.push(v); } }
  vals.sort((p, q) => p - q);
  const hf = vals.length ? vals[Math.floor(vals.length * 0.95)] : 30;
  const Hw = 1.0 * hf;   // 壁面：和人像的大部分一样高，人像在龛里，只有鼻尖、额头探到龛口
  let a, cx, b, ys, fwL = 0.25 * w, headOnly = false;
  if (faces && faces.length) {
    const fx0 = Math.min(...faces.map((f) => f[0])), fx1 = Math.max(...faces.map((f) => f[2]));
    const fws = faces.map((f) => f[2] - f[0]).sort((p, q) => p - q), fw = fws[fws.length >> 1];
    let bw = 0; for (let x = 0; x < w; x++) for (let y = Math.floor(0.9 * h); y < h; y++) if (heights[y * w + x] > 2) { bw++; break; }
    headOnly = faces.length === 1 && bw < 1.8 * fw;
    a = headOnly ? 1.3 * fw : Math.max(1.6 * fw, (fx1 - fx0) / 2 + 1.25 * fw);   // 照片窄也不卡窄龛口：照片外面是龛里的地子，切边渐隐
    cx = (fx0 + fx1) / 2; fwL = fw;
    b = 0.9 * a;
    // 头顶：脸框上方那几列人像的最高点；头高 = 下巴到头顶
    let top = h, chin = 0;
    for (const f of faces) { for (let x = Math.max(0, Math.floor(f[0])); x < Math.min(w, Math.ceil(f[2])); x++) top = Math.min(top, col[x]); chin = Math.max(chin, f[3]); }
    if (top >= h) top = Math.min(...faces.map((f) => f[1])) - 0.4 * (faces[0][3] - faces[0][1]);
    const headH = Math.max(chin - top, 10);
    let archTop = top - 0.45 * headH;
    ys = archTop + b;
    // 合影：两边的头也要在拱里（头顶和脸侧留 6%），放不下就把拱抬高
    for (let it = 0; it < 40; it++) {
      let ok = true;
      for (const f of faces) for (const [px, py] of [[f[0] - 0.15 * fw, f[1]], [f[2] + 0.15 * fw, f[1]], [(f[0] + f[2]) / 2, f[1] - 0.45 * (f[3] - f[1])]]) {
        if (py >= ys) continue;
        const u = (px - cx) / a, v = (ys - py) / b; if (u * u + v * v > 0.94 * 0.94) ok = false;
      }
      if (ok) break; archTop -= 0.03 * headH; ys = archTop + b;
    }
  } else {
    // 没有脸：从低往高试拱脚线，拱脚线以上的人像全在拱里（留 6%），挑拱顶最低的
    const jin = Math.round(0.05 * w); a = (w - 2 * jin) / 2; cx = w / 2; b = 0.9 * a; ys = Math.round(0.3 * h);
    let bestTop = -1e9;
    for (let yt = Math.round(0.85 * h); yt > -h; yt -= 4) {
      let need = 0, ok = true;
      for (let x = 0; x < w; x++) {
        if (col[x] >= yt) continue;
        const u = Math.abs(x - cx) / a; if (u >= 0.94) { ok = false; break; }
        need = Math.max(need, (yt - col[x]) / Math.sqrt(0.94 * 0.94 - u * u));
      }
      if (!ok || need > b) continue;
      const topY = yt - b; if (topY > bestTop) { bestTop = topY; ys = yt; }
    }
  }
  // 照片左右边沿切到人像（肩膀被画框切断）：龛口不越过那条边，切口藏在龛柱后面
  const floorP = h - Math.round((headOnly ? 0.07 : 0.03) * h);   // 坛基顶面（照片坐标）：只有头颈时抬高一点，挡住脖子的切口
  // 太扁（龛口高不到宽的 1.05 倍）：先把龛口收窄（拱顶不动，最窄 1.3 个脸宽），还不够再把拱抬高
  // 合影：二佛并坐龛本来就是横宽的，高宽比放到 0.85，只抬拱、不收窄（两边的人不被柱子切到脸）
  const group = !!(faces && faces.length >= 2), asp = group ? 0.85 : headOnly ? 0.8 : 1.05;   // 只有头颈的近景：龛不必高过宽，免得头顶上空一大块
  { const top0 = ys - b, Hop = floorP - top0;
    if (!group && Hop < asp * 2 * a) { a = Math.max(Math.min(a, Hop / (2 * asp)), 1.3 * fwL); b = 0.9 * a; ys = top0 + b; }
    const asp2 = Math.min(asp, 0.85);   // 收到最窄还不够高（近景人像短）：只抬到 0.85，不让头顶上空出一大块
    if (floorP - (ys - b) < asp2 * 2 * a) ys = floorP - asp2 * 2 * a + b; }
  const capH0 = 0.13 * a;
  if (floorP - (ys + capH0) < 0.3 * (floorP - (ys - b))) ys = Math.min(ys, floorP - capH0 - 0.3 * (floorP - (ys - b)));
  const ox0 = Math.round(cx - a), ox1 = Math.round(cx + a);
  // 龛楣：拱顶厚 T（约龛口宽的 1/4），两头 t0；尖顶
  const Tb = 0.27 * a, Ttip = 0.2 * a, T = Tb + Ttip, t0 = 0.24 * a, pw = 0.17 * a;
  const archTop = ys - b - T;
  const side = Math.round(pw + 0.34 * a);         // 两边：柱 + 龛尾 + 边
  const mL = Math.max(0, Math.ceil(side - ox0)), mT = Math.max(0, Math.ceil(-archTop + 0.1 * a));
  const offX = mL, offY = mT;
  const ledge = Math.round(0.16 * h);            // 坛基往下扩
  const H2 = offY + h + ledge;
  let W2 = Math.max(offX + w, offX + ox1 + side);
  const floorY = offY + floorP;
  // 题记碑：龛外右边壁面上，碑底和坛基顶面齐，碑顶不高过拱脚线以上 0.2 个拱高；右边多留壁面，推镜头时碑能落在画面中间
  let S = null;
  if (stele) {
    // 碑高取龛口高（坛基顶到拱顶）的 0.62，宽高比和不带龛时一样（0.24 : 0.58）
    const y1 = floorY, ph = Math.round(0.62 * (y1 - (offY + ys - b))), y0 = y1 - ph;
    const H = ph / 0.58, gap = Math.round(0.06 * a), pw2 = Math.round(0.24 * H), margin = Math.round(0.3 * H);
    const x0 = Math.round(offX + ox1 + side - 0.1 * a) + gap;
    W2 = x0 + pw2 + margin;
    S = { x0, y0, x1: x0 + pw2, y1,
      name: { x0: x0 + Math.round(0.08 * pw2), y0: y0 + Math.round(0.06 * ph), x1: x0 + Math.round(0.56 * pw2), y1: y0 + Math.round(0.94 * ph) },
      era: { x0: x0 + Math.round(0.58 * pw2), y0: y0 + Math.round(0.06 * ph), x1: x0 + Math.round(0.94 * pw2), y1: y0 + Math.round(0.7 * ph) } };
  }
  return { headOnly, w2: W2, h2: H2, offX, offY, ox0: ox0 + offX, ox1: ox1 + offX, cx: cx + offX, ys: ys + offY, a, b, T, Tb, Ttip, t0, pw, Hw, hf, fw: fwL,
    floorY, photo: [offX, offY, w, h], ...(S || {}), stele: !!S };
}

// 楣面上的火焰（云冈龛楣的火焰纹）：焰舌密排、互相压着，填满楣面不露底；每个焰舌是一道 S 弯、根宽尖细，
// 两边的焰舌都往拱顶倒、尖头往拱顶勾，拱顶正中一个直立的；面上刻三道顺着轮廓的阴线（一层套一层）。
// 在楣带局部坐标里画：s 沿拱 0（右拱脚）..1（左拱脚），u 径向 0 内沿 .. 1 外沿。返回 [高度 0..1, 第几个焰舌]
function flame(s, u, n, jit) {
  const step = 1 / (n - 1), k0 = Math.round(s / step);
  let best = 0, bk = -1;
  for (let kk = k0 - 2; kk <= k0 + 2; kk++) {
    if (kk < 0 || kk >= n) continue;
    const c = kk * step + jit(kk, 1) * 0.12 * step, side = kk * step < 0.5 - 1e-6 ? 1 : kk * step > 0.5 + 1e-6 ? -1 : 0;
    const len = 0.93 + 0.07 * jit(kk, 2);
    const q = u / len; if (q >= 1) continue;
    const lean = side * step * (1.25 * q * q + 0.22 * Math.sin(2 * Math.PI * q) + 2.2 * Math.max(0, q - 0.75) ** 1.6 * 4);
    const wav = side === 0 ? 0.1 * step * Math.sin(2 * Math.PI * q) : 0;
    const cs = c + lean + wav;
    const half = step * 1.05 * Math.pow(1 - q, 0.7) * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, 0.2 + q * 1.8)));
    const d = Math.abs(s - cs) / Math.max(half, 1e-5);
    if (d >= 1) continue;
    const dome = Math.sqrt(1 - d * d);
    const lines = 0.28 * (gs((d - 0.33) / 0.09) + gs((d - 0.62) / 0.08)) + 0.22 * gs(d / 0.07) * sm(0.12, 0.3, q);
    const v = dome * (1 - lines) * (0.7 + 0.3 * (1 - q)) + 0.1 * (side === 0 ? 1 : Math.abs(kk * step - 0.5) < 0.5 ? 1 - Math.abs(kk * step - 0.5) * 2 : 0);   // 越近拱顶的压在上面
    if (v > best) { best = v; bk = kk; }
  }
  return [best, bk];
}

// 生成整块高度：照片浮雕放进龛里（龛内保留原高度），龛外是壁面、龛楣、柱、坛基；返回 { heights, frame }。
// frame：帧代码（见 FRAME），龛内的小数部分是龛里的暗（0..0.4：越靠拱顶、龛壁越暗）；楣面 3 + 径向位置 0..0.4（叠晕），火焰 4 + 第几个焰舌模 3 × 0.1
export function buildNiche(heights, w, h, L) {
  const { w2: W2, h2: H2, offX, offY, cx, ys, a, b, T, t0, pw, Hw } = L;
  const out = new Float32Array(W2 * H2), fr = new Float32Array(W2 * H2);
  const e = 0.07 * a;                  // 龛口边：壁面转进龛里的圆边宽（看得出龛口的厚度）
  const ox0 = L.ox0, ox1 = L.ox1;
  const nFl = Math.max(13, Math.round(13 + (a / 250) * 4) | 1);   // 焰舌个数（单数）
  const capH = 0.13 * a, capY = ys + capH;   // 柱头（栌斗）：顶面就是拱脚线
  const ledgeTop = L.floorY;
  const jit = (k, c) => { const t = Math.sin(k * 12.9898 + c * 78.233) * 43758.5453; return (t - Math.floor(t)) * 2 - 1; };
  const nz = (x, y, f) => Math.sin(x * f + 1.7 * Math.sin(y * f * 0.73)) * Math.sin(y * f * 1.13 + 0.9 * Math.sin(x * f * 0.61));   // 手工的不规则
  let bot = 0; for (let y = h - 4; y < h; y++) for (let x = 0; x < w; x++) bot = Math.max(bot, heights[y * w + x]);
  let botF = 0; for (let y = Math.max(0, L.floorY - L.offY - 4); y < Math.min(h, L.floorY - L.offY + 2); y++) for (let x = 0; x < w; x++) botF = Math.max(botF, heights[y * w + x]);
  const Lh = Math.max(1.1 * Hw, 1.04 * bot, 1.04 * botF);   // 坛基凸出壁面，也高过它挡住的人像底边
  // 龛里照片以外的地方：地子高度取照片地子的中位数（不然照片边上会出一道台阶）
  const gv = []; for (let i = 0; i < w * h; i += 7) if (heights[i] < 2) gv.push(heights[i]);
  gv.sort((p, q) => p - q); const g0 = gv.length ? gv[gv.length >> 1] : 0;
  const topRow = new Float32Array(w);
  for (let x = 0; x < w; x++) { let m = 0, n = 0; for (let k = -4; k <= 4; k++) { const xx = x + k; if (xx >= 0 && xx < w) { m += (heights[xx] + heights[w + xx] + heights[2 * w + xx]) / 3; n++; } } topRow[x] = Math.min(m / n, heights[x] * 1.15 + 0.5); }
  // 照片上、左、右边沿切到人像（满版近景切掉头顶、肩膀被画框切断）：这条边往里 0.3 个脸宽内，浮雕渐渐沉回地子
  // （“从后壁里浮出来”，浮雕的老办法），不补头顶、不立竖崖。下沿有坛基挡着，不用管
  const edgeHit = (get, n) => { let c = 0; for (let k = 0; k < n; k++) if (get(k) > g0 + 2) c++; return c > 0.04 * n; };
  const cutT = edgeHit((k) => topRow[k], w);
  const cutL = edgeHit((k) => heights[k * w], h), cutR = edgeHit((k) => heights[k * w + w - 1], h);
  const FD = Math.max(8, 0.3 * L.fw);
  for (let Y = 0; Y < H2; Y++) for (let X = 0; X < W2; X++) {
    const i = Y * W2 + X;
    const px = X - offX, py = Y - offY;
    const inPhoto = px >= 0 && py >= 0 && px < w && py < h;
    let fig = inPhoto ? heights[py * w + px] : g0;
    if (inPhoto && fig > g0) {
      let f = 1;
      if (cutT) f = Math.min(f, sm(0, FD, py)); if (cutL) f = Math.min(f, sm(0, FD, px)); if (cutR) f = Math.min(f, sm(0, FD, w - 1 - px));
      if (L.headOnly) f = Math.min(f, sm(0, FD, (L.floorY - L.offY) - py));   // 只有头颈：脖子在碰到坛基之前沉回地子
      if (f < 1) fig = g0 + (fig - g0) * f;
    }
    let dOpen, inArch = false, r = 0, th = 0;
    if (Y >= ys) dOpen = Math.max(ox0 - X, X - ox1);
    else {
      const ux = (X - cx) / a, uy = (ys - Y) / b; r = Math.hypot(ux, uy); th = Math.atan2(uy, ux);
      dOpen = (r - 1) * (Math.min(a, b) + (a - Math.min(a, b)) * sm(0.55, 0.85, Math.abs(ux))); inArch = true;   // 尺度平滑过渡（原来在 |ux| = 0.7 突变，龛口右侧内沿留一道竖缝，11-11 评审）
    }
    // 1 壁面和龛口：龛口外是壁面 Hw，龛口边一道圆角转下去（e 宽，看得出龛口的厚度）
    let hh, code = FRAME.WALL;
    if (dOpen < -e) {
      hh = fig;
      // 龛里的暗：离龛口边越近、越靠上越暗（拱和龛壁挡住了天光）
      const dd = Math.min(1, (-dOpen - e) / (0.45 * a)), up = Y < ys ? 1 : Math.max(0, 1 - (Y - ys) / (1.2 * a));
      code = FRAME.IN + 0.4 * (1 - dd) ** 1.6 * (0.45 + 0.55 * up);
    } else if (dOpen < 0) { const q = (dOpen + e) / e; hh = Math.max(fig * (1 - q), g0 + (Hw - g0) * (1 - Math.cos(q * Math.PI / 2)) ** 0.8); code = q > 0.45 ? FRAME.WALL : FRAME.IN + 0.4; }
    else hh = Hw;
    if (code >= 1) hh += 0.5 * nz(X, Y, 0.045) + 0.25 * nz(X + 300, Y, 0.12);
    // 2 龛楣：拱外一圈，顶上厚 T、两头 t0，外沿尖拱；楣面略高于壁面，内外沿各一道凸棱，楣面上火焰
    if (inArch && r >= 1) {
      const sArc = 1 - th / Math.PI, pk = 1 - Math.abs(sArc - 0.5) * 2;
      const rho = Math.hypot(a * Math.cos(th), b * Math.sin(th)), dpx = (r - 1) * rho;            // 到拱口的距离（像素，近似）
      const thick = t0 + (L.Tb - t0) * Math.min(1, pk / 0.25) + L.Ttip * Math.max(0, (pk - 0.72) / 0.28);   // 楣带几乎等宽、和拱口同心，两头落在柱头上；拱顶两侧线性收成钝尖（外凸，不反曲）
      const dd = dpx / Math.max(thick, 1);
      if (dd <= 1.04) {
        const edge = sm(1.04, 0.96, dd);
        const rimIn = gs(dpx / (0.03 * a)), rimOut = gs((thick * 0.95 - dpx) / (0.028 * a));
        const [fl, fk] = flame(sArc, Math.max(0, (dd - 0.1) / 0.82), nFl, jit);
        const flv = fl * sm(0.04, 0.09, pk) * sm(0.08, 0.13, dd) * sm(0.94, 0.88, dd);
        const band = Hw + 0.06 * Hw + (0.1 * rimIn + 0.08 * rimOut) * Hw + 0.24 * Hw * flv + 0.4 * nz(X, Y, 0.09);
        hh = Math.max(hh, Hw + (band - Hw) * edge);
        if (edge > 0.5) code = flv > 0.12 ? FRAME.FLAME + 0.1 * (((fk % 3) + 3) % 3) : (rimIn > 0.4 || rimOut > 0.4 ? FRAME.RIM : FRAME.BAND + 0.4 * Math.min(1, dd));
      }
    }
    // 3 龛尾：楣带两头接着往外卷成涡卷（一条凸起的带子绕一圈半），落在柱头上
    for (const sgn of [-1, 1]) {
      const R0 = 0.085 * a, vx = cx + sgn * (a + t0 + 0.75 * R0), vy = ys - 0.75 * R0;
      const dx = (X - vx) * sgn, dy = Y - vy, rr = Math.hypot(dx, dy);
      if (rr < R0 * 1.3) {
        const ang = Math.atan2(-dy, -dx);   // 从朝向龛口的一侧起卷
        let ridge = 0;
        for (let k = 0; k < 3; k++) {
          const phi = ((ang + 2 * Math.PI * k) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) + 2 * Math.PI * k;
          if (phi > 2.6 * Math.PI) continue;
          const rs = R0 * (1.05 - phi / (3.2 * Math.PI)), wd = 0.24 * R0 * (1 - 0.3 * phi / (2.6 * Math.PI));
          const dr = (rr - rs) / wd; ridge = Math.max(ridge, Math.sqrt(Math.max(0, 1 - dr * dr)) * sm(2.6 * Math.PI, 2.2 * Math.PI, phi));
        }
        const v = Hw + 0.1 * Hw * sm(R0 * 1.25, R0 * 1.0, rr) + 0.18 * Hw * ridge;
        if (v > hh) { hh = v; if (ridge > 0.2 || rr < R0) code = FRAME.RIM; }
      }
    }
    // 4 龛柱：龛口两边各一根方柱（素面，两边一道窄棱），柱头栌斗（上宽下收），柱础一块
    for (const sgn of [-1, 1]) {
      const c0 = sgn < 0 ? ox0 - pw : ox1, c1 = c0 + pw;
      if (X >= c0 - 0.3 * pw && X <= c1 + 0.3 * pw && Y >= ys && Y <= ledgeTop + 2) {
        const fx = (X - c0) / pw;
        let capW = 0;
        if (Y < capY) capW = Y < ys + 0.45 * capH ? 0.24 : 0.24 * (1 - (Y - ys - 0.45 * capH) / (0.55 * capH));   // 栌斗：上半截方、下半截斜收
        const baseH = 0.09 * a; if (Y > ledgeTop - baseH) capW = Math.max(capW, 0.14);                    // 柱础
        const cwL = sgn < 0 ? capW : 0, cwR = sgn < 0 ? 0 : capW;   // 栌斗、柱础只往龛外伸，不伸进龛口
        if (fx > -cwR && fx < 1 + cwL) {
          const edgeF = sm(-cwR - 0.05, -cwR + 0.08, fx) * sm(1 + cwL + 0.05, 1 + cwL - 0.08, fx);
          const arris = Y > capY && Y < ledgeTop - baseH ? 0.03 * (gs((fx - 0.08) / 0.03) + gs((fx - 0.92) / 0.03)) : 0;
          const band = Y < capY && Math.abs(Y - (ys + 0.45 * capH)) < 0.04 * capH ? -0.03 : 0;
          const v = Hw + Hw * (0.12 + (Y < capY ? 0.05 : 0) + arris + band) * edgeF + 0.3 * nz(X, Y, 0.1);
          if (v > hh) { hh = v; code = FRAME.RIM; }
        }
      }
    }
    // 5 坛基：龛底一道横带，前沿圆角，挡住照片底边；上面一道窄棱
    if (Y >= ledgeTop - 0.02 * h && X > ox0 - pw - 0.12 * a && X < ox1 + pw + 0.12 * a) {
      const q = sm(ledgeTop - 0.02 * h, ledgeTop + 0.012 * h, Y);
      const v = Lh * q + Hw * 0.05 * gs((Y - (ledgeTop + 0.035 * h)) / (0.007 * h)) - Hw * 0.03 * gs((Y - (ledgeTop + 0.09 * h)) / (0.005 * h)) + 0.3 * nz(X, Y, 0.08);
      if (v > hh || q > 0.6) { hh = Math.max(v, q > 0.6 ? v : hh); if (q > 0.5) code = Math.abs(Y - (ledgeTop + 0.035 * h)) < 0.012 * h ? FRAME.RIM : FRAME.RIM + 0.3; }
    }
    out[i] = hh; fr[i] = code;
  }
  return { heights: out, frame: fr, Lh };
}

// 碑面：在壁面上凹进去 depth（像素），边是 bev 宽的斜坡（和不带龛时的 extendRelief 一样，只是从壁面高度往下凹）
export function cutStele(hts, W2, L, depth = 3.0, bev = 5) {
  for (let y = L.y0 - bev; y < L.y1 + bev; y++) for (let x = L.x0 - bev; x < L.x1 + bev; x++) {
    if (x < 0 || y < 0 || x >= W2) continue;
    const dx = Math.max(L.x0 - x, x - L.x1 + 1, 0), dy = Math.max(L.y0 - y, y - L.y1 + 1, 0), d = Math.max(dx, dy);
    const inside = x >= L.x0 && x < L.x1 && y >= L.y0 && y < L.y1, k = inside ? 1 : Math.max(0, 1 - d / bev);
    hts[y * W2 + x] -= depth * k * k * (3 - 2 * k);
  }
}

// 区域图（半分辨率 RGBA8）放进大画布：照片放在 (offX, offY)，其余补 0
export function placeReg(reg, L) {
  if (!reg) return null;
  const rw2 = Math.ceil(L.w2 / 2), rh2 = Math.ceil(L.h2 / 2), out = new Uint8Array(rw2 * rh2 * 4);
  const ox = Math.round(L.offX / 2), oy = Math.round(L.offY / 2);
  for (let y = 0; y < reg.h; y++) { const yy = y + oy; if (yy >= rh2) break; out.set(reg.data.subarray(y * reg.w * 4, (y + 1) * reg.w * 4).subarray(0, Math.max(0, Math.min(reg.w, rw2 - ox)) * 4), (yy * rw2 + ox) * 4); }
  return { w: rw2, h: rh2, data: out };
}
