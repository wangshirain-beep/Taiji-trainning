// 演示人：按成人标准比例建模，分三层——半透明皮肤、肌肉、骨骼；
// 头部有五官、耳朵和动漫风格的刺猬头发型；双手有五根可弯曲的手指，可清楚分辨掌、拳、勾手。
// 姿势坐标约定：手的位置 (r右, u上, f前)，世界坐标 y 向上，起势面向 +z，人的左侧为 +x。
(function () {
  const T = THREE;
  const Taiji = (window.Taiji = window.Taiji || {});
  const DEG = Math.PI / 180;

  const D = {
    ankle: 0.08, shin: 0.43, thigh: 0.44, hipW: 0.095,
    shW: 0.19, shY: 0.42, upper: 0.28, fore: 0.25, headY: 0.64,
  };
  const STAND = D.ankle + D.shin + D.thigh;
  const LEG_MAX = D.shin + D.thigh - 0.005;

  const COLORS = { L: 0x4db8ff, R: 0xff9f4a };
  const SKIN = 0xf2c9a4, MUSCLE = 0xc2463f, BONE = 0xf1e9d6, HAIR = 0x2a2327;

  const V = (x, y, z) => new T.Vector3(x, y, z);
  const Y_AXIS = V(0, 1, 0);
  const SPH = new T.SphereGeometry(1, 22, 16);

  // 手型：每根手指 [掌指关节, 近节, 远节] 屈曲角度；spread 张开角度；拇指 ab 外展 / op 对掌 / tw 横跨 / f 屈曲
  const SHAPES = {
    palm: { f: [[6, 8, 5], [5, 7, 5], [6, 8, 5], [8, 10, 6]], spread: [5, 1.5, -1.5, -5], th: { ab: 32, op: 12, tw: 0, f: [5, 8, 6] } },
    fist: { f: [[88, 100, 60], [90, 105, 60], [90, 105, 60], [88, 100, 60]], spread: [0, 0, 0, 0], th: { ab: 8, op: 55, tw: 30, f: [15, 30, 25] } },
    hook: { f: [[55, 40, 25], [50, 42, 25], [50, 42, 25], [55, 40, 25]], spread: [-7, -2.5, 2.5, 7], th: { ab: 6, op: 55, tw: 10, f: [10, 25, 20] } },
  };
  const FINGER = [ // [长度: 近节, 中节, 远节], 半径, 横向位置(拇指侧为正)
    { len: [0.046, 0.027, 0.022], r: 0.0085, x: 0.027 },
    { len: [0.05, 0.031, 0.024], r: 0.009, x: 0.009 },
    { len: [0.047, 0.029, 0.023], r: 0.0085, x: -0.009 },
    { len: [0.037, 0.022, 0.019], r: 0.0075, x: -0.026 },
  ];

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
  function lathe(profile, segs) {
    return new T.LatheGeometry(profile.map(([y, r]) => new T.Vector2(Math.max(r, 0.0005), y)), segs || 24);
  }
  function capsuleUp(r, len) { // 从原点沿 +Y 伸出的胶囊体
    const g = new T.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 4, 10);
    g.translate(0, len / 2, 0);
    return g;
  }

  class Figure {
    constructor() {
      this.root = new T.Group();
      this.layers = { skin: [], muscle: [], bone: [], face: [], hand: [] };
      this.J = {};
      for (const n of ['pelvis', 'chest', 'headC', 'shL', 'shR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR']) this.J[n] = V(0, 0, 0);
      this.pArm = { L: V(0, 0, 0), R: V(0, 0, 0) };
      this.pLeg = { L: V(0, 0, 0), R: V(0, 0, 0) };

      // ---------- 材质 ----------
      const skin = (color, opacity, depthWrite) => new T.MeshStandardMaterial({
        color, roughness: 0.55, metalness: 0, transparent: true, opacity, depthWrite: !!depthWrite,
      });
      this.mat = {
        skin: skin(SKIN, 0.2),
        skinL: skin(SKIN, 0.2),
        skinR: skin(SKIN, 0.2),
        head: skin(SKIN, 0.55, true),
        handL: skin(SKIN, 0.95, true),
        handR: skin(SKIN, 0.95, true),
        muscle: new T.MeshStandardMaterial({ color: MUSCLE, emissive: 0x3a0c0a, roughness: 0.45, transparent: true, opacity: 0.55, depthWrite: false }),
        bone: new T.MeshStandardMaterial({ color: BONE, roughness: 0.7, side: T.DoubleSide }),
        hair: new T.MeshStandardMaterial({ color: HAIR, roughness: 0.6, transparent: true, opacity: 1 }),
        white: new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, transparent: true }),
        iris: new T.MeshBasicMaterial({ color: 0x3b2a1f, transparent: true }),
        dark: new T.MeshBasicMaterial({ color: 0x2a1c18, transparent: true }),
        lip: new T.MeshStandardMaterial({ color: 0xb8645a, roughness: 0.6, transparent: true }),
      };
      this.setTint(true);

      const seg = () => { const g = new T.Group(); this.root.add(g); return g; };
      const add = (parent, layer, geo, mat, pos, scale, rot) => {
        const m = new T.Mesh(geo, mat);
        if (pos) m.position.set(pos[0], pos[1], pos[2]);
        if (scale) m.scale.set(scale[0], scale[1], scale[2]);
        if (rot) m.rotation.set(rot[0], rot[1], rot[2], rot[3] || 'XYZ');
        if (layer === 'skin' || layer === 'face' || layer === 'hand') m.castShadow = true;
        if (layer === 'face') m.renderOrder = 2;
        parent.add(m);
        if (layer) this.layers[layer].push(m);
        return m;
      };
      const ell = (parent, layer, mat, pos, scale, rot) => add(parent, layer, SPH, mat, pos, scale, rot);
      const stick = (parent, layer, mat, a, b, r) => { // 两点之间的圆柱（静态）
        const m = add(parent, layer, new T.CylinderGeometry(r, r, 1, 8), mat);
        const A = V(...a), B = V(...b);
        m.position.copy(A).add(B).multiplyScalar(0.5);
        m.quaternion.setFromUnitVectors(Y_AXIS, B.clone().sub(A).normalize());
        m.scale.y = A.distanceTo(B);
        return m;
      };
      const longBone = (parent, len, r, x, z) => {
        add(parent, 'bone', new T.CylinderGeometry(r, r, len - 0.03, 8), this.mat.bone, [x || 0, len / 2, z || 0]);
        ell(parent, 'bone', this.mat.bone, [x || 0, 0.012, z || 0], [r * 1.8, r * 1.5, r * 1.8]);
        ell(parent, 'bone', this.mat.bone, [x || 0, len - 0.012, z || 0], [r * 1.8, r * 1.5, r * 1.8]);
      };
      const M = this.mat;

      // ---------- 躯干 ----------
      this.gPelvis = seg(); this.gWaist = seg(); this.gChest = seg(); this.gHead = seg();
      add(this.gPelvis, 'skin', lathe([[-0.15, 0], [-0.13, 0.07], [-0.1, 0.145], [-0.04, 0.165], [0.03, 0.158], [0.1, 0.138], [0.16, 0.13], [0.18, 0]]), M.skin, [0, 0, -0.01], [1.08, 1, 0.7]);
      add(this.gChest, 'skin', lathe([[0.06, 0], [0.07, 0.12], [0.12, 0.132], [0.2, 0.142], [0.28, 0.158], [0.34, 0.166], [0.39, 0.162], [0.43, 0.14], [0.46, 0.09], [0.475, 0.05], [0.48, 0]]), M.skin, [0, 0, -0.005], [1.12, 1, 0.64]);
      ell(this.gChest, 'skin', M.skin, [0, 0.415, -0.01], [0.2, 0.045, 0.075]);
      add(this.gChest, 'skin', lathe([[0.42, 0], [0.43, 0.052], [0.5, 0.047], [0.57, 0.05], [0.58, 0]], 16), M.skin, [0, 0, -0.01]);

      // 骨盆、脊柱、胸廓
      for (const s of [1, -1]) ell(this.gPelvis, 'bone', M.bone, [s * 0.09, 0.05, -0.01], [0.05, 0.065, 0.018], [0, s * 0.6, s * -0.2]);
      ell(this.gPelvis, 'bone', M.bone, [0, 0.0, -0.07], [0.035, 0.06, 0.02], [0.3, 0, 0]);
      const brim = new T.TorusGeometry(0.075, 0.01, 6, 28);
      add(this.gPelvis, 'bone', brim, M.bone, [0, -0.03, 0.005], [1.2, 1, 0.9], [Math.PI / 2 - 0.7, 0, 0]);
      const vert = new T.CylinderGeometry(0.017, 0.017, 0.02, 10);
      for (let i = 0; i < 5; i++) add(this.gWaist, 'bone', vert, M.bone, [0, 0.03 + i * 0.033, -0.06]);
      for (let i = 0; i < 11; i++) add(this.gChest, 'bone', vert, M.bone, [0, 0.2 + i * 0.024, -0.075 - 0.012 * Math.sin((i / 10) * Math.PI)], [0.85, 1, 0.85]);
      for (let i = 0; i < 5; i++) add(this.gChest, 'bone', vert, M.bone, [0, 0.47 + i * 0.02, -0.035], [0.7, 0.8, 0.7]);
      const gap = 1.2;
      const ribGeo = new T.TorusGeometry(1, 0.05, 5, 36, Math.PI * 2 - gap);
      ribGeo.rotateX(Math.PI / 2);
      ribGeo.rotateY(-Math.PI / 2 - gap / 2);
      for (let i = 0; i < 10; i++) {
        const k = Math.sin(((i + 1) / 11) * Math.PI);
        add(this.gChest, 'bone', ribGeo, M.bone, [0, 0.2 + i * 0.023, -0.012], [0.1 + 0.045 * k, 0.12, 0.07 + 0.03 * k]);
      }
      add(this.gChest, 'bone', new T.BoxGeometry(0.022, 0.15, 0.01), M.bone, [0, 0.33, 0.092]);
      for (const s of [1, -1]) {
        stick(this.gChest, 'bone', M.bone, [s * 0.02, 0.425, 0.08], [s * 0.17, 0.435, 0.0], 0.007);
        ell(this.gChest, 'bone', M.bone, [s * 0.09, 0.36, -0.095], [0.05, 0.07, 0.008], [0, s * 0.35, s * 0.15]); // 肩胛骨
      }

      // 躯干肌肉
      for (const s of [1, -1]) {
        ell(this.gChest, 'muscle', M.muscle, [s * 0.075, 0.335, 0.078], [0.075, 0.05, 0.028], [0, 0, s * 0.2]); // 胸大肌
        ell(this.gChest, 'muscle', M.muscle, [s * 0.11, 0.17, 0.04], [0.035, 0.075, 0.05]); // 腹外斜肌
        ell(this.gChest, 'muscle', M.muscle, [s * 0.1, 0.25, -0.06], [0.055, 0.11, 0.035], [0, 0, s * 0.25]); // 背阔肌
        ell(this.gChest, 'muscle', M.muscle, [s * 0.022, 0.5, 0.025], [0.012, 0.055, 0.012], [-0.35, 0, s * 0.3]); // 胸锁乳突肌
        ell(this.gWaist, 'muscle', M.muscle, [s * 0.03, 0.08, -0.07], [0.022, 0.09, 0.02]); // 竖脊肌
        ell(this.gPelvis, 'muscle', M.muscle, [s * 0.07, -0.05, -0.065], [0.07, 0.085, 0.055]); // 臀大肌
        for (let r = 0; r < 3; r++) ell(this.gChest, 'muscle', M.muscle, [s * 0.027, 0.13 + r * 0.058, 0.085], [0.024, 0.025, 0.008]); // 腹直肌
      }
      ell(this.gChest, 'muscle', M.muscle, [0, 0.43, -0.05], [0.12, 0.05, 0.035]); // 斜方肌
      ell(this.gChest, 'muscle', M.muscle, [0, 0.35, -0.085], [0.07, 0.08, 0.02]);

      // ---------- 头部 ----------
      const H = this.gHead;
      ell(H, 'skin', M.head, [0, 0.025, -0.005], [0.083, 0.098, 0.1]); // 颅
      ell(H, 'skin', M.head, [0, -0.035, 0.02], [0.066, 0.078, 0.085]); // 面
      ell(H, 'skin', M.head, [0, -0.09, 0.045], [0.03, 0.025, 0.03]); // 下巴
      for (const s of [1, -1]) {
        ell(H, 'skin', M.head, [s * 0.084, -0.005, -0.005], [0.012, 0.028, 0.02]); // 耳
        ell(H, 'face', M.white, [s * 0.032, 0.008, 0.084], [0.017, 0.013, 0.008]); // 眼白
        add(H, 'face', new T.CircleGeometry(0.0088, 20), M.iris, [s * 0.032, 0.006, 0.0925]); // 瞳
        add(H, 'face', new T.CircleGeometry(0.0025, 10), M.white, [s * 0.029, 0.009, 0.0928]); // 高光
        add(H, 'face', new T.BoxGeometry(0.028, 0.005, 0.004), M.dark, [s * 0.034, 0.034, 0.091], null, [0, 0, s * -0.12]); // 眉
      }
      const nose = new T.ConeGeometry(0.013, 0.032, 12);
      nose.rotateX(Math.PI / 2 + 0.35);
      add(H, 'face', nose, M.head.clone(), [0, -0.02, 0.105]).material.depthWrite = true;
      add(H, 'face', new T.BoxGeometry(0.024, 0.004, 0.004), M.lip, [0, -0.058, 0.1]);
      // 头骨
      ell(H, 'bone', M.bone, [0, 0.022, -0.005], [0.074, 0.086, 0.088]);
      ell(H, 'bone', M.bone, [0, -0.035, 0.02], [0.05, 0.045, 0.045]);
      ell(H, 'bone', M.bone, [0, -0.072, 0.02], [0.042, 0.018, 0.04]);
      // 发型：动漫风格刺猬头（原创造型）
      const cap = new T.SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, 1.3);
      add(H, 'face', cap, M.hair, [0, 0.03, -0.012], [0.09, 0.106, 0.108], [-0.4, 0, 0]);
      const spike = new T.ConeGeometry(0.02, 0.055, 8);
      spike.translate(0, 0.0275, 0);
      const center = V(0, 0.03, -0.012);
      const place = (theta, phi, len, sweep) => {
        const n = V(Math.sin(theta) * Math.sin(phi), Math.cos(theta), Math.sin(theta) * Math.cos(phi));
        const pos = center.clone().add(V(n.x * 0.085, n.y * 0.1, n.z * 0.1));
        const dir = n.clone().add(sweep).normalize();
        const m = add(H, 'face', spike, M.hair, [pos.x, pos.y, pos.z], [1, len, 1]);
        m.quaternion.setFromUnitVectors(Y_AXIS, dir);
      };
      place(0.05, 0, 1.0, V(0, 0.4, -0.3));
      for (let i = 0; i < 6; i++) place(0.55, (i / 6) * Math.PI * 2 + 0.3, 1.1, V(0, 0.35, -0.45));
      for (let i = 0; i < 9; i++) {
        const phi = Math.PI * 0.35 + (i / 8) * Math.PI * 1.3; // 侧后方
        place(1.05, phi, 1.0, V(0, 0.15, -0.5));
      }
      for (const phi of [-0.45, -0.15, 0.15, 0.45]) place(0.95, phi, 0.7, V(0, -1.3, 0.25)); // 刘海

      // ---------- 四肢 ----------
      this.limb = {};
      for (const side of ['L', 'R']) {
        const lat = side === 'L' ? -1 : 1; // 肢体局部 X 轴上的"外侧"方向
        const tsgn = side === 'R' ? 1 : -1; // 手部局部 X 轴上的拇指方向
        const sk = side === 'L' ? M.skinL : M.skinR;
        const g = { upper: seg(), fore: seg(), hand: seg(), thigh: seg(), shin: seg(), foot: seg() };

        // 上臂
        add(g.upper, 'skin', lathe([[-0.035, 0], [-0.03, 0.035], [-0.015, 0.05], [0.02, 0.056], [0.07, 0.05], [0.15, 0.044], [0.24, 0.038], [0.28, 0.035], [0.3, 0.025], [0.31, 0]]), sk);
        longBone(g.upper, D.upper, 0.011);
        ell(g.upper, 'bone', M.bone, [0, 0.005, 0], [0.022, 0.022, 0.022]);
        ell(g.upper, 'muscle', M.muscle, [lat * 0.012, 0.035, 0], [0.05, 0.075, 0.055]); // 三角肌
        ell(g.upper, 'muscle', M.muscle, [0, 0.145, 0.02], [0.027, 0.095, 0.025]); // 肱二头肌
        ell(g.upper, 'muscle', M.muscle, [0, 0.14, -0.022], [0.03, 0.105, 0.027]); // 肱三头肌
        // 前臂
        add(g.fore, 'skin', lathe([[-0.02, 0], [-0.015, 0.03], [0, 0.038], [0.05, 0.042], [0.12, 0.036], [0.2, 0.028], [0.245, 0.024], [0.26, 0.015], [0.265, 0]]), sk);
        longBone(g.fore, D.fore, 0.0065, 0.009);
        longBone(g.fore, D.fore, 0.0065, -0.009);
        ell(g.fore, 'muscle', M.muscle, [0, 0.075, 0.012], [0.03, 0.08, 0.022]); // 屈肌群
        ell(g.fore, 'muscle', M.muscle, [lat * 0.012, 0.065, -0.008], [0.028, 0.085, 0.024]); // 伸肌群
        // 大腿
        add(g.thigh, 'skin', lathe([[-0.04, 0], [-0.03, 0.06], [0, 0.085], [0.08, 0.088], [0.2, 0.078], [0.33, 0.063], [0.41, 0.052], [0.45, 0.05], [0.47, 0.035], [0.48, 0]]), sk);
        longBone(g.thigh, D.thigh, 0.013);
        ell(g.thigh, 'bone', M.bone, [-lat * 0.02, 0.0, 0], [0.022, 0.022, 0.022]);
        ell(g.thigh, 'bone', M.bone, [0, 0.43, 0], [0.028, 0.016, 0.02]);
        ell(g.thigh, 'muscle', M.muscle, [0, 0.2, 0.025], [0.058, 0.19, 0.045]); // 股四头肌
        ell(g.thigh, 'muscle', M.muscle, [-lat * 0.022, 0.34, 0.018], [0.035, 0.07, 0.035]);
        ell(g.thigh, 'muscle', M.muscle, [0, 0.2, -0.03], [0.052, 0.18, 0.04]); // 腘绳肌
        ell(g.thigh, 'muscle', M.muscle, [-lat * 0.035, 0.12, 0], [0.035, 0.13, 0.04]); // 内收肌
        // 小腿
        add(g.shin, 'skin', lathe([[-0.025, 0], [-0.02, 0.04], [0, 0.05], [0.08, 0.056], [0.16, 0.052], [0.28, 0.04], [0.38, 0.032], [0.43, 0.03], [0.445, 0.02], [0.45, 0]]), sk);
        longBone(g.shin, D.shin, 0.012, 0, 0.006);
        longBone(g.shin, D.shin, 0.006, lat * 0.022, -0.008);
        ell(g.shin, 'bone', M.bone, [0, 0.012, 0.004], [0.03, 0.012, 0.022]);
        ell(g.shin, 'bone', M.bone, [0, -0.008, 0.045], [0.018, 0.022, 0.01]); // 髌骨
        ell(g.shin, 'muscle', M.muscle, [0, 0.12, -0.028], [0.045, 0.11, 0.034]); // 腓肠肌
        ell(g.shin, 'muscle', M.muscle, [lat * 0.012, 0.16, 0.022], [0.018, 0.13, 0.016]); // 胫骨前肌
        // 脚
        const fm = side === 'L' ? M.handL : M.handR;
        ell(g.foot, 'hand', fm, [0, -0.045, -0.015], [0.034, 0.035, 0.045]);
        ell(g.foot, 'hand', fm, [0, -0.052, 0.06], [0.044, 0.028, 0.1]);
        ell(g.foot, 'hand', fm, [0, -0.062, 0.14], [0.042, 0.017, 0.04]);

        // 手：掌 + 五指
        const hm = side === 'L' ? M.handL : M.handR;
        ell(g.hand, 'hand', hm, [0, 0.05, 0], [0.042, 0.055, 0.016]);
        ell(g.hand, 'hand', hm, [tsgn * 0.024, 0.03, 0.008], [0.02, 0.03, 0.015]);
        const fingers = FINGER.map((fd) => {
          const joints = [];
          let parent = g.hand;
          fd.len.forEach((l, k) => {
            const j = new T.Group();
            j.position.set(k === 0 ? tsgn * fd.x : 0, k === 0 ? 0.095 : fd.len[k - 1], 0);
            parent.add(j);
            add(j, 'hand', capsuleUp(fd.r * (1 - k * 0.08), l + fd.r * 0.6), hm, [0, -fd.r * 0.3, 0]);
            joints.push(j);
            parent = j;
          });
          return joints;
        });
        const tb = new T.Group();
        tb.position.set(tsgn * 0.03, 0.02, 0.006);
        g.hand.add(tb);
        const thumb = [tb];
        let tp = tb;
        [0.042, 0.032, 0.026].forEach((l, k) => {
          const j = k === 0 ? tb : new T.Group();
          if (k > 0) { j.position.set(0, [0.042, 0.032][k - 1], 0); tp.add(j); thumb.push(j); }
          add(j, 'hand', capsuleUp(0.0115 - k * 0.001, l + 0.005), hm, [0, -0.003, 0]);
          tp = j;
        });
        g.hand.scale.setScalar(1.06);
        Object.assign(g, { fingers, thumb, tsgn });
        this.limb[side] = g;
      }
    }

    setLayer(name, on) {
      this.layers[name].forEach((m) => (m.visible = on));
      if (name === 'skin') this.layers.face.forEach((m) => (m.visible = on));
    }
    setSkinOpacity(o) {
      this.mat.skin.opacity = this.mat.skinL.opacity = this.mat.skinR.opacity = o;
      this.mat.head.opacity = Math.min(0.95, o + 0.65);
    }
    setTint(on) {
      const base = new T.Color(SKIN);
      for (const s of ['L', 'R']) {
        const tint = on ? base.clone().lerp(new T.Color(COLORS[s]), 0.45) : base;
        this.mat['skin' + s].color.copy(on ? base.clone().lerp(new T.Color(COLORS[s]), 0.3) : base);
        this.mat['hand' + s].color.copy(tint);
      }
    }

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
      J.headC.copy(J.pelvis).add(C(0, D.headY, 0.01));
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
