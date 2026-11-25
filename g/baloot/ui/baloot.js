/* ═══════════════════════════════════════════════════════════════════════
   Baloot table: a play surface that owns its tree and updates it, rather than
   a string of markup rebuilt on every poll.

   Why this file differs from the other Shahd games: the rest are drawn by
   rewriting `innerHTML` on every poll, and that kills every animation in its
   cradle. The card never finishes its flight, the ring never finishes its
   turn, the speech bubble appears and vanishes before it can be read. Here the
   tree is built once and only what changed is touched.

   Time is read from `turnDeadline` as sent by the server, never from a local
   counter, so however slow the poll or however long the device slept, all four
   players see the same number.

   No Arabic lives in this file. Every player-facing word comes from
   `locales/ar.json` and every mark from `icons.svg`, per AGENTS.md.

   Contract with the page: supports / mount / paint / bind.
   ═══════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const ASSETS = '/g/baloot';
  const DECK = '/g/deck';

  /**
   * Every file this table loads carries the same version its own script does.
   *
   * The page loads `baloot.js?v=…`, so a new script always arrives. But the
   * words and the icon sprite were fetched with no version at all and are
   * served with a day of cache, so a phone kept yesterday's copies: new
   * buttons came out blank and new icons came out empty, and the table looked
   * broken while it was only old. The version is read from this script's own
   * address, so there is nothing to remember to bump twice.
   */
  const BUILD = (() => {
    try {
      const own = (document.currentScript && document.currentScript.src) || '';
      return new URL(own, location.href).searchParams.get('v') || '';
    } catch (_) { return ''; }
  })();
  const stamp = (url) =>
    (BUILD ? `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(BUILD)}` : url);

  const ICONS = stamp(`${ASSETS}/ui/icons.svg`);
  const POS = ['south', 'east', 'north', 'west'];
  const SUITS = ['S', 'H', 'D', 'C'];
  const RED = new Set(['H', 'D']);
  const EASY_KEY = 'shahd-baloot-easy';
  const MUTE_KEY = 'shahd-baloot-mute';
  const FX_KEY = 'shahd-baloot-fx';
  const RING_R = 47;            // ring radius in the 100-unit avatar box
  const DRAG_TO_PLAY = 46;      // pixels pulled upwards before a card is thrown
  const OPEN_PULL = 0.40;       // how much of a card hides under its neighbour
  const TIGHT_PULL = 0.68;      // and the most it may hide before the cards shrink
  const COME_MS = 300;          // the deck travelling from the dealer to the middle
  const SHUFFLE_MS = 1180;      // the riffle itself
  const DEAL_STEP = 62;         // one card leaving the stack for a hand
  // Baloot is dealt five at a time and then three more once the bid is
  // settled, which is what the engine does and what the table must show.
  const FIRST_CARDS = 5;
  const REST_STEP = 110;        // the three that follow the bid
  const SORT_KEY = 'shahd-baloot-sort';
  const BACK_KEY = 'shahd-baloot-back';
  const FACE_KEY = 'shahd-baloot-face';
  const THEME_KEY = 'shahd-baloot-theme';
  const SHATTER_KEY = 'shahd-baloot-shatter';
  // The changeable parts of the table. `classic` is the deck as it was drawn;
  // everything beside it is an alternative, never a replacement.
  const BACKS = ['classic', 'sadu', 'najdi', 'dallah', 'layl'];
  const FACES = ['classic', 'clean'];
  const THEMES = ['majlis', 'sadu', 'green', 'layl'];
  // The clean set redraws the numbers only. The king, the queen and the jack
  // are the deck's own painting and are never swapped.
  const PLAIN_RANKS = new Set(['7', '8', '9', '10', 'A']);
  const SORTS = ['suit', 'run', 'power'];
  const SEQ = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const TRUMP_POWER = { J: 8, 9: 7, A: 6, 10: 5, K: 4, Q: 3, 8: 2, 7: 1 };
  const PLAIN_POWER = { A: 8, 10: 7, K: 6, Q: 5, J: 4, 9: 3, 8: 2, 7: 1 };
  const TRUMP_VALUE = { J: 20, 9: 14, A: 11, 10: 10, K: 4, Q: 3, 8: 0, 7: 0 };
  const PLAIN_VALUE = { A: 11, 10: 10, K: 4, Q: 3, J: 2, 9: 0, 8: 0, 7: 0 };

  /* ═══════════ words and marks ═══════════ */

  let words = {};

  async function loadWords() {
    try {
      const res = await fetch(stamp(`${ASSETS}/locale/ar.json`), { cache: 'force-cache' });
      words = await res.json();
    } catch (_) { words = {}; }
  }

  /** `t('ui.waiting', {name})` — a dotted key into the locale file. */
  function t(path, vars) {
    let node = words;
    for (const part of path.split('.')) {
      node = node && node[part];
      if (node === undefined) return '';
    }
    let out = String(node);
    if (vars) {
      for (const [key, value] of Object.entries(vars)) {
        out = out.split(`{${key}}`).join(String(value));
      }
    }
    return out;
  }

  /**
   * A new skin changes pictures and nothing else.
   *
   * This used to pretend a fresh deal had happened so that everything would
   * be redrawn — and a fresh deal is a shuffle, twenty cards in the air, the
   * sounds that go with them, and a reset of the counter that decides which
   * calls have been heard, so every voice in the buffer spoke again. Press a
   * few colours in a row and the table came apart. Now the sources are simply
   * repointed, in place, with nothing moving and nothing sounding.
   */
  function restyleCards() {
    if (!root) return;
    handKey = '';                       // my own hand is rebuilt with the faces
    el.deck.querySelectorAll('img').forEach((img) => { img.src = backSrc(); });
    el.flip.dataset.card = '';          // the face-up card redraws on the pass
    Object.values(el.seats).forEach((cell) => {
      cell.fan.querySelectorAll('img').forEach((img) => { img.src = backSrc(); });
      cell.pile.querySelectorAll('img').forEach((img) => { img.src = backSrc(); });
    });
    root.querySelectorAll('.blt-play img, .blt-reveal img').forEach((img) => {
      const card = img.getAttribute('alt');
      if (card) img.src = faceSrc(card);
    });
    el.opts.dataset.key = '';
    if (el.lobby) el.lobby.dataset.key = '';
  }

  /** The back of a card, as this player has chosen to see it. */
  const backSrc = () => (backSkin === 'classic'
    ? `${DECK}/back.webp`
    : stamp(`${ASSETS}/art/back-${backSkin}.svg`));

  /** The face of one card: the numbers may change, the court never does. */
  const faceSrc = (card) => ((faceSkin === 'clean'
    && PLAIN_RANKS.has(String(card).slice(0, -1)))
    ? `${DECK}/clean/${card}.webp`
    : `${DECK}/${card}.webp`);

  const icon = (name, cls = '') =>
    `<svg class="${cls}" aria-hidden="true"><use href="${ICONS}#i-${name}"></use></svg>`;
  const suitIcon = (suit) => icon(`suit-${suit}`);

  const $ = (tag, cls, html) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const read = (key, fallback) => {
    try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; }
  };
  const write = (key, value) => {
    try { localStorage.setItem(key, value); } catch (_) { /* private mode */ }
  };

  /* ═══════════ state ═══════════ */

  let send = () => {};
  let root = null;
  let el = {};
  let table = null;
  let easy = read(EASY_KEY, '1') === '1';
  let muted = read(MUTE_KEY, '0') === '1';
  // The table's own noises — the throw, the deal, the swept trick — apart from
  // the voices. A player who wants the calls without the shuffle turns these
  // off alone.
  let fxOff = read(FX_KEY, '0') === '1';
  let tray = false;
  let optsOpen = false;
  let picking = false;          // choosing which project to declare
  let bidStep = '';
  let sheetClosed = 0;          // hand number whose sheet the player dismissed
  let selected = '';
  let micOn = false;
  let talking = new Set();

  let handKey = '';
  let held = new Set();         // the cards already in my hand, to spot arrivals
  let dealtHand = 0;
  let lastWinner = null;
  let seenSay = -1;
  let seenChat = 0;
  let seenReveal = 0;
  let dealtAtMs = 0;            // when the cards start leaving the stack
  let dealtStamp = 0;           // the server's moment of the deal we drew
  let greeted = false;          // the greeting belongs to the first hand only
  let sortBy = SORTS.includes(read(SORT_KEY, 'suit')) ? read(SORT_KEY, 'suit') : 'suit';
  const pickOne = (list, key, fallback) => {
    const kept = read(key, fallback);
    return list.includes(kept) ? kept : fallback;
  };
  let backSkin = pickOne(BACKS, BACK_KEY, 'classic');
  let faceSkin = pickOne(FACES, FACE_KEY, 'classic');
  let theme = pickOne(THEMES, THEME_KEY, 'majlis');
  let shatter = read(SHATTER_KEY, '1') === '1';
  let ticking = 0;
  const spoken = new Set();     // calls voiced locally, not to be voiced again

  /* ═══════════ sound ═══════════ */

  /**
   * Sound goes through the Web Audio API, not through `new Audio().play()`.
   *
   * This is the whole reason the table was silent. Browsers, and Telegram's
   * web view above all, refuse to start an audio element unless the call sits
   * inside a real user gesture. Every sound here is triggered by a poll or by
   * an animation, never by the tap itself, so every single one was rejected
   * and the rejection was swallowed.
   *
   * An AudioContext is different: it is unlocked once by any gesture and then
   * plays freely for the rest of the session. So one context is opened, the
   * first touch anywhere resumes it, the clips are decoded into buffers, and
   * from then on a sound is a buffer handed to the speakers with nothing left
   * to refuse it.
   */
  const sfx = {
    index: null,
    quick: [],
    ctx: null,
    gain: null,
    buffers: new Map(),
    pending: new Map(),
    unlocked: false,
    tags: new Map(),      // fallback <audio> elements, for browsers with no context
  };

  async function loadSfx() {
    if (sfx.index) return;
    sfx.index = {};
    try {
      const res = await fetch(stamp(`${ASSETS}/sfx/index.json`), { cache: 'no-cache' });
      const body = await res.json();
      sfx.index = body.sounds || {};
      sfx.quick = body.quick || [];
    } catch (_) { /* no sound, the game still plays */ }
  }

  function context() {
    if (sfx.ctx) return sfx.ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      sfx.ctx = new Ctor();
      sfx.gain = sfx.ctx.createGain();
      sfx.gain.gain.value = 0.9;
      sfx.gain.connect(sfx.ctx.destination);
    } catch (_) {
      sfx.ctx = null;
    }
    return sfx.ctx;
  }

  /** Called from a real gesture. Resumes the context and warms the short clips. */
  function unlock() {
    const ctx = context();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (sfx.unlocked) return;
    sfx.unlocked = true;
    ['_card', '_deal', '_trick_win', '_wrong'].forEach((key) => { buffer(key); });
  }

  function buffer(key) {
    if (sfx.buffers.has(key)) return Promise.resolve(sfx.buffers.get(key));
    if (sfx.pending.has(key)) return sfx.pending.get(key);
    const file = sfx.index && sfx.index[key];
    const ctx = context();
    if (!file || !ctx) return Promise.resolve(null);
    const job = fetch(`${ASSETS}/sfx/${encodeURIComponent(file)}`)
      .then((res) => res.arrayBuffer())
      .then((raw) => ctx.decodeAudioData(raw))
      .then((decoded) => { sfx.buffers.set(key, decoded); return decoded; })
      .catch(() => null)
      .finally(() => sfx.pending.delete(key));
    sfx.pending.set(key, job);
    return job;
  }

  /** Last resort for a browser with no AudioContext at all. */
  function fallback(key) {
    const file = sfx.index && sfx.index[key];
    if (!file) return;
    let tag = sfx.tags.get(key);
    if (!tag) {
      tag = new Audio(`${ASSETS}/sfx/${encodeURIComponent(file)}`);
      tag.preload = 'auto';
      sfx.tags.set(key, tag);
    }
    try { tag.currentTime = 0; tag.play().catch(() => {}); } catch (_) { /* blocked */ }
  }

  /** Starts one clip. Resolves with its length in seconds, or 0. */
  async function fire(key) {
    const ctx = context();
    if (!ctx) { fallback(key); return 0; }
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (_) { /* still locked */ }
    }
    const decoded = await buffer(key);
    if (!decoded) { fallback(key); return 0; }
    try {
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.connect(sfx.gain);
      source.start();
      return decoded.duration;
    } catch (_) {
      return 0;
    }
  }

  /**
   * Speech is spoken one call after another; effects fire at once.
   *
   * "Hokum thani" and then "spades" are two calls that leave the engine in the
   * same instant, and played together they are heard as one muddled noise.
   */
  const voice = { line: [], busy: false };

  function play(key) {
    if (muted || !sfx.index) return;
    if (String(key).charAt(0) === '_') { if (!fxOff) fire(key); return; }
    voice.line.push(key);
    if (!voice.busy) drain();
  }

  async function drain() {
    const key = voice.line.shift();
    if (key === undefined) { voice.busy = false; return; }
    voice.busy = true;
    const seconds = await fire(key);
    // Waited by length rather than by an `ended` event: a fallback tag never
    // fires one, and a queue that waits for it stops for good.
    setTimeout(drain, Math.min(2600, Math.max(220, seconds * 1000 + 90)));
  }

  /** Voiced here and now for the player who pressed, and not voiced again when
   *  the same call comes back from the server. */
  function speakNow(key) {
    play(key);
    spoken.add(key);
  }

  /* ═══════════ build ═══════════ */

  /**
   * Mounts on `body`, not inside the room stage.
   *
   * A rule of CSS with no way around it: `position: fixed` is measured from
   * the screen unless an ancestor carries a `transform` or a `filter`, in
   * which case it is measured from that ancestor. The app shell carries
   * transforms, so the table used to shrink into a corner of the page.
   */
  function mount() {
    if (root && root.isConnected) return;
    root = $('div', 'blt-root');
    root.style.setProperty('--bg-land', `url("${ASSETS}/bg/majlis-landscape.webp")`);
    root.style.setProperty('--bg-port', `url("${ASSETS}/bg/majlis-portrait.webp")`);
    root.appendChild($('div', 'blt-bg'));

    const top = $('div', 'blt-top');
    el.icons = $('div', 'blt-icons');
    el.score = $('div', 'blt-score');
    top.append(el.icons, el.score);
    root.appendChild(top);

    el.seats = {};
    for (const where of POS) {
      const seat = $('div', `blt-seat ${where}`);
      const fan = $('div', 'blt-fan');
      const pile = $('div', 'blt-pile');
      const ring = ringSvg();
      const run = ring.querySelector('.run');
      // The circumference never changes, so it is written here and not in the
      // frame loop, where it was being set sixty times a second for nothing.
      run.style.strokeDasharray = String(2 * Math.PI * RING_R);
      const face = $('div', 'blt-face');
      const name = $('div', 'blt-name');
      // The fan and the pile are children of the seat, so a player's cards
      // follow his face on every screen instead of being placed by themselves.
      //
      // The ring and the face share one box of exactly one avatar's size. The
      // ring used to be a sibling of the face sized by hand, so it hung
      // outside the picture; sharing a box makes the two the same circle by
      // construction, at every screen size, with nothing left to drift.
      const avatar = $('div', 'blt-avatar');
      avatar.append(ring, face);
      seat.append(fan, pile, avatar, name);
      root.appendChild(seat);
      el.seats[where] = { box: seat, fan, pile, avatar, ring, run, face, name };
    }

    el.felt = $('div', 'blt-felt');
    // The deck is kept for its position and not for its face: the shuffle in
    // the middle of the table stands in for it while the cards go out, and
    // for the rest of the hand a card lying face down on the felt beside the
    // trick meant nothing and was read as a mistake. It stays in the tree,
    // invisible, because every flight is measured from where it is.
    el.deck = $('div', 'blt-deck away', `<img alt="" src="${backSrc()}">`);
    el.flip = $('div', 'blt-flip');
    el.flip.hidden = true;
    el.felt.append(el.deck, el.flip);
    root.appendChild(el.felt);

    el.bottom = $('div', 'blt-bottom');
    el.hand = $('div', 'blt-hand');
    el.actions = $('div', 'blt-actions');
    // Nothing else lives down here. The order of the hand is chosen from the
    // settings drawer at the top: a pill floating beside the fan stood on the
    // cards, and a control that covers what it controls is worse than one
    // more tap away.
    el.bottom.append(el.hand, el.actions);
    root.appendChild(el.bottom);

    // The tray is built once and only shown or hidden. It used to be appended
    // inside the action bar, which is rebuilt on every poll, so it was torn
    // down and rebuilt twice a second: it flickered and ate what was typed.
    el.tray = $('div', 'blt-tray');
    el.tray.hidden = true;
    root.appendChild(el.tray);

    el.sheet = $('div', 'blt-sheet');
    el.sheet.hidden = true;
    root.appendChild(el.sheet);

    // Choosing where to sit, and the settings drawer. Both built once and only
    // shown or hidden, for the same reason the tray is.
    el.lobby = $('div', 'blt-lobby');
    el.lobby.hidden = true;
    root.appendChild(el.lobby);

    el.opts = $('div', 'blt-opts');
    el.opts.hidden = true;
    root.appendChild(el.opts);

    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSay);
    root.addEventListener('pointerdown', unlock);
    document.addEventListener('pointerdown', unlock, { capture: true });
    document.addEventListener('touchstart', unlock, { capture: true, passive: true });
    document.addEventListener('keydown', onKey);
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);

    root.dataset.theme = theme;
    document.body.appendChild(root);
    document.body.classList.add('blt-playing');
    fitScreen();
    watchRoomView();
    watchScreen();
    loadWords().then(() => { if (table) paint(table, null); });
    loadSfx();
  }

  function ringSvg() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'blt-ring');
    svg.setAttribute('viewBox', '0 0 100 100');
    for (const cls of ['track', 'run']) {
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('class', cls);
      circle.setAttribute('cx', '50');
      circle.setAttribute('cy', '50');
      circle.setAttribute('r', String(RING_R));
      svg.appendChild(circle);
    }
    return svg;
  }

  /**
   * Sizes the table to what is visible, not to the window.
   *
   * Inside Telegram the window is taller than the visible area, because the
   * app keeps the bottom for its own bar. The player's hand fell under that
   * edge and could not be reached.
   */
  function fitScreen() {
    if (!root) return;
    const tg = window.Telegram && window.Telegram.WebApp;
    const height = (tg && tg.viewportStableHeight) || window.innerHeight;
    if (height) root.style.setProperty('--vh', `${height}px`);
    fitHand();
  }

  let fitting = false;

  function watchScreen() {
    if (fitting) return;
    fitting = true;
    window.addEventListener('resize', fitScreen);
    window.addEventListener('orientationchange', fitScreen);
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg && tg.onEvent) {
      try { tg.onEvent('viewportChanged', fitScreen); } catch (_) { /* older client */ }
    }
  }

  let watcher = null;

  function watchRoomView() {
    const view = document.getElementById('view-room');
    if (!view) return;
    const sync = () => { if (root) root.hidden = !!view.hidden; };
    sync();
    if (watcher) watcher.disconnect();
    watcher = new MutationObserver(sync);
    watcher.observe(view, { attributes: true, attributeFilter: ['hidden'] });
  }

  /* ═══════════ paint ═══════════ */

  function paint(next, room) {
    if (!root) return;
    table = next;
    const mine = table.seat == null ? 0 : table.seat;

    // The microphone belongs to the room, not to the table: reading its state
    // from there keeps one microphone in all of Shahd instead of two.
    if (room) {
      const me = (room.players || []).find((p) => p && p.id === room.you);
      micOn = !!(me && me.mic);
      // Who is speaking, not who has a microphone open. The two are not the
      // same thing and the difference is the whole use of the ring.
      const heard = window.ShahdVoice && window.ShahdVoice.speaking;
      const open = (room.players || []).filter((p) => p && p.mic);
      talking = new Set(heard
        ? open.filter((p) => heard.has(p.id)).map((p) => p.id)
        : open.map((p) => p.id));
    }

    paintIcons();
    paintScore(mine);
    // The felt is handed the new cards before the seats are drawn: the pile
    // under a winner's name asks the timeline whether the cards have arrived,
    // and it must be asked after the timeline knows about them.
    syncTrick(mine);
    // The deal is set up before the seats are drawn: the fans ask it when
    // their cards are due to arrive, and it is the pass that answers.
    paintDeal(mine);
    paintSeats(mine);
    paintLobby(mine);
    paintFlip();
    paintHand();
    paintActions();
    paintSheet(mine);
    paintSpeech(mine);
    paintReveal(mine);
    paintChat(room, mine);
    runClock();
  }

  function paintIcons() {
    if (!el.icons.childElementCount) {
      const make = (todo, name) => {
        const button = $('button', 'blt-ico', icon(name));
        button.type = 'button';
        button.dataset.do = todo;
        return button;
      };
      // Four marks at the table, and not one more: leaving, inviting, the
      // microphone, and a drawer for everything that is a setting rather than
      // an action. The row had grown to six and was starting to read as a
      // toolbar instead of a game.
      el.icons.append(make('leave', 'leave'), make('invite', 'invite'),
        make('mic', 'mic-off'), make('opts', 'settings'));
    }
    const mic = el.icons.querySelector('[data-do="mic"]');
    mic.innerHTML = icon(micOn ? 'mic' : 'mic-off');
    mic.classList.toggle('on', micOn);
    mic.title = t(micOn ? 'icons.mic_on' : 'icons.mic_off');
    mic.setAttribute('aria-label', mic.title);

    const gear = el.icons.querySelector('[data-do="opts"]');
    gear.classList.toggle('on', optsOpen);
    gear.title = t('icons.settings');
    gear.setAttribute('aria-label', gear.title);

    el.icons.querySelector('[data-do="leave"]').title = t('icons.leave');
    el.icons.querySelector('[data-do="invite"]').title = t('icons.invite');
    paintOpts();
  }

  /**
   * The settings drawer: everything that is a preference rather than a move,
   * named in words instead of guessed from an icon.
   */
  function paintOpts() {
    if (!el.opts) return;
    el.opts.hidden = !optsOpen;
    if (!optsOpen) { el.opts.dataset.key = ''; return; }
    // It used to be rebuilt on every poll, so the switches replayed their
    // animation twice a second and looked as if they were turning themselves
    // on and off. It is built when its state changes, not when it is painted.
    const key = `${easy}|${muted}|${fxOff}|${sortBy}|${backSkin}|${faceSkin}`
      + `|${theme}|${shatter}|${words.opts ? 1 : 0}`;
    if (el.opts.dataset.key === key) return;
    el.opts.dataset.key = key;
    const skinRow = (kind, label, list, chosen) =>
      `<div class="pick"><span>${esc(label)}</span><div>`
      + list.map((name) =>
        `<button type="button" data-do="${kind}:${name}"`
        + ` class="chip ${kind} ${name}${name === chosen ? ' on' : ''}">`
        + `${esc(t(`${kind}s.${name}`))}</button>`).join('')
      + '</div></div>';
    const row = (todo, label, on) =>
      `<button type="button" class="row" data-do="${todo}">`
      + `<span>${esc(label)}</span><i class="sw${on ? ' on' : ''}"></i></button>`;
    el.opts.innerHTML = '<div class="blt-opts-card">'
      + `<h4>${esc(t('opts.title'))}</h4>`
      + row('easy', t('opts.easy'), easy)
      + row('mute', t('opts.sound'), !muted)
      + row('fx', t('opts.fx'), !fxOff)
      + `<div class="pick"><span>${esc(t('opts.sort'))}</span><div>`
      + SORTS.map((mode) =>
        `<button type="button" data-do="sort:${mode}"`
        + `${mode === sortBy ? ' class="on"' : ''}>${esc(t(`sort.${mode}`))}</button>`).join('')
      + '</div></div>'
      + row('shatter', t('opts.shatter'), shatter)
      + skinRow('back', t('opts.back'), BACKS, backSkin)
      + skinRow('face', t('opts.face'), FACES, faceSkin)
      + skinRow('theme', t('opts.theme'), THEMES, theme)
      + (table.seat != null && !(table.away || []).includes(table.seat)
        ? `<button type="button" class="row go" data-do="stepaway">`
          + `<span>${esc(t('opts.away'))}</span></button>` : '')
      + '</div>';
  }

  function paintScore(mine) {
    const us = mine % 2;
    if (table.phase === 'lobby') {
      el.score.innerHTML = `<div class="meta"><span>${esc(t('lobby.title'))}</span></div>`;
      return;
    }
    const mode = table.mode === 'sun'
      ? `<span>${esc(t('actions.sun'))}</span>`
      : table.mode
        ? `<span class="${RED.has(table.trump) ? 'red' : ''}">${esc(t('actions.hokum'))}
           ${suitIcon(table.trump)}</span>`
        : `<span>${esc(t('ui.bidding'))}</span>`;
    el.score.innerHTML =
      `<div class="us"><small>${esc(t('ui.us'))}</small><b>${table.scores[us]}</b></div>`
      + '<div class="bar"></div>'
      + `<div class="them"><small>${esc(t('ui.them'))}</small><b>${table.scores[1 - us]}</b></div>`
      + `<div class="meta">${mode}<span>&times;${table.multiplier || 1}</span>`
      + (table.gahwa != null
        ? `<span class="gahwa">${esc(t('actions.gahwa'))}</span>` : '')
      + `<span>${esc(t('ui.hand_no', { n: table.handNo }))}</span>`
      + `<span>${esc(t('ui.target', { n: table.target }))}</span></div>`;
  }

  /**
   * The speaking ring, driven from the sound itself.
   *
   * The room measures every voice it can hear and hands the result straight
   * to the table, so the ring lights the instant someone speaks instead of
   * waiting for the next poll to come round.
   */
  function applyTalking() {
    if (!root || !table || !el.seats) return;
    const mine = table.seat == null ? 0 : table.seat;
    (table.players || []).forEach((player, seat) => {
      const cell = el.seats[POS[(seat - mine + 4) % 4]];
      if (cell) cell.box.classList.toggle('talking', talking.has(player.id));
    });
  }

  function paintSeats(mine) {
    // While the deal is running the other hands fill up on the same clock the
    // cards leave the stack on, so a fan is never full before its cards have
    // arrived.
    const wait = Math.max(0, dealtAtMs - performance.now());
    const dealing = !!table.dealing;
    table.players.forEach((player, seat) => {
      const where = POS[(seat - mine + 4) % 4];
      const cell = el.seats[where];
      // My own chair is never drawn: my cards fill the bottom of the screen
      // and any badge down there stands on them. What I need from a seat —
      // whose turn it is and how long is left — is in the call bar instead,
      // where there is room for words.
      if (where === 'south') {
        cell.box.hidden = true;
        return;
      }
      const away = (table.away || []).includes(seat);
      cell.box.classList.toggle('turn', (table.waitingOn || []).includes(seat));
      cell.box.classList.toggle('mine', seat === mine);
      cell.box.classList.toggle('talking', talking.has(player.id));
      cell.box.dataset.seat = String(seat);

      const label = String(player.name || '');
      if (cell.face.dataset.who !== (player.photo || label)) {
        cell.face.dataset.who = player.photo || label;
        cell.face.querySelectorAll('img, span').forEach((node) => node.remove());
        if (player.photo) {
          const img = new Image();
          img.src = player.photo;
          img.alt = '';
          cell.face.appendChild(img);
        } else {
          cell.face.appendChild($('span', '', esc(label.trim().charAt(0) || '?')));
        }
      }
      // Claimed, not yet shown: the table knows he holds something and not
      // what, which is exactly what the rule intends.
      const claiming = (table.declaredBy || []).includes(seat)
        && !(table.shownBy || []).includes(seat);
      const chip = cell.box.querySelector('.blt-claim');
      if (claiming && !chip) {
        cell.box.appendChild($('i', 'blt-claim', esc(t('summary.claimed'))));
      } else if (!claiming && chip) {
        chip.remove();
      }

      const crowned = cell.box.querySelector('.blt-crown');
      if (seat === table.declarer && !crowned) {
        cell.box.appendChild($('i', 'blt-crown', icon('crown')));
      } else if (seat !== table.declarer && crowned) {
        crowned.remove();
      }

      cell.name.innerHTML =
        `<i class="blt-dot ${away || player.bot ? 'off' : ''}"></i>`
        + `<span>${esc(label)}${away ? ` · ${esc(t('ui.away'))}` : ''}</span>`
        + `<u>${player.cards}</u>`;

      // The pile grows when the cards reach it, not when the server says the
      // trick is won: the two are a second and a half apart, and a pile that
      // counted the cards while they were still in the air read as a mistake.
      const won = (table.tricksBySeat || [])[seat] || 0;
      if (!busy() && Number(cell.pile.dataset.won) !== won) {
        cell.pile.dataset.won = String(won);
        cell.pile.innerHTML = '';
        for (let i = 0; i < Math.min(won, 5); i += 1) {
          const img = new Image();
          img.src = backSrc();
          img.alt = '';
          img.style.setProperty('--s', String(i));
          cell.pile.appendChild(img);
        }
        if (won) cell.pile.appendChild($('b', '', String(won)));
      }

      // Face-down cards, counted exactly: counting is part of the game.
      const count = seat === mine ? 0 : player.cards || 0;
      if (Number(cell.fan.dataset.count) !== count) {
        const at = (seat - mine + 4) % 4;
        // The three that arrive after the bid fly in like the first five did,
        // instead of appearing in the fan out of nowhere.
        const was = Number(cell.fan.dataset.count) || 0;
        const grew = !dealing && count > was && was > 0;
        cell.fan.dataset.count = String(count);
        cell.fan.innerHTML = '';
        cell.fan.style.setProperty('--n', String(count));
        cell.fan.classList.toggle('dealing', dealing);
        cell.fan.classList.toggle('more', grew);
        for (let i = 0; i < count; i += 1) {
          const img = new Image();
          img.src = backSrc();
          img.alt = '';
          img.style.setProperty('--r', `${-(i - (count - 1) / 2) * 6.5}deg`);
          img.style.setProperty('--i', String(i));
          if (dealing) {
            img.style.setProperty('--dd',
              `${Math.round(wait + (i * 4 + at) * DEAL_STEP)}ms`);
          } else if (grew && i >= was) {
            img.classList.add('new');
            img.style.setProperty('--dd', `${(i - was) * REST_STEP + 90}ms`);
          }
          cell.fan.appendChild(img);
        }
      }
    });
  }

  /**
   * The seating screen, before a single card is dealt.
   *
   * Four seats, two teams, and the plain question a player wants answered
   * before he plays: who is with me. Any machine's chair may be taken; a
   * person's may not, because nobody should be dragged across a table by
   * someone else. If the word never comes the table deals itself, so a lobby
   * cannot become a place where a game goes to wait.
   */
  function paintLobby(mine) {
    if (!el.lobby) return;
    if (table.phase !== 'lobby') {
      if (!el.lobby.hidden) { el.lobby.hidden = true; el.lobby.dataset.key = ''; }
      return;
    }
    const seats = table.players || [];
    const key = seats.map((p) => `${p.id}:${p.bot ? 1 : 0}`).join('|')
      + `#${table.seat}#${words.lobby ? 1 : 0}#${backSkin}|${faceSkin}|${theme}`;
    el.lobby.hidden = false;
    if (el.lobby.dataset.key === key) return;
    el.lobby.dataset.key = key;

    const line = (where) => {
      const seat = (mine + where) % 4;
      const player = seats[seat] || {};
      const isMine = seat === table.seat;
      const label = String(player.name || '');
      return `<div class="who${isMine ? ' me' : ''}">`
        + `<i class="face">${player.photo
          ? `<img alt="" src="${esc(player.photo)}">`
          : esc(label.trim().charAt(0) || '?')}</i>`
        + `<span>${esc(label)}</span>`
        + (isMine ? `<u>${esc(t('lobby.you'))}</u>`
          : player.bot ? `<u class="bot">${esc(t('lobby.bot'))}</u>` : '')
        + (!isMine && player.bot && table.seat != null
          ? `<button type="button" class="blt-take" data-do="takeseat:${seat}">`
            + `${esc(t('lobby.sit'))}</button>` : '')
        + '</div>';
    };

    el.lobby.innerHTML =
      '<div class="blt-lobby-card">'
      + `<h3>${esc(t('lobby.title'))}</h3>`
      + `<p>${esc(t('lobby.hint'))}</p>`
      + '<div class="blt-teams">'
      + `<div class="team ours"><b>${esc(t('lobby.us'))}</b>${line(0)}${line(2)}</div>`
      + `<div class="team theirs"><b>${esc(t('lobby.them'))}</b>${line(1)}${line(3)}</div>`
      + '</div>'
      + '<div class="blt-lobby-look">'
      + `<img alt="" src="${backSrc()}">`
      + `<img alt="" src="${faceSrc('AS')}">`
      + `<img alt="" src="${faceSrc('10H')}">`
      + `<img alt="" src="${faceSrc('KD')}">`
      + '</div>'
      + '<div class="blt-lobby-skins">'
      + [['back', BACKS, backSkin], ['face', FACES, faceSkin],
         ['theme', THEMES, theme]].map(([kind, list, chosen]) =>
        `<div class="pick"><span>${esc(t(`opts.${kind}`))}</span><div>`
        + list.map((name) =>
          `<button type="button" data-do="${kind}:${name}"`
          + ` class="chip${name === chosen ? ' on' : ''}">`
          + `${esc(t(`${kind}s.${name}`))}</button>`).join('')
        + '</div></div>').join('')
      + '</div>'
      + '<div class="blt-lobby-go">'
      + (table.seat == null ? ''
        : `<button type="button" class="blt-call go" data-do="startmatch">`
          + `<span>${esc(t('lobby.start'))}</span></button>`)
      + `<small class="blt-lobby-clock"></small>`
      + '</div></div>';
  }

  /** The seconds left before the table deals itself. */
  function tickLobby() {
    const clock = el.lobby && el.lobby.querySelector('.blt-lobby-clock');
    if (!clock || table.phase !== 'lobby') return;
    const left = table.turnDeadline
      ? Math.max(0, Math.ceil((table.turnDeadline - Date.now()) / 1000)) : 0;
    clock.textContent = left ? t('lobby.auto', { n: left }) : '';
  }

  /* ═══════════ the deal, as a hand of cards is actually dealt ═══════════

     A hand used to begin with eight cards already in your fist, which is the
     one thing that never happens at a real table. Now the deck leaves the
     dealer's seat, comes to the middle, is riffled in the air where everyone
     can see it, and then goes out card by card — round after round, four
     seats at a time — until it lands in your hand and the bidding opens.

     The engine holds the table for exactly as long as this takes
     (`dealHold`), so nothing is ever cut off mid-air, and the first hand of a
     match is held longer still for the greeting. */

  function paintDeal(mine) {
    // Keyed on the moment of the deal, not on the number of the hand. A hand
    // thrown in for waraq is dealt again under the same number, and keying on
    // the number alone meant that redeal came out with no shuffle at all and
    // with the call counters still holding the numbers of the dead hand.
    const stamp = table.dealNo || table.dealtAt || 0;
    if (stamp === dealtStamp && table.handNo === dealtHand) return;
    dealtStamp = stamp;
    dealtHand = table.handNo;
    // Both counters start again with every hand, because the engine empties
    // the log the hand is numbered from. Carrying yesterday's number forward
    // silenced every call in every hand after the first: they arrived with a
    // smaller number than the one already seen and were dropped as old.
    seenSay = -1;
    seenReveal = 0;
    if (!table.dealtAt) return;             // seeded tests deal without a pause

    const intro = (table.handNo === 1 && !greeted) ? (table.introHold || 0) : 0;
    if (intro) { greeted = true; greeting(intro); }

    const start = intro;
    // Written here and not inside `dealDeck`: the hand is painted in this same
    // pass and has to know, already, when the cards will start leaving the
    // stack. A value set inside a timer arrives one pass too late and the hand
    // flies in before the shuffle has begun.
    dealtAtMs = performance.now() + start + COME_MS + SHUFFLE_MS;
    // The deck waits for the greeting to leave the screen before it comes to
    // the middle: two ceremonies on top of each other are neither.
    later(() => dealDeck(mine), start);

    const first = (table.turn == null) ? null : table.players[table.turn];
    if (first) {
      later(() => banner(t('ui.starts_with', { name: String(first.name || '') })),
            start + COME_MS + SHUFFLE_MS + FIRST_CARDS * 4 * DEAL_STEP + 200);
    }
  }

  /** A word for the whole table, in the middle, for a moment. */
  function banner(text, life = 2400) {
    if (!root || !text) return;
    const node = $('div', 'blt-banner', esc(text));
    root.appendChild(node);
    later(() => node.remove(), life);
  }

  /** Abu Saad, once a match, and gone before anyone has to wait for him. */
  function greeting(span) {
    const box = $('div', 'blt-greet',
      `<img alt="" src="${ASSETS}/art/abu-saad.webp">`);
    root.appendChild(box);
    play('_intro');
    play('salu');                 // the owner's own voice once it is recorded
    later(() => box.classList.add('out'), Math.max(600, span - 620));
    later(() => box.remove(), span + 80);
  }

  /**
   * The deck comes to the middle, is riffled, and goes out again.
   *
   * The riffle is drawn rather than faked with one image: two halves of a real
   * stack of backs, bent apart in perspective and let go. It costs eleven
   * nodes and they are all gone before the first bid.
   */
  function dealDeck(mine) {
    // Whatever an earlier ceremony left behind goes first. Two shuffles on one
    // felt is how a table ends up with a hundred cards in the air.
    el.felt.querySelectorAll('.blt-shuffle, .blt-toss').forEach((node) => node.remove());
    const dealer = table.dealer == null ? mine : table.dealer;
    const from = seatPoint(POS[(dealer - mine + 4) % 4], 'box');
    const deck = el.deck.getBoundingClientRect();

    const stack = $('div', 'blt-shuffle');
    stack.style.setProperty('--from-x',
      `${from.x - (deck.left + deck.width / 2)}px`);
    stack.style.setProperty('--from-y',
      `${from.y - (deck.top + deck.height / 2)}px`);
    for (let i = 0; i < 10; i += 1) {
      const back = new Image();
      back.src = backSrc();
      back.alt = '';
      back.className = i % 2 ? 'b' : 'a';
      back.style.setProperty('--k', String(i));
      stack.appendChild(back);
    }
    el.felt.appendChild(stack);

    later(() => play('_deal'), COME_MS);
    // Two passes of the riffle, and a slap when the halves come together.
    later(() => play('_deal'), COME_MS + SHUFFLE_MS * 0.55);

    const out = COME_MS + SHUFFLE_MS;
    later(() => {
      stack.classList.add('dealing');
    }, out - 60);
    later(() => {
      stack.remove();
    }, out + FIRST_CARDS * 4 * DEAL_STEP + 260);

    // The cards leaving for the three other hands. Mine are animated by
    // `paintHand`, which knows where each of them is going to sit.
    //
    // One sound to a round, not one to a card: four cards leave within a
    // quarter of a second and four clips on top of each other are a noise,
    // not a deal.
    for (let round = 0; round < FIRST_CARDS; round += 1) {
      later(() => play('_deal_one'), out + round * 4 * DEAL_STEP);
      for (let where = 1; where < 4; where += 1) {
        const cell = el.seats[POS[where]];
        if (!cell) continue;
        later(() => tossTo(cell, where, deck), out + (round * 4 + where) * DEAL_STEP);
      }
    }
  }

  /** One card back flying from the middle to a seat that is not mine. */
  function tossTo(cell, where, deck) {
    const to = seatPoint(POS[where], 'box');
    const card = new Image();
    card.className = 'blt-toss';
    card.src = backSrc();
    card.alt = '';
    card.style.setProperty('--tx', `${to.x - (deck.left + deck.width / 2)}px`);
    card.style.setProperty('--ty', `${to.y - (deck.top + deck.height / 2)}px`);
    card.style.setProperty('--tr', `${(where - 2) * 22}deg`);
    el.felt.appendChild(card);
    later(() => card.remove(), 620);
  }

  /* ═══════════ the trick, played out one card at a time ═══════════

     The felt is driven by a timeline of its own, not straight off the poll.

     Four players and three machines do not move at one speed, and a single
     poll can arrive carrying two cards at once. Painted as they came, cards
     appeared and vanished together and nobody could tell who had thrown what.
     That is the defect this section exists to end.

     So every change to the trick becomes a step in a queue, and the steps are
     played in order: a card lands and is left alone long enough to be read,
     the finished trick is held up whole, then the four cards gather into one
     stack and the stack is drawn to the player who won it — measured in real
     pixels off the winner's own pile, so it goes where his cards go.

     The queue cannot fall far behind the table: when steps pile up the gaps
     shrink, and a hidden tab is fast-forwarded outright. */

  const CARD_GAP = 320;     // shortest time a card is alone on the felt
  const TRICK_READ = 760;   // the finished trick is readable before it moves
  const GATHER_MS = 340;    // four cards into one stack
  const FLIGHT_MS = 540;    // the stack to its owner

  const flow = {
    queue: [],
    nodes: [],              // the cards now on the felt, in play order
    mirror: [],             // the trick as already handed to the queue
    pends: new Set(),       // every timer this section owns, so reset can end them
    running: false,
  };

  /** Is the felt still telling the story of a trick? */
  function busy() { return flow.running || flow.queue.length > 0; }

  /**
   * Where a seat sits on the screen, in pixels.
   *
   * My own chair is not drawn, so its box measures zero and everything aimed
   * at it — the cards I win, the deck when I am the dealer — used to fly to
   * the top-left corner of the screen. My place is the middle of the bottom
   * edge, where my hand is, and that is what is returned for it.
   */
  function seatPoint(where, part) {
    const cell = el.seats[where];
    const node = cell && (part === 'pile' ? cell.pile : cell.box);
    const box = node ? node.getBoundingClientRect() : null;
    if (box && (box.width || box.height)) {
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }
    const felt = el.felt.getBoundingClientRect();
    const floor = (root ? root.getBoundingClientRect().bottom : window.innerHeight);
    return { x: felt.left + felt.width / 2, y: floor - 40 };
  }

  function later(fn, ms) {
    const id = setTimeout(() => { flow.pends.delete(id); fn(); }, Math.max(0, ms));
    flow.pends.add(id);
    return id;
  }

  function syncTrick(mine) {
    const trick = table.trick || [];
    if (table.trickWinner != null) lastWinner = table.trickWinner;
    const sig = trick.map((pair) => pair.join(':'));
    const follows = sig.length >= flow.mirror.length
      && flow.mirror.every((card, i) => card === sig[i]);
    if (follows && sig.length === flow.mirror.length) return;
    if (!follows) {
      // Not our trick any more. Whatever is queued still plays out, and the
      // felt is cleared after it rather than under it.
      if (flow.mirror.length) queue({ act: 'clear' });
      flow.mirror = [];
    }
    for (let i = flow.mirror.length; i < sig.length; i += 1) {
      const [seat, card] = trick[i];
      queue({ act: 'play', seat, card, mine });
      // The sweep is queued with the fourth card and not when the server
      // clears the trick. On the last trick of a hand the server never clears
      // it — the hand is scored the instant it closes — and the four cards
      // used to sit there while the count covered them.
      if (i === 3) {
        queue({
          act: 'sweep',
          mine,
          winner: table.trickWinner != null ? table.trickWinner : lastWinner,
          closing: table.phase === 'hand_done' || table.phase === 'match_done',
        });
      }
    }
    flow.mirror = sig;
  }

  function queue(step) {
    flow.queue.push(step);
    if (!flow.running) advance();
  }

  function advance() {
    const step = flow.queue.shift();
    if (!step) {
      flow.running = false;
      repaint();               // whatever the animation was holding back
      return;
    }
    flow.running = true;
    // Behind the table? Then the gaps close. The cards are still seen, they
    // are simply not lingered over.
    const rush = document.hidden ? 0
      : flow.queue.length >= 5 ? 0.35
        : flow.queue.length >= 3 ? 0.55
          : flow.queue.length >= 1 ? 0.8 : 1;
    const after = (ms) => { later(advance, Math.round(ms)); };
    if (step.act === 'clear') { wipeFelt(); after(0); return; }
    if (step.act === 'play') { landCard(step); after(CARD_GAP * rush); return; }
    if (step.act === 'sweep') { sweepTrick(step, rush, after); return; }
    after(0);
  }

  function landCard(step) {
    const where = (step.seat - step.mine + 4) % 4;
    const node = $('div', `blt-play p${where}`,
      `<img alt="${esc(step.card)}" src="${faceSrc(step.card)}">`);
    node.dataset.seat = String(step.seat);
    // The weight of the card in the mode being played. The jack and the nine
    // of the hokum are the two cards a table reacts to out loud, and an ace
    // or a ten is worth a thump of its own.
    const weight = worth(step.card);
    if (weight >= 14) node.classList.add('heavy');
    else if (weight >= 10) node.classList.add('strong');
    el.felt.appendChild(node);
    flow.nodes.push(node);
    if (document.hidden) return;
    if (weight >= 14) {
      play('_slam');
      quake();
      const blast = $('i', `blt-impact p${where}`);
      el.felt.appendChild(blast);
      later(() => blast.remove(), 720);
    } else {
      play('_card');
    }
    // The seat flashes as its card leaves it. Between the card flying in from
    // his side and his face lighting up, there is no guessing who threw.
    const cell = el.seats[POS[where]];
    if (!cell) return;
    cell.box.classList.remove('threw');
    void cell.box.offsetWidth;
    cell.box.classList.add('threw');
    later(() => cell.box.classList.remove('threw'), 620);
  }

  function sweepTrick(step, rush, after) {
    const nodes = flow.nodes;
    flow.nodes = [];
    if (!nodes.length) { after(0); return; }
    const winner = step.winner == null ? step.mine : step.winner;
    const cell = el.seats[POS[(winner - step.mine + 4) % 4]];
    nodes.forEach((node) => {
      if (Number(node.dataset.seat) === winner) node.classList.add('won');
    });
    if (document.hidden) {
      nodes.forEach((node) => node.remove());
      after(0);
      return;
    }

    // Where each card is and where the two moves take it, measured in pixels
    // off the real boxes. Percentages could not do this: the winner's pile is
    // not inside the felt, and the felt itself moves with the orientation.
    const spots = nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { node, x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    const heap = {
      x: spots.reduce((sum, spot) => sum + spot.x, 0) / spots.length,
      y: spots.reduce((sum, spot) => sum + spot.y, 0) / spots.length,
    };
    const home = seatPoint(POS[(winner - step.mine + 4) % 4], 'pile');

    // The last trick of a hand is held longer: the count follows it, and it is
    // the one trick a player wants to look at twice.
    const read = Math.round(TRICK_READ * (step.closing ? 1.5 : 1) * rush);
    const slow = rush < 1 ? 0.8 : 1;
    const gather = Math.round(GATHER_MS * slow);
    const flight = Math.round(FLIGHT_MS * slow);

    later(() => {
      spots.forEach((spot, i) => {
        spot.node.classList.add('moving');
        spot.node.style.setProperty('--move', `${gather}ms`);
        spot.node.style.setProperty('--gx', `${heap.x + (i - 1.5) * 3.4 - spot.x}px`);
        spot.node.style.setProperty('--gy', `${heap.y + (i - 1.5) * 2.2 - spot.y}px`);
        spot.node.style.setProperty('--spin', `${(i - 1.5) * 3.6}deg`);
        // The card that took the trick lies on top of the stack, as it would
        // on a table.
        spot.node.style.zIndex = String(
          Number(spot.node.dataset.seat) === winner ? 9 : 4 + i);
      });
    }, read);

    later(() => {
      play('_trick_win');
      if (cell) {
        cell.box.classList.add('takes');
        later(() => cell.box.classList.remove('takes'), 760);
      }
      spots.forEach((spot, i) => {
        spot.node.style.setProperty('--move', `${flight}ms`);
        spot.node.style.setProperty('--fade', `${Math.round(flight * 0.52)}ms`);
        spot.node.style.setProperty('--gx', `${home.x + (i - 1.5) * 2 - spot.x}px`);
        spot.node.style.setProperty('--gy', `${home.y + (i - 1.5) * 1.4 - spot.y}px`);
        spot.node.style.setProperty('--sc', '.34');
        spot.node.style.opacity = '0';
      });
    }, read + gather + 40);

    const whole = read + gather + 40 + flight;
    later(() => nodes.forEach((node) => node.remove()), whole + 60);
    after(whole + 90);
  }

  /** The room takes the blow. The bars stay still on purpose: a menu that
   *  jumps under a thumb is a menu that gets mis-tapped. */
  function quake() {
    if (!root) return;
    root.classList.remove('quake');
    void root.offsetWidth;
    root.classList.add('quake');
    later(() => root.classList.remove('quake'), 470);
  }

  function wipeFelt() {
    flow.nodes.forEach((node) => node.remove());
    flow.nodes = [];
  }

  function stopFlow() {
    flow.pends.forEach((id) => clearTimeout(id));
    flow.pends.clear();
    flow.queue.length = 0;
    flow.running = false;
    flow.mirror = [];
    wipeFelt();
    if (el.felt) el.felt.querySelectorAll('.blt-play').forEach((node) => node.remove());
  }

  function paintFlip() {
    // Not while the deal is still running: the cards are dealt first and
    // only then is one turned over, which is the order at a real table.
    const card = (table.phase === 'bidding' && !table.dealing) ? table.flipped : null;
    if (!card) { el.flip.hidden = true; el.flip.dataset.card = ''; return; }
    if (el.flip.dataset.card !== card) {
      el.flip.dataset.card = card;
      el.flip.innerHTML = `<img alt="${esc(card)}" src="${faceSrc(card)}">`
        + `<small>${esc(t('ui.flipped'))}</small>`;
    }
    el.flip.hidden = false;
  }

  /* ═══════════ how a hand is held ═══════════

     The server sends the cards sorted its own way, which is one opinion out
     of three. A player wants a different order depending on what he is asking
     the hand: which suit am I long in, what runs am I sitting on, and what
     can actually take a trick. One button walks the three, and the choice is
     remembered on the device.

     Suits are laid out so that two neighbouring blocks are never the same
     colour, and the trump always leads the line: a hand you can read at a
     glance is worth more than a hand you have to study. */

  const suitOf = (card) => String(card).slice(-1);
  const rankOf = (card) => String(card).slice(0, -1);

  function suitLine(trump) {
    const all = ['S', 'H', 'C', 'D'];
    if (!trump) return all;
    const rest = all.filter((suit) => suit !== trump);
    const line = [trump];
    let red = !RED.has(trump);
    while (rest.length) {
      let pick = rest.findIndex((suit) => RED.has(suit) === red);
      if (pick < 0) pick = 0;
      line.push(rest.splice(pick, 1)[0]);
      red = !red;
    }
    return line;
  }

  const trumpSuit = () => (table.mode === 'sun' ? '' : (table.trump || ''));
  const power = (card) =>
    ((suitOf(card) === trumpSuit() ? TRUMP_POWER : PLAIN_POWER)[rankOf(card)] || 0);
  const worth = (card) =>
    ((suitOf(card) === trumpSuit() ? TRUMP_VALUE : PLAIN_VALUE)[rankOf(card)] || 0);

  function orderHand(hand) {
    const trump = trumpSuit();
    const line = suitLine(trump);
    const bySuit = (a, b) => line.indexOf(suitOf(a)) - line.indexOf(suitOf(b));
    const list = [...hand];
    if (sortBy === 'power') {
      // What takes a trick, not what is worth points: a trump seven beats
      // every ace on the table and belongs at the head of the hand.
      list.sort((a, b) =>
        ((suitOf(b) === trump) - (suitOf(a) === trump))
        || (suitOf(a) === trump
          ? power(b) - power(a)
          : (worth(b) - worth(a)) || bySuit(a, b) || (power(b) - power(a))));
      return list;
    }
    if (sortBy === 'run') {
      // Natural sequence inside each suit, so a sira sits together and the
      // king, the queen and the jack are always side by side.
      list.sort((a, b) => bySuit(a, b) || (SEQ.indexOf(rankOf(a)) - SEQ.indexOf(rankOf(b))));
      return list;
    }
    list.sort((a, b) => bySuit(a, b) || (power(b) - power(a)));
    return list;
  }

  /** Where one order ends and the next begins, so the eye finds the blocks. */
  function breaksIn(list) {
    const trump = trumpSuit();
    return list.map((card, index) => {
      if (!index) return false;
      const before = list[index - 1];
      if (sortBy === 'power') return suitOf(before) === trump && suitOf(card) !== trump;
      return suitOf(before) !== suitOf(card);
    });
  }

  function paintHand() {
    // Never while a card is being dragged. A poll landing mid-drag used to
    // rebuild the row and throw away the very node under the thumb, and the
    // card stuck to the screen. That is the drag that felt broken.
    if (drag) { handKey = ''; return; }
    const hand = orderHand(table.hand || []);
    const legal = new Set(table.legal || []);
    const key = `${hand.join('|')}#${[...legal].join('|')}#${easy}#${selected}`
      + `#${table.trump}#${sortBy}`;
    if (key === handKey) return;
    // Which cards are new to this hand. A card that was already here is not
    // dealt again: only what actually arrived flies in.
    const before = held;
    held = new Set(hand);
    const arrived = hand.filter((card) => !before.has(card));
    handKey = key;

    el.hand.innerHTML = '';
    // How many cards, so the stacking order can be written in CSS. The page is
    // right-to-left, so the first card sits on the right and every later one
    // is laid to its left: without a z-index the left card would cover the
    // right one and hide the very corner a player reads, the rank and the suit
    // printed at its top-left. The order here is the order of a real hand.
    el.hand.style.setProperty('--n', String(hand.length));
    el.hand.classList.toggle('easy', easy);
    const myTurn = table.phase === 'playing' && table.turn === table.seat;
    const breaks = breaksIn(hand);
    hand.forEach((card, index) => {
      const spread = index - (hand.length - 1) / 2;
      const button = $('button', 'blt-slot',
        `<img alt="${esc(card)}" src="${faceSrc(card)}">`);
      button.type = 'button';
      button.dataset.card = card;
      // Negative, for the same reason: the fan opens outwards from the middle
      // and index 0 is the rightmost card, not the leftmost.
      button.style.setProperty('--r', `${-spread * 1.6}deg`);
      button.style.setProperty('--i', String(index));
      if (breaks[index]) button.classList.add('sep');
      if (myTurn) button.classList.add('live');
      if (card === selected) button.classList.add('up');
      // Beginner mode alone dims what is barred and frames what belongs to the
      // hokum. With it off every card looks the same, and a wrong throw is
      // refused by the server and costs the player his turn. That is the catch.
      if (easy && myTurn && !legal.has(card)) button.classList.add('no');
      if (easy && table.trump && card.slice(-1) === table.trump) {
        button.classList.add('trump');
        button.appendChild($('i', 'blt-trump-mark', suitIcon(table.trump)));
      }
      el.hand.appendChild(button);
    });
    fitHand();
    // The deal proper, on the ceremony's own clock; the three that follow the
    // bid, on a short one of their own. Anything else — a reconnection, a
    // re-sort — arrives without a flight, because nothing was dealt.
    if (arrived.length && table.dealing) flyIntoHand(arrived, true);
    else if (arrived.length && arrived.length < hand.length) flyIntoHand(arrived, false);
    else el.hand.classList.remove('dealing');
  }

  /**
   * The eight cards arriving one at a time from the shuffled stack.
   *
   * Measured, not guessed: each card is told the distance from the middle of
   * the felt to the place it will finally sit, and it covers that distance on
   * the same clock the rest of the table is dealt on.
   */
  function flyIntoHand(arrived, ceremony) {
    const deck = el.deck.getBoundingClientRect();
    const from = { x: deck.left + deck.width / 2, y: deck.top + deck.height / 2 };
    const wait = ceremony ? Math.max(0, dealtAtMs - performance.now()) : 90;
    const step = ceremony ? 4 * DEAL_STEP : REST_STEP;
    const fresh = new Set(arrived);
    el.hand.classList.add('dealing');
    let order = 0;
    let last = wait;
    [...el.hand.children].forEach((slot) => {
      if (!fresh.has(slot.dataset.card)) {
        // Already in the hand: it stays exactly where it is, with no flight
        // and no delay of its own.
        slot.style.setProperty('--dd', '0ms');
        slot.style.setProperty('--dx', '0px');
        slot.style.setProperty('--dy', '0px');
        slot.classList.add('settled');
        return;
      }
      const box = slot.getBoundingClientRect();
      const delay = wait + order * step;
      order += 1;
      last = delay;
      slot.classList.remove('settled');
      slot.style.setProperty('--dx', `${from.x - (box.left + box.width / 2)}px`);
      slot.style.setProperty('--dy', `${from.y - (box.top + box.height / 2)}px`);
      slot.style.setProperty('--dd', `${Math.round(delay)}ms`);
      // The three that follow the bid are few enough to be heard one by one.
      if (!ceremony) later(() => play('_deal_one'), delay + 90);
    });
    later(() => el.hand.classList.remove('dealing'), last + 700);
  }

  /** Cards as large as the screen allows, and all of them on it. */
  function fitHand() {
    const slots = el.hand && el.hand.children;
    if (!slots || !slots.length) return;
    el.hand.style.setProperty('--fit', '1');
    el.hand.style.setProperty('--pull', String(OPEN_PULL));
    const style = getComputedStyle(el.hand);
    const room = el.hand.clientWidth
      - parseFloat(style.paddingInlineStart || 0)
      - parseFloat(style.paddingInlineEnd || 0);
    const card = slots[0].offsetWidth;
    const count = slots.length;
    if (!room || !card) return;
    // Width of the fan = one whole card, plus the visible sliver of each of
    // the others, plus the small gap that separates one block from the next.
    const gaps = el.hand.querySelectorAll('button.sep').length * 0.1;
    const sliver = count > 1 ? (room / card - 1 - gaps) / (count - 1) : 1;
    let pull = Math.max(OPEN_PULL, 1 - sliver);
    let fit = 1;
    if (pull > TIGHT_PULL) {
      pull = TIGHT_PULL;
      fit = room / (card * (1 + (count - 1) * (1 - TIGHT_PULL) + gaps));
    }
    el.hand.style.setProperty('--pull', pull.toFixed(3));
    el.hand.style.setProperty('--fit', Math.min(1, Math.max(0.5, fit)).toFixed(3));
  }

  function paintActions() {
    const bits = [];
    const seat = table.seat;

    if (table.phase === 'lobby') {
      if (el.actions.dataset.key !== 'lobby') {
        el.actions.dataset.key = 'lobby';
        el.actions.innerHTML = '';
      }
      el.tray.hidden = true;
      return;
    }
    if (seat == null) {
      bits.push(hint(t('ui.spectator')));
    } else if ((table.away || []).includes(seat)) {
      bits.push(button('sitback', t('actions.sit_back'), 'go'));
    } else if (table.dealing) {
      bits.push(hint(t('ui.shuffling'), true));
    } else if (table.phase === 'bidding') {
      bits.push(...bidBar());
    } else if (table.phase === 'doubling') {
      bits.push(...doubleBar());
    } else if (table.phase === 'playing') {
      bits.push(...playBar());
    } else if (table.phase === 'hand_done') {
      bits.push(button('nexthand', t('actions.next_hand'), 'go'));
    }
    if (seat != null) bits.push(button('tray', '', 'icon', icon('chat')));

    const key = bits.map((node) => node.dataset.do || node.textContent).join('|');
    if (el.actions.dataset.key !== key) {
      el.actions.dataset.key = key;
      el.actions.innerHTML = '';
      bits.forEach((node) => el.actions.appendChild(node));
    }
    if (tray && !el.tray.childElementCount) fillTray();
    el.tray.hidden = !tray;
  }

  function fillTray() {
    el.tray.innerHTML = '';
    (sfx.quick.length ? sfx.quick : ['kafo', 'thanks', 'coffee']).forEach((key) => {
      el.tray.appendChild(button(`say:${key}`, t(`say.${key}`)));
    });
    // And words of your own: ready phrases carry a trick, not a conversation.
    el.tray.appendChild($('form', '',
      `<input maxlength="120" placeholder="${esc(t('icons.write'))}"`
      + ` aria-label="${esc(t('icons.message'))}">`
      + `<button type="submit" aria-label="${esc(t('icons.send'))}">${icon('send')}</button>`));
  }

  function bidBar() {
    // A hokum that is still waiting for later speakers. The server says who
    // called it and whether this seat may ashkal; the buttons only follow.
    const standing = table.pendingBid;
    const caller = standing && table.players && table.players[standing.seat]
      ? String(table.players[standing.seat].name || '') : '';
    if (table.turn !== table.seat) {
      return [hint(standing
        ? t('ui.hokum_standing', { name: caller, next: turnName() })
        : t('ui.bid_waiting', { name: turnName() }))];
    }
    if (standing) {
      return [
        hint(t('ui.answer_hokum', { name: caller })),
        button('bid:sun', t('actions.sun')),
        ...(table.canAshkal ? [button('bid:ashkal', t('actions.ashkal'))] : []),
        button('bid:pass', t('actions.pass'), 'go'),
      ];
    }
    if (table.bidRound === 1) {
      const suit = table.flipped ? table.flipped.slice(-1) : '';
      return [
        button('bid:sun', t('actions.sun')),
        button('bid:hokum', t('actions.hokum'), RED.has(suit) ? 'red' : '', suitIcon(suit)),
        ...(table.canAshkal ? [button('bid:ashkal', t('actions.ashkal'))] : []),
        button('bid:pass', t('actions.pass'), 'go'),
      ];
    }
    // Round two is two steps, not one: "hokum thani" is called first and heard,
    // then the suit is chosen and its name is heard. As one step the two calls
    // came out on top of each other.
    //
    // The last man to speak keeps his pass. He used to lose the button
    // entirely — the engine would refuse the call anyway, and between them
    // the hand could never be thrown in. Nobody is made to buy a hand he does
    // not want: if he passes too, it is "waraq", the cards go back, and the
    // next man deals. The button says so before it is pressed.
    const last = table.bidRound === 2 && !table.mode && (table.passes || 0) >= 3;
    if (bidStep !== 'suit') {
      return [
        hint(last ? t('ui.last_caller') : t('ui.your_turn')),
        button('bid2', t('actions.hokum_second'), 'go'),
        button('bid:sun', t('actions.sun')),
        button('bid:pass', last ? t('actions.pass_waraq') : t('actions.pass'),
               last ? 'waraq' : ''),
      ];
    }
    return [
      hint(t('ui.pick_trump')),
      ...SUITS.map((suit) => button(`bid:hokum:${suit}`, '',
        `suit ${RED.has(suit) ? 'red' : ''}`, suitIcon(suit))),
      button('bid2back', t('actions.back')),
    ];
  }

  function doubleBar() {
    if (!table.canDouble) return [hint(t('ui.double_waiting'))];
    const ladder = table.ladder || [];
    return [
      // Gahwa is a wager on the match, not a multiplier, and the button says
      // so before it is pressed rather than after.
      ...(ladder.includes('gahwa') ? [hint(t('ui.gahwa_warn'))] : []),
      ...ladder.map((call) => button(
        `double:${call}`,
        t(`actions.${call === 'double' ? 'double_open' : call}`),
        call === 'gahwa' ? 'gahwa' : 'go')),
      button('double:skip', t('actions.skip')),
    ];
  }

  function playBar() {
    const out = [];
    if (table.canBaloot) {
      out.push(button('baloot', t(easy ? 'actions.baloot_easy' : 'actions.baloot'),
        easy ? 'go' : ''));
    }
    const mine = table.myProjects || [];
    if (table.canDeclare && picking && mine.length > 1) {
      // More than one project in one hand: which of them he shows is his
      // decision, not the machine's. Declaring the lot gives away a hand that
      // a beaten project would have kept hidden.
      return [
        hint(t('ui.pick_project')),
        ...mine.map((item) =>
          button(`declare:${item.kind}`, projectName(item), 'go')),
        button('declare:all', t('actions.declare_all')),
        button('declare:none', t('actions.back')),
      ];
    }
    if (table.canDeclare) {
      const list = mine.map(projectName).join(' + ');
      out.push(button('declare',
        easy ? t('actions.declare_easy', { list }) : t('actions.declare'),
        easy ? 'go' : ''));
    }
    if (table.turn === table.seat) {
      // The seconds sit in the sentence, where they are read without hunting
      // for a ring in a corner.
      const node = hint(t(easy ? 'ui.your_turn_easy' : 'ui.your_turn'));
      node.classList.add('mine');
      node.appendChild($('b', 'blt-count', ''));
      out.push(node);
    } else {
      out.push(hint(t('ui.waiting', { name: turnName() }), true));
    }
    return out;
  }

  /** A project by name: "sira in spades", "a hundred of kings". */
  function projectName(item) {
    const kind = item.kind === 'four' ? 'hundred' : item.kind;
    const word = t(`say.${kind}`) || '';
    if (item.kind === 'four' || item.kind === 'four_hundred') {
      const rank = t(`ranks.${item.rank}`) || '';
      return rank ? `${word} · ${rank}` : word;
    }
    const suit = item.suit ? t(`suits.${item.suit}`) : '';
    return suit ? `${word} · ${suit}` : word;
  }

  function turnName() {
    const player = table.players && table.players[table.turn];
    return player ? String(player.name || '') : '';
  }

  function button(todo, label, cls = '', glyph = '') {
    const node = $('button', `blt-call ${cls}`, glyph + (label ? `<span>${esc(label)}</span>` : ''));
    node.type = 'button';
    node.dataset.do = todo;
    return node;
  }

  function hint(text, quiet) {
    return $('div', `blt-hint ${quiet ? '' : 'warn'}`, esc(text));
  }

  /* ═══════════ the count sheet ═══════════

     What a majlis actually argues about at the end of a hand: how many the
     cards were worth, who took the last trick, what was declared, and what
     the whole thing converted to. Four rows, two columns, one ribbon — read
     right to left, ours on the right where the eye starts.

     Every number is counted up rather than printed, every row arrives after
     the one above it, and the winning side is lit. The point is not the
     decoration: a hand that ends in a flat table is a hand nobody reads. */

  function paintSheet(mine) {
    const done = table.phase === 'hand_done' || table.phase === 'match_done';
    // The last trick is watched to its end before the count is shown: the four
    // cards land, they are read whole, they are drawn to the winner, and only
    // then does the sheet come up. The engine scores the hand the instant the
    // fourth card falls, so without this the count covered the cards that
    // earned it.
    if (!done || busy() || !table.lastHand || sheetClosed === table.handNo) {
      el.sheet.hidden = true;
      el.sheet.dataset.key = '';
      return;
    }
    const key = `${table.handNo}:${table.phase}`;
    if (el.sheet.dataset.key === key) return;
    el.sheet.dataset.key = key;
    buildSheet(mine);
  }

  /** The projects a side put on the table, as chips rather than a number. */
  function chipsOf(hand, team) {
    const out = [];
    Object.entries(hand.declared || {}).forEach(([seat, kinds]) => {
      if (Number(seat) % 2 !== team) return;
      (kinds || []).forEach((kind) => {
        out.push(t(`say.${kind === 'four' ? 'hundred' : kind}`));
      });
    });
    if (hand.baloot != null && hand.baloot % 2 === team) {
      out.push(t('summary.baloot_chip'));
    }
    return out;
  }

  function modeMark() {
    const hand = table.lastHand;
    return hand.mode === 'sun'
      ? `<span class="blt-mode sun">${esc(t('actions.sun'))}</span>`
      : `<span class="blt-mode ${RED.has(hand.trump) ? 'red' : ''}">`
        + `${suitIcon(hand.trump)}${esc(t('actions.hokum'))}</span>`;
  }

  /** A number that will be counted up to, not printed. */
  const num = (value, cls = '') =>
    `<b class="blt-num ${cls}" data-to="${Number(value) || 0}">0</b>`;

  function buildSheet(mine) {
    const hand = table.lastHand;
    const us = mine % 2;
    const them = 1 - us;
    const match = table.phase === 'match_done';

    // Older summaries carried the last trick folded into the card points.
    // Reading both shapes costs one line and saves a table mid-match.
    const taken = hand.taken || hand.raw || [0, 0];
    const land = hand.land || [0, 0];
    const projects = hand.projects || [0, 0];
    const weigh = hand.weigh
      || [0, 1].map((team) => (hand.raw || [0, 0])[team] + projects[team]);
    const gained = hand.gained || [0, 0];
    const winner = gained[us] === gained[them] ? -1 : (gained[us] > gained[them] ? 0 : 1);

    const chips = (team) => {
      const list = chipsOf(hand, team);
      return list.length
        ? `<span class="blt-chips">${list.map((word) =>
          `<i>${esc(word)}</i>`).join('')}</span>`
        : '';
    };

    const rows = [
      ['tricks', t('summary.row_tricks'), taken[us], taken[them], ''],
      ['land', t('summary.row_land'), land[us], land[them], ''],
      ['projects', t('summary.row_projects'), projects[us], projects[them], 'chips'],
      ['points', t('summary.row_points'), weigh[us], weigh[them], 'sum'],
    ];

    const body = rows.map(([mark, label, ourValue, theirValue, kind], i) =>
      `<div class="blt-tally-row ${kind}" style="--k:${i}">`
      + `<div class="side ours">${num(ourValue)}`
      + (kind === 'chips' ? chips(us) : '') + '</div>'
      + `<div class="lab">${icon(mark)}<span>${esc(label)}</span></div>`
      + `<div class="side theirs">${num(theirValue)}`
      + (kind === 'chips' ? chips(them) : '') + '</div>'
      + '</div>').join('');

    const verdict = hand.failed
      ? `<div class="blt-verdict bayla">${icon('spark')}`
        + `<span>${esc(t('summary.verdict_bayla'))}</span></div>`
      : `<div class="blt-verdict">${icon('spark')}`
        + `<span>${esc(t('summary.verdict_win'))}</span></div>`;

    const title = match
      ? t(table.winnerTeam === us ? 'summary.match_won' : 'summary.match_lost')
      : (hand.failed ? t('summary.bayla')
        : t(winner === 0 ? 'summary.hand_ours' : 'summary.hand_theirs'));

    const card = $('div', `blt-card-sheet${match ? ' match' : ''}`,
      `<div class="blt-sheet-head">`
      + `<div class="team ours${winner === 0 ? ' win' : ''}">`
      + `<span>${esc(t('summary.us_short'))}</span>`
      + (winner === 0 ? icon('check', 'tick') : '') + '</div>'
      + `<div class="call">${modeMark()}`
      + (hand.multiplier > 1 ? `<u>&times;${hand.multiplier}</u>` : '') + '</div>'
      + `<div class="team theirs${winner === 1 ? ' win' : ''}">`
      + (winner === 1 ? icon('check', 'tick') : '')
      + `<span>${esc(t('summary.them_short'))}</span></div>`
      + '</div>'
      + `<h3>${esc(title)}</h3>`
      + `<div class="blt-tally">${body}</div>`
      + `<div class="blt-final${winner === 0 ? ' ours-win' : winner === 1 ? ' theirs-win' : ''}">`
      + `<div class="side ours">${num(gained[us], 'big')}</div>`
      + `<div class="lab"><span>${esc(t('summary.result'))}</span></div>`
      + `<div class="side theirs">${num(gained[them], 'big')}</div>`
      + '</div>'
      + verdict
      + `<p class="blt-called">${esc(t('summary.called_by',
        { name: nameOf(hand.declarer) }))}`
      + (hand.ashkalBy != null
        ? ` · ${esc(t('summary.ashkal_by', { name: nameOf(hand.ashkalBy) }))}` : '')
      + ` · ${esc(t('summary.total'))} ${table.scores[us]} — ${table.scores[them]}</p>`
      + (match ? bookTable(us) : ''));

    const actions = match
      ? [button('rematch', t('actions.rematch'), 'go', icon('replay')),
        button('closesheet', t('actions.close'), '', icon('close')),
        button('leave', t('actions.leave'), '', icon('leave'))]
      : [button('nexthand', t('actions.next_hand'), 'go'),
        button('closesheet', t('actions.close'), '', icon('close'))];
    const bar = $('div', 'blt-sheet-actions');
    actions.forEach((node) => bar.appendChild(node));
    card.appendChild(bar);
    // The ground around the sheet closes it too, and says so once.
    card.appendChild($('small', 'blt-tap-hint', esc(t('summary.tap_to_close'))));

    const wrap = $('div', 'blt-sheet-wrap');
    if (match) wrap.appendChild(crest(table.winnerTeam === us));
    wrap.appendChild(card);

    el.sheet.innerHTML = '';
    el.sheet.appendChild(wrap);
    el.sheet.hidden = false;

    // The winning column gets the sparks, and only it.
    if (winner >= 0) {
      const home = card.querySelector(`.blt-final .side.${winner === 0 ? 'ours' : 'theirs'}`);
      if (home) home.appendChild(sparks(10));
    }
    countSheet(card, match, hand, winner === 0);
    // A hiding is not "we won" — it is winning by a street, or a buyer who
    // called a hand and lost it whole.
    const spread = Math.abs((gained[us] || 0) - (gained[them] || 0));
    if (hand.failed || spread >= 12) {
      later(() => shatterTable(hand.failed && spread >= 12 ? 2 : 1), 620);
    }
  }

  /**
   * A hiding: the floor cracks and what was on the table goes over.
   *
   * It fires on a hand won by a wide margin, and hardest on a bayla — the
   * moments a majlis actually makes a noise about. Everything is drawn: five
   * crack lines over the felt and a handful of objects thrown outwards, so it
   * costs one animation frame and no downloads. Anyone who wants his table
   * left alone turns it off in the drawer.
   */
  function shatterTable(force) {
    if (!shatter || !root || document.hidden) return;
    root.classList.add('cracked');
    later(() => root.classList.remove('cracked'), 1100);
    quake();

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'blt-cracks');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    // Cracks run out of the middle, where the trick was, and none of them is
    // straight — a straight crack reads as a drawn line, not as broken ground.
    const seams = [
      'M50 50 L34 22 L28 6', 'M50 50 L74 30 L92 18', 'M50 50 L70 76 L84 96',
      'M50 50 L28 70 L10 88', 'M50 50 L14 46 L2 40',
    ];
    seams.slice(0, force > 1 ? 5 : 3).forEach((line, i) => {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', line);
      path.style.animationDelay = `${i * 70}ms`;
      svg.appendChild(path);
    });
    el.felt.appendChild(svg);
    later(() => svg.remove(), 2500);

    const things = ['cup', 'plate', 'dates', 'cup', 'plate'];
    const count = force > 1 ? 5 : 3;
    for (let i = 0; i < count; i += 1) {
      const shard = $('i', 'blt-shard', icon(things[i % things.length]));
      const side = i % 2 ? 1 : -1;
      shard.style.left = `${28 + (i * 13) % 44}%`;
      shard.style.top = `${34 + (i * 17) % 26}%`;
      shard.style.setProperty('--fx', `${side * (70 + i * 26)}px`);
      shard.style.setProperty('--fy', `${180 + (i % 3) * 70}px`);
      shard.style.setProperty('--spin', `${side * (320 + i * 90)}deg`);
      shard.style.setProperty('--d', `${i * 80}ms`);
      el.felt.appendChild(shard);
      later(() => shard.remove(), 1800 + i * 80);
    }
    play('_slam');
  }

  /** The crown and the wings, for the end of a match and nothing smaller. */
  function crest(won) {
    const box = $('div', `blt-crest ${won ? 'won' : 'lost'}`,
      icon('wings', 'blt-wings')
      + `<i class="blt-crest-crown">${icon('crown')}</i>`
      + `<b>${esc(t(won ? 'summary.win_word' : 'summary.lose_word'))}</b>`);
    if (won) box.appendChild(sparks(14));
    return box;
  }

  /** Points of light thrown outwards. Drawn, not an image: it has to scale
   *  with the sheet and cost nothing to load. */
  function sparks(count) {
    const layer = $('div', 'blt-sparks');
    for (let i = 0; i < count; i += 1) {
      const spark = $('i', '', icon('spark'));
      spark.style.setProperty('--a', `${(360 / count) * i + (i % 3) * 7}deg`);
      spark.style.setProperty('--d', `${i * 46}ms`);
      spark.style.setProperty('--far', `${58 + (i % 4) * 17}px`);
      layer.appendChild(spark);
    }
    return layer;
  }

  /** Every number climbs to its own value, and the table is heard counting. */
  function countSheet(card, match, hand, ours) {
    const cells = [...card.querySelectorAll('.blt-num')];
    // Warmed together: the sheet's own clips are wanted within a second of
    // each other, and a clip fetched at the moment it is needed arrives late.
    ['_row', '_win_hand', '_lose_hand', '_bayla', '_banner'].forEach(buffer);
    play('_sheet');
    cells.forEach((node, index) => {
      const big = node.classList.contains('big');
      const delay = big ? 900 : 260 + Math.floor(index / 2) * 140;
      countUp(node, Number(node.dataset.to) || 0, delay, big ? 620 : 460);
      if (!big && index % 2 === 0) later(() => play('_row'), delay);
    });
    later(() => {
      play(hand.failed ? '_bayla' : ours ? '_win_hand' : '_lose_hand');
    }, 940);
    if (match) later(() => play('_banner'), 1400);
  }

  function countUp(node, to, delay, span) {
    node.textContent = '0';
    const begin = performance.now() + delay;
    const frame = (now) => {
      if (!node.isConnected) return;
      if (now < begin) { requestAnimationFrame(frame); return; }
      const part = Math.min(1, (now - begin) / span);
      const eased = 1 - Math.pow(1 - part, 3);
      node.textContent = String(Math.round(to * eased));
      if (part < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** The match book: one row per hand, so the closing sheet shows the road
   *  travelled and not only the last step. */
  function bookTable(us) {
    const book = table.book || [];
    if (!book.length) return '';
    const stats = table.stats || {};
    const head = `<tr><th>${esc(t('summary.book_hand'))}</th>`
      + `<th>${esc(t('summary.book_call'))}</th>`
      + `<th>${esc(t('summary.book_us'))}</th>`
      + `<th>${esc(t('summary.book_them'))}</th></tr>`;
    const rows = book.map((hand) => {
      const call = hand.mode === 'sun'
        ? t('summary.mode_sun')
        : t('summary.mode_hokum', { suit: t(`suits.${hand.trump}`) });
      const mark = hand.multiplier > 1 ? ` ×${hand.multiplier}` : '';
      return `<tr class="${hand.failed ? 'bayla' : ''}"><td>${hand.handNo}</td>`
        + `<td>${esc(call + mark)}</td>`
        + `<td><b>${hand.scores[us]}</b></td><td><b>${hand.scores[1 - us]}</b></td></tr>`;
    }).join('');
    const tail = '<div class="blt-rows">'
      + `<div><span>${esc(t('summary.hands_played'))}</span><b>${stats.hands || 0}</b></div>`
      + `<div><span>${esc(t('summary.baylas'))}</span>`
      + `<b>${(stats.baylas || [0, 0])[us]} — ${(stats.baylas || [0, 0])[1 - us]}</b></div>`
      + '</div>';
    return `<h4>${esc(t('summary.book_title'))}</h4>`
      + `<table class="blt-book"><thead>${head}</thead><tbody>${rows}</tbody></table>${tail}`;
  }

  function nameOf(seat) {
    const player = table.players && table.players[seat];
    return player ? String(player.name || '') : '';
  }

  /* ═══════════ speech and chat ═══════════ */

  function paintSpeech(mine) {
    (table.speech || []).forEach((line) => {
      if (line.n <= seenSay) return;
      seenSay = line.n;
      const echo = line.seat === table.seat && spoken.delete(line.say);
      if (!echo) play(line.say);
      // "I'm back" carries a made sound under the word, so the table hears
      // something even before the word itself is recorded.
      if (line.say === 'back') play('_back');
      if (line.seat != null) {
        bubble(line.seat, t(`say.${line.say}`), mine, 2200);
      } else if (line.say === 'waraq') {
        // A call that belongs to the table and not to a seat: nobody bought,
        // the cards go back. It is announced in the middle where a bubble
        // over an empty chair would say nothing.
        banner(t('ui.waraq_note') || t('say.waraq'), 2600);
      }
    });
  }

  /**
   * "And this is my sira." A project that is only spoken is a project the
   * table has to take on trust; the engine now sends the cards behind it and
   * they are laid face up in the middle for as long as it takes to read them.
   */
  function paintReveal(mine) {
    const show = table.reveal;
    if (!show || !show.n || show.n <= seenReveal) return;
    seenReveal = show.n;
    if (!root || document.hidden) return;
    const cards = (show.cards || []).filter(Boolean);
    if (!cards.length) return;

    const box = $('div', 'blt-reveal');
    const word = t(`say.${show.kind}`) || '';
    box.innerHTML =
      `<b>${esc(nameOf(show.seat))}${word ? ` · ${esc(word)}` : ''}</b>`
      + `<div class="cards">${cards.map((card, i) =>
        `<img alt="${esc(card)}" src="${faceSrc(card)}" style="--k:${i}">`).join('')}</div>`;
    root.appendChild(box);
    play('_reveal');
    // The declarer says it in his own voice; everyone else hears the call the
    // engine already sent through `speech`.
    if (show.seat === table.seat) play('my_sira');
    later(() => box.classList.add('out'), 2400);
    later(() => box.remove(), 2800);
  }

  function paintChat(room, mine) {
    const log = (room && room.chat) || [];
    log.forEach((line) => {
      if (!line.at || line.at <= seenChat || line.sys) return;
      const seat = table.players.findIndex((p) => p && p.id === line.id);
      if (seat >= 0) bubble(seat, line.text, mine, 4200);
    });
    if (log.length) seenChat = Math.max(seenChat, ...log.map((line) => line.at || 0));
  }

  function bubble(seat, text, mine, life) {
    if (!text) return;
    const cell = el.seats[POS[(seat - mine + 4) % 4]];
    if (!cell) return;
    cell.box.querySelectorAll('.blt-bubble').forEach((node) => node.remove());
    const node = $('div', 'blt-bubble', esc(text));
    cell.box.appendChild(node);
    setTimeout(() => {
      node.classList.add('out');
      setTimeout(() => node.remove(), 300);
    }, life);
  }

  /* ═══════════ the clock ═══════════ */

  /**
   * The turn ring, drawn only where it can be seen.
   *
   * It used to write to all four rings on every animation frame although at
   * most one of them is ever visible, and to write the same value again and
   * again between one visible step and the next. On a phone with three other
   * people in the room that is heat for nothing. Now: the seat whose turn it
   * is, at thirty frames a second, and only when the number has moved enough
   * to be seen.
   */
  function runClock() {
    if (ticking) cancelAnimationFrame(ticking);
    const total = (table.turnSeconds || 10) * 1000;
    const ends = table.turnDeadline;
    const circumference = 2 * Math.PI * RING_R;
    const live = new Set(table.waitingOn || []);
    const mine = table.seat == null ? 0 : table.seat;
    const cells = (table.players || []).map((_, seat) =>
      (live.has(seat) ? el.seats[POS[(seat - mine + 4) % 4]] : null)).filter(Boolean);
    let drawn = -1;
    let last = 0;
    let shown = -1;
    const count = el.actions.querySelector('.blt-count');

    const frame = (now) => {
      const left = ends ? Math.max(0, ends - Date.now()) : 0;
      const part = ends ? Math.min(1, left / total) : 0;
      if (!now || now - last >= 32) {
        last = now || 0;
        const step = Math.round(part * 240);
        if (step !== drawn) {
          drawn = step;
          const offset = String(circumference * (1 - part));
          const hurry = part > 0 && part < 0.34;
          cells.forEach((cell) => {
            cell.run.style.strokeDashoffset = offset;
            cell.box.classList.toggle('hurry', hurry);
          });
        }
        if (count) {
          const seconds = Math.max(0, Math.ceil(left / 1000));
          if (seconds !== shown) { shown = seconds; count.textContent = String(seconds); }
        }
        tickLobby();
      }
      ticking = ends && left > 0 ? requestAnimationFrame(frame) : 0;
    };
    // A seat that has stopped waiting keeps neither ring nor hurry.
    Object.values(el.seats).forEach((cell) => {
      if (cells.includes(cell)) return;
      cell.run.style.strokeDashoffset = String(circumference);
      cell.box.classList.remove('hurry');
    });
    frame(0);
  }

  /* ═══════════ input ═══════════ */

  let drag = null;

  function onDown(event) {
    const slot = event.target.closest('[data-card]');
    if (!slot || !slot.classList.contains('live')) return;
    drag = { card: slot.dataset.card, node: slot,
             x: event.clientX, y: event.clientY,
             dx: 0, dy: 0, moved: false, frame: 0 };
    slot.setPointerCapture?.(event.pointerId);
  }

  /**
   * The card is carried, not nudged.
   *
   * It used to follow the finger upwards only, along one line, which is not
   * how anyone holds a card: you pick it up and you move it where you like,
   * and you let go over the table. So both axes are tracked and the card
   * goes wherever the hand goes.
   *
   * One write for each frame the screen draws, not one for each event the
   * finger sends — a phone sends far more of the second than the first, and
   * the difference was the drag that felt sticky.
   */
  function onMove(event) {
    if (!drag) return;
    drag.dx = event.clientX - drag.x;
    drag.dy = event.clientY - drag.y;
    if (!drag.moved && Math.abs(drag.dx) + Math.abs(drag.dy) < 5) return;
    drag.moved = true;
    if (drag.frame) return;
    drag.frame = requestAnimationFrame(() => {
      if (!drag) return;
      drag.frame = 0;
      drag.node.classList.add('drag');
      drag.node.style.setProperty('--dx', `${Math.round(drag.dx)}px`);
      drag.node.style.setProperty('--dy', `${Math.round(drag.dy)}px`);
    });
  }

  /**
   * A tap shows the card; a pull upwards throws it.
   *
   * Touching a card used to put it straight on the table, which meant a
   * mis-tap cost a trick. Now the first touch only lifts it to be read, and it
   * is played by dragging it up or by tapping the lifted card again, which is
   * also what a mouse expects.
   */
  function onUp(event) {
    if (!drag) return;
    const held = drag;
    if (held.frame) cancelAnimationFrame(held.frame);
    drag = null;
    held.node.classList.remove('drag');
    held.node.style.removeProperty('--dx');
    held.node.style.removeProperty('--dy');
    handKey = '';                       // the row was frozen while dragging
    // Let go anywhere above the fan and the card is on the table. That is the
    // whole rule, and it is the same rule for a finger, a pen and a mouse.
    const row = el.hand ? el.hand.getBoundingClientRect().top : 0;
    const above = event.clientY < row - 6;
    const far = (event.clientY - held.y) <= -DRAG_TO_PLAY;
    if (held.moved && (above || far)) return throwCard(held.node, held.card);
    if (held.moved) { repaint(); return undefined; }   // carried back and dropped
    if (selected === held.card) return throwCard(held.node, held.card);
    selected = held.card;
    repaint();
    return undefined;
  }

  /**
   * The keyboard plays too.
   *
   * A table that only answers a finger is a table half the people who open it
   * cannot use well. The arrows walk the hand the way the eye does — right to
   * left, like the cards themselves — Enter throws, and Escape closes whatever
   * is open.
   */
  function onKey(event) {
    if (!root || root.hidden || !table) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const typing = event.target
      && ((event.target.tagName === 'INPUT') || event.target.isContentEditable);
    if (typing) return;

    if (event.key === 'Escape') {
      if (optsOpen) { optsOpen = false; repaint(); }
      else if (tray) { tray = false; repaint(); }
      else if (!el.sheet.hidden) { sheetClosed = table.handNo; el.sheet.hidden = true; }
      else return;
      event.preventDefault();
      return;
    }

    const hand = orderHand(table.hand || []);
    if (!hand.length) return;
    const myTurn = table.phase === 'playing' && table.turn === table.seat;

    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      // Index 0 is the rightmost card, so the right arrow counts down.
      const step = event.key === 'ArrowRight' ? -1 : 1;
      const at = hand.indexOf(selected);
      const next = at < 0
        ? (step > 0 ? 0 : hand.length - 1)
        : Math.min(hand.length - 1, Math.max(0, at + step));
      selected = hand[next];
      handKey = '';
      repaint();
      event.preventDefault();
      return;
    }

    if ((event.key === 'Enter' || event.key === ' ') && myTurn && selected) {
      const node = el.hand.querySelector(`[data-card="${CSS.escape(selected)}"]`);
      const card = selected;
      selected = '';
      if (node) throwCard(node, card);
      event.preventDefault();
    }
  }

  function throwCard(node, card) {
    const legal = new Set((table && table.legal) || []);
    selected = '';
    if (!table || table.phase !== 'playing' || table.turn !== table.seat) return;
    if (!legal.has(card)) {
      // The server refuses it anyway; this saves the round trip and shows why.
      node.classList.add('wrong');
      setTimeout(() => node.classList.remove('wrong'), 400);
      play('_wrong');
      send('why', { text: t(`why.${(table.why || {})[card]}`) || t('why.illegal') });
      handKey = '';
      repaint();
      return;
    }
    send('card', { card });
  }

  function onClick(event) {
    if (event.target.closest('[data-card]')) return;   // cards are pointer driven
    if (event.target === el.opts) {                    // the ground around the drawer
      optsOpen = false;
      return repaint();
    }
    if (event.target === el.sheet) {                   // the ground around the sheet
      sheetClosed = table.handNo;
      el.sheet.hidden = true;
      return undefined;
    }
    const hit = event.target.closest('[data-do]');
    if (!hit) return;
    const [todo, ...rest] = hit.dataset.do.split(':');

    if (todo === 'easy') {
      easy = !easy;
      write(EASY_KEY, easy ? '1' : '0');
      handKey = '';
      return repaint();
    }
    if (todo === 'mute') {
      muted = !muted;
      write(MUTE_KEY, muted ? '1' : '0');
      if (!muted) { unlock(); play('_card'); }
      return repaint();
    }
    if (todo === 'fx') {
      fxOff = !fxOff;
      write(FX_KEY, fxOff ? '1' : '0');
      if (!fxOff) { unlock(); play('_card'); }
      return repaint();
    }
    if (todo === 'opts') { optsOpen = !optsOpen; return repaint(); }
    if (todo === 'back' || todo === 'face' || todo === 'theme') {
      // A skin is a choice about my own screen, so it is kept on my own
      // device and asks nobody's permission.
      const list = { back: BACKS, face: FACES, theme: THEMES }[todo];
      const want = list.includes(rest[0]) ? rest[0] : list[0];
      if (todo === 'back') { backSkin = want; write(BACK_KEY, want); }
      if (todo === 'face') { faceSkin = want; write(FACE_KEY, want); }
      if (todo === 'theme') { theme = want; write(THEME_KEY, want); root.dataset.theme = want; }
      restyleCards();
      play('_row');
      return repaint();
    }
    if (todo === 'shatter') {
      shatter = !shatter;
      write(SHATTER_KEY, shatter ? '1' : '0');
      el.opts.dataset.key = '';
      return repaint();
    }
    if (todo === 'sort') {
      sortBy = SORTS.includes(rest[0])
        ? rest[0]
        : SORTS[(SORTS.indexOf(sortBy) + 1) % SORTS.length];
      write(SORT_KEY, sortBy);
      handKey = '';
      play('_row');
      return repaint();
    }
    if (todo === 'takeseat') return send('takeseat', { seat: Number(rest[0]) });
    if (todo === 'startmatch') return send('startmatch', {});
    if (todo === 'tray') { tray = !tray; return repaint(); }
    if (todo === 'closesheet') {
      sheetClosed = table.handNo;
      el.sheet.hidden = true;
      return undefined;
    }
    if (todo === 'bid2') {
      bidStep = 'suit';
      speakNow('hokum2');
      return repaint();
    }
    if (todo === 'bid2back') { bidStep = ''; return repaint(); }
    if (todo === 'say') { tray = false; play(rest[0]); return send('say', { text: t(`say.${rest[0]}`) }); }
    if (todo === 'leave' || todo === 'invite' || todo === 'mic') return send(todo, {});
    if (todo === 'bid') {
      // Voiced on the press so the call is heard the instant the button moves.
      bidStep = '';
      speakNow(rest[0] === 'hokum' && rest[1] ? `suit_${rest[1]}` : rest[0]);
      return send('bid', { call: rest[0], suit: rest[1] || null });
    }
    if (todo === 'double') { speakNow(rest[0]); return send('double', { call: rest[0] }); }
    if (todo === 'declare') {
      const mine = table.myProjects || [];
      if (rest[0] === 'none') { picking = false; return repaint(); }
      if (rest[0] === 'all' || !rest[0]) {
        if (!rest[0] && mine.length > 1 && !picking) { picking = true; return repaint(); }
        picking = false;
        return send('declare', {});
      }
      picking = false;
      return send('declare', { kinds: [rest[0]] });
    }
    if (todo === 'stepaway') { optsOpen = false; return send('stepaway', {}); }
    if (todo === 'baloot') { speakNow('baloot'); return send('baloot', {}); }
    if (todo === 'sitback') return send('sitback', {});
    if (todo === 'nexthand' || todo === 'rematch') {
      sheetClosed = 0;
      return send(todo, {});
    }
    return undefined;
  }

  function onSay(event) {
    event.preventDefault();
    const input = event.target.querySelector('input');
    const text = ((input && input.value) || '').trim();
    if (!text) return;
    input.value = '';
    tray = false;
    send('say', { text });
  }

  function repaint() {
    if (table) paint(table, null);
  }

  function reset() {
    handKey = '';
    held = new Set();
    backSkin = pickOne(BACKS, BACK_KEY, 'classic');
    faceSkin = pickOne(FACES, FACE_KEY, 'classic');
    theme = pickOne(THEMES, THEME_KEY, 'majlis');
    seenSay = -1;
    seenChat = 0;
    seenReveal = 0;
    greeted = false;
    dealtAtMs = 0;
    dealtStamp = 0;
    dealtHand = 0;
    lastWinner = null;
    sheetClosed = 0;
    selected = '';
    bidStep = '';
    tray = false;
    optsOpen = false;
    picking = false;
    drag = null;
    spoken.clear();
    voice.line.length = 0;
    voice.busy = false;
    stopFlow();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', unlock, { capture: true });
    document.removeEventListener('touchstart', unlock, { capture: true });
    if (watcher) watcher.disconnect();
    watcher = null;
    if (root) root.remove();
    root = null;
    el = {};
    document.body.classList.remove('blt-playing');
  }

  window.ShahdBaloot = {
    supports: (game) => game === 'baloot',
    /** يوقظ محرّك الصوت بعد أن يقطعه فتح المايك أو رجوع التطبيق من الخلفية. */
    unlockAudio: unlock,
    /** Called by the room's own voice meter, many times a second. */
    voice: (ids) => {
      if (!root || !table) return;
      talking = new Set(ids || []);
      applyTalking();
    },
    mount,
    paint,
    bind: (fn) => { send = fn; },
    reset,
  };
})();
