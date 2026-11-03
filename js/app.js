'use strict';

const stage = document.getElementById('stage');
const handoff = document.getElementById('handoff');

const state = {
  phase: 'title',
  playMode: 'local',
  players: [],
  specs: [],
  current: 0,
  myIndex: 0,
  selectedId: null,
  orientation: 'h',
  locked: false,
  lastShot: null,
  lastResult: null,
  pendingNotice: null,
  log: '',
  winner: null,
  handoffNext: 0,
  handoffKind: 'place',
  online: {
    code: null,
    playerIndex: 0,
    placementReady: [false, false],
    error: '',
  },
};

let hover = null;

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

function isOnline() {
  return state.playMode === 'online';
}

function viewIndex() {
  return isOnline() ? state.myIndex : state.current;
}

function currentPlayer() {
  return state.players[viewIndex()];
}

function enemyPlayer() {
  return state.players[1 - viewIndex()];
}

function myTurn() {
  if (!isOnline()) return state.current === state.myIndex || state.phase === 'place';
  if (state.phase === 'place') return !state.online.placementReady[state.myIndex];
  return state.current === state.myIndex && !state.locked;
}

function playerFromPayload(p, withGrid) {
  const grid = withGrid && p.grid
    ? p.grid
    : Array.from({ length: SeaBattle.SIZE }, () => Array(SeaBattle.SIZE).fill(null));
  const ships = (p.ships || []).map((s) => ({
    id: s.id,
    size: s.size,
    name: s.name,
    cells: s.cells || [],
    sunk: Boolean(s.sunk),
  }));
  return { name: p.name, grid, ships, shots: { ...(p.shots || {}) } };
}

function applyRemote(payload) {
  state.online.code = payload.code;
  state.online.playerIndex = payload.playerIndex;
  state.online.placementReady = payload.placementReady.slice();
  state.myIndex = payload.playerIndex;
  state.phase = payload.lobby ? 'lobby' : payload.phase;
  state.current = payload.current;
  state.locked = payload.locked;
  state.winner = payload.winner;
  state.log = payload.log;
  state.lastShot = payload.lastShot;
  state.specs = payload.specs;
  state.players = [null, null];
  state.players[payload.playerIndex] = playerFromPayload(payload.you, true);
  state.players[1 - payload.playerIndex] = playerFromPayload(
    payload.enemy,
    payload.phase === 'over'
  );
  if (state.phase === 'place' && !state.online.placementReady[state.myIndex]) {
    const me = state.players[state.myIndex];
    if (me) {
      const left = state.specs.filter(
        (spec) => !me.ships.some((ship) => ship.id === spec.id)
      );
      state.selectedId = left[0] ? left[0].id : null;
    }
  }
}

function cleanName(value, fallback) {
  const name = value.trim().slice(0, 18);
  return name || fallback;
}

function segmentClass(cells, r, c) {
  const has = (rr, cc) => cells.some((cell) => cell.r === rr && cell.c === cc);
  const horizontal = has(r, c - 1) || has(r, c + 1);
  const vertical = has(r - 1, c) || has(r + 1, c);
  if (!horizontal && !vertical) return 'seg-single';
  if (horizontal) {
    if (!has(r, c - 1)) return 'seg-h-start';
    if (!has(r, c + 1)) return 'seg-h-end';
    return 'seg-h-mid';
  }
  if (!has(r - 1, c)) return 'seg-v-start';
  if (!has(r + 1, c)) return 'seg-v-end';
  return 'seg-v-mid';
}

function segmentPart(cells, r, c) {
  const seg = segmentClass(cells, r, c);
  if (seg === 'seg-single') return 'single';
  if (seg.startsWith('seg-h')) {
    if (seg.endsWith('-start')) return 'head';
    if (seg.endsWith('-end')) return 'tail';
    return 'mid';
  }
  /* Вертикаль: нос вниз (max r), якорь сверху */
  if (seg.endsWith('-start')) return 'tail';
  if (seg.endsWith('-end')) return 'head';
  return 'mid';
}

function shipOrientation(ship) {
  if (ship.cells.length < 2) return 'h';
  const a = ship.cells[0];
  const b = ship.cells[1];
  return a.r === b.r ? 'h' : 'v';
}

function shouldShowShip(ship, reveal) {
  if (reveal === 'own' || reveal === 'all') return true;
  if (reveal === 'sunk' && ship.sunk) return true;
  return false;
}

