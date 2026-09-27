(() => {
  // ---- 定数 ----
  const STORAGE_KEY = 'palette-map-v1';
  const FONT = '"Segoe UI", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif';
  const MONO = 'Consolas, "SFMono-Regular", monospace';
  const ACHROMA_S = 0.05;

  // マップの座標系
  const W = 760, H = 396;
  const PL = 56, PW = 580, PT = 24, PH = 320;
  const PB = PT + PH;
  const LANE_X = 664, LANE_W = 52, LANE_CX = LANE_X + LANE_W / 2;
  const SW = 340, SPL = 44, SPW = 270;   // 彩度×明度マップ（高さと明度軸は共通）
  const TW = W + SW;                     // PNG に書き出すときの全体幅
  const BG = '#808080';
  const PT_R = 7;
  const LABEL_SIZE = 12, LABEL_H = 15;

  // ---- 状態 ----
  let rows = [];
  let baseId = null;
  let nextId = 1;

  const newRow = (hex = '', name = '', visible = true) => ({ id: nextId++, hex, name, visible });

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (data && Array.isArray(data.rows) && data.rows.length) {
        rows = data.rows.map(r => newRow(String(r.hex || ''), String(r.name || ''), r.visible !== false));
        const idx = data.baseIndex;
        baseId = Number.isInteger(idx) && rows[idx] ? rows[idx].id : null;
        return;
      }
    } catch (e) { /* 読めなければ初期状態 */ }
    rows = [newRow()];
  }

  function save() {
    try {
      const baseIndex = rows.findIndex(r => r.id === baseId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        rows: rows.map(({ hex, name, visible }) => ({ hex, name, visible })),
        baseIndex,
      }));
    } catch (e) { /* 保存できない環境では無視 */ }
  }

  // ---- 色の計算 ----
  function parseHex(text) {
    const m = String(text).trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return '#' + h.toUpperCase();
  }

  function hsvOf(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d > 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : d / max, v: max };
  }

  const hueDelta = (a, b) => ((((a - b + 180) % 360) + 360) % 360) - 180;

  // ---- 入力欄 ----
  const rowsEl = document.getElementById('rows');

  function renderRows() {
    rowsEl.innerHTML = '';
    for (const row of rows) {
      const el = document.createElement('div');
      el.className = 'row';
      el.dataset.id = row.id;
      el.innerHTML = `
        <span class="grip" title="ドラッグで並べ替え">⋮⋮</span>
        <input type="checkbox" class="vis" title="マップに表示する">
        <input type="color" title="カラーピッカー">
        <input type="text" class="hex" placeholder="#RRGGBB" spellcheck="false" autocomplete="off">
        <input type="text" class="name" placeholder="名前（任意）" autocomplete="off">
        <span class="hsv"></span>
        <input type="radio" name="base" class="base" title="この色を色相の基準にする">
        <button class="del" title="行を削除">×</button>`;
      const picker = el.querySelector('input[type="color"]');
      const hexIn = el.querySelector('.hex');
      const nameIn = el.querySelector('.name');
      const radio = el.querySelector('.base');
      const vis = el.querySelector('.vis');

      hexIn.value = row.hex;
      nameIn.value = row.name;
      vis.checked = row.visible;

      hexIn.addEventListener('input', () => { row.hex = hexIn.value; update(); });
      hexIn.addEventListener('blur', () => {
        const hex = parseHex(hexIn.value);
        if (hex && hex !== hexIn.value) { hexIn.value = row.hex = hex; update(); }
      });
      picker.addEventListener('input', () => { hexIn.value = row.hex = picker.value.toUpperCase(); update(); });
      nameIn.addEventListener('input', () => { row.name = nameIn.value; update(); });
      radio.addEventListener('change', () => { baseId = row.id; update(); });
      vis.addEventListener('change', () => { row.visible = vis.checked; update(); });
      el.querySelector('.grip').addEventListener('pointerdown', e => startSort(e, el));
      el.querySelector('.del').addEventListener('click', () => {
        rows = rows.filter(r => r !== row);
        if (baseId === row.id) baseId = null;
        if (!rows.length) rows.push(newRow());
        renderRows();
        update();
      });
      rowsEl.appendChild(el);
    }
  }

  // つまみのドラッグで行を並べ替える。ドラッグ中は DOM の位置だけ動かし、離したときに rows に反映する
  function startSort(e, el) {
    if (e.button !== 0) return;
    e.preventDefault();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    document.body.classList.add('sorting');

    const move = ev => {
      const next = [...rowsEl.children].filter(c => c !== el).find(c => {
        const r = c.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      if (next) { if (el.nextElementSibling !== next) rowsEl.insertBefore(el, next); }
      else if (rowsEl.lastElementChild !== el) rowsEl.appendChild(el);
    };
    const end = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      el.classList.remove('dragging');
      document.body.classList.remove('sorting');
      const order = [...rowsEl.children].map(c => Number(c.dataset.id));
      if (order.some((id, i) => rows[i].id !== id)) {
        rows = order.map(id => rows.find(r => r.id === id));
        update();
      }
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  function syncRowStates(effectiveBaseId) {
    for (const el of rowsEl.children) {
      const row = rows.find(r => r.id === Number(el.dataset.id));
      if (!row) continue;
      const hex = parseHex(row.hex);
      const hexIn = el.querySelector('.hex');
      hexIn.classList.toggle('invalid', row.hex.trim() !== '' && !hex);
      if (hex) el.querySelector('input[type="color"]').value = hex.toLowerCase();
      const hsv = hex && hsvOf(hex);
      el.querySelector('.hsv').textContent = hsv
        ? `H${Math.round(hsv.h)} S${Math.round(hsv.s * 100)} V${Math.round(hsv.v * 100)}`
        : '';
      el.querySelector('.base').checked = row.id === effectiveBaseId;
      el.classList.toggle('off', !row.visible);
    }
  }

  document.getElementById('add').addEventListener('click', () => {
    rows.push(newRow());
    renderRows();
    update();
    rowsEl.lastElementChild.querySelector('.hex').focus();
  });

  // ---- 一括貼り付け ----
  const HEX_IN_TEXT = /#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z])|(?<![0-9a-z#])([0-9a-f]{6})(?![0-9a-z])/i;

  function parseBulk(text) {
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(HEX_IN_TEXT);
      if (!m) continue;
      const hex = parseHex(m[1] || m[2]);
      const rest = (line.slice(0, m.index) + '\u0000' + line.slice(m.index + m[0].length))
        .replace(/`/g, '');
      const name = rest.split(/[\u0000|\t,]/).map(s => s.trim()).find(s => s) || '';
      out.push(newRow(hex, name));
    }
    return out;
  }

  document.getElementById('bulk-add').addEventListener('click', () => {
    const ta = document.getElementById('bulk');
    const added = parseBulk(ta.value);
    if (!added.length) return;
    const onlyEmpty = rows.length === 1 && !rows[0].hex.trim() && !rows[0].name.trim();
    rows = onlyEmpty ? added : rows.concat(added);
    ta.value = '';
    renderRows();
    update();
  });

  // ---- マップ ----
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const measureCtx = document.createElement('canvas').getContext('2d');
  function textWidth(text, size = LABEL_SIZE) {
    measureCtx.font = `${size}px ${FONT}`;
    return measureCtx.measureText(text).width;
  }

  // 有効な色と基準を求める
  function compute() {
    const colors = [];
    for (const row of rows) {
      const hex = parseHex(row.hex);
      if (!hex) continue;
      const hsv = hsvOf(hex);
      colors.push({ id: row.id, hex, name: row.name.trim(), visible: row.visible, ...hsv, achroma: hsv.s < ACHROMA_S });
    }
    let note = '';
    let base = colors.find(c => c.id === baseId) || colors[0] || null;
    if (base && base.achroma) {
      const alt = colors.find(c => !c.achroma);
      note = alt
        ? `基準に選んだ ${base.hex} は無彩色のため、${alt.hex} を色相の基準にしています。`
        : 'すべて無彩色のため、色相の基準は 0°（赤）です。';
      base = alt || base;
    }
    const baseHue = base && !base.achroma ? base.h : 0;
    for (const c of colors) {
      c.y = PT + (1 - c.v) * PH;
      c.isBase = !!base && c.id === base.id;
    }
    // 基準は非表示の色も含めて決め、描くのは表示中の色だけ（切り替えで軸が動かないように）
    const allCount = colors.length;
    const shown = colors.filter(c => c.visible);
    // マップごとの点。y（明度）は2枚で共通
    const huePts = shown.map(c => ({
      c, y: c.y, x: c.achroma ? LANE_CX : PL + (hueDelta(c.h, baseHue) + 180) / 360 * PW,
    }));
    const svPts = shown.map(c => ({ c, y: c.y, x: SPL + c.s * SPW }));
    placeLabels(huePts, W);
    placeLabels(svPts, SW);
    return { colors: shown, allCount, huePts, svPts, baseHue, baseRowId: base ? base.id : null, note };
  }

  // 名前ラベルの配置。点は動かさず、ラベルだけを重ならない位置へ逃がす
  function placeLabels(pts, width) {
    const obstacles = pts.map(p => {
      const r = p.c.isBase ? PT_R + 6 : PT_R + 2;
      return { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 };
    });
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const inside = r => r.x >= 4 && r.x + r.w <= width - 4 && r.y >= 2 && r.y + r.h <= PB + 6;

    const labeled = pts.filter(p => p.c.name).sort((a, b) => a.y - b.y || a.x - b.x);
    const dys = [0];
    for (let k = 1; k <= 10; k++) dys.push(-k * LABEL_H, k * LABEL_H);

    for (const p of labeled) {
      const w = textWidth(p.c.name);
      let chosen = null;
      for (const dy of dys) {
        for (const side of ['right', 'left']) {
          const lx = side === 'right' ? p.x + PT_R + 5 : p.x - PT_R - 5 - w;
          const rect = { x: lx - 1, y: p.y + dy - LABEL_H / 2, w: w + 2, h: LABEL_H };
          if (inside(rect) && !obstacles.some(o => hit(rect, o))) { chosen = { side, dy, rect }; break; }
        }
        if (chosen) break;
      }
      if (!chosen) {
        const rect = { x: p.x + PT_R + 5 - 1, y: p.y - LABEL_H / 2, w: w + 2, h: LABEL_H };
        chosen = { side: 'right', dy: 0, rect };
      }
      obstacles.push(chosen.rect);
      p.label = chosen;
    }
  }

  const yOf = v => PT + (1 - v) * PH;
  const txt = (x, y, s, anchor = 'middle', size = 11) =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-family='${FONT}' fill="#ffffff">${esc(s)}</text>`;
  const gridLine = (x1, y1, x2, y2, opacity = 0.18, dash = '') =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ffffff" stroke-opacity="${opacity}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;

  // 引出し線・点・名前ラベル（2枚のマップで共通）
  function marksSvg(pts) {
    const out = [];
    for (const p of pts) {
      if (!p.label || p.label.dy === 0) continue;
      const { rect, side } = p.label;
      const lx = side === 'right' ? rect.x : rect.x + rect.w;
      out.push(`<line x1="${p.x}" y1="${p.y}" x2="${lx}" y2="${rect.y + rect.h / 2}" stroke="#ffffff" stroke-opacity="0.75" stroke-width="1"/>`);
    }
    // 基準色は最前面
    for (const p of [...pts].sort((a, b) => a.c.isBase - b.c.isBase)) {
      if (p.c.isBase) out.push(`<circle cx="${p.x}" cy="${p.y}" r="${PT_R + 5}" fill="none" stroke="#ffffff" stroke-width="1.5"/>`);
      out.push(`<circle cx="${p.x}" cy="${p.y}" r="${PT_R + 1}" fill="#1e1e1e"/>`);
      out.push(`<circle cx="${p.x}" cy="${p.y}" r="${PT_R}" fill="${p.c.hex}" stroke="#ffffff" stroke-width="1.25"/>`);
    }
    for (const p of pts) {
      if (!p.label) continue;
      const { rect, side } = p.label;
      const x = side === 'right' ? rect.x + 1 : rect.x + rect.w - 1;
      const y = rect.y + rect.h / 2 + LABEL_SIZE * 0.35;
      out.push(`<text x="${x}" y="${y}" text-anchor="${side === 'right' ? 'start' : 'end'}" font-size="${LABEL_SIZE}" font-family='${FONT}' fill="#ffffff" stroke="#1e1e1e" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${esc(p.c.name)}</text>`);
    }
    return out.join('');
  }

  // 明度軸（2枚で共通の目盛り）
  function vAxisSvg(left, width) {
    const out = [];
    for (const v of [0.25, 0.5, 0.75]) out.push(gridLine(left, yOf(v), left + width, yOf(v)));
    out.push(txt(left - 8, PT - 10, '明度 V', 'end'));
    for (const v of [1, 0.5, 0]) out.push(txt(left - 8, yOf(v) + 4, v.toFixed(1), 'end'));
    return out.join('');
  }

  // 色相 × 明度
  function hueSvgBody(state) {
    const { colors, allCount, huePts, baseHue } = state;
    const out = [];
    const xOf = off => PL + (off + 180) / 360 * PW;

    const stops = [];
    for (let off = -180; off <= 180; off += 15) {
      const h = (((baseHue + off) % 360) + 360) % 360;
      stops.push(`<stop offset="${(off + 180) / 360}" stop-color="hsl(${h.toFixed(1)},85%,55%)"/>`);
    }
    out.push(`<defs><linearGradient id="hueband" x1="0" x2="1" y1="0" y2="0">${stops.join('')}</linearGradient></defs>`);
    out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${BG}"/>`);

    out.push(vAxisSvg(PL, PW));
    for (const off of [-90, 0, 90]) {
      out.push(gridLine(xOf(off), PT, xOf(off), PB, off === 0 ? 0.4 : 0.18, off === 0 ? '' : '3 3'));
    }
    out.push(`<rect x="${PL}" y="${PT}" width="${PW}" height="${PH}" fill="none" stroke="#ffffff" stroke-opacity="0.5"/>`);
    out.push(`<rect x="${LANE_X}" y="${PT}" width="${LANE_W}" height="${PH}" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.5"/>`);
    out.push(txt(PL + PW, PT - 10, '色相 × 明度', 'end'));

    out.push(`<rect x="${PL}" y="${PB + 10}" width="${PW}" height="12" fill="url(#hueband)" stroke="#ffffff" stroke-opacity="0.5"/>`);
    for (const off of [-180, -90, 0, 90, 180]) {
      const label = off === 0 ? '0°（基準）' : `${off > 0 ? '+' : '−'}${Math.abs(off)}°`;
      out.push(txt(xOf(off), PB + 38, label));
    }
    out.push(txt(LANE_CX, PB + 38, '無彩色'));

    if (!colors.length) {
      const msg = allCount ? '表示中の色がありません' : 'カラーコードを入力するとここに表示されます';
      out.push(txt(PL + PW / 2, PT + PH / 2, msg, 'middle', 13));
    }
    out.push(marksSvg(huePts));
    return out.join('');
  }

  // 彩度 × 明度
  function svSvgBody(state) {
    const { svPts, baseHue } = state;
    const out = [];
    const xOf = s => SPL + s * SPW;

    out.push(`<defs><linearGradient id="satband" x1="0" x2="1" y1="0" y2="0">` +
      `<stop offset="0" stop-color="hsl(${baseHue.toFixed(1)},0%,55%)"/>` +
      `<stop offset="1" stop-color="hsl(${baseHue.toFixed(1)},85%,55%)"/></linearGradient></defs>`);
    out.push(`<rect x="0" y="0" width="${SW}" height="${H}" fill="${BG}"/>`);

    out.push(vAxisSvg(SPL, SPW));
    for (const s of [0.25, 0.5, 0.75]) out.push(gridLine(xOf(s), PT, xOf(s), PB, 0.18, '3 3'));
    out.push(`<rect x="${SPL}" y="${PT}" width="${SPW}" height="${PH}" fill="none" stroke="#ffffff" stroke-opacity="0.5"/>`);
    out.push(txt(SPL + SPW, PT - 10, '彩度 × 明度', 'end'));

    out.push(`<rect x="${SPL}" y="${PB + 10}" width="${SPW}" height="12" fill="url(#satband)" stroke="#ffffff" stroke-opacity="0.5"/>`);
    for (const s of [0, 0.5, 1]) out.push(txt(xOf(s), PB + 38, s === 0 ? 'S 0' : s.toFixed(1)));

    out.push(marksSvg(svPts));
    return out.join('');
  }

  const mapEl = document.getElementById('map');
  const noteEl = document.getElementById('note');
  let current = null;

  function update() {
    current = compute();
    syncRowStates(current.baseRowId);
    mapEl.innerHTML =
      `<svg class="hue" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="色相と明度のパレットマップ">${hueSvgBody(current)}</svg>` +
      `<svg class="sv" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${H}" role="img" aria-label="彩度と明度のパレットマップ">${svSvgBody(current)}</svg>`;
    noteEl.textContent = current.note;
    save();
  }

  // ---- PNG 保存 ----
  // 2枚のマップを横に並べ、その下に色一覧を付ける
  function exportSvg(state) {
    const list = state.colors;   // 行の順番どおり
    const ROW = 28, PAD = 16;
    const listTop = H + 8;
    const listH = list.length ? PAD * 2 + list.length * ROW : 0;
    const totalH = H + (list.length ? 8 + listH + 16 : 0);
    const parts = [
      `<rect x="0" y="0" width="${TW}" height="${totalH}" fill="${BG}"/>`,
      `<g>${hueSvgBody(state)}</g>`,
      `<g transform="translate(${W},0)">${svSvgBody(state)}</g>`,
    ];
    if (list.length) {
      parts.push(`<rect x="${PL}" y="${listTop}" width="${TW - PL - 16}" height="${listH}" rx="6" fill="#2a2a2a"/>`);
      list.forEach((c, i) => {
        const cy = listTop + PAD + i * ROW + ROW / 2;
        const t = (x, s, font, fill = '#ffffff') =>
          `<text x="${x}" y="${cy + 4}" font-size="12" font-family='${font}' fill="${fill}">${esc(s)}</text>`;
        parts.push(`<rect x="${PL + 16}" y="${cy - 10}" width="20" height="20" rx="3" fill="${c.hex}" stroke="#ffffff" stroke-opacity="0.6"/>`);
        parts.push(t(PL + 48, c.hex, MONO));
        parts.push(t(PL + 128, `H${Math.round(c.h)} S${Math.round(c.s * 100)} V${Math.round(c.v * 100)}`, MONO, '#bbbbbb'));
        parts.push(t(PL + 260, (c.isBase ? '★ ' : '') + (c.name || ''), FONT));
      });
    }
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${TW}" height="${totalH}" viewBox="0 0 ${TW} ${totalH}">${parts.join('')}</svg>`, w: TW, h: totalH };
  }

  function timestamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  document.getElementById('download').addEventListener('click', () => {
    const { svg, w, h } = exportSvg(current);
    const scale = 2;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = h * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => downloadBlob(blob, `palette-map_${timestamp()}.png`), 'image/png');
    };
    img.onerror = () => alert('画像の生成に失敗しました。');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });

  // ---- 色を行に追加（空の行があれば先に埋める） ----
  function addColor(hex) {
    const empty = rows.find(r => !r.hex.trim());
    if (empty) empty.hex = hex;
    else rows.push(newRow(hex));
    renderRows();
    update();
  }

  // ---- 画像から拾う ----
  const MAX_IMG = 2400;          // 長辺がこれを超える画像は縮小して保持する
  const LOUPE_PX = 15, LOUPE_SCALE = 8;
  const dropEl = document.getElementById('drop');
  const wrapEl = document.getElementById('img-wrap');
  const imgCanvas = document.getElementById('img-canvas');
  const imgCtx = imgCanvas.getContext('2d', { willReadFrequently: true });
  const loupeEl = document.getElementById('loupe');
  const loupeCanvas = loupeEl.querySelector('canvas');
  const loupeCtx = loupeCanvas.getContext('2d');
  const closeBtn = document.getElementById('img-close');
  const imgHint = document.getElementById('img-hint');
  let pixels = null;

  function showImage(on) {
    wrapEl.hidden = !on;
    imgHint.hidden = !on;
    closeBtn.hidden = !on;
    dropEl.hidden = on;
    if (!on) { pixels = null; loupeEl.hidden = true; }
  }

  function loadImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, MAX_IMG / Math.max(img.naturalWidth, img.naturalHeight));
      imgCanvas.width = Math.max(1, Math.round(img.naturalWidth * k));
      imgCanvas.height = Math.max(1, Math.round(img.naturalHeight * k));
      imgCtx.clearRect(0, 0, imgCanvas.width, imgCanvas.height);
      imgCtx.drawImage(img, 0, 0, imgCanvas.width, imgCanvas.height);
      pixels = imgCtx.getImageData(0, 0, imgCanvas.width, imgCanvas.height).data;
      URL.revokeObjectURL(url);
      showImage(true);
      resetView();
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert('画像を読み込めませんでした。'); };
    img.src = url;
  }

  // 表示座標 → 画像のピクセル座標
  function pixelAt(e) {
    const r = imgCanvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) * imgCanvas.width / r.width);
    const y = Math.floor((e.clientY - r.top) * imgCanvas.height / r.height);
    if (x < 0 || y < 0 || x >= imgCanvas.width || y >= imgCanvas.height) return null;
    return { x, y };
  }

  // 3×3 の平均色。透明ピクセルは除く
  function sampleHex(px, py) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = py - 1; y <= py + 1; y++) {
      for (let x = px - 1; x <= px + 1; x++) {
        if (x < 0 || y < 0 || x >= imgCanvas.width || y >= imgCanvas.height) continue;
        const i = (y * imgCanvas.width + x) * 4;
        if (pixels[i + 3] === 0) continue;
        r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; n++;
      }
    }
    if (!n) return null;
    const h = v => Math.round(v / n).toString(16).padStart(2, '0');
    return ('#' + h(r) + h(g) + h(b)).toUpperCase();
  }

  function drawLoupe(p, e) {
    const half = Math.floor(LOUPE_PX / 2);
    const size = LOUPE_PX * LOUPE_SCALE;
    loupeCtx.imageSmoothingEnabled = false;
    loupeCtx.fillStyle = '#808080';
    loupeCtx.fillRect(0, 0, size, size);
    loupeCtx.drawImage(imgCanvas, p.x - half, p.y - half, LOUPE_PX, LOUPE_PX, 0, 0, size, size);
    // 平均をとる 3×3 の範囲
    const s = (half - 1) * LOUPE_SCALE;
    loupeCtx.strokeStyle = '#000000';
    loupeCtx.lineWidth = 3;
    loupeCtx.strokeRect(s, s, LOUPE_SCALE * 3, LOUPE_SCALE * 3);
    loupeCtx.strokeStyle = '#ffffff';
    loupeCtx.lineWidth = 1;
    loupeCtx.strokeRect(s, s, LOUPE_SCALE * 3, LOUPE_SCALE * 3);

    const hex = sampleHex(p.x, p.y);
    loupeEl.querySelector('.chip').style.background = hex || 'transparent';
    loupeEl.querySelector('.hex').textContent = hex || '透明';

    // カーソルの右下に出し、はみ出すなら反対側へ
    loupeEl.hidden = false;
    const wr = wrapEl.getBoundingClientRect();
    const lw = loupeEl.offsetWidth, lh = loupeEl.offsetHeight;
    let lx = e.clientX - wr.left + 18, ly = e.clientY - wr.top + 18;
    if (lx + lw > wr.width) lx = e.clientX - wr.left - 18 - lw;
    if (ly + lh > wr.height) ly = e.clientY - wr.top - 18 - lh;
    loupeEl.style.left = Math.max(0, lx) + 'px';
    loupeEl.style.top = Math.max(0, ly) + 'px';
  }

  // ---- 拡大・縮小と移動 ----
  // fit: 全体表示での倍率（表示px / 画像px）。zoom: fit に対する倍率。tx, ty: ビューポート内での画像左上の位置
  const MAX_SCALE = 32;          // 1 画像ピクセルを最大 32 表示ピクセルまで拡大
  const DRAG_THRESHOLD = 4;      // これ未満の移動はクリックとみなす
  const viewportEl = document.getElementById('viewport');
  const zoomLabel = document.getElementById('zoom-label');
  const view = { fit: 1, zoom: 1, tx: 0, ty: 0 };

  function applyView() {
    const vw = imgCanvas.width * view.fit, vh = imgCanvas.height * view.fit;
    const s = view.fit * view.zoom;
    const cw = imgCanvas.width * s, ch = imgCanvas.height * s;
    view.tx = Math.min(0, Math.max(vw - cw, view.tx));
    view.ty = Math.min(0, Math.max(vh - ch, view.ty));
    viewportEl.style.width = vw + 'px';
    viewportEl.style.height = vh + 'px';
    imgCanvas.style.width = cw + 'px';
    imgCanvas.style.height = ch + 'px';
    imgCanvas.style.transform = `translate(${view.tx}px, ${view.ty}px)`;
    imgCanvas.classList.toggle('pixelated', s >= 2);
    zoomLabel.textContent = Math.round(s * 100) + '%';
  }

  function fitScale() {
    const maxW = wrapEl.clientWidth || viewportEl.parentElement.clientWidth;
    const maxH = window.innerHeight * 0.6;
    return Math.min(1, maxW / imgCanvas.width, maxH / imgCanvas.height);
  }

  function resetView() {
    view.fit = fitScale();
    view.zoom = 1;
    view.tx = view.ty = 0;
    applyView();
  }

  window.addEventListener('resize', () => {
    if (!pixels) return;
    const k = fitScale() / view.fit;
    view.fit *= k;
    view.tx *= k;
    view.ty *= k;
    applyView();
  });

  document.getElementById('zoom-reset').addEventListener('click', resetView);

  viewportEl.addEventListener('wheel', e => {
    if (!pixels) return;
    e.preventDefault();
    const r = viewportEl.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const s = view.fit * view.zoom;
    const ix = (mx - view.tx) / s, iy = (my - view.ty) / s;
    const maxZoom = Math.max(1, MAX_SCALE / view.fit);
    view.zoom = Math.min(maxZoom, Math.max(1, view.zoom * Math.exp(-e.deltaY * 0.0015)));
    const s2 = view.fit * view.zoom;
    view.tx = mx - ix * s2;
    view.ty = my - iy * s2;
    applyView();
    const p = pixelAt(e);
    if (p) drawLoupe(p, e);
  }, { passive: false });

  let drag = null;
  imgCanvas.addEventListener('pointerdown', e => {
    if (!pixels || e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
    imgCanvas.setPointerCapture(e.pointerId);
  });
  imgCanvas.addEventListener('pointermove', e => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) >= DRAG_THRESHOLD) drag.moved = true;
      if (drag.moved) {
        view.tx = drag.tx + dx;
        view.ty = drag.ty + dy;
        applyView();
        imgCanvas.classList.add('panning');
        loupeEl.hidden = true;
        return;
      }
    }
    const p = pixels && pixelAt(e);
    if (p) drawLoupe(p, e); else loupeEl.hidden = true;
  });
  imgCanvas.addEventListener('pointerup', e => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    imgCanvas.classList.remove('panning');
    if (moved) return;
    const p = pixelAt(e);
    const hex = p && sampleHex(p.x, p.y);
    if (hex) addColor(hex);
  });
  imgCanvas.addEventListener('pointercancel', () => { drag = null; imgCanvas.classList.remove('panning'); });
  imgCanvas.addEventListener('pointerleave', () => { if (!drag) loupeEl.hidden = true; });

  const fileIn = document.getElementById('file');
  fileIn.addEventListener('change', () => { loadImageFile(fileIn.files[0]); fileIn.value = ''; });
  closeBtn.addEventListener('click', () => showImage(false));

  // ページ全体でドロップを受ける（取りこぼすとブラウザがファイルを開いてしまうため）
  const dropTarget = () => (wrapEl.hidden ? dropEl : wrapEl);
  document.addEventListener('dragover', e => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    dropTarget().classList.add('over');
  });
  document.addEventListener('dragleave', e => {
    if (e.relatedTarget) return;
    dropEl.classList.remove('over');
    wrapEl.classList.remove('over');
  });
  document.addEventListener('drop', e => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    dropEl.classList.remove('over');
    wrapEl.classList.remove('over');
    loadImageFile([...e.dataTransfer.files].find(f => f.type.startsWith('image/')));
  });
  document.addEventListener('paste', e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.kind === 'file' && i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    loadImageFile(item.getAsFile());
  });

  // 画面上のどこからでも拾う（EyeDropper API 対応ブラウザのみ）
  const eyeBtn = document.getElementById('eyedropper');
  if ('EyeDropper' in window) {
    eyeBtn.hidden = false;
    eyeBtn.addEventListener('click', async () => {
      try {
        const { sRGBHex } = await new window.EyeDropper().open();
        let hex = parseHex(sRGBHex);
        const m = !hex && sRGBHex.match(/\d+/g);
        if (m) hex = '#' + m.slice(0, 3).map(v => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase();
        if (hex) addColor(hex);
      } catch (err) { /* Esc で中断 */ }
    });
  }

  // ---- JSON 書き出し / 読み込み ----
  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  document.getElementById('json-export').addEventListener('click', () => {
    const baseRowId = current && current.baseRowId;
    const colors = rows
      .filter(r => r.hex.trim() || r.name.trim())
      .map(r => {
        const c = { hex: parseHex(r.hex) || r.hex.trim(), name: r.name.trim() };
        if (r.id === baseRowId) c.base = true;
        if (!r.visible) c.visible = false;
        return c;
      });
    if (!colors.length) { alert('書き出す色がありません。'); return; }
    const json = JSON.stringify({ app: 'palette-map', version: 1, colors }, null, 2) + '\n';
    downloadBlob(new Blob([json], { type: 'application/json' }), `palette_${timestamp()}.json`);
  });

  // { colors: [...] } / [...] のどちらも受け付ける。要素は {hex, name, base, visible} か hex 文字列
  function parsePaletteJson(data) {
    const list = Array.isArray(data) ? data : data && Array.isArray(data.colors) ? data.colors : null;
    if (!list) throw new Error('colors 配列が見つかりません。');
    const out = [];
    let skipped = 0, baseIndex = -1;
    for (const item of list) {
      const obj = typeof item === 'string' ? { hex: item } : item || {};
      const hex = parseHex(obj.hex ?? '');
      if (!hex) { skipped++; continue; }
      if (obj.base === true && baseIndex < 0) baseIndex = out.length;
      out.push({ hex, name: typeof obj.name === 'string' ? obj.name : '', visible: obj.visible !== false });
    }
    return { out, skipped, baseIndex };
  }

  const jsonIn = document.getElementById('json-import');
  jsonIn.addEventListener('change', async () => {
    const file = jsonIn.files[0];
    jsonIn.value = '';
    if (!file) return;
    let result;
    try {
      result = parsePaletteJson(JSON.parse(await file.text()));
    } catch (err) {
      alert('JSON を読み込めませんでした。\n' + err.message);
      return;
    }
    const { out, skipped, baseIndex } = result;
    if (!out.length) { alert('読み込める色がありませんでした。'); return; }
    const hasContent = rows.some(r => r.hex.trim() || r.name.trim());
    if (hasContent && !confirm(`現在のカラーを ${out.length} 色で置き換えます。よろしいですか？`)) return;
    rows = out.map(c => newRow(c.hex, c.name, c.visible));
    baseId = baseIndex >= 0 ? rows[baseIndex].id : null;
    renderRows();
    update();
    if (skipped) alert(`hex として読めない ${skipped} 件を飛ばしました。`);
  });

  // ---- すべてリセット ----
  document.getElementById('reset-all').addEventListener('click', () => {
    if (!confirm('画像とカラーをすべて消去します。よろしいですか？')) return;
    rows = [newRow()];
    baseId = null;
    document.getElementById('bulk').value = '';
    showImage(false);
    renderRows();
    update();
  });

  // ---- 起動 ----
  load();
  renderRows();
  update();
})();
