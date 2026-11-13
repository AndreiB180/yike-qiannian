// 浮雕实时渲染（WebGL2，着色器手写）。Python 参考实现：code/relief/render.py。
// 高度图 → Sobel 法线 → Oren–Nayar 漫反射（汉白玉加包裹光）→ 沿光线在高度图上步进的软阴影 → 地平线角遮蔽 → 自动曝光。
// 风化时间轴（方案 4.3(4)，11-10 起）：每一帧只由原始高度和“风化剂量” τ 算出来（无状态，可以来回拖）：
//   换作品时算一次：凿痕底 → 高斯金字塔（σ = 0,1,2,4,8,16 像素）→ 形态学顶帽（大小两个半径）、遮雨场
//   拖时间轴时：扩散软化（逐像素按 σ=√(2Dτ) 在金字塔里插值）、突起后退、鼻尖等大突起崩缺、根部掏蚀、粉化坑、
//              片状剥落（剥落前沿随剂量推进）、清代泥皮与彩画（1651）、煤尘、黑结壳、水痕、盐霜 → 新高度 + 颜色
// 坐标：纹理像素坐标 x 向右、y 向下，z 朝外（朝观众）；高度单位是像素。画进帧缓冲的中间结果用 gl_FragCoord 取坐标，
// 行序和上传的纹理一致（第 0 行是图的上沿）。照片构图时脸宽统一缩到约 380 像素，所以风化的尺度直接写成像素。

const VS = `#version 300 es
in vec2 aPos; out vec2 vUV;
uniform vec4 uRect;   // 浮雕在画布上的位置（归一化设备坐标的 x0 y0 x1 y1）
void main(){
  vUV = vec2(aPos.x*0.5+0.5, 0.5-aPos.y*0.5);
  vec2 p = mix(uRect.xy, uRect.zw, aPos*0.5+0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;
const VS_OFF = `#version 300 es
in vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2DArray;
`;

// 整数哈希的值噪声（各平台一致，不用 sin 哈希）
const NOISE = `
float hash(ivec2 p, int s){
  uint h = uint(p.x)*1597334677u ^ uint(p.y)*3812015801u ^ uint(s)*2654435761u;
  h ^= h >> 16; h *= 2246822519u; h ^= h >> 13; h *= 3266489917u; h ^= h >> 16;
  return float(h) * (1.0/4294967296.0);
}
float vnoise(vec2 x, int s){
  vec2 i = floor(x), f = fract(x); vec2 u = f*f*(3.0-2.0*f); ivec2 I = ivec2(i);
  float a = hash(I, s), b = hash(I+ivec2(1,0), s), c = hash(I+ivec2(0,1), s), d = hash(I+ivec2(1,1), s);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 x, int s, int oct){
  float a = 0.5, t = 0.0, n = 0.0;
  for(int i=0; i<8; i++){ if(i>=oct) break; n += a*vnoise(x, s+i*17); t += a; x = x*2.03 + vec2(13.1, 7.7); a *= 0.5; }
  return n/t;
}
`;

const COMMON = HEAD + `
uniform sampler2D uH;      // 高度，0..1
uniform sampler2D uNoise;  // r 颗粒，g 反照率斑驳
uniform vec2 uRes;         // 高度图尺寸（像素）
uniform float uHScale;     // 高度 1.0 对应多少像素
uniform float uGrain;
float H(vec2 p){ return texture(uH, p/uRes).r*uHScale; }
`;

// ---------- 换作品时算一次的 ----------

// 凿痕底：地子上刻一排排斜向短凿痕（云冈龛底的“斜向凿痕”），像身上不刻。凿痕的波长只有几个像素，
// 后面的扩散一跑就先没（波长 ℓ 的起伏按 exp(−2π²σ²/ℓ²) 衰减）
const FS_BASE = HEAD + NOISE + `
uniform sampler2D uH0; uniform vec2 uRes; uniform float uHmax; uniform float uChisel;
out float o;
void main(){
  vec2 p = gl_FragCoord.xy; float h0 = texture(uH0, p/uRes).r*uHmax;
  float ground = 1.0 - smoothstep(0.6, 2.5, h0);
  float g = 0.0;
  if(ground > 0.0 && uChisel > 0.0){
    // 一片一片凿（每片约 130 像素，边界随噪声弯），每片自己的方向和行距；片里一行行短斜刀痕，两头浅
    vec2 q = p + 30.0*(vec2(fbm(p/90.0, 3, 2), fbm(p/90.0 + 5.0, 4, 2)) - 0.5)*2.0;
    ivec2 ci = ivec2(floor(q/130.0));
    float ang = -0.62 + 0.5*(hash(ci, 7) - 0.5);
    float sp = 11.0 + 4.0*hash(ci, 8);
    vec2 d = vec2(cos(ang), sin(ang)); vec2 n = vec2(-d.y, d.x);
    float v = dot(p, n)/sp; float row = floor(v); float fv = fract(v);
    float u = dot(p, d) + 47.0*hash(ivec2(int(row), ci.x*7 + ci.y), 1);
    float L = 30.0 + 25.0*hash(ivec2(int(row), ci.y*5 + ci.x), 4);
    float k = floor(u/L); float fu = fract(u/L);
    float rnd = hash(ivec2(int(row), int(k)), 2);
    float c = 0.5 + 0.2*(hash(ivec2(int(row), int(k)), 3) - 0.5);
    float w = 0.24 + 0.1*rnd;
    float prof = max(0.0, 1.0 - abs(fv - c)/w); prof = prof*prof*(3.0 - 2.0*prof);
    float taper = pow(clamp(sin(3.14159*fu), 0.0, 1.0), 0.5);
    g = prof*taper*(0.6 + 0.8*rnd)*step(0.12, hash(ivec2(int(row), int(k)), 5))   // 偶尔漏一刀
      + 0.3*(vnoise(p/1.8, 9) - 0.5);
    g *= ground*(0.8 + 0.4*fbm(p/90.0, 7, 3));
  }
  o = (h0 - uChisel*g)/uHmax;
}`;

// 可分离高斯：H 从数组的第 k−1 层读，V 从中间纹理读、写进第 k 层（读写不在同一个纹理上）
const FS_BLUR_A = HEAD + `
uniform sampler2DArray uSrc; uniform float uLayer; uniform vec2 uRes; uniform float uSig;
out float o;
void main(){
  vec2 p = gl_FragCoord.xy; int R = int(ceil(3.0*uSig)); float acc = 0.0, wt = 0.0;
  for(int i=-64; i<=64; i++){ if(i<-R || i>R) continue;
    float w = exp(-0.5*float(i*i)/(uSig*uSig+1e-6));
    acc += w*texture(uSrc, vec3((p+vec2(float(i),0.0))/uRes, uLayer)).r; wt += w; }
  o = acc/wt;
}`;
const FS_BLUR_2 = HEAD + `
uniform sampler2D uSrc; uniform vec2 uRes; uniform float uSig;
out float o;
void main(){
  vec2 p = gl_FragCoord.xy; int R = int(ceil(3.0*uSig)); float acc = 0.0, wt = 0.0;
  for(int i=-64; i<=64; i++){ if(i<-R || i>R) continue;
    float w = exp(-0.5*float(i*i)/(uSig*uSig+1e-6));
    acc += w*texture(uSrc, (p+vec2(0.0,float(i)))/uRes).r; wt += w; }
  o = acc/wt;
}`;
// 最小 / 最大值滤波（第 8 讲），可分离方窗：腐蚀再膨胀 = 开运算，原图 − 开运算 = 白顶帽（突起）
const FS_MINMAX = HEAD + `
uniform sampler2D uSrc; uniform vec2 uRes; uniform vec2 uDir; uniform int uR; uniform int uMax;
out float o;
void main(){
  vec2 p = gl_FragCoord.xy; float m = uMax==1 ? -1e9 : 1e9;
  for(int i=-40; i<=40; i++){ if(i<-uR || i>uR) continue;
    float v = texture(uSrc, (p+uDir*float(i))/uRes).r; m = uMax==1 ? max(m, v) : min(m, v); }
  o = m;
}`;
// 场：r 大顶帽（半径 25：鼻尖、下巴、耳朵），g 遮雨（往上看有没有挡雨的突起），b 小顶帽（半径 8：手指、眼睑、发绺）
const FS_FIELD = HEAD + `
uniform sampler2D uH0; uniform sampler2D uOpenL; uniform sampler2D uOpenS; uniform vec2 uRes; uniform float uHmax;
out vec4 o;
void main(){
  vec2 p = gl_FragCoord.xy; vec2 uv = p/uRes;
  float h0 = texture(uH0, uv).r;
  float thL = max(0.0, h0 - texture(uOpenL, uv).r), thS = max(0.0, h0 - texture(uOpenS, uv).r);
  // 雨从上方略向崖面斜落：上方 t 像素处的高度超过 h0 + 0.6t 就挡住
  float hp = h0*uHmax; float sh = 0.0; float t = 2.0;
  for(int i=0; i<24; i++){
    vec2 q = p - vec2(0.0, t); if(q.y < 0.0) break;
    float hq = texture(uH0, q/uRes).r*uHmax;
    sh = max(sh, clamp((hq - (hp + 0.6*t))/3.0, 0.0, 1.0)); t *= 1.22;
  }
  o = vec4(thL, sh, thS, 1.0);
}`;

// ---------- 拖时间轴时算的 ----------
const FS_WEATHER = HEAD + NOISE + `
uniform sampler2DArray uStack;  // 0：原始高度；1–5：σ = 1,2,4,8,16 像素的高斯
uniform sampler2D uH0;          // 原始高度
uniform sampler2D uField;
uniform sampler2D uReg;         // 区域概率：r 头发，g 皮肤，b 衣服，a 配饰（带 mipmap，边上缺类时取粗一层）
uniform int uHasReg;
uniform vec2 uRes; uniform float uHmax;
uniform vec2 uSeed;              // 每件作品的噪声偏移：同一套规律，花纹各不相同
uniform float uChisel;           // 凿痕深（像素）
uniform int uNiche;              // 1 = 浮雕在龛里（刻槽纹理第 4 通道有帧代码）
uniform sampler2D uIns;          // 题名、题记的刻槽：r 深（像素），g 半宽（像素），b 石粉（刻字动画里刚刻出的槽，0..1）；a 龛的帧代码（0 龛内 1 壁面 2 龛沿 3 楣面 4 火焰）
uniform vec4 uStele;             // 碑面（像素 x0 y0 x1 y1；没有碑时全 0）：碑面是磨平的，没有凿痕
uniform float uTau, uTauP, uAge; // 当年剂量；1651 的剂量；重妆以后的剂量（1651→2026 记为 1）
uniform float uPaint;            // 重妆出现没有（1651 前为 0）
uniform float uPlLoss, uPaLoss;  // 泥皮、彩画掉到哪一步：保护度低于它的地方掉了（按年份排，见 app.js）
uniform float uDust, uCoal;      // 当年积尘；1950 起煤尘的累计（黑结壳）
uniform float uGood, uBad;       // 2026 以后，治水 / 不治水走了多远（0..1）
uniform vec3 uFresh, uOld;       // 石材的新鲜面、旧面
uniform vec4 uKind;              // x 扩散系数，y 片落，z 粉化，w 盐霜
uniform vec4 uKind2;             // x 层理，y 铁质黄斑，z 黑结壳，w 粉化坑的颗粒大小（像素）
uniform int uWxDbg;              // 调试：1 泥皮保留，2 彩画保留，3 保护度，4 凸度 / 凹度 / 朝上，5 潮，6 朝下 / 遮雨
uniform vec4 uStreak[4];         // 渗水：x 源头位置（0..1），y 源头高度（0..1），z 宽（像素），w 强度
layout(location=0) out float oH;
layout(location=1) out vec4 oA;