function shipsLayerHTML(player, reveal) {
  let html = '<div class="ship-layer" aria-hidden="true">';
  player.ships.forEach((ship) => {
    if (!shouldShowShip(ship, reveal)) return;
    if (!ship.cells || ship.cells.length === 0) return;
    const ori = shipOrientation(ship);
    const sorted = [...ship.cells].sort((a, b) => (ori === 'h' ? a.c - b.c : a.r - b.r));
    const minR = Math.min(...sorted.map((cell) => cell.r));
    const minC = Math.min(...sorted.map((cell) => cell.c));
    const segs = sorted.map((cell) => {
      const part = segmentPart(ship.cells, cell.r, cell.c);
      const cellHit = player.shots[`${cell.r},${cell.c}`] === 'hit';
      const burning = ship.sunk || cellHit;
      const src = esc(Atlas.segmentSrc(part, ori, burning));
      const cls = ['ship-strip-seg', `part-${part}`];
      if (burning) cls.push('is-burning');
      return `<img class="${cls.join(' ')}" src="${src}" alt="">`;
    }).join('');
    html += `<div class="ship-strip ori-${ori} len-${ship.size}" style="--ship-r:${minR};--ship-c:${minC}">${segs}</div>`;
  });
  html += '</div>';
  return html;
}

function markersLayerHTML(player, board, reveal) {
  let html = '<div class="markers-layer" aria-hidden="true">';
  for (let r = 0; r < SeaBattle.SIZE; r += 1) {
    for (let c = 0; c < SeaBattle.SIZE; c += 1) {
      const shot = player.shots[`${r},${c}`];
      const fresh = state.lastShot
        && state.lastShot.board === board
        && state.lastShot.r === r
        && state.lastShot.c === c;
      if (!shot && !fresh) continue;

      const shipId = player.grid[r][c];
      const ship = shipId ? player.ships.find((item) => item.id === shipId) : null;
      if (shot === 'hit' && ship && shouldShowShip(ship, reveal)) continue;

      const cls = ['shot-marker'];
      if (shot === 'hit') cls.push('hit');
      else if (shot === 'miss') cls.push('miss');
      else if (shot === 'splash') cls.push('splash');
      if (fresh) cls.push('fresh');
      html += `<span class="${cls.join(' ')}" style="--gr:${r};--gc:${c}"></span>`;
    }
  }
  html += '</div>';
  return html;
}

function cellHTML(player, r, c, reveal, board) {
  const key = `${r},${c}`;
  const shot = player.shots[key];
  const shipId = player.grid[r][c];
  const ship = shipId ? player.ships.find((item) => item.id === shipId) : null;
  const classes = ['cell'];
  if (shot === 'hit') classes.push('hit');
  else if (shot === 'miss') classes.push('miss');
  else if (shot === 'splash') classes.push('splash');
  if (
    state.lastShot &&
    state.lastShot.board === board &&
    state.lastShot.r === r &&
    state.lastShot.c === c
  ) {
    classes.push('fresh');
  }

  let detail = '';
  if (shot === 'splash') detail = ', матрос в воде';
  else if (shot === 'miss') detail = ', мимо';
  else if (shot === 'hit' && ship && ship.sunk) detail = ', потоплен';
  else if (shot === 'hit') detail = ', попадание';

  const label = `${SeaBattle.COLS[c]}${r + 1}${detail}`;
  const wave = (r + c) % 4;
  const water = esc(Atlas.waterSrc());

  return `<button type="button" class="${classes.join(' ')}" data-board="${board}" data-r="${r}" data-c="${c}" data-wave="${wave}" aria-label="${label}"><span class="cell-water" style="background-image:url('${water}')" aria-hidden="true"></span></button>`;
}

function gridHTML(player, reveal, board, owner) {
  let html = `<div class="sea-board" data-owner="${owner}">`;
  html += `<div class="grid" data-board="${board}" data-owner="${owner}">`;
  html += '<div class="coord corner"></div>';
  for (let c = 0; c < SeaBattle.SIZE; c += 1) {
    html += `<div class="coord">${SeaBattle.COLS[c]}</div>`;
  }
  for (let r = 0; r < SeaBattle.SIZE; r += 1) {
    html += `<div class="coord">${r + 1}</div>`;
    for (let c = 0; c < SeaBattle.SIZE; c += 1) {
      html += cellHTML(player, r, c, reveal, board);
    }
  }
  html += '</div>';
  html += shipsLayerHTML(player, reveal);
  html += markersLayerHTML(player, board, reveal);
  html += '</div>';
  return html;
}

