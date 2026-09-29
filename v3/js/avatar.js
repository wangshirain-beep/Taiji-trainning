// 人物形象：加载 VRoid 导出的 VRM 模型，用软件里的人体求解器驱动它做 24 式动作。
// 做法：求解器（js/figure.js）先算出每个关节的位置和朝向，再把 VRM 的每根骨头"对准"同样的方向。
// 模型按腿长缩放到与求解器同样大小，这样地面脚印、重心点、手部轨迹都能直接对上。
(function () {
  const T = THREE;
  const Taiji = (window.Taiji = window.Taiji || {});
  const DEG = Math.PI / 180;
  const LEG = 0.87; // 求解器的腿长（大腿 + 小腿）

  // 手型：f 四指弯曲 [近节, 中节, 远节]；sp 四指向中指靠拢的角度（食指、中指、无名指、小指）；
  // th 拇指三节 [向掌心, 向四指, 弯曲]（掌骨、近节、远节）
  const SHAPES = {
    palm: { f: [[6, 8, 5], [5, 7, 5], [6, 8, 5], [8, 10, 6]], sp: [-3, -1, 1, 3], th: [[0, 4, 2.5], [0, 4, 2.5], [0, 4, 2.5]] },
    // 拳：四指卷握，拇指横压在食指、中指第二节上
    fist: { f: [[85, 95, 55], [88, 100, 55], [88, 100, 55], [85, 95, 55]], sp: [0, 0, 0, 0], th: [[48, 96, 28], [0, -32, 110], [0, 0, 0]] },
    // 勾手：五指指尖捏拢成一点，四指较直、向中间收拢，拇指指尖与四指指尖相碰（角度由指尖距离数值优化得到）
    hook: { f: [[44, 25, 10], [40, 25, 10], [40, 25, 10], [44, 25, 10]], sp: [29, 10, -13, -33], th: [[60, 30, 20], [0, 0, 10], [0, 0, 0]] },
  };
  const FINGERS = ['Index', 'Middle', 'Ring', 'Little'], SEG = ['Proximal', 'Intermediate', 'Distal'];
  const THUMB = ['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal'];
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const _m = new T.Matrix4(), _q = new T.Quaternion(), _v = new T.Vector3();
  const basisQ = (X, Y, Z) => new T.Quaternion().setFromRotationMatrix(_m.makeBasis(X, Y, Z));
  const orth = (v, axis) => { const r = v.clone().addScaledVector(axis, -v.dot(axis)); return r.lengthSq() < 1e-8 ? null : r.normalize(); };

  class Avatar {
    constructor(scene) {
      this.container = new T.Group();
      this.container.visible = false;
      scene.add(this.container);
      this.vrm = null;
      this.ready = false;
      this.J = { wristL: V(0, 0, 0), wristR: V(0, 0, 0) };
    }

    load(url, onProgress) {
      return new Promise((resolve, reject) => {
        if (!T.GLTFLoader || !window.THREE_VRM) { reject(new Error('缺少模型加载库')); return; }
        const loader = new T.GLTFLoader();
        loader.register((parser) => new window.THREE_VRM.VRMLoaderPlugin(parser));
        loader.load(url, (gltf) => {
          const vrm = gltf.userData.vrm;
          if (!vrm) { reject(new Error('不是有效的 VRM 文件')); return; }
          window.THREE_VRM.VRMUtils.removeUnnecessaryVertices(gltf.scene);
          vrm.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
          this.vrm = vrm;
          this.container.add(vrm.scene);
          this.measure();
          this.ready = true;
          resolve(this);
        }, (e) => { if (onProgress && e.total) onProgress(e.loaded / e.total); }, reject);
      });
    }

    measure() {
      const vrm = this.vrm, c = this.container;
      c.scale.set(1, 1, 1);
      vrm.humanoid.resetNormalizedPose();
      c.updateMatrixWorld(true);
      const n = (b) => vrm.humanoid.getNormalizedBoneNode(b);
      const wp = (b) => n(b).getWorldPosition(V(0, 0, 0));
      const leg = wp('leftUpperLeg').distanceTo(wp('leftLowerLeg')) + wp('leftLowerLeg').distanceTo(wp('leftFoot'));
      this.n = n;
      this.k = leg / LEG; // 模型单位 / 求解器单位
      this.hipRest = n('hips').position.clone();
      this.footY = wp('leftFoot').y; // 站立时脚踝离地高度（模型单位）
    }

    setWorld(name, q) {
      const node = this.n(name);
      if (!node) return;
      node.parent.getWorldQuaternion(_q);
      node.quaternion.copy(_q.invert().multiply(q));
      node.updateMatrixWorld(true);
    }

    // P：姿势参数；S：已经用 P 求解过的人体求解器（js/figure.js 的 Figure）
    apply(P, S) {
      if (!this.ready) return;
      const J = S.J, n = this.n, k = this.k, c = this.container;
      c.scale.setScalar(1 / k); // 摆姿势时不镜像，镜像在 update() 里最后处理
      c.updateMatrixWorld(true);
      const hips = n('hips');
      hips.position.set(this.hipRest.x + J.pelvis.x * k, this.hipRest.y + (J.pelvis.y - 0.95) * k, this.hipRest.z + J.pelvis.z * k);
      this.setWorld('hips', S.gPelvis.quaternion);
      this.setWorld('spine', S.gWaist.quaternion);
      this.setWorld('chest', S.gChest.quaternion);
      this.setWorld('upperChest', S.gChest.quaternion);
      this.setWorld('neck', S.gChest.quaternion);
      this.setWorld('head', S.gHead.quaternion);
      for (const side of ['L', 'R']) {
        const s = side === 'L' ? 1 : -1, pre = side === 'L' ? 'left' : 'right';
        const g = S.limb[side];
        const sh = J['sh' + side], el = J['elbow' + side], wr = J['wrist' + side];
        const front = S.pArm[side].clone().negate();
        const fin = V(0, 1, 0).applyQuaternion(g.hand.quaternion), palm = V(0, 0, 1).applyQuaternion(g.hand.quaternion);
        this.setWorld(pre + 'Shoulder', S.gChest.quaternion);
        // 手臂：T 字姿势时左臂指向 +X、右臂指向 -X，前面朝 +Z
        const arm = (bone, d, ref) => { const X = d.clone().normalize().multiplyScalar(s); const Z = orth(ref, X) || orth(V(0, 0, 1), X); this.setWorld(bone, basisQ(X, Z.clone().cross(X), Z)); };
        arm(pre + 'UpperArm', el.clone().sub(sh), front);
        // 手：手指方向 = fin，手心朝向 = palm（T 字姿势时手心朝下）
        const hX = fin.clone().multiplyScalar(s), hY = orth(palm.clone().negate(), hX) || V(0, 1, 0), hZ = hX.clone().cross(hY);
        arm(pre + 'LowerArm', wr.clone().sub(el), front.clone().add(hZ).normalize()); // 前臂扭转取上臂与手掌之间
        this.setWorld(pre + 'Hand', basisQ(hX, hY, hZ));
        // 手指：按掌、拳、勾手的权重弯曲
        const hs = s > 0 ? P.lh : P.rh;
        const kw = hs.kw || { [hs.kind || 'palm']: 1 };
        const curl = [0, 1, 2, 3].map(() => [0, 0, 0]), sp = [0, 0, 0, 0], th = [0, 1, 2].map(() => [0, 0, 0]);
        for (const key in kw) {
          const w = kw[key], sh = SHAPES[key];
          if (!w) continue;
          sh.f.forEach((row, i) => row.forEach((a, j) => (curl[i][j] += a * w)));
          sh.sp.forEach((a, i) => (sp[i] += a * w));
          sh.th.forEach((row, j) => row.forEach((a, c) => (th[j][c] += a * w)));
        }
        // 四指：绕 Z 轴弯向掌心；近节再绕 Y 轴向中指靠拢
        FINGERS.forEach((f, i) => SEG.forEach((sg, j) => {
          const node = n(pre + f + sg);
          if (!node) return;
          node.quaternion.setFromAxisAngle(_v.set(0, 0, 1), -s * curl[i][j] * DEG);
          if (j === 0) node.quaternion.premultiply(_q.setFromAxisAngle(_v.set(0, 1, 0), s * sp[i] * DEG));
        }));
        // 拇指：绕 X 轴转向掌心，绕 Y 轴转向四指，绕 Z 轴弯曲
        THUMB.forEach((b, j) => { const node = n(pre + b); if (node) node.quaternion.setFromEuler(new T.Euler(th[j][0] * DEG, s * th[j][1] * DEG, -s * th[j][2] * DEG)); });
        // 腿：T 字姿势时腿指向 -Y，膝盖朝 +Z
        const hip = J['hip' + side], kn = J['knee' + side], an = J['ankle' + side];
        const leg = (bone, d) => { const Y = d.clone().normalize().negate(); const Z = orth(S.pLeg[side], Y) || orth(V(0, 0, 1), Y); this.setWorld(bone, basisQ(Y.clone().cross(Z), Y, Z)); };
        leg(pre + 'UpperLeg', kn.clone().sub(hip));
        leg(pre + 'LowerLeg', an.clone().sub(kn));
        this.setWorld(pre + 'Foot', g.foot.quaternion);
      }
      // 贴地：让着地的那只脚落在地面上
      c.updateMatrixWorld(true);
      const low = P.lf.lift <= P.rf.lift ? 'L' : 'R';
      const cur = n(low === 'L' ? 'leftFoot' : 'rightFoot').getWorldPosition(_v).y;
      const target = this.footY / k + (J['ankle' + low].y - 0.08);
      hips.position.y += (target - cur) * k;
      c.updateMatrixWorld(true);
      n('leftHand').getWorldPosition(this.J.wristL);
      n('rightHand').getWorldPosition(this.J.wristR);
    }

    // 物理（头发、头带、衣袖摆动）并处理镜像
    update(dt, mirror) {
      if (!this.ready) return;
      this.vrm.update(dt);
      this.container.scale.x = mirror / this.k;
    }

    setVisible(on) { this.container.visible = on && this.ready; }

    setOpacity(o) {
      if (!this.vrm) return;
      this.vrm.scene.traverse((m) => {
        if (!m.isMesh) return;
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => {
          const u = mat.userData;
          if (u.origTransparent === undefined) Object.assign(u, { origTransparent: mat.transparent, origDepthWrite: mat.depthWrite, origAlphaTest: mat.alphaTest });
          if (mat.isOutline) { mat.visible = o >= 0.999; return; } // 半透明时描边会透出一层深色外壳
          mat.opacity = o;
          mat.alphaTest = o < 0.999 ? Math.min(u.origAlphaTest, 0.01) : u.origAlphaTest; // VRoid 默认会裁掉低于 0.5 的像素
          mat.transparent = o < 0.999 || u.origTransparent;
          mat.depthWrite = o < 0.999 ? false : u.origDepthWrite;
          mat.needsUpdate = true;
        });
      });
    }
  }

  Taiji.Avatar = Avatar;
})();