float lev(vec2 uv, float i){ return texture(uStack, vec3(uv, i)).r*uHmax; }
float stackAt(vec2 uv, float s){
  s = clamp(s, 0.0, 15.99); float fi, f;
  if(s < 1.0){ fi = 0.0; f = s; } else { float l = floor(log2(s)); float a = exp2(l); fi = l + 1.0; f = (s - a)/a; }
  return mix(lev(uv, fi), lev(uv, fi+1.0), f);
}

// 凿痕：一片一片凿（每片约 120 像素，边界随噪声弯），每片自己的方向（±35°）、行距（10–18 像素），片里一行行短斜刀痕，两头浅。
// sp 返回行距，风化时按这个波长解析衰减
float chiselCell(vec2 p, ivec2 ci, out float sp){
  float ang = -0.62 + 1.2*(hash(ci, 7) - 0.5);
  sp = 10.0 + 8.0*hash(ci, 8);
  vec2 d = vec2(cos(ang), sin(ang)); vec2 n = vec2(-d.y, d.x);
  float v = dot(p, n)/sp; float row = floor(v); float fv = fract(v);
  float u = dot(p, d) + 47.0*hash(ivec2(int(row), ci.x*7 + ci.y), 1);
  float L = 18.0 + 28.0*hash(ivec2(int(row), ci.y*5 + ci.x), 4);
  float k = floor(u/L); float fu = fract(u/L);
  float rnd = hash(ivec2(int(row), int(k)), 2);
  float c = 0.5 + 0.25*(hash(ivec2(int(row), int(k)), 3) - 0.5);
  float w = 0.22 + 0.14*rnd;
  float prof = max(0.0, 1.0 - abs(fv - c)/w); prof = prof*prof*(3.0 - 2.0*prof);
  float taper = pow(clamp(sin(3.14159*fu), 0.0, 1.0), 0.5);
  return prof*taper*(0.5 + 0.9*rnd)*step(0.12, hash(ivec2(int(row), int(k)), 5));
}
// 一片一片凿：片界附近（片宽的 18% 以内）和隔壁那片的凿痕交叉淡变，不出一道直缝（11-11 评审：墙面方格接缝太明显）
float chiselAt(vec2 p, out float sp){
  vec2 q = p + 30.0*(vec2(fbm(p/90.0, 3, 2), fbm(p/90.0 + 5.0, 4, 2)) - 0.5)*2.0;
  vec2 cq = q/120.0; ivec2 ci = ivec2(floor(cq)); vec2 f = fract(cq);
  int nx = f.x > 0.5 ? 1 : -1, ny = f.y > 0.5 ? 1 : -1;
  float ax = 0.5*smoothstep(0.82, 1.0, max(f.x, 1.0 - f.x)), ay = 0.5*smoothstep(0.82, 1.0, max(f.y, 1.0 - f.y));
  float s00, s10, s01, s11;
  float g = chiselCell(p, ci, s00); sp = s00;
  if(ax > 0.0){ float g10 = chiselCell(p, ci + ivec2(nx, 0), s10); g = mix(g, g10, ax); sp = mix(sp, s10, ax); }
  if(ay > 0.0){
    float g01 = chiselCell(p, ci + ivec2(0, ny), s01), sp01 = s01;
    if(ax > 0.0){ float g11 = chiselCell(p, ci + ivec2(nx, ny), s11); g01 = mix(g01, g11, ax); sp01 = mix(s01, s11, ax); }
    g = mix(g, g01, ay); sp = mix(sp, sp01, ay);
  }
  return g + 0.3*(vnoise(p/1.8, 9) - 0.5);
}

// 清代重妆的颜色（第 9 窟前室的保存状态：朱红亮而暖，是一层不透明的粉；石青、石绿是点缀）
const vec3 ZHU = vec3(0.80, 0.25, 0.13);      // 朱砂
const vec3 SHIQING = vec3(0.20, 0.30, 0.50);  // 石青（掺墨，发色）
const vec3 SHILV = vec3(0.30, 0.52, 0.42);    // 石绿
const vec3 FENROU = vec3(0.90, 0.83, 0.74);   // 粉肉色（白粉调赭；和砂岩本色很近）
const vec3 MOQING = vec3(0.20, 0.22, 0.27);   // 墨青（配饰：眼镜、帽子）
const vec3 NIPI = vec3(0.76, 0.69, 0.60);     // 泥皮（黄土掺麻刀）
const vec3 MO = vec3(0.10, 0.09, 0.09);       // 墨（勾线）