function trackerHTML(player) {
  return SeaBattle.fleetStatus(player).map((group) => {
    const pips = Array.from({ length: group.size }, () => '<i></i>').join('');
    const dead = group.afloat === 0 ? ' dead' : '';
    return `<div class="track${dead}"><span class="track-name">${group.name}</span><span class="pips">${pips}</span><b>×${group.afloat}</b></div>`;
  }).join('');
}

function playBaseUrl() {
  if (typeof location === 'undefined' || location.protocol === 'file:') return null;
  return location.origin;
}

function shareLinkHTML(extraHint) {
  const url = playBaseUrl();
  if (!url) {
    return `<p class="hint mode-hint">Чтобы играть из разных мест, выложите игру на сервер в интернете (см. <code>render.yaml</code> в проекте) или поднимите туннель к <code>npm start</code>. Оба игрока открывают <strong>одну и ту же ссылку</strong> в браузере — ничего устанавливать не нужно.</p>`;
  }
  const more = extraHint ? `<p class="hint">${extraHint}</p>` : '';
  return `
    <div class="share-box">
      <p class="hint">Общая ссылка — отправьте её сопернику (можно из другого города):</p>
      <div class="share-row">
        <input class="share-url" type="text" readonly value="${esc(url)}" aria-label="Ссылка на игру">
        <button type="button" class="btn ghost" data-action="copy-link">Копировать</button>
      </div>
      ${more}
    </div>`;
}

function renderTitle() {
  const localActive = state.playMode === 'local' ? ' is-active' : '';
  const onlineActive = state.playMode === 'online' ? ' is-active' : '';
  const onlineErr = state.online.error
    ? `<p class="online-error" role="alert">${esc(state.online.error)}</p>`
    : '';
  stage.innerHTML = `
    <section class="title-card">
      <div class="radar" aria-hidden="true"></div>
      <p class="eyebrow">Explorathon</p>
      <h2>Два флота</h2>
      <ul class="rules">
        <li>Поле 10×10. Линкор ×1, крейсер ×2, эсминец ×3, катер ×4.</li>
        <li>Корабли не касаются друг друга даже углами.</li>
        <li>Попадание — стреляете снова. Промах — ход переходит к сопернику.</li>
      </ul>
      <div class="mode-tabs" role="tablist" aria-label="Режим игры">
        <button type="button" class="mode-tab${localActive}" data-action="mode-local" role="tab" aria-selected="${state.playMode === 'local'}">Локально</button>
        <button type="button" class="mode-tab${onlineActive}" data-action="mode-online" role="tab" aria-selected="${state.playMode === 'online'}">Онлайн</button>
      </div>
      <form id="start-form" class="${state.playMode === 'local' ? '' : 'hidden'}">
        <p class="hint mode-hint">Один экран, два игрока — поле блюрится при смене хода.</p>
        <div class="names">
          <label>Игрок 1
            <input name="p1" type="text" maxlength="18" value="Игрок 1" autocomplete="off">
          </label>
          <label>Игрок 2
            <input name="p2" type="text" maxlength="18" value="Игрок 2" autocomplete="off">
          </label>
        </div>
        <button class="btn primary" type="submit">Начать игру</button>
      </form>
      <div id="online-panel" class="online-panel ${state.playMode === 'online' ? '' : 'hidden'}">
        ${shareLinkHTML('Создайте комнату или войдите по коду — соперник должен открыть ту же ссылку.')}
        ${onlineErr}
        <label>Ваше имя
          <input id="online-name" type="text" maxlength="18" value="Игрок" autocomplete="off">
        </label>
        <button type="button" class="btn primary" data-action="create-room">Создать комнату</button>
        <div class="join-row">
          <label>Код комнаты
            <input id="join-code" type="text" maxlength="6" placeholder="ABC123" autocomplete="off" autocapitalize="characters">
          </label>
          <button type="button" class="btn ghost" data-action="join-room">Войти</button>
        </div>
      </div>
    </section>`;
}

function renderLobby() {
  const code = state.online.code || '------';
  stage.innerHTML = `
    <section class="title-card lobby">
      <p class="eyebrow">Онлайн</p>
      <h2>Ждём соперника</h2>
      ${shareLinkHTML('Код комнаты — ниже. Соперник открывает ссылку, вкладку «Онлайн» и вводит код.')}
      <p class="room-code-label">Код комнаты</p>
      <p class="room-code" aria-label="Код комнаты">${esc(code)}</p>
      <button type="button" class="btn ghost" data-action="copy-code">Копировать код</button>
      <button type="button" class="btn ghost" data-action="title">Отмена</button>
    </section>`;
}

