// 人物形象（预览）：肌肉分明的武林高手，身穿白色无袖太极服。原创造型。
// 与 v3/js/figure.js 相同的接口（apply(P) 摆姿势），以后可直接替换进软件。
// 姿势坐标约定：手的位置 (r右, u上, f前)，世界坐标 y 向上，起势面向 +z，人的左侧为 +x。
(function () {
  const T = THREE;
  const Taiji = (window.Taiji = window.Taiji || {});
  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;

  const D = {
    ankle: 0.08, shin: 0.43, thigh: 0.44, hipW: 0.1,
    shW: 0.215, shY: 0.42, upper: 0.29, fore: 0.26, headY: 0.645,
  };
  const STAND = D.ankle + D.shin + D.thigh;
  const LEG_MAX = D.shin + D.thigh - 0.005;

  const COL = {
    skin: 0xc68a5e, suit: 0xf3efe6, trim: 0x1c1a1a, sash: 0x151515, hair: 0x111111,
    band: 0xb3161b, shoe: 0x141414, sole: 0xe8e4da, lip: 0x8e4b3c, iris: 0x2a1a12,
  };
  const COLORS = { L: 0x4db8ff, R: 0xff9f4a }; // 手部轨迹颜色（与软件一致）

  const V = (x, y, z) => new T.Vector3(x, y, z);
  const Y_AXIS = V(0, 1, 0);
  const SPH = new T.SphereGeometry(1, 24, 18);

  const SHAPES = {
    palm: { f: [[6, 8, 5], [5, 7, 5], [6, 8, 5], [8, 10, 6]], spread: [5, 1.5, -1.5, -5], th: { ab: 32, op: 12, tw: 0, f: [5, 8, 6] } },
    fist: { f: [[88, 100, 60], [90, 105, 60], [90, 105, 60], [88, 100, 60]], spread: [0, 0, 0, 0], th: { ab: 8, op: 55, tw: 30, f: [15, 30, 25] } },
    hook: { f: [[55, 40, 25], [50, 42, 25], [50, 42, 25], [55, 40, 25]], spread: [-7, -2.5, 2.5, 7], th: { ab: 6, op: 55, tw: 10, f: [10, 25, 20] } },
  };
  const FINGER = [
    { len: [0.048, 0.028, 0.023], r: 0.0098, x: 0.029 },
    { len: [0.052, 0.032, 0.025], r: 0.0103, x: 0.0097 },
    { len: [0.049, 0.03, 0.024], r: 0.0098, x: -0.0097 },
    { len: [0.039, 0.023, 0.02], r: 0.0088, x: -0.028 },
  ];

  // ---------- 几何工具 ----------
  const gauss = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const gaussA = (a, c, w) => Math.exp(-((wrap(a - c) / w) ** 2));
  function table(pts) { // 分段平滑插值：[[y, v], ...]
    return (y) => {
      if (y <= pts[0][0]) return pts[0][1];
      for (let i = 1; i < pts.length; i++) {
        if (y <= pts[i][0]) {
          const [y0, v0] = pts[i - 1], [y1, v1] = pts[i];
          let s = (y - y0) / (y1 - y0);
          s = s * s * (3 - 2 * s);
          return v0 + (v1 - v0) * s;
        }
      }
      return pts[pts.length - 1][1];
    };
  }
  // 沿 +Y 的雕塑管：r(y, θ)，θ=0 指向 +Z（前），θ=90° 指向 +X。keep 可挖洞（衣服开襟）。
  function sculpt(y0, y1, nY, nT, rFn, keep, closeEnds) {
    const pos = [], idx = [];
    for (let i = 0; i <= nY; i++) {
      const y = y0 + ((y1 - y0) * i) / nY;
      for (let j = 0; j < nT; j++) {
        const th = (TAU * j) / nT;
        const r = Math.max(0.0004, rFn(y, th));
        pos.push(r * Math.sin(th), y, r * Math.cos(th));
      }
    }
    for (let i = 0; i < nY; i++) {
      for (let j = 0; j < nT; j++) {
        const yc = y0 + ((y1 - y0) * (i + 0.5)) / nY, tc = (TAU * (j + 0.5)) / nT;
        if (keep && !keep(yc, tc)) continue;
        const a = i * nT + j, b = i * nT + ((j + 1) % nT), c = a + nT, d = b + nT;
        idx.push(a, b, c, b, d, c);
      }
    }
    if (closeEnds) {
      const base = pos.length / 3;
      pos.push(0, y0, 0, 0, y1, 0);
      for (let j = 0; j < nT; j++) {
        const j2 = (j + 1) % nT;
        idx.push(base, j2, j);
        idx.push(base + 1, nY * nT + j, nY * nT + j2);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  const ellipseR = (a, b, th) => 1 / Math.sqrt((Math.sin(th) / a) ** 2 + (Math.cos(th) / b) ** 2);

  function ik(a, t, l1, l2, pole, outMid, outEnd, outP) {
    const dir = t.clone().sub(a);
    let dist = dir.length();
    if (dist < 1e-6) dir.set(0, -1, 0); else dir.divideScalar(dist);
    dist = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-4);
    const x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    const p = pole.clone().addScaledVector(dir, -pole.dot(dir));
    if (p.lengthSq() < 1e-8) p.set(0, 0, 1).addScaledVector(dir, -dir.z);
    p.normalize();
    outMid.copy(a).addScaledVector(dir, x).addScaledVector(p, h);
    outEnd.copy(a).addScaledVector(dir, dist);
    outP.copy(p);
  }
  function ankleOf(f) {
    const y = D.ankle + (f.lift || 0) + (f.pitch < 0 ? 0.14 * Math.sin(-f.pitch * DEG) : 0);
    return V(f.x, y, f.z);
  }
  const _m = new T.Matrix4();
  function setFrame(g, origin, Yv, Zref) {
    const Y = Yv.clone().normalize();
    const Z = Zref.clone().addScaledVector(Y, -Zref.dot(Y));
    if (Z.lengthSq() < 1e-8) Z.set(0, 0, 1).addScaledVector(Y, -Y.z);
    Z.normalize();
    const X = Y.clone().cross(Z);
    g.position.copy(origin);
    g.quaternion.setFromRotationMatrix(_m.makeBasis(X, Y, Z));
  }
  function capsuleUp(r, len) {
    const g = new T.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 4, 10);
    g.translate(0, len / 2, 0);
    return g;
  }

  // 躯干轮廓（胸廓坐标系，y 从髋关节高度量起）
  const torsoA = table([[0.02, 0.135], [0.12, 0.126], [0.2, 0.152], [0.28, 0.185], [0.35, 0.205], [0.41, 0.208], [0.45, 0.17], [0.49, 0.085]]);
  const torsoB = table([[0.02, 0.1], [0.12, 0.094], [0.2, 0.104], [0.28, 0.118], [0.35, 0.124], [0.41, 0.11], [0.45, 0.09], [0.49, 0.064]]);
  function torsoR(y, th) {
    let r = ellipseR(torsoA(y), torsoB(y), th);
    for (const s of [1, -1]) {
      r += 0.038 * gauss(y, 0.34, 0.048) * gaussA(th, s * 0.5, 0.45); // 胸大肌
      r += 0.022 * gauss(y, 0.29, 0.075) * gaussA(th, s * 2.05, 0.45); // 背阔肌
      r += 0.026 * gauss(y, 0.445, 0.04) * gaussA(th, s * 2.5, 0.6); // 斜方肌
      for (const row of [0.14, 0.195, 0.25]) r += 0.007 * gauss(y, row, 0.017) * gaussA(th, s * 0.17, 0.11); // 腹肌
      r += 0.012 * gauss(y, 0.2, 0.06) * gaussA(th, s * 1.0, 0.25); // 腹外斜肌
    }
    r -= 0.01 * gauss(y, 0.33, 0.07) * gaussA(th, 0, 0.1); // 胸骨沟
    r -= 0.004 * gauss(y, 0.2, 0.08) * gaussA(th, 0, 0.05); // 腹白线
    r -= 0.008 * gauss(y, 0.3, 0.12) * gaussA(th, Math.PI, 0.12); // 脊柱沟
    return r;
  }

  class Figure {
    constructor() {
      this.root = new T.Group();
      this.layers = { suit: [] };
      this.mats = [];
      this.J = {};
      for (const n of ['pelvis', 'chest', 'headC', 'shL', 'shR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR']) this.J[n] = V(0, 0, 0);
      this.pArm = { L: V(0, 0, 0), R: V(0, 0, 0) };
      this.pLeg = { L: V(0, 0, 0), R: V(0, 0, 0) };

      const mk = (color, rough, extra) => {
        const m = new T.MeshStandardMaterial(Object.assign({ color, roughness: rough, metalness: 0 }, extra || {}));
        this.mats.push(m);
        return m;
      };
      const M = this.mat = {
        skin: mk(COL.skin, 0.5),
        suit: mk(COL.suit, 0.55, { side: T.DoubleSide }),
        trim: mk(COL.trim, 0.6),
        sash: mk(COL.sash, 0.7, { side: T.DoubleSide }),
        hair: mk(COL.hair, 0.85),
        band: mk(COL.band, 0.7, { side: T.DoubleSide }),
        shoe: mk(COL.shoe, 0.8),
        sole: mk(COL.sole, 0.9),
        white: mk(0xffffff, 0.3),
        iris: mk(COL.iris, 0.3),
        dark: mk(0x140c08, 0.8),
        lip: mk(COL.lip, 0.6),
        earIn: mk(0x9a6040, 0.6),
        wrist: mk(0x1e1e1e, 0.8),
      };
      const seg = () => { const g = new T.Group(); this.root.add(g); return g; };
      const add = (parent, geo, mat, pos, scale, rot, layer) => {
        const m = new T.Mesh(geo, mat);
        if (pos) m.position.set(pos[0], pos[1], pos[2]);
        if (scale) m.scale.set(scale[0], scale[1], scale[2]);
        if (rot) m.rotation.set(rot[0], rot[1], rot[2], rot[3] || 'XYZ');
        m.castShadow = true;
        parent.add(m);
        if (layer) this.layers[layer].push(m);
        return m;
      };
      const ell = (parent, mat, pos, scale, rot, layer) => add(parent, SPH, mat, pos, scale, rot, layer);
      const tubeAlong = (parent, pts, r, mat, layer) => add(parent, new T.TubeGeometry(new T.CatmullRomCurve3(pts), Math.max(8, pts.length * 4), r, 6, false), mat, null, null, null, layer);

      this.gPelvis = seg(); this.gWaist = seg(); this.gChest = seg(); this.gHead = seg();

      // ---------- 躯干（肌肉雕塑）----------
      add(this.gChest, sculpt(0.0, 0.5, 60, 48, torsoR, null, true), M.skin);
      add(this.gChest, sculpt(0.43, 0.6, 10, 24, (y) => table([[0.43, 0.088], [0.47, 0.078], [0.53, 0.068], [0.58, 0.066], [0.6, 0.03]])(y), null, true), M.skin, [0, 0, -0.008]);
      add(this.gPelvis, sculpt(-0.16, 0.08, 20, 36, (y, th) => ellipseR(table([[-0.16, 0.03], [-0.12, 0.13], [-0.05, 0.165], [0.03, 0.15], [0.08, 0.135]])(y), table([[-0.16, 0.03], [-0.12, 0.1], [-0.05, 0.12], [0.03, 0.105], [0.08, 0.1]])(y), th), null, true), M.skin, [0, 0, -0.01]);

      // ---------- 太极服：对襟无袖上衣 ----------
      const openW = (y) => (y > 0.24 ? 0.06 + ((y - 0.24) / (0.47 - 0.24)) * 0.72 : 0);
      const vestR = (y, th) => ellipseR(torsoA(y) * 1.07 + 0.012, torsoB(y) * 1.12 + 0.014, th) + 0.02 * gauss(y, 0.34, 0.05) * (gaussA(th, 0.5, 0.45) + gaussA(th, -0.5, 0.45)) + 0.004 * Math.sin(th * 7 + y * 30);
      const vestKeep = (y, th) => Math.abs(wrap(th)) > openW(y);
      add(this.gChest, sculpt(0.02, 0.47, 45, 56, vestR, vestKeep, false), M.suit, null, null, null, 'suit');
      // 衣摆（盖过胯部）
      const hemR = (y, th) => ellipseR(table([[-0.13, 0.19], [-0.02, 0.172], [0.06, 0.155]])(y), table([[-0.13, 0.15], [-0.02, 0.13], [0.06, 0.118]])(y), th) + 0.005 * Math.sin(th * 9);
      add(this.gWaist, sculpt(-0.13, 0.06, 12, 56, hemR, null, false), M.suit, [0, 0, -0.005], null, null, 'suit');
      // 黑色滚边：前襟两侧、领口、下摆
      for (const s of [1, -1]) {
        const pts = [];
        for (let y = 0.24; y <= 0.4701; y += 0.023) { const th = s * openW(y); const r = vestR(y, th) + 0.003; pts.push(V(r * Math.sin(th), y, r * Math.cos(th))); }
        const lastTh = s * openW(0.47);
        for (let k = 1; k <= 8; k++) { const th = lastTh + s * (k / 8) * (Math.PI - Math.abs(lastTh)); const r = vestR(0.47, th) + 0.003; pts.push(V(r * Math.sin(th), 0.47, r * Math.cos(th))); }
        tubeAlong(this.gChest, pts, 0.007, M.trim, 'suit');
      }
      { const pts = []; for (let k = 0; k <= 36; k++) { const th = (TAU * k) / 36; const r = hemR(-0.13, th) + 0.003; pts.push(V(r * Math.sin(th), -0.13, r * Math.cos(th))); } tubeAlong(this.gWaist, pts, 0.007, M.trim, 'suit'); }
      // 盘扣（中式布扣）
      for (const y of [0.1, 0.165, 0.23]) {
        const z = vestR(y, 0) + 0.004;
        add(this.gChest, new T.TorusGeometry(0.009, 0.0032, 6, 14), M.trim, [-0.012, y, z], null, null, 'suit');
        add(this.gChest, new T.TorusGeometry(0.009, 0.0032, 6, 14), M.trim, [0.012, y, z], null, null, 'suit');
        ell(this.gChest, M.trim, [0, y, z + 0.002], [0.007, 0.007, 0.007], null, 'suit');
      }
      // 腰带（黑色宽布带，左前打结下垂）
      add(this.gWaist, sculpt(0.0, 0.065, 4, 48, (y, th) => ellipseR(0.162, 0.132, th), null, false), M.sash, null, null, null, 'suit');
      ell(this.gWaist, M.sash, [0.07, 0.03, 0.125], [0.03, 0.028, 0.018], null, 'suit');
      add(this.gPelvis, new T.BoxGeometry(0.04, 0.2, 0.006), M.sash, [0.085, -0.08, 0.13], null, [0.12, 0, 0.1], 'suit');
      add(this.gPelvis, new T.BoxGeometry(0.036, 0.17, 0.006), M.sash, [0.055, -0.07, 0.132], null, [0.1, 0, -0.08], 'suit');
      // 裤腰
      add(this.gPelvis, sculpt(-0.17, 0.07, 18, 48, (y, th) => ellipseR(table([[-0.17, 0.05], [-0.13, 0.15], [-0.05, 0.185], [0.07, 0.165]])(y), table([[-0.17, 0.05], [-0.13, 0.12], [-0.05, 0.14], [0.07, 0.13]])(y), th) + 0.005 * Math.sin(th * 8 + y * 40), null, true), M.suit, [0, 0, -0.01], null, null, 'suit');

      // ---------- 头部：一整块雕塑（圆颅、两侧较平、下颌收成方下巴，不鼓腮）----------
      const H = this.gHead;
      const hA = table([[-0.126, 0.004], [-0.115, 0.03], [-0.095, 0.046], [-0.07, 0.06], [-0.04, 0.069], [-0.01, 0.075], [0.03, 0.079], [0.08, 0.074], [0.11, 0.052], [0.126, 0.02], [0.132, 0.004]]);
      const hF = table([[-0.126, 0.004], [-0.118, 0.05], [-0.1, 0.083], [-0.075, 0.088], [-0.05, 0.094], [-0.02, 0.099], [0.01, 0.096], [0.035, 0.1], [0.08, 0.088], [0.11, 0.06], [0.126, 0.025], [0.132, 0.004]]);
      const hB = table([[-0.126, 0.004], [-0.11, 0.02], [-0.08, 0.042], [-0.05, 0.07], [-0.02, 0.09], [0.02, 0.1], [0.07, 0.096], [0.11, 0.065], [0.126, 0.028], [0.132, 0.004]]);
      const headR = (y, th) => {
        let r = ellipseR(hA(y), Math.cos(th) >= 0 ? hF(y) : hB(y), th);
        r -= 0.007 * gauss(y, 0.012, 0.013) * (gaussA(th, 0.36, 0.17) + gaussA(th, -0.36, 0.17)); // 眼窝
        r += 0.005 * gauss(y, 0.034, 0.009) * gaussA(th, 0, 0.55); // 眉弓
        r += 0.003 * gauss(y, -0.005, 0.015) * (gaussA(th, 0.85, 0.25) + gaussA(th, -0.85, 0.25)); // 颧骨（轻微）
        r += 0.004 * gauss(y, -0.085, 0.012) * (gaussA(th, 0.9, 0.3) + gaussA(th, -0.9, 0.3)); // 下颌线
        return r;
      };
      const sp = (y, th, off) => { const r = headR(y, th) + (off || 0); return [r * Math.sin(th), y, r * Math.cos(th)]; };
      add(H, sculpt(-0.126, 0.132, 64, 48, headR, null, true), M.skin);
      for (const s of [1, -1]) {
        const e = s * 0.36;
        ell(H, M.white, sp(0.012, e, 0.001), [0.016, 0.0075, 0.006], [0, e, 0, 'YXZ']); // 眼白（细长，眼神坚毅）
        add(H, new T.CircleGeometry(0.0062, 18), M.iris, sp(0.0115, s * 0.35, 0.0065), null, [0, s * 0.35, 0, 'YXZ']);
        add(H, new T.CircleGeometry(0.0018, 8), M.white, sp(0.0135, s * 0.33, 0.007), null, [0, s * 0.33, 0, 'YXZ']);
        add(H, new T.BoxGeometry(0.032, 0.0032, 0.004), M.dark, sp(0.0195, e, 0.005), null, [0, e, s * 0.14, 'YXZ']); // 上眼线
        add(H, new T.BoxGeometry(0.036, 0.009, 0.008), M.hair, sp(0.036, s * 0.34, 0.006), null, [0, s * 0.34, s * 0.26, 'YXZ']); // 浓眉，内低外高
        // 耳朵：贴着头侧、略靠后，外耳轮 + 耳窝
        const ea = s * (Math.PI / 2 + 0.14);
        const ear = new T.Group();
        ear.position.set(...sp(-0.004, ea, 0.002));
        ear.rotation.set(0, ea - s * Math.PI / 2, s * 0.08);
        H.add(ear);
        ell(ear, M.skin, [s * 0.004, 0, 0], [0.0065, 0.03, 0.019]);
        ell(ear, M.earIn, [s * 0.008, 0.002, 0.002], [0.003, 0.018, 0.011]);
      }
      const nose = new T.ConeGeometry(0.016, 0.042, 4);
      nose.rotateY(Math.PI / 4);
      nose.rotateX(Math.PI / 2 + 0.45);
      add(H, nose, M.skin, [0, -0.01, headR(-0.01, 0) + 0.004]);
      ell(H, M.skin, [0, -0.029, headR(-0.029, 0) + 0.003], [0.012, 0.009, 0.01]); // 鼻头
      for (const s of [1, -1]) ell(H, M.skin, [s * 0.011, -0.033, headR(-0.033, 0) + 0.001], [0.008, 0.007, 0.008]); // 鼻翼
      add(H, new T.BoxGeometry(0.032, 0.0042, 0.004), M.lip, [0, -0.058, headR(-0.058, 0) + 0.001]);
      add(H, new T.BoxGeometry(0.02, 0.003, 0.003), M.dark, [0, -0.065, headR(-0.065, 0)]); // 下唇阴影
      // 头发：毛寸——两三厘米长的短发，有蓬松的层次和发束，头顶略厚，前额发束微微向上，两侧和后面向后贴
      const hairline = (th) => 0.058 - 0.118 * Math.pow((1 - Math.cos(th)) / 2, 1.3);
      const ss = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
      const hairT = (y, th) => {
        let t = 0.012 + 0.014 * gauss(y, 0.13, 0.07) + 0.005 * gaussA(th, 0, 0.8) * gauss(y, 0.09, 0.03);
        t -= 0.004 * (gaussA(th, Math.PI / 2, 0.4) + gaussA(th, -Math.PI / 2, 0.4)) * gauss(y, 0.02, 0.04); // 两侧剃短一些
        t += 0.0035 * Math.sin(th * 17 + y * 110) * Math.sin(th * 5 - y * 60) + 0.002 * Math.sin(th * 31 + y * 190); // 发丝层次
        return t * ss((y - hairline(th)) / 0.015);
      };
      add(H, sculpt(-0.075, 0.145, 90, 128, (y, th) => headR(y, th) + 0.002 + hairT(y, th), (y, th) => y > hairline(th), false), M.hair);
      const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
      for (let i = 0; i < 46; i++) { // 发束：短而软，朝上、朝后
        const y = 0.055 + hash(i) * 0.075;
        const th = hash(i + 100) * TAU;
        if (y < hairline(th) + 0.012) continue;
        const front = Math.abs(wrap(th)) < 0.8 && y < 0.105;
        const out = V(Math.sin(th), 0, Math.cos(th));
        const dir = out.clone().multiplyScalar(0.45).add(front ? V(0, 1, 0.25) : V(0, 0.55, 0).add(out.clone().multiplyScalar(-0.2)).add(V(0, 0, -0.55))).normalize();
        const m = ell(H, M.hair, sp(y, th, 0.002 + hairT(y, th) * 0.55), [0.011, 0.02 + hash(i + 200) * 0.008, 0.0055]);
        m.quaternion.setFromUnitVectors(Y_AXIS, dir);
      }
      // 头带：红色布带，额前一圈，脑后打结，两条长带尾随风飘动
      add(H, sculpt(0.036, 0.058, 2, 64, (y, th) => headR(y, th) + 0.008 + (hairT(0.047, th) + 0.003) * ss((0.047 - hairline(th)) / 0.012 + 0.5), null, false), M.band);
      ell(H, M.band, sp(0.045, Math.PI, 0.03), [0.02, 0.017, 0.013]);
      for (const s of [1, -1]) {
        const tail = new T.Group();
        tail.position.set(...sp(0.042, Math.PI + s * 0.08, 0.032));
        tail.rotation.set(1.0, s * 0.25, s * 0.18);
        add(tail, new T.BoxGeometry(0.028, 0.14, 0.003), M.band, [0, -0.07, 0]);
        const t2 = new T.Group(); t2.position.set(0, -0.14, 0); t2.rotation.set(-0.35, 0, s * 0.2); tail.add(t2);
        add(t2, new T.BoxGeometry(0.026, 0.13, 0.003), M.band, [0, -0.065, 0]);
        const t3 = new T.Group(); t3.position.set(0, -0.13, 0); t3.rotation.set(-0.3, 0, s * 0.25); t2.add(t3);
        add(t3, new T.BoxGeometry(0.024, 0.12, 0.003), M.band, [0, -0.06, 0]);
        H.add(tail);
      }

      // ---------- 四肢 ----------
      this.limb = {};
      for (const side of ['L', 'R']) {
        const lat = side === 'L' ? -1 : 1;
        const thLat = lat > 0 ? Math.PI / 2 : -Math.PI / 2; // 外侧方向对应的 θ
        const tsgn = side === 'R' ? 1 : -1;
        const g = { upper: seg(), fore: seg(), hand: seg(), thigh: seg(), shin: seg(), foot: seg() };

        // 上臂：三角肌、肱二头肌、肱三头肌
        const upBase = table([[-0.06, 0.004], [-0.05, 0.042], [-0.02, 0.062], [0.05, 0.06], [0.15, 0.055], [0.24, 0.047], [0.29, 0.043], [0.31, 0.032], [0.32, 0.004]]);
        add(g.upper, sculpt(-0.055, 0.32, 40, 32, (y, th) => {
          let r = upBase(y);
          r += 0.034 * gauss(y, 0.035, 0.06) * (0.55 + 0.45 * Math.cos(wrap(th - thLat))); // 三角肌
          r += 0.026 * gauss(y, 0.16, 0.058) * gaussA(th, 0, 0.85); // 肱二头肌
          r += 0.02 * gauss(y, 0.12, 0.07) * gaussA(th, Math.PI, 0.95); // 肱三头肌
          r += 0.005 * gauss(y, 0.2, 0.05) * gaussA(th, thLat, 0.6);
          return r;
        }, null, true), M.skin);
        // 前臂：肱桡肌、屈肌群
        const foBase = table([[-0.03, 0.004], [-0.018, 0.04], [0.02, 0.053], [0.07, 0.054], [0.15, 0.042], [0.22, 0.032], [0.255, 0.029], [0.268, 0.004]]);
        add(g.fore, sculpt(-0.03, 0.268, 36, 28, (y, th) => {
          let r = foBase(y);
          r += 0.016 * gauss(y, 0.05, 0.05) * gaussA(th, thLat * 0.55, 0.7);
          r += 0.008 * gauss(y, 0.08, 0.06) * gaussA(th, -thLat * 0.4, 0.8);
          return r * (1 - 0.12 * Math.cos(2 * th) * gauss(y, 0.2, 0.06));
        }, null, true), M.skin);
        add(g.fore, sculpt(0.19, 0.24, 3, 24, () => 0.04, null, false), M.wrist, null, null, null, 'suit'); // 护腕
        // 大腿、小腿：宽松太极裤（灯笼裤）
        add(g.thigh, sculpt(-0.06, 0.5, 30, 36, (y, th) => table([[-0.06, 0.07], [-0.03, 0.105], [0.05, 0.118], [0.25, 0.108], [0.42, 0.098], [0.5, 0.09]])(y) + 0.006 * Math.sin(th * 5 + y * 22), null, true), M.suit, null, null, null, 'suit');
        add(g.shin, sculpt(-0.06, 0.44, 30, 36, (y, th) => table([[-0.06, 0.088], [0.05, 0.098], [0.25, 0.092], [0.35, 0.082], [0.39, 0.058], [0.42, 0.048], [0.44, 0.045]])(y) + 0.006 * Math.sin(th * 6 + y * 25), null, true), M.suit, null, null, null, 'suit');
        // 裤子下面的腿（关闭太极服时可见）
        add(g.thigh, sculpt(-0.03, 0.46, 20, 24, (y, th) => table([[-0.03, 0.06], [0.02, 0.088], [0.2, 0.08], [0.4, 0.056], [0.46, 0.05]])(y) + 0.012 * gauss(y, 0.22, 0.12) * gaussA(th, 0, 0.9), null, true), M.skin);
        add(g.shin, sculpt(-0.02, 0.44, 20, 24, (y, th) => table([[-0.02, 0.048], [0.1, 0.056], [0.25, 0.042], [0.4, 0.03], [0.44, 0.03]])(y) + 0.014 * gauss(y, 0.13, 0.08) * gaussA(th, Math.PI, 0.9), null, true), M.skin);
        // 功夫鞋：黑色鞋面 + 白色千层底
        ell(g.foot, M.shoe, [0, -0.045, -0.012], [0.037, 0.036, 0.048]);
        ell(g.foot, M.shoe, [0, -0.05, 0.07], [0.046, 0.03, 0.105]);
        add(g.foot, new T.BoxGeometry(0.086, 0.014, 0.25), M.sole, [0, -0.074, 0.055]);

        // 手：宽厚的掌 + 五指
        const hm = M.skin;
        ell(g.hand, hm, [0, 0.05, 0], [0.046, 0.057, 0.018]);
        ell(g.hand, hm, [tsgn * 0.026, 0.03, 0.009], [0.022, 0.032, 0.017]);
        const fingers = FINGER.map((fd) => {
          const joints = [];
          let parent = g.hand;
          fd.len.forEach((l, k) => {
            const j = new T.Group();
            j.position.set(k === 0 ? tsgn * fd.x : 0, k === 0 ? 0.098 : fd.len[k - 1], 0);
            parent.add(j);
            add(j, capsuleUp(fd.r * (1 - k * 0.08), l + fd.r * 0.6), hm, [0, -fd.r * 0.3, 0]);
            joints.push(j);
            parent = j;
          });
          return joints;
        });
        const tb = new T.Group();
        tb.position.set(tsgn * 0.032, 0.02, 0.007);
        g.hand.add(tb);
        const thumb = [tb];
        let tp = tb;
        [0.044, 0.034, 0.027].forEach((l, k) => {
          const j = k === 0 ? tb : new T.Group();
          if (k > 0) { j.position.set(0, [0.044, 0.034][k - 1], 0); tp.add(j); thumb.push(j); }
          add(j, capsuleUp(0.0128 - k * 0.001, l + 0.005), hm, [0, -0.003, 0]);
          tp = j;
        });
        Object.assign(g, { fingers, thumb, tsgn });
        this.limb[side] = g;
      }
      this.setOpacity(1);
    }

    setOpacity(o) {
      const see = o < 0.999;
      for (const m of this.mats) {
        m.opacity = o;
        m.transparent = see;
        m.depthWrite = !see;
        m.needsUpdate = true;
      }
    }
    setSuit(on) { this.layers.suit.forEach((m) => (m.visible = on)); }

    applyHand(g, kw) {
      const S = { f: [0, 1, 2, 3].map(() => [0, 0, 0]), spread: [0, 0, 0, 0], th: { ab: 0, op: 0, tw: 0, f: [0, 0, 0] } };
      for (const k of Object.keys(kw)) {
        const w = kw[k], sh = SHAPES[k];
        if (!w) continue;
        for (let i = 0; i < 4; i++) {
          for (let j = 0; j < 3; j++) S.f[i][j] += sh.f[i][j] * w;
          S.spread[i] += sh.spread[i] * w;
        }
        for (const p of ['ab', 'op', 'tw']) S.th[p] += sh.th[p] * w;
        for (let j = 0; j < 3; j++) S.th.f[j] += sh.th.f[j] * w;
      }
      g.fingers.forEach((joints, i) => {
        joints.forEach((j, k) => j.rotation.set(S.f[i][k] * DEG, 0, k === 0 ? -g.tsgn * S.spread[i] * DEG : 0));
      });
      g.thumb[0].rotation.set(S.th.op * DEG, 0, -g.tsgn * S.th.ab * DEG, 'ZXY');
      g.thumb[1].rotation.set(S.th.f[1] * DEG, 0, g.tsgn * S.th.tw * DEG);
      g.thumb[2].rotation.set(S.th.f[2] * DEG, 0, 0);
    }

    apply(P) {
      const J = this.J;
      const qP = new T.Quaternion().setFromAxisAngle(Y_AXIS, P.yaw * DEG);
      const offL = V(D.hipW, 0, 0).applyQuaternion(qP);
      const offR = V(-D.hipW, 0, 0).applyQuaternion(qP);
      const aL = ankleOf(P.lf), aR = ankleOf(P.rf);
      const px = P.lf.x + (P.rf.x - P.lf.x) * P.w;
      const pz = P.lf.z + (P.rf.z - P.lf.z) * P.w;
      let py = STAND - P.h;
      for (const [f, a, off] of [[P.lf, aL, offL], [P.rf, aR, offR]]) {
        if ((f.lift || 0) > 0.05) continue;
        const dh = Math.hypot(px + off.x - a.x, pz + off.z - a.z);
        if (dh < LEG_MAX) py = Math.min(py, a.y + Math.sqrt(LEG_MAX * LEG_MAX - dh * dh));
      }
      J.pelvis.set(px, py, pz);
      J.hipL.copy(J.pelvis).add(offL);
      J.hipR.copy(J.pelvis).add(offR);

      const qC = new T.Quaternion().setFromEuler(new T.Euler((P.lean || 0) * DEG, (P.yaw + P.waist) * DEG, 0, 'YXZ'));
      const C = (r, u, f) => V(-r, u, f).applyQuaternion(qC);
      J.chest.copy(J.pelvis).add(C(0, 0.3, 0));
      J.headC.copy(J.pelvis).add(C(0, D.headY, 0.012));
      J.shL.copy(J.pelvis).add(C(-D.shW, D.shY, 0));
      J.shR.copy(J.pelvis).add(C(D.shW, D.shY, 0));

      this.gPelvis.position.copy(J.pelvis); this.gPelvis.quaternion.copy(qP);
      this.gWaist.position.copy(J.pelvis); this.gWaist.quaternion.copy(qP).slerp(qC, 0.5);
      this.gChest.position.copy(J.pelvis); this.gChest.quaternion.copy(qC);
      this.gHead.position.copy(J.headC);
      this.gHead.quaternion.copy(qC).multiply(new T.Quaternion().setFromAxisAngle(Y_AXIS, (P.look || 0) * DEG));

      for (const side of ['L', 'R']) {
        const hs = side === 'L' ? P.lh : P.rh;
        const g = this.limb[side];
        const sh = J['sh' + side], el = J['elbow' + side], wr = J['wrist' + side];
        const target = J.pelvis.clone().add(C(hs.p[0], hs.p[1] + 0.3, hs.p[2]));
        ik(sh, target, D.upper, D.fore, C(side === 'L' ? -0.6 : 0.6, -1, -0.25), el, wr, this.pArm[side]);
        const front = this.pArm[side].clone().negate();
        setFrame(g.upper, sh, el.clone().sub(sh), front);
        setFrame(g.fore, el, wr.clone().sub(el), front);
        setFrame(g.hand, wr, C(hs.fin[0], hs.fin[1], hs.fin[2]), C(hs.palm[0], hs.palm[1], hs.palm[2]));
        this.applyHand(g, hs.kw || { [hs.kind || 'palm']: 1 });

        const f = side === 'L' ? P.lf : P.rf;
        const hip = J['hip' + side], kn = J['knee' + side], an = J['ankle' + side];
        const out = side === 'L' ? offL : offR;
        const pole = V(Math.sin(f.yaw * DEG), 0.15, Math.cos(f.yaw * DEG)).addScaledVector(out, 0.8);
        ik(hip, side === 'L' ? aL : aR, D.thigh, D.shin, pole, kn, an, this.pLeg[side]);
        setFrame(g.thigh, hip, kn.clone().sub(hip), this.pLeg[side]);
        setFrame(g.shin, kn, an.clone().sub(kn), this.pLeg[side]);
        g.foot.position.copy(an);
        g.foot.quaternion.setFromEuler(new T.Euler(-(f.pitch || 0) * DEG, f.yaw * DEG, 0, 'YXZ'));
      }
      return { pelvis: J.pelvis, yaw: P.yaw };
    }
  }

  Taiji.Figure = Figure;
  Taiji.FIG_COLORS = COLORS;
})();