void main(){
  vec2 p = gl_FragCoord.xy; vec2 uv = p/uRes; vec2 P = p + uSeed; float tau = uTau;
  float h0 = texture(uH0, uv).r*uHmax;
  float b2 = lev(uv, 2.0), b4 = lev(uv, 3.0), b16 = lev(uv, 5.0);
  vec4 insT = texture(uIns, uv);
  float fk = insT.a, arch = step(0.5, fk), orn = step(1.5, fk);   // 龛：壁面算地子（有凿痕），龛沿、楣面、火焰是磨过的面
  float fig = smoothstep(0.6, 2.5, h0)*(1.0 - arch);
  float conv = clamp((b2 - b16)/6.0, -1.0, 1.0), cv = max(conv, 0.0);
  float cav = clamp((b16 - b2)/6.0, 0.0, 1.0);
  float cvP = clamp((b4 - b16)/6.0, 0.0, 1.0), cavP = clamp((b16 - b4)/6.0, 0.0, 1.0);   // 只认大起伏（肩、领、褶），不认衣料纹理
  float gy = (lev(uv + vec2(0.0, 2.0)/uRes, 3.0) - lev(uv - vec2(0.0, 2.0)/uRes, 3.0))/4.0;
  float up = clamp(gy/0.6, 0.0, 1.0), down = clamp(-gy/0.6, 0.0, 1.0);   // 朝上 / 朝下的面（y 向下，高度往下涨 = 面朝上）
  float gyC = (lev(uv + vec2(0.0, 6.0)/uRes, 4.0) - lev(uv - vec2(0.0, 6.0)/uRes, 4.0))/12.0;
  float upC = clamp(gyC/0.4, 0.0, 1.0), downC = clamp(-gyC/0.4, 0.0, 1.0);   // 大尺度（σ8）：下巴底下、领口下、手臂下这种大面
  vec4 fd = texture(uField, uv);
  float thL = fd.r*uHmax, shel = fd.g, thS = fd.b*uHmax;
  float yr = uv.y;
  vec4 rg = vec4(0.0);
  if(uHasReg == 1){
    rg = texture(uReg, uv);
    float sm = rg.r + rg.g + rg.b + rg.a;
    if(sm < 0.5){ vec4 rb = textureLod(uReg, uv, 3.0); float sb = rb.r + rb.g + rb.b + rb.a; if(sb > 0.05) rg = mix(rb/sb, rg/max(sm, 1e-3), sm/0.5); }
  }
  float skin = rg.g*fig;

  // 渗水斑：从崖顶裂隙口往下、往外洇开的深褐晕斑，边上一圈更深的水线（第 20 窟以西窟顶的渗水斑）
  float stain = 0.0;
  for(int i=0; i<4; i++){
    vec4 s = uStreak[i]; if(s.w <= 0.0) continue;
    vec2 c = vec2(s.x, s.y)*uRes; vec2 q = p - c;
    q += 0.35*s.z*vec2(fbm(P/60.0, 20+i, 3) - 0.5, fbm(P/60.0 + 9.0, 24+i, 3) - 0.5)*2.0;   // 边口不圆
    float sy = q.y > 0.0 ? 2.4 : 0.8;                    // 往下洇得远，往上一点点
    float d = length(vec2(q.x, q.y/sy))/s.z;
    float f = clamp(1.0 - d, 0.0, 1.0);
    f = f*(0.6 + 0.8*fbm(P/40.0, 30+i, 3));
    stain = max(stain, smoothstep(0.0, 0.85, f)*s.w);
  }
  float ring = stain > 0.04 ? pow(1.0 - abs(fract(stain*2.2 + 0.15*vnoise(P/9.0, 37)) - 0.5)*2.0, 10.0) : 0.0;
  float wetB = pow(smoothstep(0.62, 1.0, yr), 1.3);   // 底部潮（毛细上升）
  float wet = clamp(wetB + 0.4*stain, 0.0, 1.0);

  // 层理：近水平、宽窄不一；有的层软（含泥多、颜色灰紫、风化快），软层边界清楚
  float bed = 0.5 + 0.5*sin(6.2832*(P.y/105.0 + 1.6*fbm(vec2(P.x/900.0, P.y/420.0), 17, 2)) + 9.0*fbm(vec2(P.x/450.0, P.y/200.0), 11, 3));   // 层厚不匀
  float layerSel = smoothstep(0.45, 0.7, fbm(vec2(P.x/900.0, P.y/105.0), 12, 2));
  float soft = uKind2.x*smoothstep(0.3, 0.85, bed)*layerSel;
  float Rh = 1.0 - 0.45*soft;
  float E = clamp(0.65 + 0.55*cv + 0.25*up + 0.35*wet - 0.3*cav + 0.4*orn, 0.2, 1.8);   // 暴露度（凸出的龛楣、柱、龛尾迎着风雨，风化得快）

  // 泥皮、彩画的保护度。像身：凹处、褶缝高，凸棱、朝上、脸上、潮处低（凸棱先掉回石色）；
  // 地子：是退进去的平底，彩画留得最久（第 1–4 窟的残红就在龛里的平底上），紧贴像身的转角最久
  float protF = 2.6*cavP + 1.3*cav - 2.4*cvP - 0.4*up - 1.6*skin - 1.6*rg.a*fig - 0.3*wet;
  float NG = (fbm(P/130.0 + 1.7, 85, 2) - 0.5)/0.14;      // 地子：很低频的大片，不出碎点
  float protG = 0.3 + cav*(0.6 + 1.0*smoothstep(-0.6, 0.8, NG)) - 0.3*wet + 0.15*NG;   // 11-11 夜二：噪声权重减半，残彩只留在转角、贴像身处，龛里平底不再一团团   // 转角也只是断续的几片，不成一圈光晕；11-11：平地子掉得更快（1907 空地子基本掉光，原来到处是软边圆斑，黑白片里像树影）
  float prot = mix(protG, protF, fig) - 0.65*arch;   // 龛外的壁面、龛楣是凸出来、迎着风雨的面，彩画比龛里的平底掉得早
  float jag = 0.3*(vnoise(P/9.0, 63) - 0.5) + 0.1*(vnoise(P/2.5, 64) - 0.5);
  float NP = (fbm(P/30.0 + 2.7, 81, 3) - 0.5)/0.13, NPc = (fbm(P/30.0 + 2.7, 81, 2) - 0.5)/0.13;
  float NQ = (fbm(P/40.0 + 5.3, 91, 3) - 0.5)/0.13, NQc = (fbm(P/40.0 + 5.3, 91, 2) - 0.5)/0.13;
  float plKeep = uPaint*fig*smoothstep(-0.12, 0.12, prot + 0.32*NP + 0.1*jag - uPlLoss)*smoothstep(-0.5, -0.15, prot + 0.32*NPc - uPlLoss);
  // 像身：成片掉，噪声低频、过渡偏软（变薄发虚，不切出迷彩）；地子：粉化着淡掉
  float NQf = (fbm(P/60.0 + 5.3, 91, 2) - 0.5)/0.14;
  float wE = mix(0.34, 0.28, fig);
  float pKeep = uPaint*smoothstep(-wE, wE, prot + fig*(0.15*NQf + 0.06*jag) - uPaLoss)*mix(1.0, plKeep, fig);   // 像身上主要是变薄，不切成迷彩

  // 1 扩散软化：σ = √(2·D·τ)，D 随暴露度、硬度变。不治水时表面松了以后磨圆加速：再加一项 σ，五官像化开的蜡，外轮廓留得最久
  float tauD = tau - uGood*max(0.0, tau - 1.0);        // 损伤剂量：治水以后不再长
  float sigW2 = 2.0*uKind.x*E/Rh*tau;
  float melt = 15.5*uBad + 6.0*uBad*soft;              // 软层里磨得更狠
  float h = stackAt(uv, sqrt(sigW2 + melt*melt*(0.7 + 0.3*E)*(1.0 + 1.5*arch*uBad)));   // 不治水：凸出的龛楣、龛口的棱也磨圆
  if(uBad > 0.0 && orn > 0.5){
    // 不治水：最凸的龛沿、楣面、火焰、涡卷还要化得更开。金字塔最粗只到 σ16，这里在 σ16 那层上再取一圈 8 个点平均（约 σ24），只在这些地方做
    float hb = stackAt(uv, 16.0);
    for(int i = 0; i < 8; i++){ float a = 0.7854*float(i); hb += stackAt(uv + 22.0*vec2(cos(a), sin(a))/uRes, 16.0); }
    h = mix(h, hb/9.0, 0.85*uBad);
  }
  // 凿痕：在最外一层，风化得比整体快（3 倍）；按自己的行距解析衰减 exp(−2π²σ²/ℓ²)；彩画的地仗把它盖住
  float sp; float g = chiselAt(P + arch*vec2(531.0, 277.0), sp);
  float sigC2 = 3.0*2.0*uKind.x*E*tau + melt*melt;
  float inStele = uStele.z > 0.0 ? (smoothstep(uStele.x - 4.0, uStele.x + 4.0, p.x)*smoothstep(uStele.z + 4.0, uStele.z - 4.0, p.x)
                                   *smoothstep(uStele.y - 4.0, uStele.y + 4.0, p.y)*smoothstep(uStele.w + 4.0, uStele.w - 4.0, p.y)) : 0.0;
  h -= uChisel*g*(1.0 - fig)*exp(-19.74*sigC2/(sp*sp))*(1.0 - 0.85*pKeep)*(1.0 - inStele)*(1.0 - 0.7*orn);
  // 题名、题记：刻槽宽窄定波长 ℓ = 2w，深度按 exp(−2π²σ²/ℓ²) 衰减——细浅的笔画几百年就模糊了，重笔留到今天
  vec2 ins = insT.rg;
  if(ins.x > 0.0) h -= ins.x*exp(-19.74*(2.0*uKind.x*E*tau + melt*melt)/(4.0*ins.y*ins.y + 0.5));
  // 2 突起后退（小顶帽）
  h -= 0.5*thS*clamp(tauD*E - 0.2, 0.0, 1.4)*(1.0 - 0.8*uBad*orn);
  // 3 大突起崩缺：顶帽超出断口高度的部分削短，断面粗、和周围同色。断口随剂量往下走，最高的鼻尖先断
  float brk = max(3.5, 26.0*exp(-1.6*max(0.0, tauD*E - 0.6)));
  float over = max(0.0, thL - brk);
  float chip = smoothstep(0.0, 3.0, over);
  h -= (over + chip*0.6*(vnoise(P/2.2, 13) - 0.3))*(1.0 - 0.8*uBad*orn);   // 不治水：龛楣、涡卷上的断口也跟着化开（这两项按原几何算，不淡掉就留一圈利的黑线）
  // 4 根部掏蚀：底部一道起伏的线以下掏出一个个圆凹窝，窝里磨圆
  float yL = 0.84 - 0.06*uBad + 0.05*(fbm(vec2(P.x/170.0, 3.3), 35, 3) - 0.5)*2.0 + 0.05*(hash(ivec2(uSeed), 36) - 0.5) - 0.03*cvP;
  float pocket = clamp((fbm(vec2(P.x/70.0, P.y/55.0), 31, 2) - 0.3)*2.5, 0.0, 1.0);   // 连续起伏的凹窝，不切硬边
  float alc = smoothstep(yL, yL + 0.09, yr)*pocket;
  float aDep = tau*tau*(0.4 + 3.6*uBad);
  h = mix(h, stackAt(uv, 15.0), clamp(alc*(0.1 + 0.6*uBad), 0.0, 0.7));
  h -= alc*aDep;
  // 5 软层：整条凹进去，边上是台阶
  h -= soft*tau*tau*(0.25 + 2.6*uBad)*(0.7 + 0.6*fbm(vec2(P.x/160.0, P.y/100.0), 33, 3))*(1.0 - 0.4*skin);   // 脸上浅一些（掠射光下不像遮眼条）
  // 6 粉化：细小的坑，成簇，只在潮处、软层，浅
  float pw = uKind.z*tau*(0.15 + 0.7*wet + 0.4*soft)*(1.0 - 0.5*uGood);
  float gr = vnoise(P/uKind2.w, 41)*0.6 + vnoise(P/(2.4*uKind2.w), 43)*0.4;
  float pthr = 1.0 - 0.2*pw;
  float clus = smoothstep(0.42, 0.7, fbm(P/26.0, 45, 3) + 0.2*wet);
  float pits = smoothstep(pthr, pthr + 0.1, gr)*clus;
  h -= pits*(0.25 + 0.35*pw);
  // 7 片状剥落：沿层理成片，层厚不一，有的边陡有的边缓；凸处、软层、潮处多，脸上和空地子上少；治水以后不再新剥
  vec2 wq = vec2(P.x/70.0, P.y/55.0) + 0.6*vec2(fbm(P/55.0, 51, 3), fbm(P/55.0 + 7.0, 53, 3));
  float F1 = (fbm(wq, 61, 3) - 0.5)/0.13 + jag;
  float Fc = (fbm(wq, 61, 2) - 0.5)/0.13;
  float F2 = (fbm(wq*1.6 + 3.1, 71, 3) - 0.5)/0.13 + jag;
  float S = E*(0.45 + 0.7*cvP + 0.3*wetB)*(1.0 - 0.6*skin)*(0.55 + 0.45*fig);   // 不和软层挂钩：否则剥落沿层理成长条，每条一道陡坎，看着是横线
  float Pr = max(0.0, tauD - 0.35)*S*uKind.y*(1.0 + 0.3*uBad);
  float t1 = -3.6 + 2.4*Pr;
  float ew = 0.05 + 0.3*vnoise(P/35.0, 66);
  float m1 = smoothstep(t1 + ew, t1 - ew, F1)*smoothstep(t1 + 0.6, t1 + 0.2, Fc);
  float m2 = m1*smoothstep(t1 - 0.7 + ew, t1 - 0.7 - ew, F2);
  float d1 = 1.8 + 1.6*vnoise(P/70.0, 67);
  h -= m1*d1 + m2*1.5;
  float scarAge = clamp((t1 - F1)/1.8, 0.0, 1.0);
  h += (m1 + m2)*0.6*(vnoise(P/1.6, 65) - 0.5);    // 剥落面粗
  // 8 泥皮：1651 把当年的样子抹平、补上剥落，只在像身上
  float a = uAge;
  float hp = stackAt(uv, sqrt(2.0*uKind.x*E/Rh*uTauP + 2.5 + 1.2*uKind.x*E*a)) + 0.5 - 0.5*thS*clamp(uTauP*E - 0.2, 0.0, 1.4);
  h = mix(h, max(h, hp), plKeep);

  // 盐霜：从底部往上渐淡的柔和粉白
  float salt = uKind.w*(smoothstep(0.85, 1.0, tau)*0.3*(1.0 - 0.8*uGood) + 0.7*uBad);
  float zone = smoothstep(yL - 0.12, 1.0, yr);
  float bloom = smoothstep(0.35, 0.75, fbm(P/55.0, 113, 4));
  float sa = clamp(salt*zone*bloom*(0.85 + 0.15*vnoise(P/1.6, 115)), 0.0, 0.55);
  h += 0.25*sa;

  // ---- 颜色 ----
  float age = smoothstep(0.0, 0.9, tau);
  float clean = 1.0 - 0.6*uGood;                     // 治水：保养清理过，更匀更干净
  float keepDetail = 1.0 - 0.85*smoothstep(0.0, 0.8, uBad);   // 几何磨圆了，原来凹凸留下的颜色也跟着淡（不然像照片印在石头上）
  float cavC = mix(cavP, cav, 0.4)*keepDetail;
  vec3 col = mix(uFresh, uOld, age);
  col *= 0.95 + 0.10*(fbm(P/110.0, 101, 4) - 0.5)*2.0*age*clean + 0.04*(fbm(P/7.0, 105, 3) - 0.5);
  // 岩层色带：软层灰紫、偏深（第 20 窟大佛胸腹的深浅横条），风化后更显
  float strat = uKind2.x*(0.8*soft + 0.2*smoothstep(0.5, 0.75, fbm(vec2(P.x/900.0, P.y/90.0), 109, 3)));
  col *= mix(vec3(1.0), vec3(0.88, 0.84, 0.82), strat*(0.3 + 0.3*age + 0.5*uBad)*(1.0 - 0.6*skin));   // 软层偏褐、偏深；脸上淡
  col *= 1.0 - 0.10*wetB*age*(1.0 - 0.5*uGood);                          // 下部潮暗
  float ochre = smoothstep(0.6, 0.78, fbm(vec2(P.x/60.0, P.y/260.0) + 3.0, 103, 4))*age*clean;
  col = mix(col, col*vec3(1.05, 0.9, 0.76), 0.25*ochre*uKind2.y);   // 铁质黄斑：顺水流方向拉长、很弱
  col *= 1.0 - 0.2*cavC*age;                                               // 凹处旧灰
  col *= 1.0 + 0.05*uGood;
  vec3 freshFace = uFresh*vec3(1.02, 0.98, 0.92);
  col = mix(col, mix(freshFace, col, 0.5 + 0.4*scarAge), max(m1, m2));    // 新茬口只略亮略黄
  col = mix(col, freshFace*0.98, 0.45*chip);                               // 断口新、略浅
  col = mix(col, mix(col, vec3(dot(col, vec3(0.33))), 0.4)*1.04, alc*uBad*0.6);   // 掏蚀窝里泛白发灰
  col = mix(col, NIPI*(0.96 + 0.08*(vnoise(P/6.0, 121) - 0.5)), plKeep);
  // 彩画颜色：地子朱砂；像身按区域（头发石青、皮肤粉肉色、衣服石绿、配饰墨青）；区域交界和像的外轮廓勾墨线
  vec3 figPaint = FENROU;
  if(uHasReg == 1){ vec4 w4 = rg*rg*rg; float sm = w4.r + w4.g + w4.b + w4.a;   // 三次方：交界处颜色不互相晕染
    if(sm > 1e-4) figPaint = (w4.r*SHIQING + w4.g*FENROU + w4.b*SHILV + w4.a*MOQING)/sm; }
  vec3 paintC = mix(ZHU, figPaint, fig);
  // 龛（清代重妆的青绿配色）：壁面铁红；龛沿（柱、坛基、楣的内外沿、龛尾）石绿；楣面从里到外石绿 → 青绿 → 石青三道叠晕；
  // 火焰一个朱、一个粉白、一个石绿轮着来
  float fkI = floor(fk + 0.001), fkF = fk - fkI;
  vec3 archC = fkI < 1.5 ? vec3(0.56, 0.24, 0.17) : (fkI < 2.5 ? (fkF > 0.2 ? vec3(0.56, 0.24, 0.17) : SHILV) : (fkI < 3.5 ? (fkF < 0.13 ? SHILV : (fkF < 0.27 ? mix(SHILV, SHIQING, 0.5) : SHIQING))
             : (fkF < 0.05 ? ZHU : (fkF < 0.15 ? vec3(0.93, 0.89, 0.80) : SHILV))));
  paintC = mix(paintC, archC, arch);
  if(uNiche == 1) paintC = mix(paintC, vec3(0.47, 0.19, 0.13), (1.0 - arch)*(1.0 - fig));   // 龛里的后壁：和壁面一样的铁红，暗一些
  float brush = fbm(vec2(P.x/3.0 + P.y/14.0, P.y/3.0 - P.x/20.0), 131, 3);   // 斜向刷痕
  paintC *= 0.88 + 0.24*brush;
  float line = 0.0;
  if(uHasReg == 1){
    vec2 e = vec2(2.5, 0.0)/uRes;
    vec4 gx4 = texture(uReg, uv + e.xy) - texture(uReg, uv - e.xy), gy4 = texture(uReg, uv + e.yx) - texture(uReg, uv - e.yx);
    line = smoothstep(0.5, 0.9, length(vec2(length(gx4), length(gy4))))*fig;
  }
  {  // 像的外轮廓：地子到像身那一圈台阶
    vec2 e = vec2(2.0, 0.0)/uRes;
    float fx = smoothstep(0.6, 2.5, texture(uH0, uv + e.xy).r*uHmax) - smoothstep(0.6, 2.5, texture(uH0, uv - e.xy).r*uHmax);
    float fy = smoothstep(0.6, 2.5, texture(uH0, uv + e.yx).r*uHmax) - smoothstep(0.6, 2.5, texture(uH0, uv - e.yx).r*uHmax);
    line = max(line, smoothstep(0.25, 0.6, length(vec2(fx, fy))));
  }
  line *= 0.75 + 0.5*vnoise(P/6.0, 133);
  paintC = mix(paintC, MO, 0.7*line);
  paintC = mix(paintC, col, 0.35*cvP*smoothstep(0.0, 0.4, a));            // 凸处磨薄，透出底色
  float fade = clamp(0.1 + 0.6*a + 0.4*uGood, 0.0, 0.85);                   // 残色变淡、发粉
  paintC = mix(paintC, mix(vec3(dot(paintC, vec3(0.3, 0.5, 0.2))), col, 0.45), (0.55 + 0.35*fig)*fade);
  float thick = 0.84 + 0.16*smoothstep(0.3, 0.7, fbm(P/45.0, 135, 3));     // 颜料厚薄不匀，薄处略透石色
  col = mix(col, paintC, (0.95 - 0.45*smoothstep(0.4, 1.0, a))*thick*pKeep);   // 残色是一层淡粉
  // 煤尘：落在朝下的面、淋不到雨的地方和凹处，雨冲到的顶面和凸棱仍浅，黑白边界清楚；黑结壳不会自己掉
  // 煤尘、黑结壳：大面朝下、淋不到雨的地方成片蓝黑，往上慢慢淡掉；朝上的面被雨冲得发浅（第 38 窟一带的蓝黑结壳）
  float dust = uDust*(1.0 - 0.8*uGood);
  float dwt = (0.06 + 2.0*downC*keepDetail + 0.5*shel*keepDetail - 0.9*upC)*(1.0 - 0.85*skin)*(1.0 - 0.5*arch);   // 不治水：原来朝下的面已经磨圆了，积黑跟着淡
  float dw = smoothstep(0.08, 0.7, clamp(dust*dwt*(0.65 + 0.7*fbm(P/90.0, 107, 3)), 0.0, 1.0));
  vec3 soot = vec3(0.17, 0.18, 0.21)*(0.85 + 0.3*vnoise(P/2.0, 139));      // 颗粒状、哑光、偏蓝灰
  col = mix(col, soot, 0.75*dw);
  col = mix(col, col*vec3(0.80, 0.80, 0.82), 0.6*dust*skin);               // 脸上只是一层淡灰
  float crust = clamp(uKind2.z*(1.3*downC*keepDetail + 0.4*shel*keepDetail)*(0.2*tau + 0.6*uCoal)*(0.7 + 0.6*fbm(P/50.0, 108, 3)) - 0.15, 0.0, 0.55)*(1.0 - 0.85*uGood)*(1.0 - 0.85*skin)*(1.0 - 0.6*arch);
  col = mix(col, soot*0.95, crust);
  // 渗水：深褐到黑，边上一圈更深的潮线
  col = mix(col, col*vec3(0.40, 0.34, 0.28), clamp(stain*0.75, 0.0, 0.75));   // 渗水：深褐到黑
  col *= 1.0 - 0.3*ring*smoothstep(0.05, 0.3, stain);                      // 一圈圈潮痕
  col = mix(col, vec3(0.90, 0.88, 0.89), sa);

  // 刚刻出来的槽里铺着一层石粉：比石面浅、偏白、哑光（刻完几秒后吹掉）
  float powder = clamp(insT.b, 0.0, 1.0)*(0.75 + 0.5*vnoise(P/1.3, 141));
  col = mix(col, uFresh*vec3(1.08, 1.07, 1.04), 0.7*clamp(powder, 0.0, 1.0));
  if(fk < 0.5) col *= 1.0 - 0.6*fk;   // 龛里：靠拱顶、龛壁的地方天光进不来，暗一些（帧代码的小数部分）
  float rough = 0.25*powder + 1.0 + 0.8*max(m1, m2) + 0.8*chip + 0.4*min(pw, 1.0) + 0.2*sa - 0.7*plKeep - 0.15*pKeep - 0.3*alc*uBad - 0.2*uGood;
  if(uWxDbg == 1) col = vec3(plKeep); else if(uWxDbg == 2) col = vec3(pKeep);
  else if(uWxDbg == 3) col = vec3(clamp(prot*0.25 + 0.5, 0.0, 1.0));
  else if(uWxDbg == 4) col = vec3(cvP, cavP, up); else if(uWxDbg == 5) col = vec3(wet); else if(uWxDbg == 6) col = vec3(down, shel, 0.0);
  oH = h/uHmax;
  oA = vec4(clamp(col, 0.0, 1.0), clamp(rough/1.6, 0.0, 1.0));
}`;


// 读回当前（风化后）高度：缩小采样（2×2 个点取平均），16 位编码进 RGBA8 的 r、g（传拓要在 CPU 上用）
const FS_ENC = HEAD + `
uniform sampler2D uSrc; uniform vec2 uOut;
out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy/uOut, d = 0.25/uOut;
  float h = 0.25*(texture(uSrc, uv + vec2(-d.x, -d.y)).r + texture(uSrc, uv + vec2(d.x, -d.y)).r + texture(uSrc, uv + vec2(-d.x, d.y)).r + texture(uSrc, uv + vec2(d.x, d.y)).r);
  float v = clamp(h*0.8 + 0.1, 0.0, 1.0)*255.0;
  o = vec4(floor(v)/255.0, fract(v), 0.0, 1.0);
}`;

// 开凿过场（F5）：用高斯金字塔由粗到细重建的真实中间结果（《营造法式》“造作次序”由粗到细）：
// 0 平壁 → 0.25 粗坯（最粗一层慢慢升起来）→ 0.55 出形 → 0.8 细雕 → 1 线刻（刻完，交回风化那一遍的结果）
const FS_CARVE = HEAD + NOISE + `
uniform sampler2DArray uStack; uniform sampler2D uW; uniform vec2 uRes; uniform float uHmax; uniform float uCarve;
out float o;
float lev(vec2 uv, float i){ return texture(uStack, vec3(uv, i)).r; }
void main(){
  vec2 p = gl_FragCoord.xy; vec2 uv = p/uRes; float c = uCarve;
  float sc = c < 0.25 ? 16.0 : (c < 0.55 ? mix(16.0, 4.0, (c - 0.25)/0.3) : (c < 0.8 ? mix(4.0, 1.0, (c - 0.55)/0.25) : mix(1.0, 0.0, (c - 0.8)/0.2)));
  float fi, f; if(sc < 1.0){ fi = 0.0; f = sc; } else { float l = floor(log2(sc)); float a = exp2(l); fi = min(l + 1.0, 4.0); f = (sc - exp2(fi - 1.0))/exp2(fi - 1.0); }
  float h = mix(lev(uv, fi), lev(uv, min(fi + 1.0, 5.0)), clamp(f, 0.0, 1.0))*smoothstep(0.0, 0.25, c);
  h += 0.6/uHmax*(1.0 - smoothstep(0.55, 0.9, c))*(vnoise(p/3.0, 141) - 0.5)*smoothstep(0.05, 0.3, c);   // 粗坯上的錾点
  o = mix(h, texture(uW, uv).r, smoothstep(0.85, 1.0, c));   // 最后一段交回带凿痕的成品
}`;

// 遮蔽：每个像素 12 个方向各找地平线仰角，V = 平均 cos²φ（方案 4.3(3)）。高度变了才重算，半分辨率（遮蔽本身是低频）。
const FS_AO = COMMON + `
out vec4 o;
void main(){
  vec2 p = gl_FragCoord.xy*2.0; float h0 = H(p); float acc = 0.0;
  for(int d=0; d<12; d++){
    float a = 6.2831853*(float(d)+0.5)/12.0; vec2 dir = vec2(cos(a), sin(a));
    float tmax = 0.0; float t = 1.5;
    for(int i=0; i<10; i++){
      float tn = (H(p+dir*t)-h0)/t; tmax = max(tmax, tn); t *= 1.5;
    }
    acc += 1.0/(1.0+tmax*tmax);
  }
  o = vec4(acc/12.0, 0.0, 0.0, 1.0);
}`;

const FS_MAIN = COMMON + `
in vec2 vUV; out vec4 o;
uniform sampler2D uAO;
uniform sampler2D uAlbT;   // 风化后的颜色（rgb）+ 粗糙（a）
uniform int uPoint;        // 0 平行光（日），1 点光源（火、灯）
uniform vec3 uL;           // 平行光方向（x 右、y 下、z 朝外）
uniform vec3 uP;           // 点光源位置（像素）
uniform vec3 uCol;         // 光色 × 强度
uniform float uFall;       // 点光源衰减参考距离
uniform float uCone;       // 射灯光锥（cos 半角），0 = 没有光锥
uniform vec2 uAim;         // 射灯对准的点（像素）：平时是浮雕中心，推镜头到碑上时转向碑
uniform float uSigma; uniform float uWrap; uniform float uAmb; uniform vec3 uAmbCol;
uniform float uExpo; uniform int uMeter; uniform float uShadowK; uniform int uDbg;
uniform float uOldPh;      // 1907：老照片（0..1）
uniform float uOldGain;    // 老照片的基准增益（日 1，火、灯整体暗，先提亮再上曲线）
uniform float uEdge;       // 录视频：浮雕四边淡进舞台底色的宽度（占短边的比例，0 = 不淡）
uniform vec3 uBg;

