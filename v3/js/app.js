// 场景、视角控制、播放逻辑、语音讲解与界面。
// 分层教学：① 基本功（站桩、手型、步型、步法）→ ② 单式 → ③ 连贯演练；
// 地面脚印与重心提示帮助练好步法；可开启摄像头动作纠正。
(function () {
  const T = THREE;
  const Tj = window.Taiji;
  const DEG = Math.PI / 180;
  const $ = (id) => document.getElementById(id);

  // ---------- 时间轴：基本功、套路各一条 ----------
  const TEMPO = 1.25; // 整体节奏系数：全套约 5 分半钟，接近常规演练速度
  function makeTrack(keys, items) {
    let acc = 0;
    keys.forEach((k) => { k.t *= TEMPO; acc += k.t; k.T = acc; });
    items.forEach((f, i) => {
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
    return { keys, items, total: acc };
  }
  const TRACKS = {
    basic: makeTrack(Tj.buildBasics(), Tj.LESSONS),
    forms: makeTrack(Tj.buildRoutine(), Tj.FORMS),
  };
  const LEVELS = {
    basic: { track: TRACKS.basic, mode: 'form', unit: '课', label: '基本功' },
    form: { track: TRACKS.forms, mode: 'form', unit: '式', label: '单式教学' },
    all: { track: TRACKS.forms, mode: 'all', unit: '式', label: '连贯演练' },
  };
  let TR = TRACKS.forms; // 当前时间轴

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
    // 手型权重：掌、拳、勾手之间平滑过渡，手指逐渐弯曲或张开
    const kw = { palm: 0, fist: 0, hook: 0 };
    kw[h1.kind || 'palm'] += 1 - e;
    kw[h2.kind || 'palm'] += e;
    return {
      p: [0, 1, 2].map((i) => cr(h0.p[i], h1.p[i], h2.p[i], h3.p[i], s)),
      palm: lerpVec(h1.palm, h2.palm, e), fin: lerpVec(h1.fin, h2.fin, e),
      kind: e < 0.5 ? h1.kind : h2.kind,
      kw,
    };
  }
  function keyIndexAt(keys, t) {
    let lo = 0, hi = keys.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (keys[mid].T <= t) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function sample(t, tr) {
    tr = tr || TR;
    const keys = tr.keys;
    t = Math.min(Math.max(t, 0), tr.total);
    const i = keyIndexAt(keys, t);
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
  const itemAt = (t) => { for (const f of TR.items) if (t < f.t1) return f; return TR.items[TR.items.length - 1]; };
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
  const camera = new T.PerspectiveCamera(40, 1, 0.03, 60);

  scene.add(new T.HemisphereLight(0xfff4e8, 0x1c2a2e, 0.85));
  const sun = new T.DirectionalLight(0xffffff, 0.9);
  sun.position.set(2.5, 6, 3.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 15 });
  scene.add(sun, sun.target);
  const fill = new T.DirectionalLight(0xbfe6ff, 0.35);
  fill.position.set(-3, 2, -3);
  scene.add(fill);

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

  const fig = new Tj.Figure();
  scene.add(fig.root);
  const refFig = new Tj.Figure(); // 不渲染，只用来计算标准动作的关节角度
  // 人物形象：默认用 VRoid 做的"太极武者"模型（由上面的人体求解器驱动）；加载失败时退回人体结构模型
  const avatar = new Tj.Avatar(scene);
  let avatarOn = false;
  const opacityBy = { avatar: 1, anatomy: +document.getElementById('opacity').value };

  // 步法辅助：目标脚印 + 重心点（跟着人物一起镜像）
  const guides = new T.Group();
  fig.root.add(guides);
  const footGeo = new T.CircleGeometry(1, 24);
  footGeo.rotateX(-Math.PI / 2);
  const prints = ['L', 'R'].map((side) => {
    const g = new T.Group();
    const m = new T.Mesh(footGeo, new T.MeshBasicMaterial({ color: Tj.FIG_COLORS[side], transparent: true, opacity: 0.45, depthWrite: false }));
    m.scale.set(0.05, 1, 0.12);
    m.position.set(0, 0, 0.05);
    const toe = new T.Mesh(footGeo, m.material);
    toe.scale.set(0.035, 1, 0.035);
    toe.position.set(0, 0, 0.19);
    g.add(m, toe);
    g.position.y = 0.006;
    guides.add(g);
    return g;
  });
  const comDot = new T.Mesh(new T.CircleGeometry(0.045, 24), new T.MeshBasicMaterial({ color: 0xffe07a, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false }));
  comDot.renderOrder = 10; // 重心标识始终画在最上层，不会被裤腿、衣摆挡住
  comDot.rotation.x = -Math.PI / 2;
  comDot.position.y = 0.008;
  const comRing = new T.Mesh(new T.RingGeometry(0.06, 0.075, 32), comDot.material);
  comRing.rotation.x = -Math.PI / 2;
  comRing.position.y = 0.008;
  comRing.renderOrder = 10;
  guides.add(comDot, comRing);

  function updateGuides(P) {
    // 目标脚印：当前这一步结束时两脚应落在的位置
    const f = S.item;
    const st = f.steps[stepAt(f, S.t)];
    const target = TR.keys[keyIndexAt(TR.keys, st ? st.t1 : S.t)].pose;
    [target.lf, target.rf].forEach((ft, i) => {
      prints[i].visible = (ft.lift || 0) < 0.05;
      prints[i].position.x = ft.x;
      prints[i].position.z = ft.z;
      prints[i].rotation.y = ft.yaw * DEG;
    });
    const J = fig.J;
    comDot.position.x = comRing.position.x = J.pelvis.x;
    comDot.position.z = comRing.position.z = J.pelvis.z;
    const left = Math.round((1 - P.w) * 100);
    $('weightL').style.width = `${left}%`;
    $('weightText').textContent = `重心　左 ${left}% · 右 ${100 - left}%`;
  }

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
      const w = (avatarOn ? avatar.J : fig.J)['wrist' + tr.side];
      if (tr.n === TRAIL_N) a.copyWithin(0, 3); else tr.n++;
      a.set([w.x, w.y, w.z], (tr.n - 1) * 3);
      tr.geo.attributes.position.needsUpdate = true;
      tr.geo.setDrawRange(0, tr.n);
    }
  }

  // ---------- 视角 ----------
  const VIEWS = { back: 180, front: 0, left: 90, right: -90, hands: 25 };
  const cam = { az: 180 * DEG, el: 12 * DEG, dist: 3.4, follow: true, heading: 0, target: new T.Vector3(0, 0.9, 0), inited: false, focus: 'body' };
  const bodyDist = () => (camera.aspect < 0.8 ? 4.8 : 3.4);
  function setView(name) {
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
    const wasHands = cam.focus === 'hands';
    cam.focus = name === 'hands' ? 'hands' : 'body';
    if (name === 'hands') cam.dist = 1.25;
    else if (wasHands) cam.dist = bodyDist();
    if (name === 'top') { cam.el = 80 * DEG; return; }
    const rel = VIEWS[name] * DEG;
    cam.az = cam.follow ? rel : cam.heading * DEG + rel;
    cam.el = (name === 'hands' ? 8 : 12) * DEG;
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
        document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === 'hands' && cam.focus === 'hands'));
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) cam.dist = Math.min(9, Math.max(0.6, cam.dist * pinch / d));
        pinch = d;
      }
    });
    const up = (e) => { pts.delete(e.pointerId); pinch = 0; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = Math.min(9, Math.max(0.6, cam.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });
  })();

  function updateCamera(info, dt) {
    const mirror = fig.root.scale.x < 0 ? -1 : 1;
    const heading = info.yaw * mirror;
    let tx = info.pelvis.x * mirror, ty = 0.95, tz = info.pelvis.z;
    if (cam.focus === 'hands') { // 手部特写：镜头对准两手之间
      const W = avatarOn ? avatar.J : fig.J;
      const a = W.wristL, b = W.wristR;
      tx = ((a.x + b.x) / 2) * mirror; ty = (a.y + b.y) / 2; tz = (a.z + b.z) / 2;
    }
    const k = cam.inited ? 1 - Math.exp(-dt * 2.2) : 1;
    cam.heading += (heading - cam.heading) * k;
    cam.target.x += (tx - cam.target.x) * k;
    cam.target.y += (ty - cam.target.y) * k;
    cam.target.z += (tz - cam.target.z) * k;
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
    if (camera.aspect < 0.8 && cam.focus === 'body') cam.dist = Math.max(cam.dist, 4.8); // 竖屏时拉远，保证全身可见
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
    busy: false,
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
      this.busy = true;
      const finish = () => { if (my !== this.token) return; this.token++; this.busy = false; clearTimeout(this.timer); if (done) done(); };
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
      this.busy = false;
      clearTimeout(this.timer);
      if (this.ok) speechSynthesis.cancel();
    },
  };
  if (Speech.ok) { Speech.pick(); speechSynthesis.onvoiceschanged = () => Speech.pick(); }
  else $('voiceWarn').hidden = false;

  // ---------- 播放状态 ----------
  const S = {
    level: 'basic', mode: 'form', // mode: form 逐课/逐式 | all 连贯演练
    item: TR.items[0], t: 0, playing: false, speed: 1,
    teach: true, loop: false, step: -1, stepEnd: 0, speechDone: true, announced: -1,
    stepScore: {},
  };
  const range = () => (S.mode === 'form' ? [S.item.t0, S.item.t1] : [0, TR.total]);

  function beginStep(j) {
    const st = S.item.steps[j];
    S.step = j;
    S.t = st.t0;
    S.stepEnd = st.t1;
    S.speechDone = false;
    highlightStep(j);
    Speech.say(st.say, () => { S.speechDone = true; });
  }
  function play() {
    const [t0, t1] = range();
    if (S.t >= t1 - 1e-3 || S.t < t0) S.t = t0;
    S.playing = true;
    setStatus('');
    clearTrails();
    if (coach && coach.on && S.t <= t0 + 1e-3) { coach.resetStats(); S.stepScore = {}; renderScores(); }
    if (S.mode === 'form' && S.teach) beginStep(stepAt(S.item, S.t));
    else if (S.mode === 'all') { S.announced = -1; }
    updateButtons();
  }
  function pause() {
    S.playing = false;
    Speech.stop();
    markSpeaking(null);
    updateButtons();
  }
  function selectItem(i, keepPlaying) {
    const f = TR.items[Math.max(0, Math.min(TR.items.length - 1, i))];
    Speech.stop();
    S.item = f;
    S.t = f.t0;
    S.step = -1;
    S.stepScore = {};
    clearTrails();
    renderInfo();
    setStatus('');
    if (f.view) setView(f.view); else if (cam.focus === 'hands') setView('back');
    if (keepPlaying && S.playing) play(); else { S.playing = false; updateButtons(); }
  }
  function finish() {
    if (S.loop) { S.t = range()[0]; play(); return; }
    S.playing = false;
    updateButtons();
    let msg = S.mode === 'form' ? `「${S.item.name}」演示完毕。可点“下一${LEVELS[S.level].unit}”继续，或打开“循环”反复练习。` : '全套二十四式演练完毕。';
    const sum = coach && coach.on ? coach.summary() : null;
    if (sum) {
      const tip = sum.tips.length ? `主要问题：${sum.tips.join('；')}。` : '动作整体到位，继续保持。';
      msg = `本次动作评分 ${sum.score} 分。${tip}`;
      Speech.say(msg);
    }
    setStatus(msg);
  }

  function tick(dt) {
    if (!S.playing) return;
    const [, t1] = range();
    if (S.mode === 'form' && S.teach) {
      S.t = Math.min(S.t + dt * S.speed, S.stepEnd);
      if (S.t >= S.stepEnd - 1e-6 && S.speechDone) {
        if (S.step + 1 < S.item.steps.length) beginStep(S.step + 1);
        else finish();
      }
      return;
    }
    S.t += dt * S.speed;
    if (S.mode === 'all') {
      const f = itemAt(S.t);
      if (f !== S.item) { S.item = f; renderInfo(); }
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
    box.innerHTML = '';
    let group = '';
    TR.items.forEach((f, i) => {
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
        if (S.mode === 'all') { S.t = f.t0; S.item = f; renderInfo(); clearTrails(); if (S.playing) S.announced = -1; }
        else selectItem(i, false);
      };
      box.appendChild(b);
    });
  }
  function setLevel(level) {
    pause();
    S.level = level;
    S.mode = LEVELS[level].mode;
    TR = LEVELS[level].track;
    buildList();
    const unit = LEVELS[level].unit;
    $('btnPrev').textContent = `⏮ 上一${unit}`;
    $('btnNext').textContent = `下一${unit} ⏭`;
    if (S.mode === 'all') {
      S.t = 0; S.item = TR.items[0]; renderInfo();
      setStatus('连贯演练：从预备势开始完整演示二十四式。');
      if (cam.focus === 'hands') setView('back');
    } else {
      selectItem(0, false);
      if (level === 'basic') setStatus('基本功：很多初学者学不好太极拳，问题出在步法和重心上。先把站桩、步型、步法练扎实，再学套路。');
    }
    updateButtons();
  }
  let lastStepHL = -1;
  function renderInfo() {
    const f = S.item;
    const lv = LEVELS[S.level];
    document.querySelectorAll('.form-item').forEach((b) => b.classList.toggle('on', +b.dataset.idx === f.idx));
    const cur = document.querySelector('.form-item.on');
    if (cur) { const box = $('formList'); box.scrollTo({ top: cur.offsetTop - box.clientHeight / 2, left: cur.offsetLeft - box.clientWidth / 2 }); }
    $('formTitle').textContent = `第${f.idx + 1}${lv.unit}　${f.name}`;
    $('infoNum').textContent = `${lv.label} · ${f.group} · 第 ${f.idx + 1} / ${TR.items.length} ${lv.unit}`;
    $('infoName').textContent = f.name;
    const ol = $('infoSteps');
    ol.innerHTML = '';
    f.steps.forEach((st, j) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="txt"></span><span class="badge" hidden></span>';
      li.firstChild.textContent = st.say;
      li.onclick = () => { S.mode === 'form' && S.teach && S.playing ? beginStep(j) : (S.t = st.t0, clearTrails()); };
      ol.appendChild(li);
    });
    $('infoKey').textContent = f.key;
    $('infoBreath').textContent = f.breath;
    $('infoMind').textContent = f.mind;
    $('secMistake').hidden = !f.mistakes;
    $('infoMistake').textContent = f.mistakes || '';
    lastStepHL = -1;
    $('info').scrollTop = 0;
  }
  // 讲到哪里，右侧就高亮到哪里，并自动滚动到可见位置（画面上不叠加字幕，以免遮挡人物）
  function reveal(el) {
    const box = $('info');
    box.scrollTo({ top: Math.max(0, el.offsetTop - box.clientHeight * 0.25), behavior: 'smooth' });
  }
  function markSpeaking(el) {
    document.querySelectorAll('#info .speaking').forEach((x) => x.classList.remove('speaking'));
    if (el) { el.classList.add('speaking'); reveal(el); }
  }
  function highlightStep(j) {
    if (j === lastStepHL) return;
    lastStepHL = j;
    [...$('infoSteps').children].forEach((li, k) => {
      li.classList.toggle('on', k === j);
      if (k === j) reveal(li);
    });
  }
  function renderScores() { // 每一步的动作评分（开启动作纠正时）
    [...$('infoSteps').children].forEach((li, k) => {
      const b = li.querySelector('.badge');
      const sc = S.stepScore[k];
      b.hidden = !sc;
      if (sc) {
        const v = Math.round(sc.sum / sc.n);
        b.textContent = `${v}分`;
        b.className = 'badge ' + (v >= 85 ? 'good' : v >= 65 ? 'ok' : 'bad');
      }
    });
  }
  function setStatus(text) { $('status').textContent = text; $('status').hidden = !text; }
  function updateButtons() {
    $('btnPlay').textContent = S.playing ? '⏸ 暂停' : '▶ 播放';
    $('btnPlay').classList.toggle('playing', S.playing);
    document.querySelectorAll('[data-level]').forEach((b) => b.classList.toggle('on', b.dataset.level === S.level));
    $('teachWrap').classList.toggle('dim', S.mode !== 'form');
  }
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  let scrubbing = false;
  function updateProgress() {
    const [t0, t1] = range();
    if (!scrubbing) $('scrub').value = Math.round(((S.t - t0) / (t1 - t0)) * 1000);
    $('time').textContent = `${fmt(Math.max(0, S.t - t0))} / ${fmt(t1 - t0)}`;
    if (!(S.mode === 'form' && S.teach && S.playing) && (S.t > S.item.t0 + 1e-3 || S.playing)) highlightStep(stepAt(S.item, S.t));
  }

  // ---------- 动作纠正 ----------
  function refPoints(t, tr) {
    refFig.apply(sample(t, tr));
    const J = refFig.J;
    return { shL: J.shL, shR: J.shR, elL: J.elbowL, elR: J.elbowR, wrL: J.wristL, wrR: J.wristR, hipL: J.hipL, hipR: J.hipR, knL: J.kneeL, knR: J.kneeR, anL: J.ankleL, anR: J.ankleR };
  }
  const coach = new Tj.Coach({
    refFeaturesAt: (t) => { const [t0, t1] = range(); return Tj.poseFeatures(refPoints(Math.min(t1, Math.max(t0, t)))); },
    neutralFeatures: () => Tj.poseFeatures(refPoints(0, TRACKS.basic)), // 预备姿势（并步站立）
    currentTime: () => S.t,
    isPlaying: () => S.playing,
    canSpeak: () => !Speech.busy && $('chkCoachVoice').checked,
    speak: (text) => Speech.say(text),
    onScore: (sc) => {
      if (!S.playing) return;
      const j = stepAt(S.item, S.t);
      const rec = S.stepScore[j] || (S.stepScore[j] = { sum: 0, n: 0 });
      rec.sum += sc; rec.n++;
      if (rec.n % 8 === 1) renderScores();
    },
  });
  $('btnCoach').onclick = () => {
    if (coach.on) { coach.stop(); $('btnCoach').classList.remove('on'); return; }
    $('btnCoach').classList.add('on');
    coach.start();
  };
  $('btnCoachClose').onclick = () => { coach.stop(); $('btnCoach').classList.remove('on'); };
  $('btnCoachFlip').onclick = () => coach.flip();
  $('btnCoachCalib').onclick = () => coach.recalibrate();

  // ---------- 事件 ----------
  $('btnPlay').onclick = () => (S.playing ? pause() : play());
  $('btnPrev').onclick = () => (S.mode === 'all' ? (S.t = TR.items[Math.max(0, S.item.idx - 1)].t0, S.announced = -1, clearTrails()) : selectItem(S.item.idx - 1, true));
  $('btnNext').onclick = () => (S.mode === 'all' ? (S.t = TR.items[Math.min(TR.items.length - 1, S.item.idx + 1)].t0, S.announced = -1, clearTrails()) : selectItem(S.item.idx + 1, true));
  document.querySelectorAll('[data-level]').forEach((b) => (b.onclick = () => setLevel(b.dataset.level)));
  $('chkTeach').onchange = (e) => { S.teach = e.target.checked; if (S.playing) { pause(); play(); } };
  $('chkVoice').onchange = (e) => { Speech.enabled = e.target.checked; if (!Speech.enabled) Speech.stop(); if (S.playing && S.teach && S.mode === 'form') S.speechDone = true; };
  $('chkLoop').onchange = (e) => { S.loop = e.target.checked; };
  $('speed').onchange = (e) => { S.speed = +e.target.value; };
  $('scrub').oninput = (e) => {
    scrubbing = true;
    if (S.playing) pause();
    const [t0, t1] = range();
    S.t = t0 + (e.target.value / 1000) * (t1 - t0);
    if (S.mode === 'all') { const f = itemAt(S.t); if (f !== S.item) { S.item = f; renderInfo(); } }
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
  $('chkSkin').onchange = (e) => fig.setLayer('skin', e.target.checked);
  $('chkMuscle').onchange = (e) => fig.setLayer('muscle', e.target.checked);
  $('chkBone').onchange = (e) => fig.setLayer('bone', e.target.checked);
  $('chkTint').onchange = (e) => fig.setTint(e.target.checked);
  $('chkGuide').onchange = (e) => { guides.visible = e.target.checked; $('weightBox').hidden = !e.target.checked; };
  $('chkTrail').onchange = (e) => { trails.forEach((tr) => (tr.line.visible = e.target.checked)); clearTrails(); };
  $('opacity').oninput = (e) => {
    const o = +e.target.value;
    opacityBy[avatarOn ? 'avatar' : 'anatomy'] = o;
    if (avatarOn) avatar.setOpacity(o); else fig.setSkinOpacity(o);
  };
  function setFigureMode(mode) {
    avatarOn = mode === 'avatar' && avatar.ready;
    $('figMode').value = avatarOn ? 'avatar' : 'anatomy';
    avatar.setVisible(avatarOn);
    // VRoid 模型按 sRGB 配色；人体结构模型沿用原来的线性输出
    renderer.outputEncoding = avatarOn ? T.sRGBEncoding : T.LinearEncoding;
    scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true)); });
    fig.setLayer('skin', !avatarOn && $('chkSkin').checked);
    fig.setLayer('muscle', !avatarOn && $('chkMuscle').checked);
    fig.setLayer('bone', !avatarOn && $('chkBone').checked);
    fig.setLayer('hand', !avatarOn);
    $('anatomyOpts').hidden = avatarOn;
    $('opacity').value = opacityBy[avatarOn ? 'avatar' : 'anatomy'];
    $('opacity').dispatchEvent(new Event('input'));
    clearTrails();
  }
  $('figMode').onchange = (e) => setFigureMode(e.target.value);
  avatar.load('../models/taiji-warrior.vrm', (f) => setStatus(`正在加载人物模型… ${Math.round(f * 100)}%`))
    .then(() => { if ($('figMode').value === 'avatar') setFigureMode('avatar'); setStatus(''); })
    .catch(() => {
      $('figMode').querySelector('option[value=avatar]').disabled = true;
      setFigureMode('anatomy');
      setStatus('人物模型没能加载（直接双击打开网页时，浏览器不允许读取模型文件），已改用人体结构模型演示。用网址方式打开即可看到太极武者形象。');
    });
  $('btnSpeakKey').onclick = () => {
    const f = S.item;
    if (S.playing) pause();
    const parts = [['secKey', `${f.name}。动作要领：${f.key}`]];
    if (f.mistakes) parts.push(['secMistake', `常见错误：${f.mistakes}`]);
    parts.push(['secBreath', `呼吸：${f.breath}`], ['secMind', `心法：${f.mind}`]);
    const next = (i) => {
      if (i >= parts.length) { markSpeaking(null); return; }
      markSpeaking($(parts[i][0]));
      Speech.say(parts[i][1], () => next(i + 1));
    };
    next(0);
  };
  $('btnStopVoice').onclick = () => { Speech.stop(); markSpeaking(null); };
  $('btnGeneral').onclick = () => { if (S.playing) pause(); setStatus(Tj.GENERAL); Speech.say(Tj.GENERAL); };
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); $('btnPlay').click(); }
    else if (e.code === 'ArrowRight') $('btnNext').click();
    else if (e.code === 'ArrowLeft') $('btnPrev').click();
  });
  trails.forEach((tr) => (tr.line.visible = false));
  fig.setSkinOpacity(+$('opacity').value);

  setLevel('basic');

  // ---------- 主循环 ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tick(dt);
    const P = sample(S.t);
    const info = fig.apply(P);
    if (avatarOn) { avatar.apply(P, fig); avatar.update(dt, fig.root.scale.x < 0 ? -1 : 1); }
    if (guides.visible) updateGuides(P);
    if (S.playing) pushTrails();
    updateCamera(info, dt);
    updateProgress();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 供调试/截图使用
  window.TaijiApp = { S, TRACKS, setLevel, setView, sample, fig, cam, coach, avatar, setFigureMode, get TR() { return TR; } };
})();
