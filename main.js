(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const C = {
    night: css('--night'), deck: css('--deck'), rule: css('--rule'), paper: css('--paper'),
    haze: css('--haze'), amber: css('--amber'), cyan: css('--cyan'), green: css('--green'),
    violet: css('--violet'), red: css('--red'),
  };

  /* ───────────── Language ───────────── */
  let lang = 'tr';
  const L = (tr, en) => (lang === 'en' ? en : tr);
  const langListeners = [];

  function applyLang(next) {
    lang = next;
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-en]').forEach((el) => {
      if (el.dataset.tr === undefined) el.dataset.tr = el.innerHTML;
      el.innerHTML = lang === 'en' ? el.dataset.en : el.dataset.tr;
    });
    const btn = $('#langBtn');
    btn.textContent = lang === 'en' ? 'TR' : 'EN';
    btn.setAttribute('aria-label', lang === 'en' ? 'Türkçeye geç' : 'Switch to English');
    document.title = L('İbrahim Buğra San | AI / ML Mühendisi', 'İbrahim Buğra San | AI / ML Engineer');
    try { localStorage.setItem('lang', lang); } catch (e) { /* storage unavailable */ }
    langListeners.forEach((fn) => fn());
  }
  $('#langBtn').addEventListener('click', () => applyLang(lang === 'en' ? 'tr' : 'en'));

  /* ───────────── Canvas helper ───────────── */
  function fitCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: r.width, h: r.height };
  }

  /* ───────────── Telemetry simulation ───────────── */
  (function telemetry() {
    const canvas = $('#teleCanvas');
    const PX = 1.6;          // pixels per sample
    const RATE = 90;         // samples per second
    const LATENCY = 32;      // samples before the classifier commits to a label

    const CH = [
      { tr: 'Dikey hız', en: 'Vertical speed', unit: 'm/s', min: -13, max: 13, color: C.cyan, noise: 0.35, k: 0.035 },
      { tr: 'Hava hızı', en: 'Airspeed', unit: 'kt', min: -5, max: 140, color: C.amber, noise: 0.9, k: 0.02 },
      { tr: 'Yatış açısı', en: 'Roll angle', unit: '°', min: -45, max: 45, color: C.green, noise: 0.8, k: 0.04 },
      { tr: 'Tork', en: 'Torque', unit: '%', min: 0, max: 115, color: C.violet, noise: 0.9, k: 0.045 },
    ];
    const M = {
      hover:   { tr: 'Askıda kalma', en: 'Hover', t: [0, 3, 0, 78], rule: ['Hava hızı ≈ 0, dikey hız ≈ 0', 'Airspeed ≈ 0, vertical speed ≈ 0'] },
      climb:   { tr: 'Tırmanış', en: 'Climb', t: [7.5, 70, 0, 94], rule: ['Dikey hız > 0, tork yüksek', 'Vertical speed > 0, torque high'] },
      level:   { tr: 'Düz uçuş', en: 'Level flight', t: [0, 112, 0, 62], rule: ['Dikey hız ≈ 0, yatış ≈ 0', 'Vertical speed ≈ 0, roll ≈ 0'] },
      turnR:   { tr: 'Sağa dönüş', en: 'Right turn', t: [0, 95, 28, 72], rule: ['Yatış > 15°, irtifa sabit', 'Roll > 15°, altitude steady'] },
      turnL:   { tr: 'Sola dönüş', en: 'Left turn', t: [0, 95, -28, 72], rule: ['Yatış < −15°, irtifa sabit', 'Roll < −15°, altitude steady'] },
      descent: { tr: 'Alçalma', en: 'Descent', t: [-7, 84, 0, 36], rule: ['Dikey hız < 0, tork düşük', 'Vertical speed < 0, torque low'] },
      ood:     { tr: 'Reddedildi: dağılım dışı', en: 'Rejected: out of distribution', t: null, rule: ['Sinyal fiziksel zarfın dışında, tahmin verilmedi', 'Signal outside the physical envelope, no prediction'] },
    };
    const NORMAL = ['hover', 'climb', 'level', 'turnR', 'turnL', 'descent'];

    let ctx, W = 0, H = 0, maxN = 0;
    let buf = [];
    let n = 0;
    let seg = null, remain = 0, forceOod = false;
    const v = [0, 3, 0, 78];

    function newSegment() {
      let type;
      if (forceOod) { type = 'ood'; forceOod = false; }
      else {
        do { type = NORMAL[Math.floor(Math.random() * NORMAL.length)]; }
        while (seg && (type === seg.type || (seg.type === 'ood' && type === seg.prevType)));
      }
      seg = {
        type, start: n,
        prevType: seg ? seg.type : null,
        conf: type === 'ood' ? 0.41 + Math.random() * 0.12 : 0.89 + Math.random() * 0.09,
        prev: seg,
      };
      if (seg.prev) seg.prev.prev = null; // keep the chain short
      remain = type === 'ood' ? 230 : 300 + Math.floor(Math.random() * 200);
    }

    function step() {
      if (!seg || remain-- <= 0 || forceOod) newSegment();
      if (seg.type === 'ood') {
        const p = n - seg.start;
        CH.forEach((c, i) => {
          const span = c.max - c.min;
          const mid = (c.max + c.min) / 2;
          const target = mid + Math.sin(p * (0.21 + i * 0.07) + i) * span * 0.42
            + (Math.random() - 0.5) * span * 0.5;
          v[i] += (target - v[i]) * 0.5;
        });
      } else {
        const t = M[seg.type].t;
        CH.forEach((c, i) => {
          const sway = Math.sin(n * (0.021 + i * 0.006) + i * 1.7) * (c.max - c.min) * 0.02;
          v[i] += (t[i] + sway - v[i]) * c.k + (Math.random() - 0.5) * c.noise * 1.6;
        });
      }
      buf.push({ v: v.slice(), s: seg });
      if (buf.length > maxN) buf.shift();
      n++;
    }

    function committed() {
      // The label the classifier currently shows: the newest segment once it is past the latency window.
      if (n - seg.start >= LATENCY || !seg.prev) return seg;
      return seg.prev;
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const BAND = 38;
      const laneH = (H - BAND - 8) / CH.length;
      const xOf = (i) => W - (buf.length - 1 - i) * PX;

      // lane guides
      ctx.lineWidth = 1;
      ctx.strokeStyle = C.rule;
      ctx.globalAlpha = 0.55;
      CH.forEach((c, li) => {
        const y = BAND + laneH * li + laneH / 2;
        ctx.setLineDash([2, 6]);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      });
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // segments: bands, change points, labels
      let runStart = 0;
      ctx.font = '500 13px "Instrument Sans", system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      for (let i = 1; i <= buf.length; i++) {
        if (i === buf.length || buf[i].s !== buf[runStart].s) {
          const s = buf[runStart].s;
          const x0 = Math.max(0, xOf(runStart));
          const x1 = i === buf.length ? W : xOf(i);
          const isOod = s.type === 'ood';
          const known = n - s.start >= LATENCY;

          if (isOod) {
            ctx.fillStyle = C.red; ctx.globalAlpha = 0.1;
            ctx.fillRect(x0, BAND, x1 - x0, H - BAND);
            ctx.globalAlpha = 1;
          }
          ctx.fillStyle = isOod ? C.red : C.rule;
          ctx.globalAlpha = isOod ? 0.9 : 0.55;
          ctx.fillRect(x0 + 1, 8, Math.max(0, x1 - x0 - 2), BAND - 16);
          ctx.globalAlpha = 1;

          const label = known
            ? (isOod ? L(M.ood.tr, M.ood.en) : `${L(M[s.type].tr, M[s.type].en)}  ${s.conf.toFixed(2)}`)
            : '…';
          const tw = ctx.measureText(label).width;
          if (x1 - x0 > tw + 20) {
            ctx.fillStyle = isOod ? C.night : C.paper;
            ctx.fillText(label, x0 + 10, 8 + (BAND - 16) / 2 + 1);
          }

          // change point marker (only where the segment start is on screen)
          if (xOf(runStart) > 0 && s.start > 0) {
            const x = xOf(runStart);
            ctx.strokeStyle = C.amber; ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 5]);
            ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, H); ctx.stroke();
            ctx.setLineDash([]);
          }
          runStart = i;
        }
      }

      // traces
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      CH.forEach((c, li) => {
        const top = BAND + laneH * li + 6;
        const hh = laneH - 12;
        ctx.strokeStyle = c.color;
        ctx.beginPath();
        for (let i = 0; i < buf.length; i++) {
          const val = Math.min(c.max, Math.max(c.min, buf[i].v[li]));
          const y = top + hh * (1 - (val - c.min) / (c.max - c.min));
          const x = xOf(i);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // lane label
        const text = L(c.tr, c.en);
        ctx.font = '500 12px "Instrument Sans", system-ui, sans-serif';
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = C.deck; ctx.globalAlpha = 0.85;
        ctx.fillRect(8, top - 2, tw + 12, 18);
        ctx.globalAlpha = 1;
        ctx.fillStyle = c.color;
        ctx.fillText(text, 14, top + 8);
      });
    }

    // readout
    const rdM = $('#rdManeuver'), rdC = $('#rdConf'), rdR = $('#rdRule'), rdV = $('#rdVals');
    function buildVals() {
      rdV.innerHTML = CH.map((c, i) =>
        `<li><i style="background:${c.color}"></i>${L(c.tr, c.en)}<b id="rdv${i}"></b></li>`).join('');
    }
    let lastRead = 0;
    function readout(force) {
      const now = performance.now();
      if (!force && now - lastRead < 140) return;
      lastRead = now;
      const s = committed();
      const m = M[s.type];
      const bad = s.type === 'ood';
      rdM.textContent = bad ? L('Tahmin yok', 'No prediction') : L(m.tr, m.en);
      rdM.className = bad ? 'is-bad' : '';
      rdC.textContent = s.conf.toFixed(2);
      rdC.className = bad ? 'is-bad' : '';
      rdR.textContent = (bad ? '' : L('Uygun: ', 'Passes: ')) + L(m.rule[0], m.rule[1]);
      rdR.className = bad ? 'is-bad' : 'is-ok';
      CH.forEach((c, i) => {
        const el = document.getElementById('rdv' + i);
        if (el) el.textContent = `${(v[i].toFixed(i === 0 ? 1 : 0)).replace(/^-(0(\.0)?)$/, '$1')} ${c.unit}`;
      });
    }

    function resize() {
      const f = fitCanvas(canvas);
      ctx = f.ctx; W = f.w; H = f.h;
      maxN = Math.ceil(W / PX) + 2;
      while (buf.length < maxN) step();
      if (buf.length > maxN) buf = buf.slice(buf.length - maxN);
      draw();
    }

    let visible = true, last = 0, acc = 0, raf = 0;
    function frame(ts) {
      raf = 0;
      if (!visible || document.hidden) return;
      const dt = Math.min(0.1, (ts - (last || ts)) / 1000);
      last = ts;
      acc += dt * RATE;
      while (acc >= 1) { step(); acc--; }
      draw();
      readout(false);
      raf = requestAnimationFrame(frame);
    }
    function kick() { if (!reduced && !raf) { last = 0; raf = requestAnimationFrame(frame); } }

    $('#oodBtn').addEventListener('click', () => {
      forceOod = true;
      if (reduced) { for (let i = 0; i < 420; i++) step(); draw(); readout(true); }
    });

    buildVals();
    resize();
    readout(true);
    new ResizeObserver(resize).observe(canvas);
    new IntersectionObserver((e) => { visible = e[0].isIntersecting; if (visible) kick(); }).observe(canvas);
    document.addEventListener('visibilitychange', kick);
    langListeners.push(() => { buildVals(); draw(); readout(true); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
    kick();
  })();

  /* ───────────── MARS pipeline ───────────── */
  (function pipeline() {
    const STEPS = [
      {
        tr: ['Telemetri', 'Uçuş kayıt verisini al',
          'Uçuş veri kaydedicisi (FDR) ve HUMS akışlarından gelen çok değişkenli zaman serisi sisteme alınır. Sensörler farklı hızlarda örneklendiği için önce ortak bir zaman eksenine senkronize edilir.',
          'Çok değişkenli zaman serisi, sensör senkronizasyonu'],
        en: ['Telemetry', 'Ingest flight recorder data',
          'Multivariate time series from the flight data recorder (FDR) and HUMS streams enter the system. Sensors sample at different rates, so they are first synchronised onto a common time axis.',
          'Multivariate time series, sensor synchronisation'],
      },
      {
        tr: ['Ön işleme', 'Gürültülü ve dengesiz veriyi eğitime hazırla',
          'Veri kayan pencerelerle bölütlenir ve zaman serisi artırma uygulanır. Nadir manevralar az örnekle temsil edildiği için eğitim Focal Loss, Mixup ve Label Smoothing ile dengelenir.',
          'Kayan pencere, veri artırma, Focal Loss, Mixup, Label Smoothing'],
        en: ['Preprocessing', 'Prepare noisy, imbalanced data for training',
          'The data is segmented with sliding windows and augmented. Rare maneuvers have few samples, so training is balanced with Focal Loss, Mixup and Label Smoothing.',
          'Sliding window, augmentation, Focal Loss, Mixup, Label Smoothing'],
      },
      {
        tr: ['Sınıflandırma', 'Hibrit derin öğrenme modeliyle manevrayı tanı',
          'CNN katmanları yerel sinyal örüntülerini, BiLSTM zamansal bağlamı iki yönde, Multi-Head Attention ise pencere içindeki belirleyici anları yakalar. Model %93 doğruluk elde etti.',
          'CNN + BiLSTM + Multi-Head Attention, TensorFlow / Keras'],
        en: ['Classification', 'Recognise the maneuver with a hybrid deep model',
          'CNN layers capture local signal patterns, the BiLSTM captures temporal context in both directions, and Multi-Head Attention picks out the decisive moments in each window. The model reached 93% accuracy.',
          'CNN + BiLSTM + Multi-Head Attention, TensorFlow / Keras'],
      },
      {
        tr: ['Fizik kural motoru', 'Tahmini aerodinamik kurallarla denetle',
          'Modelin çıktısı tek başına kabul edilmez. Fiziksel Kural Motoru, tahmin edilen manevranın o andaki sensör değerleriyle aerodinamik olarak tutarlı olup olmadığını matematiksel olarak kontrol eder.',
          'Kural tabanlı doğrulama katmanı'],
        en: ['Physics rule engine', 'Check the prediction against aerodynamic rules',
          'The model output is not accepted on its own. The Physics Rule Engine mathematically checks whether the predicted maneuver is aerodynamically consistent with the sensor values at that moment.',
          'Rule-based validation layer'],
      },
      {
        tr: ['OOD güvenlik modülü', 'Modelin bilmediği veride tahmin verme',
          'MC Dropout ile belirsizlik ölçülür, Temperature Scaling ile güven skorları kalibre edilir. Eğitim dağılımının dışında kalan veri geldiğinde sistem yanlış bir etiket vermek yerine tahmini reddeder.',
          'MC Dropout, Temperature Scaling, Out-of-Distribution tespiti'],
        en: ['OOD safety module', 'Refuse to predict on data the model has never seen',
          'MC Dropout measures uncertainty and Temperature Scaling calibrates the confidence scores. When data falls outside the training distribution, the system rejects the prediction instead of giving a wrong label.',
          'MC Dropout, Temperature Scaling, out-of-distribution detection'],
      },
      {
        tr: ['Geçiş tespiti ve rapor', 'Manevra sınırlarını bul, bakım raporuna çevir',
          'CUSUM algoritması bir manevradan diğerine geçiş anını milisaniye hassasiyetinde bulur. Sonuçlar backend veri katmanında saklanır ve web arayüzünde kullanıma dayalı bakım raporuna dönüşür.',
          'CUSUM, backend veri katmanı, web raporlama'],
        en: ['Transitions and reporting', 'Find maneuver boundaries and turn them into a maintenance report',
          'The CUSUM algorithm finds the moment of transition between maneuvers with millisecond precision. Results are stored in the backend data layer and become a usage-based maintenance report in the web interface.',
          'CUSUM, backend data layer, web reporting'],
      },
    ];
    const list = $('#pipeSteps'), detail = $('#pipeDetail');
    let active = 2;

    function render() {
      list.innerHTML = STEPS.map((s, i) =>
        `<li role="presentation"><button type="button" role="tab" id="pipeTab${i}" aria-selected="${i === active}" tabindex="${i === active ? 0 : -1}" aria-controls="pipeDetail">${L(s.tr[0], s.en[0])}</button></li>`).join('');
      const s = L(STEPS[active].tr, STEPS[active].en);
      detail.setAttribute('aria-labelledby', 'pipeTab' + active);
      detail.innerHTML = `<h3>${s[1]}</h3><p>${s[2]}</p><p class="stack">${s[3]}</p>`;
    }
    function select(i, focus) {
      active = (i + STEPS.length) % STEPS.length;
      render();
      if (focus) $('#pipeTab' + active).focus();
    }
    list.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) select(Number(b.id.replace('pipeTab', '')), true);
    });
    list.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); select(active + 1, true); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); select(active - 1, true); }
    });
    langListeners.push(render);
    render();
  })();

  /* ───────────── Text-to-SQL walkthrough ───────────── */
  (function sqlDemo() {
    const QS = [
      {
        q: ['Geçen ay en çok ciro yapan 5 mağaza hangisi?', 'Which 5 stores had the highest revenue last month?'],
        intent: ['ciro_siralama', 'revenue_ranking'],
        schema: 'Sales(StoreId, SaleDate, NetAmount)\nStores(StoreId, StoreName)',
        sql: 'SELECT TOP 5 s.StoreName, SUM(f.NetAmount) AS Ciro\nFROM Sales f\nJOIN Stores s ON s.StoreId = f.StoreId\nWHERE f.SaleDate >= DATEADD(month, DATEDIFF(month, 0, GETDATE()) - 1, 0)\n  AND f.SaleDate <  DATEADD(month, DATEDIFF(month, 0, GETDATE()), 0)\nGROUP BY s.StoreName\nORDER BY Ciro DESC;',
        ok: true,
      },
      {
        q: ['Stokta 10 adetten az kalan ürünler hangileri?', 'Which products have fewer than 10 units in stock?'],
        intent: ['stok_sorgu', 'stock_lookup'],
        schema: 'Stock(ProductId, StoreId, Quantity)\nProducts(ProductId, ProductName)',
        sql: 'SELECT TOP 100 p.ProductName, SUM(k.Quantity) AS Adet\nFROM Stock k\nJOIN Products p ON p.ProductId = k.ProductId\nGROUP BY p.ProductName\nHAVING SUM(k.Quantity) < 10\nORDER BY Adet ASC;',
        ok: true,
      },
      {
        q: ['Bu yıl aylık ciro nasıl değişti?', 'How did monthly revenue change this year?'],
        intent: ['ciro_trend', 'revenue_trend'],
        schema: 'Sales(StoreId, SaleDate, NetAmount)',
        sql: 'SELECT MONTH(f.SaleDate) AS Ay, SUM(f.NetAmount) AS Ciro\nFROM Sales f\nWHERE YEAR(f.SaleDate) = YEAR(GETDATE())\nGROUP BY MONTH(f.SaleDate)\nORDER BY Ay;',
        ok: true,
      },
      {
        q: ['Satış tablosundaki bütün kayıtları sil', 'Delete every record in the sales table'],
        intent: ['veri_degistirme', 'data_modification'],
        schema: 'Sales(StoreId, SaleDate, NetAmount)',
        sql: 'DELETE FROM Sales;',
        ok: false,
      },
    ];
    const KW = /\b(SELECT|TOP|FROM|JOIN|ON|WHERE|AND|GROUP BY|ORDER BY|HAVING|AS|DESC|ASC|SUM|MONTH|YEAR|DATEADD|DATEDIFF|GETDATE|DELETE)\b/g;
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const hi = (s) => esc(s).replace(KW, '<b>$1</b>');

    const qBox = $('#sqlQs'), trace = $('#sqlTrace');
    let active = 0, timers = [];

    function rows(q) {
      const checks = q.ok
        ? `<span class="ok">${L('Yalnızca okuma sorgusu ✓', 'Read-only query ✓')}</span><br>
           <span class="ok">${L('Yalnızca izinli tablolar ✓', 'Allowed tables only ✓')}</span><br>
           <span class="ok">${L('Satır sınırı ve sözdizimi ✓', 'Row limit and syntax ✓')}</span>`
        : `<span class="bad">${L('Yazma/silme komutu tespit edildi ✗', 'Write/delete statement detected ✗')}</span>`;
      const result = q.ok
        ? `<span class="ok">${L('Sorgu veritabanına gönderildi, sonuç kullanıcıya doğal dille özetlendi.', 'Query sent to the database; the result is summarised for the user in plain language.')}</span>`
        : `<span class="bad">${L('Sorgu çalıştırılmadı. Bu asistan yalnızca okuma sorgularına izin verir.', 'Query not executed. This assistant only allows read queries.')}</span>`;
      return [
        [L('Niyet', 'Intent'), `<pre>${L(q.intent[0], q.intent[1])}</pre>`],
        [L('Enjekte edilen şema', 'Injected schema'), `<pre>${esc(q.schema)}</pre>`],
        [L('Üretilen SQL', 'Generated SQL'), `<pre data-sql></pre>`],
        [L('Denetim', 'Validation'), checks],
        [L('Sonuç', 'Result'), result],
      ];
    }

    function run(animate) {
      timers.forEach(clearTimeout); timers = [];
      const q = QS[active];
      qBox.innerHTML = QS.map((x, i) =>
        `<button type="button" data-i="${i}" aria-pressed="${i === active}">${L(x.q[0], x.q[1])}</button>`).join('');
      const r = rows(q);
      trace.innerHTML = '';
      const add = (i) => {
        const li = document.createElement('li');
        if (!q.ok && i >= 3) li.className = 'is-blocked';
        li.innerHTML = `<span>${r[i][0]}</span><div>${r[i][1]}</div>`;
        trace.appendChild(li);
        return li;
      };
      if (!animate || reduced) {
        r.forEach((_, i) => add(i));
        trace.querySelector('[data-sql]').innerHTML = hi(q.sql);
        return;
      }
      let t = 0;
      r.forEach((_, i) => {
        timers.push(setTimeout(() => {
          const li = add(i);
          if (i === 2) {
            const pre = li.querySelector('[data-sql]');
            const total = q.sql.length, dur = Math.min(900, total * 6);
            const t0 = performance.now();
            const type = (ts) => {
              const k = Math.min(1, (ts - t0) / dur);
              pre.innerHTML = hi(q.sql.slice(0, Math.round(total * k)));
              if (k < 1 && pre.isConnected) requestAnimationFrame(type);
            };
            requestAnimationFrame(type);
          }
        }, t));
        t += i === 2 ? Math.min(900, q.sql.length * 6) + 250 : 320;
      });
    }
    qBox.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      active = Number(b.dataset.i);
      run(true);
      qBox.querySelector(`[data-i="${active}"]`).focus();
    });
    langListeners.push(() => run(false));
    run(false);
  })();

  /* ───────────── A* drone route grid ───────────── */
  (function drone() {
    const canvas = $('#droneCanvas');
    const stat = $('#droneStat');
    const COLS = 28, ROWS = 14;
    const start = { x: 1, y: 7 }, goal = { x: 26, y: 6 };
    let blocked = new Uint8Array(COLS * ROWS);
    let ctx, W = 0, H = 0, cell = 1, path = null, explored = 0, cost = 0;
    const idx = (x, y) => y * COLS + x;
    const isEnd = (x, y) => (x === start.x && y === start.y) || (x === goal.x && y === goal.y);

    function astar() {
      const N = COLS * ROWS;
      const g = new Float32Array(N).fill(Infinity);
      const f = new Float32Array(N).fill(Infinity);
      const came = new Int32Array(N).fill(-1);
      const closed = new Uint8Array(N);
      const open = [];
      const h = (x, y) => {
        const dx = Math.abs(x - goal.x), dy = Math.abs(y - goal.y);
        return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
      };
      const s = idx(start.x, start.y), e = idx(goal.x, goal.y);
      g[s] = 0; f[s] = h(start.x, start.y); open.push(s);
      explored = 0;
      while (open.length) {
        let bi = 0;
        for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
        const cur = open.splice(bi, 1)[0];
        if (closed[cur]) continue;
        closed[cur] = 1; explored++;
        if (cur === e) {
          const out = [];
          for (let c = e; c !== -1; c = came[c]) out.push({ x: c % COLS, y: Math.floor(c / COLS) });
          cost = g[e];
          return out.reverse();
        }
        const cx = cur % COLS, cy = Math.floor(cur / COLS);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          const ni = idx(nx, ny);
          if (blocked[ni] || closed[ni]) continue;
          // no cutting across the corner of a no-fly cell
          if (dx && dy && (blocked[idx(cx + dx, cy)] || blocked[idx(cx, cy + dy)])) continue;
          const ng = g[cur] + (dx && dy ? Math.SQRT2 : 1);
          if (ng < g[ni]) { g[ni] = ng; f[ni] = ng + h(nx, ny); came[ni] = cur; open.push(ni); }
        }
      }
      return null;
    }

    function solve() {
      path = astar();
      stat.textContent = path
        ? L(`Rota uzunluğu ${cost.toFixed(1)} birim, incelenen düğüm ${explored}`,
            `Route length ${cost.toFixed(1)} units, ${explored} nodes explored`)
        : L('Rota yok: teslimat noktası yasak bölgelerle çevrili. Birkaç hücreyi açın.',
            'No route: the delivery point is sealed off by no-fly zones. Open a few cells.');
      draw();
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const ox = (W - cell * COLS) / 2, oy = (H - cell * ROWS) / 2;
      const cx = (x) => ox + (x + 0.5) * cell, cy = (y) => oy + (y + 0.5) * cell;

      ctx.fillStyle = C.rule;
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
        if (blocked[idx(x, y)]) continue;
        ctx.beginPath(); ctx.arc(cx(x), cy(y), 1.2, 0, 6.3); ctx.fill();
      }
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
        if (!blocked[idx(x, y)]) continue;
        const px = ox + x * cell, py = oy + y * cell;
        ctx.fillStyle = C.red; ctx.globalAlpha = 0.22;
        ctx.fillRect(px, py, cell, cell);
        ctx.globalAlpha = 0.8; ctx.strokeStyle = C.red; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px + 3, py + cell - 3); ctx.lineTo(px + cell - 3, py + 3); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (path) {
        ctx.strokeStyle = C.amber; ctx.lineWidth = Math.max(2, cell * 0.16);
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath();
        path.forEach((p, i) => (i ? ctx.lineTo(cx(p.x), cy(p.y)) : ctx.moveTo(cx(p.x), cy(p.y))));
        ctx.stroke();
      }
      const r = Math.max(5, cell * 0.36);
      ctx.fillStyle = C.cyan;
      ctx.beginPath(); ctx.arc(cx(start.x), cy(start.y), r, 0, 6.3); ctx.fill();
      ctx.fillStyle = C.green;
      ctx.fillRect(cx(goal.x) - r, cy(goal.y) - r, r * 2, r * 2);

      ctx.font = '500 12px "Instrument Sans", system-ui, sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = C.cyan; ctx.textAlign = 'left';
      ctx.fillText(L('Depo', 'Depot'), cx(start.x) - r, cy(start.y) - r - 4);
      ctx.fillStyle = C.green; ctx.textAlign = 'right';
      ctx.fillText(L('Teslimat', 'Delivery'), cx(goal.x) + r, cy(goal.y) - r - 4);
      ctx.textAlign = 'left';
    }

    function preset() {
      blocked.fill(0);
      const rect = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) blocked[idx(x, y)] = 1; };
      rect(6, 3, 8, 11); rect(13, 0, 14, 7); rect(13, 10, 14, 13); rect(19, 4, 22, 9);
    }
    function randomize() {
      blocked.fill(0);
      for (let k = 0; k < 9; k++) {
        const w = 1 + Math.floor(Math.random() * 3), hh = 2 + Math.floor(Math.random() * 5);
        const x0 = 3 + Math.floor(Math.random() * (COLS - 6 - w)), y0 = Math.floor(Math.random() * (ROWS - hh));
        for (let y = y0; y < y0 + hh; y++) for (let x = x0; x < x0 + w; x++) if (!isEnd(x, y)) blocked[idx(x, y)] = 1;
      }
    }

    function cellAt(ev) {
      const r = canvas.getBoundingClientRect();
      const ox = (W - cell * COLS) / 2, oy = (H - cell * ROWS) / 2;
      const x = Math.floor((ev.clientX - r.left - ox) / cell), y = Math.floor((ev.clientY - r.top - oy) / cell);
      return x >= 0 && y >= 0 && x < COLS && y < ROWS ? { x, y } : null;
    }
    let painting = false, paintTo = 1, lastCell = -1;
    function paint(ev) {
      const c = cellAt(ev);
      if (!c || isEnd(c.x, c.y)) return;
      const i = idx(c.x, c.y);
      if (i === lastCell) return;
      lastCell = i; blocked[i] = paintTo; solve();
    }
    canvas.addEventListener('pointerdown', (ev) => {
      const c = cellAt(ev);
      if (!c || isEnd(c.x, c.y)) return;
      painting = true; lastCell = -1;
      paintTo = blocked[idx(c.x, c.y)] ? 0 : 1;
      canvas.setPointerCapture(ev.pointerId);
      paint(ev);
    });
    canvas.addEventListener('pointermove', (ev) => { if (painting) paint(ev); });
    const stop = () => { painting = false; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);

    $('#droneRand').addEventListener('click', () => { randomize(); solve(); });
    $('#droneClear').addEventListener('click', () => { blocked.fill(0); solve(); });

    function resize() {
      const f = fitCanvas(canvas);
      ctx = f.ctx; W = f.w; H = f.h;
      cell = Math.min(W / COLS, H / ROWS);
      draw();
    }
    preset();
    resize();
    solve();
    new ResizeObserver(resize).observe(canvas);
    langListeners.push(solve);
  })();

  /* ───────────── Copy e-mail ───────────── */
  (function copyMail() {
    const btn = $('#copyMail');
    let t;
    btn.addEventListener('click', async () => {
      let ok = true;
      try { await navigator.clipboard.writeText('ibugrasan@gmail.com'); } catch (e) { ok = false; }
      btn.textContent = ok ? L('Adres kopyalandı', 'Address copied') : 'ibugrasan@gmail.com';
      clearTimeout(t);
      t = setTimeout(() => { btn.textContent = L('Adresi kopyala', 'Copy address'); }, 2000);
    });
  })();

  /* ───────────── Initial language ───────────── */
  let initial = 'tr';
  const param = new URLSearchParams(location.search).get('lang');
  try { initial = localStorage.getItem('lang') || initial; } catch (e) { /* storage unavailable */ }
  if (param === 'en' || param === 'tr') initial = param;
  if (initial === 'en') applyLang('en');
})();