function renderPlace() {
  const player = currentPlayer();
  const placed = new Set(player.ships.map((ship) => ship.id));
  const dock = state.specs.filter((spec) => !placed.has(spec.id));
  const ready = player.ships.length === state.specs.length;
  const waitingOpponent = isOnline() && state.online.placementReady[state.myIndex];
  const orient = state.selectedId
    ? (state.orientation === 'h' ? 'горизонтально' : 'вертикально')
    : 'все корабли на поле';
  const dockHTML = dock.length
    ? dock.map((spec) => {
      const pips = Array.from({ length: spec.size }, () => '<i></i>').join('');
      const selected = spec.id === state.selectedId ? ' is-selected' : '';
      return `<button type="button" class="dock-ship${selected}" data-action="select" data-id="${spec.id}" aria-pressed="${spec.id === state.selectedId}"><span>${spec.name}</span><span class="pips">${pips}</span></button>`;
    }).join('')
    : '<p class="hint">Все корабли на воде. Можно подтверждать.</p>';

  stage.innerHTML = `
    <div class="place-layout">
      <section class="panel">
        <div class="panel-head">
          <h2>Ваше поле</h2>
          <p>${player.ships.length} / ${state.specs.length} кораблей</p>
        </div>
        ${gridHTML(player, 'own', 'place', viewIndex())}
        <p class="hint">Клик по уже стоящему кораблю снимает его. Правая кнопка или R — поворот.</p>
      </section>
      <aside class="panel yard">
        <div class="panel-head">
          <h2>Верфь</h2>
          <p>${esc(player.name)} · ${orient}</p>
        </div>
        <div class="dock ${state.orientation === 'v' ? 'orient-v' : ''}">${dockHTML}</div>
        <p class="log">${esc(state.log)}</p>
        <button type="button" class="btn ghost" data-action="rotate">Повернуть</button>
        <button type="button" class="btn ghost" data-action="random">Случайная расстановка</button>
        <button type="button" class="btn ghost" data-action="clear">Сбросить</button>
        <button type="button" class="btn primary" data-action="ready" ${ready && myTurn() && !waitingOpponent ? '' : 'disabled'}>${waitingOpponent ? 'Ждём соперника…' : 'Готово'}</button>
      </aside>
    </div>`;
}

function renderBattle() {
  const player = currentPlayer();
  const enemy = enemyPlayer();
  const afloat = player.ships.filter((ship) => !ship.sunk).length;
  const pass = !isOnline() && state.locked && state.phase === 'battle'
    ? '<button type="button" class="btn primary attention" data-action="pass">Сменить игрока</button>'
    : '';
  const waitHint = isOnline() && !myTurn()
    ? '<p class="hint wait-turn">Сейчас ход соперника — ждите.</p>'
    : '<p class="hint">Попадание — ещё выстрел. Промах — ход переходит к сопернику.</p>';

  stage.innerHTML = `
    <div class="battle-layout">
      <section class="panel">
        <div class="panel-head">
          <h2>Ваш флот</h2>
          <p>На плаву ${afloat} / ${player.ships.length}</p>
        </div>
        ${gridHTML(player, 'own', 'own', viewIndex())}
      </section>
      <section class="panel">
        <div class="panel-head">
          <h2>Поле соперника</h2>
          <p>${esc(enemy.name)}</p>
        </div>
        ${gridHTML(enemy, 'sunk', 'enemy', 1 - viewIndex())}
        <div class="tracker">
          <p class="tracker-label">Ещё на плаву</p>
          ${trackerHTML(enemy)}
        </div>
      </section>
    </div>
    <div class="banner">
      <div>
        <p class="log">${esc(state.log)}</p>
        ${waitHint}
      </div>
      ${pass}
    </div>`;
}