float shadow(vec2 p, float h0, vec3 L, float tLim){
  float pl = length(L.xy); if(pl < 1e-3) return 1.0;
  vec2 dir = L.xy/pl; float slope = L.z/pl; float vis = 1.0;
  float t = 0.8; float tEnd = min(tLim, 0.3*max(uRes.x,uRes.y));
  float k = pow(tEnd/0.8, 1.0/47.0);
  for(int i=0; i<48; i++){
    if(t > tEnd) break;
    float hs = H(p+dir*t);
    vis = min(vis, clamp(uShadowK*((h0+slope*t)-hs)/t + 0.5, 0.0, 1.0));
    t *= k;
  }
  return vis;
}

float orenNayar(vec3 n, vec3 L, float s){
  float s2 = s*s; float A = 1.0-0.5*s2/(s2+0.33); float B = 0.45*s2/(s2+0.09);
  float ci = clamp(dot(n,L),0.0,1.0); float cr = clamp(n.z,1e-4,1.0);
  vec3 li = L-n*ci; vec3 lr = vec3(0,0,1)-n*cr;
  float cphi = clamp(dot(li,lr)/(length(li)*length(lr)+1e-6),0.0,1.0);
  float ti = acos(ci), tr = acos(cr);
  float al = max(ti,tr), be = min(ti,tr);
  return ci*(A + B*cphi*sin(al)*tan(be));
}

