// 动作纠正：用摄像头 + MediaPipe 姿态识别，把练习者的关节角度与标准动作对比，给出评分和纠正提示。
// 视频只在本机浏览器里处理，不会上传。
(function () {
  const Taiji = (window.Taiji = window.Taiji || {});
  const DEG = 180 / Math.PI;

  const MP_VERSION = '1.0.1';
  const LOCAL = '../vendor/mediapipe';
  const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
  const CDN_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

  // MediaPipe 33 点中用到的关节
  const LM = { shL: 11, shR: 12, elL: 13, elR: 14, wrL: 15, wrR: 16, hipL: 23, hipR: 24, knL: 25, knR: 26, anL: 27, anR: 28 };
  const BONES = [['shL', 'shR'], ['shL', 'elL'], ['elL', 'wrL'], ['shR', 'elR'], ['elR', 'wrR'], ['shL', 'hipL'], ['shR', 'hipR'], ['hipL', 'hipR'],
    ['hipL', 'knL'], ['knL', 'anL'], ['hipR', 'knR'], ['knR', 'anR']];

  // 参与评分的特征：权重越大越重要（步法与重心权重最高）
  const FEATURES = [
    { id: 'kneeL', w: 1.5, joint: 'knL' }, { id: 'kneeR', w: 1.5, joint: 'knR' },
    { id: 'stance', w: 1.5, joint: null }, { id: 'weight', w: 1.5, joint: null },
    { id: 'hipL', w: 0.8, joint: 'hipL' }, { id: 'hipR', w: 0.8, joint: 'hipR' },
    { id: 'lean', w: 0.5, joint: null },
    { id: 'armL', w: 0.8, joint: 'shL' }, { id: 'armR', w: 0.8, joint: 'shR' },
    { id: 'elbowL', w: 0.6, joint: 'elL' }, { id: 'elbowR', w: 0.6, joint: 'elR' },
  ];
  const TOL = 15; // 误差在 15° 以内算合格（单摄像头估计深度有误差，不宜过严）
  const ANGLES = ['kneeL', 'kneeR', 'hipL', 'hipR', 'elbowL', 'elbowR', 'armL', 'armR', 'lean'];
  const CALIB_MS = 3000;

  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const len = (v) => Math.hypot(v.x, v.y, v.z);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
  function angleBetween(u, v) {
    const d = (u.x * v.x + u.y * v.y + u.z * v.z) / (len(u) * len(v) || 1);
    return Math.acos(Math.max(-1, Math.min(1, d))) * DEG;
  }
  const jointAngle = (a, b, c) => angleBetween(sub(a, b), sub(c, b));

  // 由关节坐标（y 轴向上）计算特征
  function features(p) {
    const shM = mid(p.shL, p.shR), hipM = mid(p.hipL, p.hipR);
    const torsoUp = sub(shM, hipM), torsoDown = sub(hipM, shM);
    const legLen = (len(sub(p.hipL, p.knL)) + len(sub(p.knL, p.anL)) + len(sub(p.hipR, p.knR)) + len(sub(p.knR, p.anR))) / 2;
    const ax = p.anR.x - p.anL.x, az = p.anR.z - p.anL.z;
    const feetDist = Math.hypot(ax, az);
    const f = {
      kneeL: jointAngle(p.hipL, p.knL, p.anL), kneeR: jointAngle(p.hipR, p.knR, p.anR),
      hipL: angleBetween(torsoUp, sub(p.knL, p.hipL)), hipR: angleBetween(torsoUp, sub(p.knR, p.hipR)),
      elbowL: jointAngle(p.shL, p.elL, p.wrL), elbowR: jointAngle(p.shR, p.elR, p.wrR),
      armL: angleBetween(torsoDown, sub(p.elL, p.shL)), armR: angleBetween(torsoDown, sub(p.elR, p.shR)),
      lean: angleBetween(torsoUp, { x: 0, y: 1, z: 0 }),
      stance: feetDist / (legLen || 1),
      weight: null,
    };
    if (feetDist > 0.15 * legLen) { // 两脚分开时才计算重心落点：0=在左脚上，1=在右脚上
      const t = ((hipM.x - p.anL.x) * ax + (hipM.z - p.anL.z) * az) / (feetDist * feetDist);
      f.weight = Math.max(0, Math.min(1, t));
    }
    return f;
  }

  // 把特征差异换算成 "角度误差"，便于统一评分
  function diffs(u, r) {
    const d = {};
    for (const F of FEATURES) {
      if (F.id === 'stance') d.stance = (u.stance - r.stance) * 90;
      else if (F.id === 'weight') d.weight = u.weight == null || r.weight == null ? null : (u.weight - r.weight) * 90;
      else if (F.id === 'lean') d.lean = u.lean - r.lean;
      else d[F.id] = u[F.id] - r[F.id];
    }
    return d;
  }
  function scoreOf(d) {
    let sw = 0, s = 0;
    for (const F of FEATURES) {
      if (d[F.id] == null) continue;
      const e = Math.abs(d[F.id]);
      s += F.w * Math.max(0, 1 - Math.max(0, e - TOL / 2) / 50);
      sw += F.w;
    }
    return sw ? (s / sw) * 100 : 0;
  }
  function tipsOf(d, ref) {
    const out = [];
    const side = (id) => (id.endsWith('L') ? '左' : '右');
    for (const F of FEATURES) {
      const v = d[F.id];
      if (v == null) continue;
      const e = Math.abs(v);
      if (F.id === 'lean' && (v < 0 || e < 25)) continue; // 比标准更直立不算错；前倾受摄像头角度影响大，放宽
      if (e < TOL + 5) continue;
      let text = '';
      if (F.id.startsWith('knee')) text = v > 0 ? `${side(F.id)}腿再屈膝下沉一些` : `${side(F.id)}腿蹲得太低，稍微起来一点`;
      else if (F.id.startsWith('hip')) continue; // 与膝、重心提示重复，只计分
      else if (F.id.startsWith('elbow')) text = v > 0 ? `${side(F.id)}臂不要伸直，微屈沉肘` : `${side(F.id)}臂再舒展一些`;
      else if (F.id.startsWith('arm')) text = v > 0 ? `${side(F.id)}手放低一些` : `${side(F.id)}手再抬高一些`;
      else if (F.id === 'lean') text = '上身保持中正，不要前俯后仰';
      else if (F.id === 'stance') text = v < 0 ? '步子太小，脚再迈开一些' : '步子太大，收小一点';
      else if (F.id === 'weight') {
        const target = ref.weight < 0.35 ? '左腿' : ref.weight > 0.65 ? '右腿' : '两腿中间';
        text = `重心不对，把重心移到${target}`;
      }
      out.push({ text, e: e * F.w, joint: F.joint });
    }
    out.sort((a, b) => b.e - a.e);
    return out;
  }

  function loadScript(src) {
    return new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = ok;
      s.onerror = () => fail(new Error('无法加载 ' + src));
      document.head.appendChild(s);
    });
  }

  class Coach {
    // hooks: refFeaturesAt(t) / neutralFeatures() / currentTime() / isPlaying() / speak(text) / canSpeak() / onScore(score)
    constructor(hooks) {
      this.hooks = hooks;
      this.on = false;
      this.landmarker = null;
      this.video = document.createElement('video');
      this.video.playsInline = true;
      this.video.muted = true;
      this.source = null;
      this.facing = 'user';
      this.score = 0;
      this.lastTs = 0;
      this.lastSpoken = 0;
      this.tipSince = { text: '', t: 0 };
      this.stats = null;
      this.bias = null; // 校准：练习者自然站立时与标准站姿的差值（抵消摄像头角度和体型差异）
      this.calib = null;
      this.el = {
        panel: document.getElementById('coach'),
        canvas: document.getElementById('coachCanvas'),
        score: document.getElementById('coachScore'),
        tips: document.getElementById('coachTips'),
        status: document.getElementById('coachStatus'),
      };
      this.ctx = this.el.canvas.getContext('2d');
    }

    status(text) { this.el.status.textContent = text; this.el.status.hidden = !text; }

    async ensureModel() {
      if (this.landmarker) return;
      const local = /^https?:$/.test(location.protocol);
      this.status('正在加载姿态识别模型（首次约 18MB，请稍候）…');
      if (!window.Vision) await loadScript(`${LOCAL}/vision_bundle.js`);
      const wasmBase = local ? `${LOCAL}/wasm` : CDN_WASM;
      const fileset = { wasmLoaderPath: `${wasmBase}/vision_wasm_internal.js`, wasmBinaryPath: `${wasmBase}/vision_wasm_internal.wasm` };
      const model = local ? `${LOCAL}/pose_landmarker_lite.task` : CDN_MODEL;
      const make = (delegate) => window.Vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: model, delegate }, runningMode: 'VIDEO', numPoses: 1,
      });
      try { this.landmarker = await make('GPU'); } catch (e) { this.landmarker = await make('CPU'); }
    }

    async startCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('这个浏览器不支持摄像头，请用 Chrome / Edge / Safari 最新版，并通过 https 网址打开。');
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.facing, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.source = this.video;
    }

    async start() {
      this.on = true;
      this.el.panel.hidden = false;
      this.resetStats();
      try {
        await this.ensureModel();
        if (!this.source) {
          this.status('正在打开摄像头…');
          await this.startCamera();
        }
        this.status('');
        if (!this.bias) this.recalibrate();
        this.loop();
      } catch (e) {
        this.status(this.explain(e));
      }
    }
    explain(e) {
      const msg = String((e && e.message) || e);
      if (/Permission|NotAllowed/i.test(msg)) return '没有摄像头权限：请在浏览器地址栏旁边允许使用摄像头，然后重新打开动作纠正。';
      if (/NotFound|not found|Devices/i.test(msg)) return '没有找到摄像头。';
      if (/加载|fetch|Failed|wasm|model|network/i.test(msg)) return '姿态识别模型加载失败。请用网址方式打开本页面（见说明），或检查网络后重试。（' + msg + '）';
      return '动作纠正无法启动：' + msg;
    }
    stop() {
      this.on = false;
      this.el.panel.hidden = true;
      if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
      if (this.source === this.video) this.source = null;
    }
    async flip() {
      this.facing = this.facing === 'user' ? 'environment' : 'user';
      if (this.on && this.source === this.video) { try { await this.startCamera(); } catch (e) { this.status(this.explain(e)); } }
    }
    // 调试用：用图片/画布代替摄像头
    useSource(el) { this.source = el; }

    recalibrate() { this.bias = null; this.calib = { start: 0, n: 0, sum: {} }; }

    resetStats() { this.stats = { sum: 0, n: 0, tips: {} }; }
    summary() {
      if (!this.stats || !this.stats.n) return null;
      const top = Object.entries(this.stats.tips).sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]);
      return { score: Math.round(this.stats.sum / this.stats.n), tips: top };
    }

    loop() {
      if (!this.on) return;
      requestAnimationFrame(() => this.loop());
      const now = performance.now();
      if (!this.landmarker || !this.source || now - this.lastTs < 66) return; // 约 15 帧/秒
      const src = this.source;
      if (src === this.video && this.video.readyState < 2) return;
      this.lastTs = now;
      let res;
      try { res = this.landmarker.detectForVideo(src, now); } catch (e) { this.status(this.explain(e)); return; }
      this.process(res, src, now);
    }

    process(res, src, now) {
      const lm = res && res.landmarks && res.landmarks[0];
      const wl = res && res.worldLandmarks && res.worldLandmarks[0];
      let tips = [];
      let bad = new Set();
      if (!lm || !wl) {
        this.draw(src, null, bad);
        this.showTips([{ text: '没有看到人：请站到画面中间，全身入镜。' }], null);
        return;
      }
      const vis = (k) => (lm[LM[k]].visibility ?? 1);
      if (vis('anL') < 0.4 || vis('anR') < 0.4 || vis('knL') < 0.4 || vis('knR') < 0.4) {
        this.draw(src, lm, bad);
        this.showTips([{ text: '请再退后一点，让双脚也进入画面（步法要看脚）。' }], null);
        return;
      }
      const p = {};
      for (const k of Object.keys(LM)) { const q = wl[LM[k]]; p[k] = { x: q.x, y: -q.y, z: q.z }; }
      const user = features(p);

      if (this.calib) { // 校准：自然站立 3 秒
        const c = this.calib;
        if (!c.start) c.start = now;
        c.n++;
        for (const k of ANGLES) c.sum[k] = (c.sum[k] || 0) + user[k];
        const left = Math.max(0, Math.ceil((CALIB_MS - (now - c.start)) / 1000));
        this.draw(src, lm, bad);
        this.showTips([{ text: `校准中：请面向摄像头自然站立，两臂下垂，保持不动……${left} 秒` }], null);
        if (now - c.start >= CALIB_MS && c.n >= 10) {
          const ref = this.hooks.neutralFeatures();
          this.bias = {};
          for (const k of ANGLES) this.bias[k] = Math.max(-25, Math.min(25, c.sum[k] / c.n - ref[k]));
          this.calib = null;
          this.status('校准完成，开始练习吧。');
          setTimeout(() => this.status(''), 3000);
        }
        return;
      }
      if (this.bias) for (const k of ANGLES) user[k] -= this.bias[k];

      // 播放时练习者会慢半拍：在最近 2 秒的标准动作里找最接近的一帧来比
      const t = this.hooks.currentTime();
      const times = this.hooks.isPlaying() ? [0, -0.25, -0.5, -0.75, -1, -1.25, -1.5, -1.75, -2, 0.25].map((x) => t + x) : [t];
      let best = null;
      for (const tt of times) {
        const ref = this.hooks.refFeaturesAt(tt);
        const d = diffs(user, ref);
        const sc = scoreOf(d);
        if (!best || sc > best.sc) best = { sc, d, ref };
      }
      this.score = this.score ? this.score * 0.75 + best.sc * 0.25 : best.sc;
      tips = tipsOf(best.d, best.ref);
      tips.forEach((x) => x.joint && bad.add(x.joint));
      this.draw(src, lm, bad);
      this.showTips(tips.slice(0, 2), this.score);

      if (this.hooks.isPlaying()) {
        this.stats.sum += best.sc; this.stats.n++;
        if (tips[0]) this.stats.tips[tips[0].text] = (this.stats.tips[tips[0].text] || 0) + 1;
      }
      if (this.hooks.onScore) this.hooks.onScore(best.sc);

      // 语音纠正：同一条提示持续 2 秒以上、且没有在讲解时才说，每 7 秒最多一次
      const top = tips[0] ? tips[0].text : '';
      if (top !== this.tipSince.text) this.tipSince = { text: top, t: now };
      if (top && now - this.tipSince.t > 2000 && now - this.lastSpoken > 7000 && this.hooks.canSpeak()) {
        this.lastSpoken = now;
        this.hooks.speak(top);
      }
    }

    showTips(tips, score) {
      this.el.score.textContent = score == null ? '--' : Math.round(score);
      this.el.score.className = 'coach-score ' + (score == null ? '' : score >= 85 ? 'good' : score >= 65 ? 'ok' : 'bad');
      this.el.tips.innerHTML = '';
      const list = tips.length ? tips : [{ text: '动作很好，保持！' }];
      for (const x of list) {
        const li = document.createElement('li');
        li.textContent = x.text;
        this.el.tips.appendChild(li);
      }
    }

    draw(src, lm, bad) {
      const c = this.el.canvas, g = this.ctx;
      const w = src.videoWidth || src.naturalWidth || src.width || 640;
      const h = src.videoHeight || src.naturalHeight || src.height || 480;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      g.save();
      g.translate(w, 0); g.scale(-1, 1); // 镜像显示，像照镜子
      g.drawImage(src, 0, 0, w, h);
      if (lm) {
        g.lineWidth = Math.max(3, w / 160);
        for (const [a, b] of BONES) {
          const A = lm[LM[a]], B = lm[LM[b]];
          g.strokeStyle = bad.has(a) || bad.has(b) ? 'rgba(255,120,80,0.95)' : 'rgba(120,230,200,0.9)';
          g.beginPath(); g.moveTo(A.x * w, A.y * h); g.lineTo(B.x * w, B.y * h); g.stroke();
        }
        for (const k of Object.keys(LM)) {
          const P = lm[LM[k]];
          g.fillStyle = bad.has(k) ? '#ff6a4d' : '#ffffff';
          g.beginPath(); g.arc(P.x * w, P.y * h, Math.max(4, w / 120), 0, Math.PI * 2); g.fill();
        }
      }
      g.restore();
    }
  }

  Taiji.Coach = Coach;
  Taiji.poseFeatures = features;
})();