function renderOver() {
  if (!isOnline()) {
    const winner = state.players[state.winner];
    const loser = state.players[1 - state.winner];
    stage.innerHTML = `
    <section class="over">
      <p class="eyebrow">Бой окончен</p>
      <h2 class="victory">Победил ${esc(winner.name)}</h2>
      <p class="hint">Флот ${esc(loser.name)} уничтожен. Обе карты открыты.</p>
      <div class="battle-layout">
        <section class="panel owner-${state.winner}">
          <div class="panel-head"><h2>${esc(winner.name)}</h2><p>Победитель</p></div>
          ${gridHTML(winner, 'all', 'show', state.winner)}
        </section>
        <section class="panel owner-${1 - state.winner}">
          <div class="panel-head"><h2>${esc(loser.name)}</h2><p>Флот потоплен</p></div>
          ${gridHTML(loser, 'all', 'show', 1 - state.winner)}
        </section>
      </div>
      <div class="row-actions">
        <button type="button" class="btn primary" data-action="rematch">Ещё партия</button>
        <button type="button" class="btn ghost" data-action="title">К именам</button>
      </div>
    </section>`;
    return;
  }
  const youWon = state.winner === state.myIndex;
  const headline = youWon ? 'Победа!' : 'Поражение';
  const sub = youWon
    ? 'Флот соперника уничтожен.'
    : `Победил ${esc(enemyPlayer().name)}.`;
  stage.innerHTML = `
    <section class="over">
      <p class="eyebrow">Бой окончен</p>
      <h2 class="victory">${headline}</h2>
      <p class="hint">${sub} Обе карты открыты.</p>
      <div class="battle-layout">
        <section class="panel owner-${viewIndex()}">
          <div class="panel-head"><h2>${esc(currentPlayer().name)}</h2><p>${youWon ? 'Победитель' : 'Ваш флот'}</p></div>
          ${gridHTML(currentPlayer(), 'all', 'show', viewIndex())}
        </section>
        <section class="panel owner-${1 - viewIndex()}">
          <div class="panel-head"><h2>${esc(enemyPlayer().name)}</h2><p>${youWon ? 'Флот потоплен' : 'Победитель'}</p></div>
          ${gridHTML(enemyPlayer(), 'all', 'show', 1 - viewIndex())}
        </section>
      </div>
      <div class="row-actions">
        <button type="button" class="btn primary" data-action="rematch">Ещё партия</button>
        <button type="button" class="btn ghost" data-action="title">К именам</button>
      </div>
    </section>`;
}

function paintGhost() {
  stage.querySelectorAll('.cell.ghost-ok, .cell.ghost-bad').forEach((cell) => {
    cell.classList.remove('ghost-ok', 'ghost-bad');
  });
  if (state.phase !== 'place' || !hover || !state.selectedId) return;
  const spec = state.specs.find((item) => item.id === state.selectedId);
  if (!spec) return;
  const cells = SeaBattle.shipCells(hover.r, hover.c, spec.size, state.orientation);
  const ok = SeaBattle.canPlace(currentPlayer(), cells);
  cells.forEach((cell) => {
    if (cell.r < 0 || cell.c < 0 || cell.r >= SeaBattle.SIZE || cell.c >= SeaBattle.SIZE) return;
    const el = stage.querySelector(`.cell[data-board="place"][data-r="${cell.r}"][data-c="${cell.c}"]`);
    if (el) el.classList.add(ok ? 'ghost-ok' : 'ghost-bad');
  });
}

function syncChrome() {
  const label = document.getElementById('phase-label');
  const who = document.getElementById('who');
  if (state.phase === 'title' || state.phase === 'lobby' || !state.players.length) {
    label.textContent = state.playMode === 'online' && state.online.code
      ? `Онлайн · комната ${state.online.code}`
      : state.playMode === 'online'
        ? 'Онлайн · два браузера'
        : 'Два игрока · одна клавиатура';
    who.replaceChildren();
    return;
  }
  if (state.phase === 'handoff' && !isOnline()) {
    label.textContent = 'Поле закрыто';
    who.replaceChildren();
    return;
  }
  const captions = {
    place: isOnline() ? 'Расстановка флота · онлайн' : 'Расстановка флота',
    battle: isOnline() ? 'Бой · онлайн' : 'Бой',
    over: 'Конец боя',
  };
  label.textContent = captions[state.phase] || '';
  const dotIndex = isOnline() ? state.myIndex : state.current;
  const name = isOnline() && state.phase === 'battle'
    ? (myTurn() ? state.players[state.myIndex].name : 'Ход соперника')
    : state.players[isOnline() ? state.myIndex : state.current].name;
  who.innerHTML = `<span class="dot p${dotIndex}"></span><span>${esc(name)}</span>`;
}