float gk;
float Hg(vec2 q){ return H(q) + gk*(texture(uNoise, q/uRes).r-0.5)*2.0; }

void main(){
  vec2 p = vUV*uRes;
  vec4 at = texture(uAlbT, vUV);
  gk = uGrain*at.a*1.6;   // 颗粒按风化后的粗糙走：泥皮、彩画上平，剥落面、粉化处粗
  float h0 = Hg(p);
  float gx = (Hg(p+vec2(1,-1))+2.0*Hg(p+vec2(1,0))+Hg(p+vec2(1,1)) - Hg(p+vec2(-1,-1))-2.0*Hg(p+vec2(-1,0))-Hg(p+vec2(-1,1)))/8.0;
  float gy = (Hg(p+vec2(-1,1))+2.0*Hg(p+vec2(0,1))+Hg(p+vec2(1,1)) - Hg(p+vec2(-1,-1))-2.0*Hg(p+vec2(0,-1))-Hg(p+vec2(1,-1)))/8.0;
  vec3 n = normalize(vec3(-gx,-gy,1.0));
  vec3 L; float att = 1.0; float tLim = 1e9;
  if(uPoint==1){
    vec3 d = uP - vec3(p, H(p)); float dl = length(d); L = d/dl;
    att = uFall*uFall/(dl*dl + 0.35*uFall*uFall); tLim = length(d.xy);   // 分母加一项：灯贴近时不至于一片白（0.15 时火把跟前是一块平的橙色）
    if(uCone > 0.0){
      vec3 axis = normalize(vec3(uAim, 0.0) - uP);
      float c = dot(-L, axis);
      att *= smoothstep(uCone, uCone + 0.18, c);
    }
  } else { L = normalize(uL); }
  float diff = orenNayar(n, L, uSigma);
  if(uWrap > 0.0){ diff = mix(diff, max((dot(n,L)+uWrap)/(1.0+uWrap),0.0)*0.85, 0.5); }
  float sh = shadow(p, H(p), L, tLim);
  float ao = texture(uAO, vUV).r;
  ao = clamp((ao-0.55)/0.45, 0.0, 1.0); ao = mix(0.35, 1.0, ao);
  vec3 shade = uAmb*uAmbCol*ao + uCol*diff*sh*att*(0.6+0.4*ao);
  if(uDbg==1){ o=vec4(vec3(sh),1); return; } if(uDbg==2){ o=vec4(vec3(ao),1); return; } if(uDbg==3){ o=vec4(vec3(diff),1); return; } if(uDbg==4){ o=vec4(vec3(H(p)/uHScale),1); return; }
  if(uDbg==5){ o=vec4(at.rgb,1); return; }
  if(uMeter==1){ o = vec4(clamp(dot(shade, vec3(0.3,0.5,0.2))*0.5, 0.0, 1.0), 0, 0, 1); return; }   // 8 位存，量程 0–2
  float alb = 0.94 + 0.10*texture(uNoise, vUV).g;
  vec3 c = at.rgb*alb*shade*uExpo;
  // 高光按亮度压，超出 1 的按最大通道整体缩：逐通道截断会把火光的红先削平，颜色往黄白偏
  float lum = dot(c, vec3(0.3,0.5,0.2));
  c = c/(1.0+0.12*lum);
  c = c/max(1.0, max(c.r, max(c.g, c.b)));
  if(uOldPh > 0.0){
    // 1907 沙畹的玻璃底片：正色片对红光不敏感（朱砂拍出来近黑、青绿偏亮）；暗部发灰、暖褐调、暗角、银粒
    float l = clamp(dot(c, vec3(0.18, 0.56, 0.26))*1.1*uOldGain, 0.0, 1.0);
    l = smoothstep(0.1, 0.82, l); l = 0.02 + 0.97*mix(l, l*l*(3.0 - 2.0*l), 0.5);   // 反差拉到和沙畹原片相当（10–90 分位约 45–195）
    vec2 dd = vUV - 0.5; float vig = 1.0 - 0.9*dot(dd, dd);
    ivec2 ip = ivec2(gl_FragCoord.xy);
    uint hh = uint(ip.x)*1597334677u ^ uint(ip.y)*3812015801u; hh ^= hh >> 15; hh *= 2246822519u; hh ^= hh >> 13;
    float gn = float(hh & 65535u)/65535.0 - 0.5;
    vec3 sep = vec3(1.0, 0.95, 0.86)*(l*vig + 0.09*gn);
    c = mix(c, clamp(sep, 0.0, 1.0), uOldPh);
  }
  if(uEdge > 0.0){
    vec2 q = min(vUV, 1.0 - vUV)*uRes/min(uRes.x, uRes.y);
    float f = smoothstep(0.0, uEdge, min(q.x, q.y)); c = mix(uBg, c, f*f);
  }
  o = vec4(c, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl, fs, vs = VS) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "aPos"); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}

