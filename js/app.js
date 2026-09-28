// 场景、视角控制、播放逻辑、语音讲解与界面。
(function () {
  const T = THREE;
  const Tj = window.Taiji;
  const DEG = Math.PI / 180;
  const $ = (id) => document.getElementById(id);

  // ---------- 时间轴 ----------
  const keys = Tj.buildRoutine();
  const TEMPO = 1.25; // 整体节奏系数：全套约 5 分半钟，接近常规演练速度
  let acc = 0;
  keys.forEach((k) => { k.t *= TEMPO; acc += k.t; k.T = acc; });
  const TOTAL = acc;
  const FORMS = Tj.FORMS;
  FORMS.forEach((f, i) => {
    f.idx = i;
    f.t0 = keys[f.first - 1].T;
    f.t1 = keys[f.last].T;
    f.steps = [];
    for (let k = f.first; k <= f.last; k++) if (keys[k].say) f.steps.push({ k, say: keys[k].say });
    f.steps.forEach((st, j) => {
      st.t0 = keys[st.k - 1].T;
      st.t1 = j + 1 < f.steps.length ? keys[f.steps[j + 1].k - 1].T : f.t1;
    });
  });

  // ---------- 姿势插值 ----------
  const lerp = (a, b, s) => a + (b - a) * s;
  const smooth = (s) => s * s * (3 - 2 * s);
  const cr = (p0, p1, p2, p3, s) => {
    const s2 = s * s, s3 = s2 * s;
    return 0.5 * (2 * p1 + (p2 - p0) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (3 * p1 - p0 - 3 * p2 + p3) * s3);
  };
  function lerpFoot(a, b, s) {
    const e = smooth(s);
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const arc = d > 0.03 ? Math.sin(Math.PI * e) * Math.min(0.1, 0.04 + d * 0.12) : 0;
    return {
      x: lerp(a.x, b.x, e), z: lerp(a.z, b.z, e), yaw: lerp(a.yaw, b.yaw, e),
      lift: lerp(a.lift, b.lift, e) + arc, pitch: lerp(a.pitch, b.pitch, e),
    };
  }
  function lerpVec(a, b, e) {
    const v = [lerp(a[0], b[0], e), lerp(a[1], b[1], e), lerp(a[2], b[2], e)];
    const n = Math.hypot(v[0], v[1], v[2]);
    return n < 1e-4 ? b : v.map((x) => x / n);
  }
  function lerpHand(h0, h1, h2, h3, s, e) {
    return {
      p: [0, 1, 2].map((i) => cr(h0.p[i], h1.p[i], h2.p[i], h3.p[i], s)),
      palm: lerpVec(h1.palm, h2.palm, e), fin: lerpVec(h1.fin, h2.fin, e),
      kind: e < 0.5 ? h1.kind : h2.kind,
    };
  }
  function keyIndexAt(t) {
    let lo = 0, hi = keys.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (keys[mid].T <= t) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function sample(t) {
    t = Math.min(Math.max(t, 0), TOTAL);
    const i = keyIndexAt(t);
    if (i >= keys.length - 1) return keys[keys.length - 1].pose;
    const a = keys[i].pose, b = keys[i + 1].pose;
    const s = Math.min(1, (t - keys[i].T) / keys[i + 1].t);
    const e = 0.4 * s + 0.6 * smooth(s);
    const p0 = keys[Math.max(0, i - 1)].pose, p3 = keys[Math.min(keys.length - 1, i + 2)].pose;
    const P = { lf: lerpFoot(a.lf, b.lf, s), rf: lerpFoot(a.rf, b.rf, s) };
    for (const k of ['w', 'h', 'yaw', 'waist', 'lean', 'look']) P[k] = lerp(a[k], b[k], e);
    P.lh = lerpHand(p0.lh, a.lh, b.lh, p3.lh, s, e);
    P.rh = lerpHand(p0.rh, a.rh, b.rh, p3.rh, s, e);
    return P;
  }
  const formAt = (t) => { for (const f of FORMS) if (t < f.t1) return f; return FORMS[FORMS.length - 1]; };
  const stepAt = (f, t) => { for (let j = 0; j < f.steps.length; j++) if (t < f.steps[j].t1) return j; return f.steps.length - 1; };

  // ---------- 三维场景 ----------
  const stage = $('stage');
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  stage.prepend(renderer.domElement);

  const scene = new T.Scene();
  scene.background = new T.Color(0x0f1c21);
  scene.fog = new T.Fog(0x0f1c21, 9, 20);
  const camera = new T.PerspectiveCamera(40, 1, 0.05, 60);

  scene.add(new T.HemisphereLight(0xdff6ff, 0x1c2a2e, 0.9));
  const sun = new T.DirectionalLight(0xffffff, 0.8);
  sun.position.set(2.5, 6, 3.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 15 });
  scene.add(sun, sun.target);

  const ground = new T.Mesh(new T.CircleGeometry(12, 64), new T.MeshStandardMaterial({ color: 0x16282e, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new T.GridHelper(12, 24, 0x2f555e, 0x223c42);
  grid.position.y = 0.002;
  scene.add(grid);

  // 地面方位字：以起势时的朝向为"前"
  function label(text, x, z) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(160,220,210,0.55)';
    g.font = 'bold 84px "Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 64, 68);
    const m = new T.Mesh(new T.PlaneGeometry(0.45, 0.45), new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.005, z);
    scene.add(m);
  }
  label('前', 0, 2.8); label('后', 0, -2.8); label('左', 2.8, 0); label('右', -2.8, 0);
  const startMark = new T.Mesh(new T.RingGeometry(0.34, 0.37, 48), new T.MeshBasicMaterial({ color: 0x5fb8a8, transparent: true, opacity: 0.5 }));
  startMark.rotation.x = -Math.PI / 2;
  startMark.position.y = 0.004;
  scene.add(startMark);

  const fig = new Tj.Figure();
  scene.add(fig.root);

  // 手部轨迹
  const TRAIL_N = 150;
  const trails = ['L', 'R'].map((side) => {
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
    geo.setDrawRange(0, 0);
    const line = new T.Line(geo, new T.LineBasicMaterial({ color: Tj.FIG_COLORS[side], transparent: true, opacity: 0.8 }));
    line.frustumCulled = false;
    fig.root.add(line);
    return { line, geo, n: 0, side };
  });
  function clearTrails() { trails.forEach((tr) => { tr.n = 0; tr.geo.setDrawRange(0, 0); }); }
  function pushTrails() {
    for (const tr of trails) {
      const a = tr.geo.attributes.position.array;
      const w = fig.J['wrist' + tr.side];
      if (tr.n === TRAIL_N) a.copyWithin(0, 3); else tr.n++;
      a.set([w.x, w.y, w.z], (tr.n - 1) * 3);
      tr.geo.attributes.position.needsUpdate = true;
      tr.geo.setDrawRange(0, tr.n);
    }
  }

  // ---------- 视角 ----------
  const VIEWS = { back: 180, front: 0, left: 90, right: -90 };
  const cam = { az: 180 * DEG, el: 12 * DEG, dist: 3.4, follow: true, heading: 0, target: new T.Vector3(0, 0.9, 0), inited: false };
  function setView(name) {
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
    if (name === 'top') { cam.el = 80 * DEG; return; }
    const rel = VIEWS[name] * DEG;
    cam.az = cam.follow ? rel : cam.heading * DEG + rel;
    cam.el = 12 * DEG;
  }
  (function bindPointer() {
    const el = renderer.domElement;
    const pts = new Map();
    let pinch = 0;
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); });
    el.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 1) {
        cam.az -= (e.clientX - prev[0]) * 0.008;
        cam.el = Math.min(85 * DEG, Math.max(-5 * DEG, cam.el + (e.clientY - prev[1]) * 0.006));
        document.querySelectorAll('[data-view]').forEach((b) => b.classList.remove('on'));
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) cam.dist = Math.min(9, Math.max(1.5, cam.dist * pinch / d));
        pinch = d;
      }
    });
    const up = (e) => { pts.delete(e.pointerId); pinch = 0; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = Math.min(9, Math.max(1.5, cam.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });
  })();

  function updateCamera(info, dt) {
    const mirror = fig.root.scale.x < 0 ? -1 : 1;
    const heading = info.yaw * mirror;
    const tx = info.pelvis.x * mirror, tz = info.pelvis.z;
    const k = cam.inited ? 1 - Math.exp(-dt * 2.2) : 1;
    cam.heading += (heading - cam.heading) * k;
    cam.target.x += (tx - cam.target.x) * k;
    cam.target.z += (tz - cam.target.z) * k;
    cam.target.y = 0.95;
    cam.inited = true;
    const az = cam.follow ? cam.heading * DEG + cam.az : cam.az;
    camera.position.set(
      cam.target.x + cam.dist * Math.sin(az) * Math.cos(cam.el),
      cam.target.y + cam.dist * Math.sin(cam.el),
      cam.target.z + cam.dist * Math.cos(az) * Math.cos(cam.el),
    );
    camera.lookAt(cam.target);
    sun.position.set(cam.target.x + 2.5, 6, cam.target.z + 3.5);
    sun.target.position.copy(cam.target);
  }
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    if (camera.aspect < 0.8) cam.dist = Math.max(cam.dist, 4.8); // 竖屏时拉远，保证全身可见
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  // ---------- 语音 ----------
  const Speech = {
    ok: 'speechSynthesis' in window,
    enabled: true,
    voice: null,
    token: 0,
    timer: 0,
    pick() {
      if (!this.ok) return;
      const vs = speechSynthesis.getVoices();
      this.voice = vs.find((v) => /zh[-_]CN/i.test(v.lang)) || vs.find((v) => /^zh/i.test(v.lang) && !/HK|TW/i.test(v.lang)) || vs.find((v) => /^zh/i.test(v.lang)) || null;
      // 语音列表已加载却没有中文语音时，不朗读（避免用外语语音念中文）
      this.missing = vs.length > 0 && !this.voice;
      $('voiceWarn').hidden = !this.missing;
    },
    say(text, done) {
      this.stop();
      const my = ++this.token;
      const finish = () => { if (my !== this.token) return; this.token++; clearTimeout(this.timer); if (done) done(); };
      if (!this.ok || !this.enabled || this.missing) { this.timer = setTimeout(finish, 600); return; }
      const parts = text.split(/(?<=[。；！？])/).filter((x) => x.trim());
      let i = 0;
      const next = () => {
        if (my !== this.token) return;
        if (i >= parts.length) return finish();
        const u = new SpeechSynthesisUtterance(parts[i++]);
        u.lang = 'zh-CN';
        if (this.voice) u.voice = this.voice;
        u.rate = 0.95;
        u.onend = next;
        u.onerror = next;
        speechSynthesis.speak(u);
      };
      next();
      // 保险：个别浏览器不触发 onend
      this.timer = setTimeout(finish, (text.length * 0.3 + 4) * 1000);
    },
    stop() {
      this.token++;
      clearTimeout(this.timer);
      if (this.ok) speechSynthesis.cancel();
    },
  };
  if (Speech.ok) { Speech.pick(); speechSynthesis.onvoiceschanged = () => Speech.pick(); }
  else $('voiceWarn').hidden = false;

  // ---------- 播放状态 ----------
  const S = {
    mode: 'form', // form 单式教学 | all 连贯演练
    form: FORMS[0], t: 0, playing: false, speed: 1,
    teach: true, loop: false, step: -1, stepEnd: 0, speechDone: true, announced: -1,
  };
  const range = () => (S.mode === 'form' ? [S.form.t0, S.form.t1] : [0, TOTAL]);

  function beginStep(j) {
    const st = S.form.steps[j];
    S.step = j;
    S.t = st.t0;
    S.stepEnd = st.t1;
    S.speechDone = false;
    showCaption(st.say);
    highlightStep(j);
    Speech.say(st.say, () => { S.speechDone = true; });
  }
  function play() {
    const [t0, t1] = range();
    if (S.t >= t1 - 1e-3 || S.t < t0) S.t = t0;
    S.playing = true;
    clearTrails();
    if (S.mode === 'form' && S.teach) beginStep(stepAt(S.form, S.t));
    else if (S.mode === 'all') { S.announced = -1; }
    updateButtons();
  }
  function pause() {
    S.playing = false;
    Speech.stop();
    updateButtons();
  }
  function selectForm(i, keepPlaying) {
    const f = FORMS[Math.max(0, Math.min(FORMS.length - 1, i))];
    Speech.stop();
    S.form = f;
    S.t = f.t0;
    S.step = -1;
    clearTrails();
    renderInfo();
    showCaption(`第${f.idx + 1}式　${f.name}`);
    if (keepPlaying && S.playing) play(); else { S.playing = false; updateButtons(); }
  }
  function finish() {
    if (S.loop) { S.t = range()[0]; play(); return; }
    S.playing = false;
    updateButtons();
    if (S.mode === 'form') showCaption(`第${S.form.idx + 1}式「${S.form.name}」演示完毕。可点“下一式”继续学习，或打开“循环”反复练习。`);
    else showCaption('全套二十四式演练完毕。');
  }

  function tick(dt) {
    if (!S.playing) return;
    const [, t1] = range();
    if (S.mode === 'form' && S.teach) {
      S.t = Math.min(S.t + dt * S.speed, S.stepEnd);
      if (S.t >= S.stepEnd - 1e-6 && S.speechDone) {
        if (S.step + 1 < S.form.steps.length) beginStep(S.step + 1);
        else finish();
      }
      return;
    }
    S.t += dt * S.speed;
    if (S.mode === 'all') {
      const f = formAt(S.t);
      if (f !== S.form) { S.form = f; renderInfo(); }
      if (f.idx !== S.announced) {
        S.announced = f.idx;
        Speech.say(`第${f.idx + 1}式，${f.name}`);
      }
    }
    if (S.t >= t1) { S.t = t1; finish(); }
  }

  // ---------- 界面 ----------
  function buildList() {
    const box = $('formList');
    let group = '';
    FORMS.forEach((f, i) => {
      if (f.group !== group) {
        group = f.group;
        const g = document.createElement('div');
        g.className = 'group';
        g.textContent = group;
        box.appendChild(g);
      }
      const b = document.createElement('button');
      b.className = 'form-item';
      b.dataset.idx = i;
      b.innerHTML = `<span class="num">${i + 1}</span><span class="nm">${f.name}</span>`;
      b.onclick = () => {
        if (S.mode === 'all') { S.t = f.t0; S.form = f; renderInfo(); clearTrails(); if (S.playing) S.announced = -1; }
        else selectForm(i, false);
      };
      box.appendChild(b);
    });
  }
  function renderInfo() {
    const f = S.form;
    document.querySelectorAll('.form-item').forEach((b) => b.classList.toggle('on', +b.dataset.idx === f.idx));
    const cur = document.querySelector('.form-item.on');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    $('formTitle').textContent = `第${f.idx + 1}式　${f.name}`;
    $('infoNum').textContent = `${f.group} · 第 ${f.idx + 1} / 24 式`;
    $('infoName').textContent = f.name;
    const ol = $('infoSteps');
    ol.innerHTML = '';
    f.steps.forEach((st, j) => {
      const li = document.createElement('li');
      li.textContent = st.say;
      li.onclick = () => { S.mode === 'form' && S.teach && S.playing ? beginStep(j) : (S.t = st.t0, clearTrails()); };
      ol.appendChild(li);
    });
    $('infoKey').textContent = f.key;
    $('infoBreath').textContent = f.breath;
    $('infoMind').textContent = f.mind;
  }
  let lastStepHL = -1;
  function highlightStep(j) {
    if (j === lastStepHL) return;
    lastStepHL = j;
    [...$('infoSteps').children].forEach((li, k) => li.classList.toggle('on', k === j));
  }
  let lastCaption = '';
  function showCaption(text) {
    if (text === lastCaption) return;
    lastCaption = text;
    $('caption').textContent = text;
  }
  function updateButtons() {
    $('btnPlay').textContent = S.playing ? '⏸ 暂停' : '▶ 播放';
    $('btnPlay').classList.toggle('playing', S.playing);
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
    $('teachWrap').classList.toggle('dim', S.mode !== 'form');
  }
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  let scrubbing = false;
  function updateProgress() {
    const [t0, t1] = range();
    if (!scrubbing) $('scrub').value = Math.round(((S.t - t0) / (t1 - t0)) * 1000);
    $('time').textContent = `${fmt(Math.max(0, S.t - t0))} / ${fmt(t1 - t0)}`;
    if (!(S.mode === 'form' && S.teach && S.playing)) {
      const f = S.mode === 'all' ? S.form : S.form;
      if (S.t > f.t0 + 1e-3 || S.playing) {
        const j = stepAt(f, S.t);
        highlightStep(j);
        if (S.playing || scrubbing) showCaption(f.steps[j].say);
      }
    }
  }

  $('btnPlay').onclick = () => (S.playing ? pause() : play());
  $('btnPrev').onclick = () => (S.mode === 'all' ? (S.t = FORMS[Math.max(0, S.form.idx - 1)].t0, S.announced = -1, clearTrails()) : selectForm(S.form.idx - 1, true));
  $('btnNext').onclick = () => (S.mode === 'all' ? (S.t = FORMS[Math.min(23, S.form.idx + 1)].t0, S.announced = -1, clearTrails()) : selectForm(S.form.idx + 1, true));
  document.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => {
    pause();
    S.mode = b.dataset.mode;
    if (S.mode === 'form') selectForm(S.form.idx, false);
    else { S.t = 0; S.form = FORMS[0]; renderInfo(); showCaption('连贯演练：从预备势开始完整演示二十四式。'); }
    updateButtons();
  }));
  $('chkTeach').onchange = (e) => { S.teach = e.target.checked; if (S.playing) { pause(); play(); } };
  $('chkVoice').onchange = (e) => { Speech.enabled = e.target.checked; if (!Speech.enabled) Speech.stop(); if (S.playing && S.teach && S.mode === 'form') S.speechDone = true; };
  $('chkLoop').onchange = (e) => { S.loop = e.target.checked; };
  $('speed').onchange = (e) => { S.speed = +e.target.value; };
  $('scrub').oninput = (e) => {
    scrubbing = true;
    if (S.playing) pause();
    const [t0, t1] = range();
    S.t = t0 + (e.target.value / 1000) * (t1 - t0);
    if (S.mode === 'all') { const f = formAt(S.t); if (f !== S.form) { S.form = f; renderInfo(); } }
    clearTrails();
  };
  $('scrub').onchange = () => { scrubbing = false; };
  document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  $('chkFollow').onchange = (e) => {
    const heading = cam.heading * DEG;
    cam.az = e.target.checked ? cam.az - heading : cam.az + heading;
    cam.follow = e.target.checked;
  };
  $('chkMirror').onchange = (e) => { fig.root.scale.x = e.target.checked ? -1 : 1; clearTrails(); };
  $('chkBones').onchange = (e) => { fig.bones.visible = e.target.checked; };
  $('chkTrail').onchange = (e) => { trails.forEach((tr) => (tr.line.visible = e.target.checked)); clearTrails(); };
  $('opacity').oninput = (e) => fig.setOpacity(+e.target.value);
  $('btnSpeakKey').onclick = () => {
    const f = S.form;
    if (S.playing) pause();
    Speech.say(`${f.name}。动作要领：${f.key}呼吸：${f.breath}心法：${f.mind}`);
  };
  $('btnStopVoice').onclick = () => Speech.stop();
  $('btnGeneral').onclick = () => { if (S.playing) pause(); showCaption(Tj.GENERAL); Speech.say(Tj.GENERAL); };
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); $('btnPlay').click(); }
    else if (e.code === 'ArrowRight') $('btnNext').click();
    else if (e.code === 'ArrowLeft') $('btnPrev').click();
  });
  trails.forEach((tr) => (tr.line.visible = false));

  buildList();
  selectForm(0, false);
  showCaption('选择左侧招式，点击“播放”开始学习。拖动画面可旋转视角，滚轮或双指缩放。');
  updateButtons();

  // ---------- 主循环 ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tick(dt);
    const info = fig.apply(sample(S.t));
    if (S.playing) pushTrails();
    updateCamera(info, dt);
    updateProgress();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 供调试/截图使用
  window.TaijiApp = { S, FORMS, keys, TOTAL, setView, sample, fig, cam };
})();