function syncHandoff() {
  const show = state.phase === 'handoff';
  handoff.hidden = !show;
  if (!show) return;
  const name = state.players[state.handoffNext].name;
  const eye = document.getElementById('ho-eye');
  const title = document.getElementById('ho-title');
  const text = document.getElementById('ho-text');
  const button = document.getElementById('ho-btn');
  if (state.handoffKind === 'place') {
    eye.textContent = 'Расстановка';
    title.textContent = name;
    text.textContent = 'Пусть соперник отвернётся. Поле под блюром откроется только по кнопке — схему флота должен видеть только тот, кто её ставит.';
    button.textContent = 'Открыть поле и расставить флот';
  } else {
    eye.textContent = 'Смена хода';
    title.textContent = `Ходит ${name}`;
    text.textContent = 'Поле противника закрыто блюром. Передайте клавиатуру и откройте экран, только когда на него смотрите вы.';
    button.textContent = 'Я готов, открыть поле';
  }
}

function announce() {
  const live = document.getElementById('live');
  if (state.phase === 'handoff') {
    live.textContent = `Поле закрыто. Ход переходит к ${state.players[state.handoffNext].name}.`;
    return;
  }
  live.textContent = state.log || '';
}

function render() {
  const view = state.phase === 'handoff' && !isOnline() ? state.handoffKind : state.phase;
  stage.classList.toggle('is-secret', state.phase === 'handoff' && !isOnline());
  stage.classList.toggle('is-locked', (state.phase === 'battle' && (state.locked || (isOnline() && !myTurn())))
    || (state.phase === 'place' && isOnline() && state.online.placementReady[state.myIndex]));
  stage.inert = (state.phase === 'handoff' && !isOnline())
    || (isOnline() && state.phase === 'place' && state.online.placementReady[state.myIndex]);
  stage.setAttribute('aria-hidden', state.phase === 'handoff' && !isOnline() ? 'true' : 'false');
  stage.dataset.mode = view === 'lobby' ? 'title' : view;
  const paintPlayer = isOnline() ? state.myIndex : state.current;
  stage.dataset.player = state.players.length ? String(paintPlayer) : '';

  if (view === 'title') renderTitle();
  else if (view === 'lobby') renderLobby();
  else if (view === 'place') renderPlace();
  else if (view === 'over') renderOver();
  else renderBattle();

  syncChrome();
  syncHandoff();
  paintGhost();
  announce();
}

function openHandoff(next, kind) {
  state.phase = 'handoff';
  state.handoffNext = next;
  state.handoffKind = kind;
  render();
  document.getElementById('ho-btn').focus();
}

function begin(nameA, nameB) {
  state.playMode = 'local';
  state.myIndex = 0;
  state.players = [SeaBattle.createPlayer(nameA), SeaBattle.createPlayer(nameB)];
  state.specs = SeaBattle.fleetSpecs();
  state.current = 0;
  state.selectedId = state.specs[0].id;
  state.orientation = 'h';
  state.locked = false;
  state.lastShot = null;
  state.lastResult = null;
  state.pendingNotice = null;
  state.winner = null;
  state.log = 'Поставьте все 10 кораблей. R или правая кнопка мыши — поворот.';
  hover = null;
  openHandoff(0, 'place');
}

function confirmHandoff() {
  state.current = state.handoffNext;
  state.phase = state.handoffKind;
  state.locked = false;
  state.lastShot = null;
  state.orientation = 'h';
  hover = null;

  if (state.phase === 'place') {
    const player = currentPlayer();
    const left = state.specs.filter((spec) => !player.ships.some((ship) => ship.id === spec.id));
    state.selectedId = left[0] ? left[0].id : null;
    state.log = 'Поставьте все 10 кораблей. R или правая кнопка мыши — поворот.';
  } else {
    state.selectedId = null;
    const notice = state.pendingNotice;
    state.pendingNotice = null;
    if (!notice) {
      state.log = 'Стреляйте по полю соперника. Пока попадаете — ход ваш.';
    } else if (notice.result === 'miss') {
      state.log = 'Противник промахнулся. Ваш выстрел.';
    } else if (notice.result === 'sunk') {
      state.log = `Потоплен ваш ${notice.shipName.toLowerCase()}. Ваш выстрел.`;
    } else {
      state.log = 'По вашему кораблю попали. Ваш выстрел.';
    }
  }
  render();
}

function selectNextShip(player) {
  const left = state.specs.filter((spec) => !player.ships.some((ship) => ship.id === spec.id));
  state.selectedId = left[0] ? left[0].id : null;
}