// 值噪声分形（和 Python fbm 同一思路：多倍频随机格点双三次放大）
function fbm(w, h, base, octaves, seed) {
  let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = new Float32Array(w * h); let amp = 1, tot = 0, cell = base;
  for (let o = 0; o < octaves; o++) {
    const gw = Math.ceil(w / cell) + 3, gh = Math.ceil(h / cell) + 3; const g = new Float32Array(gw * gh);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    for (let y = 0; y < h; y++) {
      const fy = y / cell, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < w; x++) {
        const fx = x / cell, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
        const a = g[iy * gw + ix], b = g[iy * gw + ix + 1], c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
        out[y * w + x] += amp * ((a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy);
      }
    }
    tot += amp; amp *= 0.5; cell = Math.max(1, cell >> 1);
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

// fresh / old：新鲜面、旧面（11-10 从 6 张云冈实拍的 Lab K-means 主色定色相：亮面约 R:G:B = 1 : 0.88 : 0.79，偏粉的黄褐，见 设计/参考/图）；weather：扩散、片落、粉化、盐霜的系数；weather2：层理、黄斑、黑结壳、坑的大小
export const STONES = {
  "云冈砂岩": { fresh: [0.93, 0.84, 0.70], old: [0.82, 0.74, 0.65], grain: 0.35, sigma: 0.6, wrap: 0.0, weather: [3.6, 1.0, 1.0, 1.0], weather2: [1.0, 1.0, 1.0, 1.4] },
  "汉白玉": { fresh: [0.93, 0.92, 0.89], old: [0.84, 0.83, 0.79], grain: 0.12, sigma: 0.25, wrap: 0.35, weather: [1.1, 0.35, 0.8, 0.6], weather2: [0.0, 0.25, 1.4, 0.9] },   // 汉白玉：没有层理，糖粒化（细坑）、黑结壳重
};

const LEVELS = [0, 1, 2, 4, 8, 16];

export class ReliefRenderer {
  constructor(canvas) {
    this.cv = canvas;
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("浏览器不支持 WebGL2");
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("浏览器不支持浮点渲染目标");
    gl.getExtension("OES_texture_float_linear");
    this.gl = gl;
    this.pMain = program(gl, FS_MAIN); this.pAO = program(gl, FS_AO, VS_OFF);
    this.pBase = program(gl, FS_BASE, VS_OFF); this.pBlurA = program(gl, FS_BLUR_A, VS_OFF); this.pBlur2 = program(gl, FS_BLUR_2, VS_OFF);
    this.pMinMax = program(gl, FS_MINMAX, VS_OFF); this.pField = program(gl, FS_FIELD, VS_OFF); this.pWx = program(gl, FS_WEATHER, VS_OFF);
    this.pCarve = program(gl, FS_CARVE, VS_OFF); this.pEnc = program(gl, FS_ENC, VS_OFF);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.meter = this._target(160, 160, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.expo = 1.0; this.scale = 1.0; this.stone = "云冈砂岩";
    this.gain = 1.0;                 // 亮场主题：曝光整体提一档（投影对比度低）
    this.bg = [0.07, 0.063, 0.051];  // 舞台底色，跟着主题的 CSS 变量走
    this.light = { point: false, dir: [-0.55, -0.65, 0.52], pos: [0, 0, 0], col: [1, 0.97, 0.92], fall: 1, amb: 0.14, ambCol: [1, 1, 1] };
    // 时间：默认 483 刚刻成
    this.time = { tau: 0, tauP: 0, age: 0, paint: 0, plLoss: -3, paLoss: -3, dust: 0, coal: 0, good: 0, bad: 0, old: 0, streaks: new Float32Array(16) };
    this._tex1 = this._tex(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this._made = [];
  }

  _tex(w, h, ifmt, fmt, type, data, filter) {
    const gl = this.gl; const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data);
    const f = filter || gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  _target(w, h, ifmt, fmt, type) {
    const gl = this.gl; const tex = this._tex(w, h, ifmt, fmt, type, null);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h };
  }
  // 换作品时把上一件的纹理、帧缓冲都删掉
  _free() {
    const gl = this.gl;
    for (const o of this._made) { if (o instanceof WebGLTexture) gl.deleteTexture(o); else gl.deleteFramebuffer(o); }
    this._made = [];
  }
  _keep(x) { if (x && x.fb) this._made.push(x.tex, x.fb); else this._made.push(x); return x; }

  // 一遍全屏绘制：texs = [[uniform 名, 纹理, 纹理类型]]，其他 uniform 由 set(u) 设
  _pass(P, fb, w, h, texs, set) {
    const gl = this.gl; gl.useProgram(P.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, w, h);
    texs.forEach(([name, t, kind], i) => {
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(kind || gl.TEXTURE_2D, t); gl.uniform1i(P.u[name], i);
    });
    if (P.u.uRes) gl.uniform2f(P.u.uRes, this.w, this.h);
    if (P.u.uHmax) gl.uniform1f(P.u.uHmax, this.hmax);
    if (set) set(P.u);
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    texs.forEach(([, , kind], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(kind || gl.TEXTURE_2D, null); });   // 解绑，免得下一遍读写同一纹理
  }

  // heights：Float32Array（像素单位），w × h；reg：可选，{ w, h, data: Uint8Array RGBA }
  setRelief(heights, w, h, reg) {
    const gl = this.gl; this._free(); this.texCarve = null; this._hTex = null;
    if (this.texIns) { gl.deleteTexture(this.texIns); this.texIns = null; }
    let mx = 1e-6; for (let i = 0; i < heights.length; i++) mx = Math.max(mx, heights[i]);
    const norm = new Float32Array(heights.length); for (let i = 0; i < heights.length; i++) norm[i] = heights[i] / mx;
    this.hmax = mx; this.w = w; this.h = h;
    this.texH0 = this._keep(this._tex(w, h, gl.R16F, gl.RED, gl.FLOAT, norm));
    const g1 = fbm(w, h, 5, 3, 11), g2 = fbm(w, h, 40, 4, 12);
    const nz = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { nz[4 * i] = g1[i] * 255; nz[4 * i + 1] = g2[i] * 255; nz[4 * i + 3] = 255; }
    this.texN = this._keep(this._tex(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, nz));
    this.texReg = reg ? this._keep(this._tex(reg.w, reg.h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, reg.data)) : this._tex1;
    if (reg) { gl.bindTexture(gl.TEXTURE_2D, this.texReg); gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    this.hasReg = !!reg;
    this.ao = this._keep(this._target(Math.ceil(w / 2), Math.ceil(h / 2), gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE));
    this._prepare();
    this._wxDirty = true; this._aoDirty = true;
  }

  // 只算一次的：凿痕底、高斯金字塔、顶帽、遮雨
  _prepare() {
    const gl = this.gl, w = this.w, h = this.h;
    const tmpA = this._keep(this._target(w, h, gl.R16F, gl.RED, gl.HALF_FLOAT));
    const tmpB = this._keep(this._target(w, h, gl.R16F, gl.RED, gl.HALF_FLOAT));
    const tmpC = this._keep(this._target(w, h, gl.R16F, gl.RED, gl.HALF_FLOAT));
    // 金字塔：2D 数组纹理，第 0 层是带凿痕的高度
    const st = this._keep(gl.createTexture()); gl.bindTexture(gl.TEXTURE_2D_ARRAY, st);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R16F, w, h, LEVELS.length, 0, gl.RED, gl.HALF_FLOAT, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, k, v);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    this.stack = st;
    const fbL = this._keep(gl.createFramebuffer());
    const toLayer = (k) => { gl.bindFramebuffer(gl.FRAMEBUFFER, fbL); gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, st, 0, k); return fbL; };
    this._pass(this.pBase, toLayer(0), w, h, [["uH0", this.texH0]], (u) => gl.uniform1f(u.uChisel, 0.0));   // 凿痕改在风化里算（好按波长衰减），金字塔只放原始高度
    for (let k = 1; k < LEVELS.length; k++) {
      const s = Math.sqrt(LEVELS[k] ** 2 - LEVELS[k - 1] ** 2);   // 从上一层再糊 √(σk² − σk−1²)
      this._pass(this.pBlurA, tmpA.fb, w, h, [["uSrc", st, gl.TEXTURE_2D_ARRAY]], (u) => { gl.uniform1f(u.uLayer, k - 1); gl.uniform1f(u.uSig, s); });
      this._pass(this.pBlur2, toLayer(k), w, h, [["uSrc", tmpA.tex]], (u) => gl.uniform1f(u.uSig, s));
    }
    // 开运算（方窗）：腐蚀 H、V，再膨胀 H、V
    const mm = (src, dst, dir, r, mx) => this._pass(this.pMinMax, dst.fb, w, h, [["uSrc", src]], (u) => { gl.uniform2f(u.uDir, dir[0], dir[1]); gl.uniform1i(u.uR, r); gl.uniform1i(u.uMax, mx); });
    const open = (r, out) => { mm(this.texH0, tmpA, [1, 0], r, 0); mm(tmpA.tex, out, [0, 1], r, 0); mm(out.tex, tmpA, [1, 0], r, 1); mm(tmpA.tex, out, [0, 1], r, 1); };
    // out 既当中间又当结果：第二步写 out、第三步读 out 写 tmpA、第四步读 tmpA 写 out，没有同一遍里读写同一纹理
    open(25, tmpB); open(8, tmpC);
    this.field = this._keep(this._target(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT));
    this._pass(this.pField, this.field.fb, w, h, [["uH0", this.texH0], ["uOpenL", tmpB.tex], ["uOpenS", tmpC.tex]]);
    // 风化结果：高度（R16F）+ 颜色（RGBA8），一遍出两个
    this.texW = this._keep(this._tex(w, h, gl.R16F, gl.RED, gl.HALF_FLOAT, null));
    this.texA = this._keep(this._tex(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null));
    this.fbW = this._keep(gl.createFramebuffer());
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbW);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texW, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.texA, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  _weather() {
    const gl = this.gl, T = this.time, st = STONES[this.stone];
    this._pass(this.pWx, this.fbW, this.w, this.h,
      [["uStack", this.stack, gl.TEXTURE_2D_ARRAY], ["uH0", this.texH0], ["uField", this.field.tex], ["uReg", this.texReg], ["uIns", this.texIns || this._tex1]], (u) => {
        gl.uniform1i(u.uHasReg, this.hasReg ? 1 : 0); gl.uniform1i(u.uNiche, this.niche ? 1 : 0); gl.uniform2fv(u.uSeed, this.seedOff || [0, 0]); gl.uniform1f(u.uChisel, 1.3); gl.uniform4fv(u.uStele, this.stele || [0, 0, 0, 0]);
        gl.uniform1f(u.uTau, T.tau); gl.uniform1f(u.uTauP, T.tauP); gl.uniform1f(u.uAge, T.age); gl.uniform1f(u.uPaint, T.paint); gl.uniform1f(u.uPlLoss, T.plLoss); gl.uniform1f(u.uPaLoss, T.paLoss);
        gl.uniform1f(u.uDust, T.dust); gl.uniform1f(u.uCoal, T.coal); gl.uniform1f(u.uGood, T.good); gl.uniform1f(u.uBad, T.bad);
        gl.uniform3fv(u.uFresh, st.fresh); gl.uniform3fv(u.uOld, st.old); gl.uniform4fv(u.uKind, st.weather); gl.uniform4fv(u.uKind2, st.weather2);
        gl.uniform4fv(u.uStreak, T.streaks); gl.uniform1i(u.uWxDbg, this.wxDbg || 0);
      });
    if (this.carve !== undefined && this.carve < 0.999) {   // 开凿过场：把高度换成由粗到细的中间结果
      if (!this.texCarve) this.texCarve = this._keep(this._target(this.w, this.h, gl.R16F, gl.RED, gl.HALF_FLOAT));
      this._pass(this.pCarve, this.texCarve.fb, this.w, this.h, [["uStack", this.stack, gl.TEXTURE_2D_ARRAY], ["uW", this.texW]], (u) => gl.uniform1f(u.uCarve, this.carve));
      this._hTex = this.texCarve.tex;
    } else this._hTex = this.texW;
    this._wxDirty = false; this._aoDirty = true;
  }

  setTime(t) { Object.assign(this.time, t); this._wxDirty = true; }
  // 题名刻槽：Float32Array(w·h·4)，[深, 半宽, 石粉, 0] 交错；null 清掉
  setInscription(a) {
    const gl = this.gl;
    if (this.texIns) { gl.deleteTexture(this.texIns); this.texIns = null; }
    if (a) this.texIns = this._tex(this.w, this.h, gl.RGBA16F, gl.RGBA, gl.FLOAT, a, gl.NEAREST);
    this._wxDirty = true;
  }
  // 刻字动画：只换题名区那一块（x, y, w, h 像素；data：Float32Array(w·h·4)）
  updateInscription(x, y, w, h, data) {
    const gl = this.gl; if (!this.texIns) return;
    const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(this.w, x + w), y1 = Math.min(this.h, y + h);
    if (x1 <= x0 || y1 <= y0) return;
    let d = data;
    if (x0 !== x || y0 !== y || x1 - x0 !== w || y1 - y0 !== h) {   // 超出画布的部分裁掉
      d = new Float32Array((x1 - x0) * (y1 - y0) * 4);
      for (let r = y0; r < y1; r++) d.set(data.subarray(((r - y) * w + (x0 - x)) * 4, ((r - y) * w + (x1 - x)) * 4), (r - y0) * (x1 - x0) * 4);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texIns); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, x1 - x0, y1 - y0, gl.RGBA, gl.FLOAT, d);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this._wxDirty = true;
  }
  setScale(s) { this.scale = s; this._aoDirty = true; }
  // 读回当前年份风化后的高度，长边缩到 maxSide 以内；高度跟着缩（坡度不变）。返回 { data, w, h, sc }
  readHeight(maxSide = 1100) {
    const gl = this.gl; this._update();
    const sc = Math.min(1, maxSide / Math.max(this.w, this.h)), w = Math.round(this.w * sc), h = Math.round(this.h * sc);
    const T = this._target(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this._pass(this.pEnc, T.fb, w, h, [["uSrc", this._hTex || this.texW]], (u) => gl.uniform2f(u.uOut, w, h));
    const px = new Uint8Array(w * h * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(T.fb); gl.deleteTexture(T.tex);
    const data = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) data[i] = ((px[4 * i] + px[4 * i + 1] / 255) / 255 - 0.1) / 0.8 * this.hmax * sc;
    return { data, w, h, sc };
  }
  setStone(s) { this.stone = s; this._wxDirty = true; }

  _common(P) {
    const gl = this.gl;
    gl.useProgram(P.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._hTex || this.texW); gl.uniform1i(P.u.uH, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texN); gl.uniform1i(P.u.uNoise, 1);
    gl.uniform2f(P.u.uRes, this.w, this.h);
    gl.uniform1f(P.u.uHScale, this.hmax * this.scale);
    gl.uniform1f(P.u.uGrain, STONES[this.stone].grain);
    gl.bindVertexArray(this.vao);
  }

  _update() {
    if (this._wxDirty) this._weather();
    if (this._aoDirty) this._drawAO();
  }

  _drawAO() {
    const gl = this.gl; this._common(this.pAO);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ao.fb); gl.viewport(0, 0, this.ao.w, this.ao.h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this._aoDirty = false;
  }

  _main(meter, rect) {
    const gl = this.gl, P = this.pMain, u = P.u, st = STONES[this.stone], L = this.light;
    this._common(P);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.ao.tex); gl.uniform1i(u.uAO, 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.texA); gl.uniform1i(u.uAlbT, 3);
    gl.uniform1i(u.uPoint, L.point ? 1 : 0);
    gl.uniform3fv(u.uL, L.dir); gl.uniform3fv(u.uP, L.pos); gl.uniform3fv(u.uCol, L.col); gl.uniform1f(u.uFall, L.fall); gl.uniform1f(u.uCone, L.cone || 0); gl.uniform2fv(u.uAim, L.aim || [this.w / 2, this.h / 2]);
    gl.uniform1f(u.uSigma, st.sigma); gl.uniform1f(u.uWrap, st.wrap);
    gl.uniform1f(u.uAmb, L.amb); gl.uniform3fv(u.uAmbCol, L.ambCol);
    gl.uniform1f(u.uExpo, this.expo * this.gain); gl.uniform1i(u.uMeter, meter ? 1 : 0);
    gl.uniform1f(u.uShadowK, L.shadowK || 10.0); gl.uniform1i(u.uDbg, this.dbg || 0);
    gl.uniform1f(u.uOldPh, this.time.old || 0); gl.uniform1f(u.uOldGain, this.oldGain || 1);
    gl.uniform4fv(u.uRect, rect); gl.uniform1f(u.uEdge, meter ? 0 : (this.edge || 0)); gl.uniform3fv(u.uBg, this.bg);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // 自动曝光：小图上算一遍亮度，取 97 分位，让它落在 0.92（和 Python 版一致），帧间平滑
  // q：取哪个分位数落到 0.92。点光源用 0.995：灯跟前那一圈本来就最亮，按 97 分位定曝光会削平成一块（11-08 火把）
  // 测的是光照（不含石色），所以煤尘、彩画、老照片不会被曝光“补回来”
  meterExposure(smooth = 0.35, q = 0.97) {
    const gl = this.gl, m = this.meter;
    this._update();   // 遮蔽没算出来时测光会读到全 0，光被低估、开场偏亮（11-08 复核）
    gl.bindFramebuffer(gl.FRAMEBUFFER, m.fb); gl.viewport(0, 0, m.w, m.h);
    this._main(true, [-1, -1, 1, 1]);
    const px = new Uint8Array(m.w * m.h * 4); gl.readPixels(0, 0, m.w, m.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const hist = new Uint32Array(256); for (let i = 0; i < px.length; i += 4) hist[px[i]]++;
    let acc = 0, qi = 255; const tgt = q * m.w * m.h;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= tgt) { qi = i; break; } }
    const p97 = Math.max(qi, 1) / 255 * 2;
    const want = 0.92 / p97;
    const old = this.expo;
    this.expo = old * (1 - smooth) + want * smooth;
    return Math.abs(want - this.expo) / want;   // 离目标还差多少（相对），调用方据此决定要不要再测
  }

  // rect：浮雕在画布上的像素矩形 [x, y, w, h]（左上原点）
  draw(rect) {
    const gl = this.gl;
    this._update();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.cv.width, this.cv.height);
    gl.clearColor(this.bg[0], this.bg[1], this.bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const W = this.cv.width, Hh = this.cv.height; const [x, y, w, h] = rect;
    const c = this.clip;   // 推镜头时只画在原来的浮雕框里
    if (c) { gl.enable(gl.SCISSOR_TEST); gl.scissor(Math.round(c[0]), Math.round(Hh - c[1] - c[3]), Math.round(c[2]), Math.round(c[3])); }
    this._main(false, [x / W * 2 - 1, 1 - (y + h) / Hh * 2, (x + w) / W * 2 - 1, 1 - y / Hh * 2]);
    if (c) gl.disable(gl.SCISSOR_TEST);
  }
}
