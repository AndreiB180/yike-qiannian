// 执灯（方案 F1）：笔记本摄像头看着观众手里的手电，灯头在画面里的位置 → 浮雕上灯的位置，光斑大小 → 灯的远近。零标定。
// 每帧：画面缩到 160×120 → 亮度 → 和慢慢更新的背景相减（屋里本来就亮的窗户、台灯不算）→ 阈值 → 连通域，挑面积大又圆的一团
// → 亮度加权质心 → 1€ 滤波（Casiez 2012）去抖。画面左右镜像：人往右拿，光就从右边来（和照镜子一样）。
// 用法：const h = await startHoldLamp(video, preview, (u, v, z) => {...})；h.stop()。u、v 是浮雕上的相对位置，z 是远近倍数；
// 认不到手电超过 0.3 秒回调一次 (null)，舞台把灯熄掉（11-11 组长：没有手电这种明显亮光的时候就不展示灯光）。

const W = 160, H = 120;

class OneEuro {   // 1€ 滤波：慢的时候平滑多（不抖），快的时候平滑少（不拖）
  constructor(minCut = 1.2, beta = 0.03, dCut = 1.0) { Object.assign(this, { minCut, beta, dCut, x: null, dx: 0, t: 0 }); }
  alpha(cut, dt) { const tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); }
  f(x, t) {
    if (this.x === null) { this.x = x; this.t = t; return x; }
    const dt = Math.max(1e-3, (t - this.t) / 1000); this.t = t;
    const dx = (x - this.x) / dt; this.dx += this.alpha(this.dCut, dt) * (dx - this.dx);
    const cut = this.minCut + this.beta * Math.abs(this.dx);
    this.x += this.alpha(cut, dt) * (x - this.x); return this.x;
  }
}

// 一帧里找灯头：返回 { x, y（0..1，已镜像）, area（像素，160×120 下）} 或 null
export function findLamp(Y, bg) {
  const N = W * H; let mx = 0;
  for (let i = 0; i < N; i++) if (Y[i] > mx) mx = Y[i];
  const thr = Math.max(200, mx - 30);
  const lab = new Int32Array(N), stack = new Int32Array(N); let best = null, nl = 0;
  for (let s = 0; s < N; s++) {
    if (lab[s] || Y[s] < thr || Y[s] - bg[s] < 35) continue;
    nl++; let sp = 0, area = 0, sx = 0, sy = 0, sw = 0, x0 = W, x1 = 0, y0 = H, y1 = 0; stack[sp++] = s; lab[s] = nl;
    while (sp) {
      const i = stack[--sp], x = i % W, y = (i / W) | 0, w = Y[i] - thr + 1;
      area++; sx += x * w; sy += y * w; sw += w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const j of [i - 1, i + 1, i - W, i + W]) {
        if (j < 0 || j >= N || lab[j] || Math.abs((j % W) - x) > 1) continue;
        if (Y[j] >= thr && Y[j] - bg[j] >= 35) { lab[j] = nl; stack[sp++] = j; }
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, round = area / (Math.PI / 4 * bw * bh);   // 圆度：面积 / 外接椭圆面积
    const score = area * Math.min(1, round / 0.6) * Math.min(bw, bh) / Math.max(bw, bh);
    if (area >= 3 && round > 0.35 && (!best || score > best.score)) best = { x: 1 - sx / sw / W, y: sy / sw / H, area, score };
  }
  return best;
}

export async function startHoldLamp(video, preview, onLight) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } });
  video.srcObject = stream; await video.play();
  const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d", { willReadFrequently: true });
  const pg = preview?.getContext("2d");
  const Y = new Float32Array(W * H), bg = new Float32Array(W * H); let first = true, run = true, lastSeen = 0;
  const fu = new OneEuro(), fv = new OneEuro(), fz = new OneEuro(0.6, 0.01);
  const A0 = 14;   // 手电在一臂远时灯头大约这么多像素（160×120 下）：当作 z = 1
  let lost = true;
  function tick(t) {
    if (!run) return;
    g.drawImage(video, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data;
    for (let i = 0; i < W * H; i++) Y[i] = 0.3 * px[4 * i] + 0.59 * px[4 * i + 1] + 0.11 * px[4 * i + 2];
    if (first) { bg.set(Y); first = false; }
    const L = findLamp(Y, bg);
    for (let i = 0; i < W * H; i++) bg[i] += (L ? 0.01 : 0.03) * (Math.min(Y[i], bg[i] + 20) - bg[i]);   // 背景慢慢跟上（灯头那块不急着吸进背景）
    if (L) {
      if (lost) { fu.x = fv.x = fz.x = null; lost = false; }   // 重新认到：直接从手电的位置亮起来，不从上次熄灭的地方滑过去
      lastSeen = t;
      const u = (L.x - 0.15) / 0.7, v = (L.y - 0.12) / 0.76;   // 画面中间七成映到整块浮雕：不用伸到画面边上
      onLight(fu.f(Math.min(1.15, Math.max(-0.15, u)), t), fv.f(Math.min(1.15, Math.max(-0.15, v)), t), fz.f(Math.min(2.5, Math.max(0.4, Math.sqrt(A0 / L.area))), t));
    } else if (!lost && t - lastSeen > 300) { lost = true; onLight(null); }   // 偶尔丢一两帧不算
    if (pg) {   // 角上的小预览（镜像），认到的灯头画个圈
      pg.save(); pg.translate(preview.width, 0); pg.scale(-1, 1); pg.drawImage(video, 0, 0, preview.width, preview.height); pg.restore();
      if (L && t - lastSeen < 50) { pg.strokeStyle = "#E8A65A"; pg.lineWidth = 2; pg.beginPath(); pg.arc(L.x * preview.width, L.y * preview.height, 4 + Math.sqrt(L.area) * preview.width / W, 0, 7); pg.stroke(); }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  return { stop() { run = false; stream.getTracks().forEach((tr) => tr.stop()); video.srcObject = null; } };
}