function onPlaceClick(r, c) {
  if (isOnline()) {
    if (!myTurn()) return;
    const player = currentPlayer();
    const occupied = player.grid[r][c];
    if (occupied) {
      Online.send({ type: 'place', sub: 'remove', shipId: occupied });
      return;
    }
    if (!state.selectedId) {
      state.log = 'Сначала выберите корабль на верфи.';
      render();
      return;
    }
    Online.send({
      type: 'place',
      sub: 'cell',
      r,
      c,
      shipId: state.selectedId,
      orientation: state.orientation,
    });
    return;
  }
  const player = currentPlayer();
  const occupied = player.grid[r][c];
  if (occupied) {
    SeaBattle.removeShip(player, occupied);
    state.selectedId = occupied;
    state.log = 'Корабль снят с поля. Поставьте его заново.';
    render();
    return;
  }
  if (!state.selectedId) {
    state.log = 'Сначала выберите корабль на верфи.';
    render();
    return;
  }
  const spec = state.specs.find((item) => item.id === state.selectedId);
  const cells = SeaBattle.shipCells(r, c, spec.size, state.orientation);
  if (!SeaBattle.canPlace(player, cells)) {
    state.log = 'Так нельзя: корабль выходит за поле или стоит вплотную к другому.';
    render();
    const grid = stage.querySelector('.grid');
    if (grid) grid.classList.add('shake');
    return;
  }
  SeaBattle.placeShip(player, spec, r, c, state.orientation);
  selectNextShip(player);
  state.log = state.selectedId
    ? 'Корабль на месте. Ставьте следующий.'
    : 'Все корабли расставлены. Жмите «Готово».';
  render();
}

function onFire(r, c) {
  if (state.phase !== 'battle' || state.locked) return;
  if (isOnline()) {
    if (!myTurn()) return;
    Online.send({ type: 'fire', r, c });
    return;
  }
  const defender = state.players[1 - state.current];
  const result = SeaBattle.fire(defender, r, c);
  if (!result.ok) {
    state.log = 'Сюда уже стреляли.';
    render();
    return;
  }
  state.lastShot = { r, c, board: 'enemy' };
  state.lastResult = result;
  if (result.allSunk) {
    state.phase = 'over';
    state.winner = state.current;
    state.locked = false;
    state.log = 'Флот противника уничтожен.';
    render();
    return;
  }
  if (result.result === 'miss') {
    state.locked = true;
    state.log = 'Мимо. Посмотрите клетку и смените игрока.';
    render();
    stage.querySelector('[data-action="pass"]')?.focus();
    return;
  }
  if (result.result === 'sunk') state.log = `Убил: ${result.shipName}. Ход продолжается.`;
  else state.log = 'Ранил. Ход продолжается.';
  render();
}

function toggleOrientation() {
  if (state.phase !== 'place') return;
  state.orientation = state.orientation === 'h' ? 'v' : 'h';
  render();
}

function onlineName() {
  const el = document.getElementById('online-name');
  return cleanName(el ? el.value : '', 'Игрок');
}

async function startCreateRoom() {
  state.playMode = 'online';
  state.online.error = '';
  const res = await Online.createRoom(onlineName());
  if (!res.ok) {
    state.online.error = res.error || 'Не удалось создать комнату. Запущен ли сервер?';
    render();
    return;
  }
  state.online.code = res.code;
  state.phase = 'lobby';
  render();
}

async function startJoinRoom() {
  state.playMode = 'online';
  state.online.error = '';
  const codeEl = document.getElementById('join-code');
  const code = codeEl ? String(codeEl.value).trim() : '';
  const res = await Online.joinRoom(code, onlineName());
  if (!res.ok) {
    state.online.error = res.error || 'Не удалось войти в комнату.';
    render();
    return;
  }
  state.online.code = res.code;
}

