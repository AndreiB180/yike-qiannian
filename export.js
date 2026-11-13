// 导出（方案 C8）：
//   STL：当前年份风化后的整块浮雕（连龛、碑），做成一块带底座的实心板，二进制 STL；长边 128 毫米，浮雕最高 6 毫米，底座 3 毫米。
//        顶面按高度网格两两成三角，四周侧壁、底面也用同样的网格边，每条边正好两个三角共用（水密），导出前自检一遍。
//   观照记录：A4 横版一页，同一块浮雕在冬至、夏至三个时刻的日光下，四个年代，两种石材，还有拓片（拓过的话）。

// 面积平均缩小到 gw × gh
function down(h, w, H, gw, gh) {
  const out = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const x0 = Math.floor(x * w / gw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * w / gw)), y0 = Math.floor(y * H / gh), y1 = Math.max(y0 + 1, Math.floor((y + 1) * H / gh));
    let s = 0, n = 0; for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += h[yy * w + xx]; n++; }
    out[y * gw + x] = s / n;
  }
  return out;
}

// heights：Float32Array（像素单位，w × h）。返回 { buf: ArrayBuffer, tris, watertight, size: [x, y, z]（毫米） }
export function makeSTL(heights, w, h, { maxSide = 320, longMM = 128, reliefMM = 6, baseMM = 3 } = {}) {
  const sc = maxSide / Math.max(w, h), gw = Math.max(2, Math.round(w * sc)), gh = Math.max(2, Math.round(h * sc));
  const g = down(heights, w, h, gw, gh);
  let lo = Infinity, hi = -Infinity; for (const v of g) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const mm = longMM / (Math.max(gw, gh) - 1), zs = reliefMM / Math.max(hi - lo, 1e-6);
  const X = (i) => i * mm, Y = (j) => (gh - 1 - j) * mm;   // y 翻过来：图像下沿 = 模型前沿
  // 顶点按编号存：顶面 j·gw + i，底面再加 N
  const N = gw * gh, V = new Float64Array(2 * N * 3);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const k = j * gw + i;
    V.set([X(i), Y(j), baseMM + (g[k] - lo) * zs], 3 * k); V.set([X(i), Y(j), 0], 3 * (N + k));
  }
  const tris = []; const T = (a, b, c) => tris.push(a, b, c);
  const top = (i, j) => j * gw + i, bot = (i, j) => N + j * gw + i;
  // 顶面（法线朝上：从上往下看逆时针）
  for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) { T(top(i, j), top(i, j + 1), top(i + 1, j + 1)); T(top(i, j), top(i + 1, j + 1), top(i + 1, j)); }
  // 底面（z = 0，法线朝下）
  for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) { T(bot(i, j), bot(i + 1, j + 1), bot(i, j + 1)); T(bot(i, j), bot(i + 1, j), bot(i + 1, j + 1)); }
  // 四周侧壁：沿边界走一圈，每段一个竖着的四边形（两个三角），法线朝外
  const ring = [];
  for (let i = 0; i < gw; i++) ring.push([i, 0]);
  for (let j = 1; j < gh; j++) ring.push([gw - 1, j]);
  for (let i = gw - 2; i >= 0; i--) ring.push([i, gh - 1]);
  for (let j = gh - 2; j >= 1; j--) ring.push([0, j]);
  for (let k = 0; k < ring.length; k++) {
    const [ia, ja] = ring[k], [ib, jb] = ring[(k + 1) % ring.length];
    T(top(ia, ja), top(ib, jb), bot(ib, jb)); T(top(ia, ja), bot(ib, jb), bot(ia, ja));
  }
  // 水密自检：每条边正好被两个三角共用，且两次方向相反（按顶点编号，键是整数）
  const M2 = 2 * N, edges = new Map();
  for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = tris[t + e], b = tris[t + (e + 1) % 3], k = a < b ? a * M2 + b : b * M2 + a;
    edges.set(k, (edges.get(k) || 0) + (a < b ? 1 : 1000));
  }
  let watertight = true; for (const v of edges.values()) if (v !== 1001) { watertight = false; break; }
  // 二进制 STL：80 字节头 + 三角数 + 每个三角 50 字节
  const n = tris.length / 3, buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf);
  const head = "Yike Qiannian relief STL (mm)"; for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, n, true);
  let o = 84;
  const P = (q) => [V[3 * q], V[3 * q + 1], V[3 * q + 2]];
  for (let t = 0; t < tris.length; t += 3) {
    const a = P(tris[t]), b = P(tris[t + 1]), c = P(tris[t + 2]);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const v of [nx, ny, nz, ...a, ...b, ...c]) { dv.setFloat32(o, v, true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return { buf, tris: n, watertight, size: [X(gw - 1), Y(0), baseMM + reliefMM] };
}

// 观照记录：shots = { day: [{ img, label }...6], years: [...4], stones: [...2], rubbing: canvas | null }，title、name。返回 A4 横版 canvas（150 dpi）
export function makeRecord({ day, years, stones, rubbing, title = "观照记录", sub = "" }) {
  const W = 1754, H = 1240, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = "#F3EEE4"; g.fillRect(0, 0, W, H);
  const ink = "#2A2118", soft = "#7A6A55", serif = '"Songti SC","STSong","Noto Serif SC",serif', kai = '"Kaiti SC","STKaiti","KaiTi",serif';
  g.fillStyle = ink; g.font = `600 44px ${serif}`; g.textBaseline = "top"; g.fillText(title, 70, 56);
  g.fillStyle = soft; g.font = `22px ${serif}`; g.fillText(sub, 340, 72);
  g.strokeStyle = "#C9BBA4"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(70, 124); g.lineTo(W - 70, 124); g.stroke();
  const cell = (im, x, y, w, h, label) => {
    const s = Math.min(w / im.width, h / im.height), dw = im.width * s, dh = im.height * s;
    g.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    g.fillStyle = soft; g.font = `20px ${kai}`; g.textBaseline = "top"; g.textAlign = "center"; g.fillText(label, x + w / 2, y + (h + dh) / 2 + 8); g.textAlign = "left";   // 字跟着图的下沿
  };
  const head = (t, x, y) => { g.fillStyle = ink; g.font = `600 26px ${serif}`; g.textBaseline = "top"; g.fillText(t, x, y); };
  // 左：一日（2 × 3）、千年（1 × 4）
  const L = 70, CW = 960, cw = (CW - 2 * 18) / 3, ch = cw * 0.66;
  head("一日", L, 150); g.fillStyle = soft; g.font = `18px ${serif}`; g.fillText("地方太阳时，石面朝南。夏至正午太阳高，光贴着崖面掠过，整壁反而暗", L + 80, 156);
  day.forEach((d, i) => cell(d.img, L + (i % 3) * (cw + 18), 194 + Math.floor(i / 3) * (ch + 46), cw, ch, d.label));
  const yy = 194 + 2 * (ch + 46) + 16, c4 = (CW - 3 * 14) / 4, h4 = c4 * 0.66;
  head("千年", L, yy);
  years.forEach((d, i) => cell(d.img, L + i * (c4 + 14), yy + 44, c4, h4, d.label));
  // 右：两种石材、拓片
  const RX = L + CW + 50, RW = W - 70 - RX;
  head("石材", RX, 150);
  const sh = RW * 0.62 * 0.5;
  stones.forEach((d, i) => cell(d.img, RX + i * (RW / 2 + 6), 194, RW / 2 - 6, sh, d.label));
  head("拓", RX, 194 + sh + 60);
  if (rubbing) { const top = 194 + sh + 104, hh = Math.min(H - top - 100, RW * rubbing.height / rubbing.width); cell(rubbing, RX, top, RW, hh, "今日手拓"); }
  else { g.fillStyle = soft; g.font = `20px ${kai}`; g.fillText("未拓", RX, 194 + sh + 110); }
  g.fillStyle = soft; g.font = `18px ${serif}`; g.textBaseline = "alphabetic"; g.fillText("一刻千年", 70, H - 50);
  return cv;
}
