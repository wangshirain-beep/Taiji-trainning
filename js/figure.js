// 半透明演示人：由胶囊体组成的人形 + 内部骨架线，用两段式 IK 求解四肢。
// 姿势坐标约定（身体坐标）：r = 向右，u = 向上，f = 向前（单位：米）。
// 世界坐标：y 向上；起势时面向 +z，人的左侧为 +x；yaw（度）为正表示向左转。
(function () {
  const T = THREE;
  const Taiji = (window.Taiji = window.Taiji || {});
  const DEG = Math.PI / 180;

  const D = {
    ankle: 0.08, shin: 0.43, thigh: 0.44, hipW: 0.095,
    spine: 0.3, shW: 0.19, shUp: 0.12, upper: 0.28, fore: 0.25,
  };
  const STAND = D.ankle + D.shin + D.thigh; // 髋关节站立高度
  const LEG_MAX = D.shin + D.thigh - 0.005;

  const COLORS = { L: 0x4db8ff, R: 0xff9f4a, C: 0xd9f2ea };

  function skinMat(c) {
    return new T.MeshStandardMaterial({
      color: c, emissive: c, emissiveIntensity: 0.2, roughness: 0.35, metalness: 0,
      transparent: true, opacity: 0.3, depthWrite: false,
    });
  }

  const V = (x, y, z) => new T.Vector3(x, y, z);
  const Y_AXIS = V(0, 1, 0);

  function ik(a, t, l1, l2, pole, outMid, outEnd) {
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
  }

  function ankleOf(f) {
    const y = D.ankle + (f.lift || 0) + (f.pitch < 0 ? 0.14 * Math.sin(-f.pitch * DEG) : 0);
    return V(f.x, y, f.z);
  }

  class Figure {
    constructor() {
      this.root = new T.Group();
      const mC = skinMat(COLORS.C), mL = skinMat(COLORS.L), mR = skinMat(COLORS.R);
      this.skinMats = [mC, mL, mR];
      this.skin = new T.Group();
      this.bones = new T.Group();
      this.root.add(this.skin, this.bones);

      const add = (geo, mat, shadow = true) => {
        const m = new T.Mesh(geo, mat);
        m.castShadow = shadow;
        this.skin.add(m);
        return m;
      };
      const cap = (r, len, mat) => add(new T.CapsuleGeometry(r, len, 6, 16), mat);

      this.pelvis = add(new T.SphereGeometry(1, 24, 16), mC);
      this.pelvis.scale.set(0.165, 0.11, 0.115);
      this.torso = cap(0.12, 0.2, mC);
      this.torso.scale.set(1.3, 1, 0.78);
      this.chest = add(new T.SphereGeometry(1, 24, 16), mC);
      this.chest.scale.set(0.2, 0.14, 0.12);
      this.neck = cap(0.045, 0.07, mC);
      this.head = new T.Group();
      this.skin.add(this.head);
      // 头部单独写入深度，这样从背后看时不会透出面部标记
      const skull = new T.Mesh(new T.SphereGeometry(0.105, 24, 18), mC.clone());
      skull.material.depthWrite = true;
      this.skinMats.push(skull.material);
      skull.scale.set(0.92, 1.12, 1);
      skull.castShadow = true;
      this.head.add(skull);
      // 面部标记（鼻、眼），便于分辨正面与背面
      const faceMat = new T.MeshBasicMaterial({ color: 0x20343a, transparent: true });
      const nose = new T.Mesh(new T.ConeGeometry(0.018, 0.045, 10), new T.MeshBasicMaterial({ color: COLORS.C, transparent: true }));
      nose.renderOrder = 1;
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, -0.01, 0.11);
      this.head.add(nose);
      for (const sx of [-1, 1]) {
        const eye = new T.Mesh(new T.SphereGeometry(0.014, 10, 8), faceMat);
        eye.position.set(sx * 0.035, 0.025, 0.1);
        eye.renderOrder = 1;
        this.head.add(eye);
      }

      this.limbs = {};
      for (const side of ['L', 'R']) {
        const m = side === 'L' ? mL : mR;
        const hand = new T.Group();
        const palmGeo = new T.BoxGeometry(0.075, 0.16, 0.03);
        palmGeo.translate(0, 0.08, 0);
        const palm = new T.Mesh(palmGeo, m);
        palm.castShadow = true;
        hand.add(palm);
        const thumbGeo = new T.CapsuleGeometry(0.013, 0.045, 4, 8);
        thumbGeo.translate(0, 0.03, 0);
        const thumb = new T.Mesh(thumbGeo, m);
        thumb.position.set(0.036 * (side === 'R' ? 1 : -1), 0.02, 0.01);
        thumb.rotation.z = (side === 'R' ? -1 : 1) * 0.5;
        hand.add(thumb);
        this.skin.add(hand);

        const foot = new T.Group();
        const footGeo = new T.BoxGeometry(0.09, 0.055, 0.24);
        footGeo.translate(0, -0.05, 0.06);
        const footMesh = new T.Mesh(footGeo, m);
        footMesh.castShadow = true;
        foot.add(footMesh);
        this.skin.add(foot);

        this.limbs[side] = {
          upper: cap(0.043, D.upper, m), fore: cap(0.036, D.fore, m),
          thigh: cap(0.066, D.thigh, m), shin: cap(0.049, D.shin, m),
          hand, palm, thumb, foot,
        };
      }

      // 内部骨架：不透明的细骨与关节点，穿过半透明外壳依然清晰可见
      const boneGeo = new T.CylinderGeometry(0.011, 0.011, 1, 6);
      const jointGeo = new T.SphereGeometry(0.022, 10, 8);
      const bm = { L: new T.MeshBasicMaterial({ color: COLORS.L }), R: new T.MeshBasicMaterial({ color: COLORS.R }), C: new T.MeshBasicMaterial({ color: 0xffffff }) };
      this.boneList = [
        ['pelvis', 'chest', 'C'], ['chest', 'neckTop', 'C'],
        ['hipL', 'hipR', 'C'], ['shL', 'shR', 'C'],
        ['shL', 'elbowL', 'L'], ['elbowL', 'wristL', 'L'], ['hipL', 'kneeL', 'L'], ['kneeL', 'ankleL', 'L'],
        ['shR', 'elbowR', 'R'], ['elbowR', 'wristR', 'R'], ['hipR', 'kneeR', 'R'], ['kneeR', 'ankleR', 'R'],
      ].map(([a, b, c]) => {
        const mesh = new T.Mesh(boneGeo, bm[c]);
        this.bones.add(mesh);
        return { a, b, mesh };
      });
      this.jointList = ['pelvis', 'chest', 'shL', 'shR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR']
        .map((name) => {
          const c = name.endsWith('L') ? 'L' : name.endsWith('R') ? 'R' : 'C';
          const mesh = new T.Mesh(jointGeo, bm[c]);
          this.bones.add(mesh);
          return { name, mesh };
        });

      this.J = {};
      for (const n of ['pelvis', 'chest', 'neckTop', 'headC', 'shL', 'shR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR']) this.J[n] = V(0, 0, 0);
    }

    setOpacity(o) { this.skinMats.forEach((m) => (m.opacity = o)); }

    static placeSeg(mesh, a, b) {
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      const dir = b.clone().sub(a);
      const len = dir.length();
      if (len > 1e-6) mesh.quaternion.setFromUnitVectors(Y_AXIS, dir.divideScalar(len));
      return len;
    }

    // 根据姿势参数求解全身关节位置并更新模型
    apply(P) {
      const J = this.J;
      const qP = new T.Quaternion().setFromAxisAngle(Y_AXIS, P.yaw * DEG);
      const offL = V(D.hipW, 0, 0).applyQuaternion(qP);
      const offR = V(-D.hipW, 0, 0).applyQuaternion(qP);
      const aL = ankleOf(P.lf), aR = ankleOf(P.rf);

      const px = P.lf.x + (P.rf.x - P.lf.x) * P.w;
      const pz = P.lf.z + (P.rf.z - P.lf.z) * P.w;
      let py = STAND - P.h;
      // 着地的脚必须够得着：必要时自动降低重心
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
      J.chest.copy(J.pelvis).add(C(0, D.spine, 0));
      J.neckTop.copy(J.chest).add(C(0, 0.22, 0));
      J.headC.copy(J.chest).add(C(0, 0.34, 0.01));
      J.shL.copy(J.chest).add(C(-D.shW, D.shUp, 0));
      J.shR.copy(J.chest).add(C(D.shW, D.shUp, 0));

      // 躯干
      this.pelvis.position.copy(J.pelvis);
      this.pelvis.quaternion.copy(qP);
      this.torso.position.copy(J.pelvis).add(C(0, 0.17, 0));
      this.torso.quaternion.copy(qC);
      this.chest.position.copy(J.chest).add(C(0, 0.07, 0));
      this.chest.quaternion.copy(qC);
      Figure.placeSeg(this.neck, J.chest.clone().add(C(0, 0.14, 0)), J.neckTop);
      this.head.position.copy(J.headC);
      this.head.quaternion.copy(qC).multiply(new T.Quaternion().setFromAxisAngle(Y_AXIS, (P.look || 0) * DEG));

      // 手臂
      for (const side of ['L', 'R']) {
        const hs = side === 'L' ? P.lh : P.rh;
        const limb = this.limbs[side];
        const sh = J['sh' + side], el = J['elbow' + side], wr = J['wrist' + side];
        const target = J.chest.clone().add(C(hs.p[0], hs.p[1], hs.p[2]));
        const pole = C(side === 'L' ? -0.6 : 0.6, -1, -0.25);
        ik(sh, target, D.upper, D.fore, pole, el, wr);
        Figure.placeSeg(limb.upper, sh, el);
        Figure.placeSeg(limb.fore, el, wr);

        const Yv = C(hs.fin[0], hs.fin[1], hs.fin[2]).normalize();
        const Zv = C(hs.palm[0], hs.palm[1], hs.palm[2]);
        Zv.addScaledVector(Yv, -Zv.dot(Yv));
        if (Zv.lengthSq() < 1e-6) Zv.copy(C(0, 0, 1)).addScaledVector(Yv, -C(0, 0, 1).dot(Yv));
        Zv.normalize();
        const Xv = Yv.clone().cross(Zv);
        limb.hand.position.copy(wr);
        limb.hand.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(Xv, Yv, Zv));
        const kind = hs.kind || 'palm';
        if (kind === 'fist') { limb.palm.scale.set(1.05, 0.55, 2.4); limb.thumb.visible = false; }
        else if (kind === 'hook') { limb.palm.scale.set(0.7, 0.75, 1.3); limb.thumb.visible = false; }
        else { limb.palm.scale.set(1, 1, 1); limb.thumb.visible = true; }
      }

      // 腿脚
      for (const side of ['L', 'R']) {
        const f = side === 'L' ? P.lf : P.rf;
        const limb = this.limbs[side];
        const hip = J['hip' + side], kn = J['knee' + side], an = J['ankle' + side];
        const target = side === 'L' ? aL : aR;
        const out = side === 'L' ? offL : offR;
        const fwd = V(Math.sin(f.yaw * DEG), 0.15, Math.cos(f.yaw * DEG)).addScaledVector(out, 0.8);
        ik(hip, target, D.thigh, D.shin, fwd, kn, an);
        Figure.placeSeg(limb.thigh, hip, kn);
        Figure.placeSeg(limb.shin, kn, an);
        limb.foot.position.copy(an);
        limb.foot.quaternion.setFromEuler(new T.Euler(-(f.pitch || 0) * DEG, f.yaw * DEG, 0, 'YXZ'));
      }

      // 骨架
      for (const b of this.boneList) {
        const len = Figure.placeSeg(b.mesh, J[b.a], J[b.b]);
        b.mesh.scale.set(1, len, 1);
      }
      for (const j of this.jointList) j.mesh.position.copy(J[j.name]);

      return { pelvis: J.pelvis, yaw: P.yaw };
    }
  }

  Taiji.Figure = Figure;
  Taiji.FIG_COLORS = COLORS;
})();