function onAction(action, el) {
  if (state.phase === 'handoff' && !isOnline()) return;
  if (action === 'mode-local') {
    state.playMode = 'local';
    state.online.error = '';
    render();
    return;
  }
  if (action === 'mode-online') {
    state.playMode = 'online';
    state.online.error = '';
    render();
    return;
  }
  if (action === 'create-room') {
    startCreateRoom();
    return;
  }
  if (action === 'join-room') {
    startJoinRoom();
    return;
  }
  if (action === 'copy-link') {
    const input = stage.querySelector('.share-url');
    const text = input ? input.value : playBaseUrl();
    if (text && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        state.online.error = '';
        state.log = 'Ссылка скопирована.';
        if (state.phase === 'title') render();
      });
    }
    return;
  }
  if (action === 'copy-code') {
    const code = state.online.code;
    if (code && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code);
    }
    return;
  }
  if (action === 'rotate') {
    toggleOrientation();
    return;
  }
  if (action === 'select') {
    state.selectedId = el.dataset.id;
    state.log = 'Кликните по клетке, откуда поставить корабль.';
    render();
    return;
  }
  if (action === 'random') {
    if (isOnline()) {
      Online.send({ type: 'place', sub: 'random' });
      return;
    }
    const player = currentPlayer();
    const ok = SeaBattle.placeRandom(player, state.specs);
    state.selectedId = null;
    state.log = ok
      ? 'Флот расставлен случайно. Можно поправить кликом по кораблю.'
      : 'Не вышло расставить флот. Попробуйте ещё раз.';
    render();
    return;
  }
  if (action === 'clear') {
    if (isOnline()) {
      Online.send({ type: 'place', sub: 'clear' });
      return;
    }
    SeaBattle.clearFleet(currentPlayer());
    state.selectedId = state.specs[0].id;
    state.log = 'Поле очищено.';
    render();
    return;
  }
  if (action === 'ready') {
    const player = currentPlayer();
    if (player.ships.length !== state.specs.length) return;
    if (isOnline()) {
      Online.send({ type: 'ready' });
      return;
    }
    if (state.current === 0) openHandoff(1, 'place');
    else openHandoff(0, 'battle');
    return;
  }
  if (action === 'pass') {
    if (!state.locked || !state.lastResult) return;
    state.pendingNotice = state.lastResult;
    openHandoff(1 - state.current, 'battle');
    return;
  }
  if (action === 'rematch') {
    if (isOnline()) {
      Online.send({ type: 'rematch' });
      return;
    }
    begin(state.players[0].name, state.players[1].name);
    return;
  }
  if (action === 'title') {
    state.phase = 'title';
    state.playMode = 'local';
    state.online.code = null;
    state.online.error = '';
    state.locked = false;
    state.players = [];
    hover = null;
    render();
  }
}

function onStageClick(event) {
  const actionEl = event.target.closest('[data-action]');
  if (actionEl) {
    onAction(actionEl.dataset.action, actionEl);
    return;
  }
  const cell = event.target.closest('.cell');
  if (!cell || state.phase === 'handoff' || state.phase === 'over') return;
  const r = Number(cell.dataset.r);
  const c = Number(cell.dataset.c);
  if (cell.dataset.board === 'place') onPlaceClick(r, c);
  if (cell.dataset.board === 'enemy') onFire(r, c);
}

function onStageHover(event) {
  const cell = event.target.closest('.cell');
  if (!cell || state.phase !== 'place' || cell.dataset.board !== 'place') {
    if (hover) {
      hover = null;
      paintGhost();
    }
    return;
  }
  const next = { r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
  if (hover && hover.r === next.r && hover.c === next.c) return;
  hover = next;
  paintGhost();
}

function onContextMenu(event) {
  if (state.phase !== 'place' || !event.target.closest('.grid')) return;
  event.preventDefault();
  toggleOrientation();
}

function onKey(event) {
  if (event.target.matches('input, textarea')) return;
  const key = event.key.toLowerCase();
  if (key === 'r' || key === 'к') {
    if (state.phase === 'place') {
      event.preventDefault();
      toggleOrientation();
    }
  }
}

function onSubmit(event) {
  if (!event.target.closest('#start-form')) return;
  event.preventDefault();
  const data = new FormData(event.target);
  begin(cleanName(String(data.get('p1') || ''), 'Игрок 1'), cleanName(String(data.get('p2') || ''), 'Игрок 2'));
}

function init() {
  Online.setHandlers({
    onState(payload) {
      applyRemote(payload);
      render();
    },
    onLeft() {
      state.phase = 'title';
      state.players = [];
      state.online.error = 'Соперник отключился.';
      render();
    },
  });
  if (typeof io !== 'undefined') Online.connect();
  stage.addEventListener('click', onStageClick);
  stage.addEventListener('mouseover', onStageHover);
  stage.addEventListener('mouseleave', () => {
    hover = null;
    paintGhost();
  });
  stage.addEventListener('contextmenu', onContextMenu);
  stage.addEventListener('submit', onSubmit);
  document.getElementById('ho-btn').addEventListener('click', confirmHandoff);
  window.addEventListener('keydown', onKey);
  render();
}

init();
