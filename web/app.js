(function () {
  'use strict';

  const C = window.GameReviewClassifier;
  const ChessCtor = window.Chess;
  const BADGES = window.CHESSCOM_BADGES || {};
  const PIECE_KEYS = ['wp', 'wn', 'wb', 'wr', 'wq', 'wk', 'bp', 'bn', 'bb', 'br', 'bq', 'bk'];

  let state = {
    platform: 'lichess',
    username: '',
    depth: 12,
    lang: 'ru',
    flipped: false,
    games: [],
    activeGame: null,
    sans: [],
    fens: [],
    ply: 0,
    review: null,
    opening: null,
    analyzing: false,
    cancelFlag: false,
    selectedSq: null,
    legalMoves: [],
    sandboxMode: false,
    isLab: false,
    sandboxSans: [],
    sandboxFens: [],
    sandboxPly: 0,
    liveEval: null,
    liveEvalJob: 0,
  };

  const STORAGE_KEY = 'chess-review-settings-v1';
  function loadSavedSettings() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
  }
  function saveSettings(extra = {}) {
    try {
      const saved = loadSavedSettings();
      const payload = {
        ...saved,
        platform: state.platform,
        username: state.username,
        depth: state.depth,
        lang: state.lang,
        flipped: state.flipped,
        lastGamePgn: state.activeGame?.pgn || saved.lastGamePgn || '',
        lastGameWhite: state.activeGame?.white?.name || saved.lastGameWhite || '',
        lastGameBlack: state.activeGame?.black?.name || saved.lastGameBlack || '',
        lastPly: state.ply,
        ...extra,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) { /* Storage may be unavailable or full; keep the app usable. */ }
  }
  const savedSettings = loadSavedSettings();
  if (savedSettings.platform === 'chesscom' || savedSettings.platform === 'lichess') state.platform = savedSettings.platform;
  if (typeof savedSettings.username === 'string') state.username = savedSettings.username;
  if ([10, 14, 18].includes(Number(savedSettings.depth))) state.depth = Number(savedSettings.depth);
  if (savedSettings.lang === 'ru' || savedSettings.lang === 'en') state.lang = savedSettings.lang;
  if (typeof savedSettings.flipped === 'boolean') state.flipped = savedSettings.flipped;

  let sfWorker = null;
  let sfReady = null;
  let pieceImagesCache = null;
  let videoRecording = false;
  let videoCancelFlag = false;

  const el = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensureStockfish() {
    if (sfReady) return sfReady;
    sfReady = new Promise((resolve, reject) => {
      try {
        sfWorker = new Worker('vendor/stockfish-19-single.js');
        let uciOk = false;
        const onInit = (e) => {
          const line = String(e.data || '');
          if (line === 'uciok' && !uciOk) {
            uciOk = true;
            sfWorker.postMessage('setoption name MultiPV value 2');
            sfWorker.postMessage('setoption name Hash value 32');
            sfWorker.postMessage('isready');
          } else if (line === 'readyok') {
            sfWorker.removeEventListener('message', onInit);
            resolve(sfWorker);
          }
        };
        sfWorker.addEventListener('message', onInit);
        sfWorker.addEventListener('error', (err) => reject(err));
        sfWorker.postMessage('uci');
      } catch (err) {
        reject(err);
      }
    });
    return sfReady;
  }


  // GitHub Pages static mode: use public APIs directly from the browser.
  async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  }

  async function fetchLichessGamesStatic(username, max = 20) {
    const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=${max}&pgnInJson=true&evals=1&opening=true`;
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/x-ndjson' } }, 20000);
    if (res.status === 404) throw new Error('Игрок на Lichess не найден');
    if (!res.ok) throw new Error(`Lichess API: HTTP ${res.status}`);
    const raw = await res.text();
    if (/^\\s*<!doctype html|^\\s*<html/i.test(raw)) throw new Error('Lichess вернул HTML вместо PGN/JSON. API недоступно или запрос блокируется.');
    const records = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => { try { return JSON.parse(line); } catch { throw new Error('Некорректный ответ Lichess API'); } });
    return records.map(g => {
      const w = g.players?.white, b = g.players?.black;
      return {
        id: `lichess_${g.id}`, platform: 'lichess', url: `https://lichess.org/${g.id}`,
        createdAt: g.createdAt || Date.now(), speed: g.speed || g.perf || 'standard',
        timeControl: g.clock ? `${Math.round(g.clock.initial / 60)}+${g.clock.increment}` : g.perf || '',
        white: { name: w?.user?.name || 'White', rating: w?.rating || null },
        black: { name: b?.user?.name || 'Black', rating: b?.rating || null },
        winner: g.winner || null, status: g.status || '', opening: g.opening?.name || '',
        pgn: g.pgn || '', moves: g.moves || '', serverAnalysis: Array.isArray(g.analysis) ? g.analysis : null,
      };
    });
  }

  async function fetchChessComGamesStatic(username, max = 20) {
    const user = username.trim().toLowerCase();
    const base = `https://api.chess.com/pub/player/${encodeURIComponent(user)}`;
    const archiveRes = await fetchWithTimeout(`${base}/games/archives`, {}, 12000);
    if (archiveRes.status === 404) throw new Error('Игрок на Chess.com не найден');
    if (!archiveRes.ok) throw new Error(`Chess.com API: HTTP ${archiveRes.status}`);
    const archiveText = await archiveRes.text();
    if (/^\\s*<!doctype html|^\\s*<html/i.test(archiveText)) throw new Error('Chess.com API вернул HTML вместо JSON.');
    let archiveData; try { archiveData = JSON.parse(archiveText); } catch { throw new Error('Chess.com API вернул некорректный JSON.'); }
    const archives = archiveData.archives || [];
    const collected = [];
    for (let i = archives.length - 1; i >= 0 && collected.length < max; i--) {
      const res = await fetchWithTimeout(archives[i], {}, 12000);
      if (!res.ok) continue;
      const monthText = await res.text();
      if (/^\\s*<!doctype html|^\\s*<html/i.test(monthText)) continue;
      let month; try { month = JSON.parse(monthText); } catch { continue; }
      collected.push(...(month.games || []).filter(g => g.rules === 'chess' && g.pgn).reverse());
    }
    return collected.slice(0, max).map((g, idx) => {
      let winner = null;
      if (g.white?.result === 'win') winner = 'white'; else if (g.black?.result === 'win') winner = 'black';
      return {
        id: `chesscom_${g.uuid || idx}_${g.end_time || 0}`, platform: 'chesscom', url: g.url || '',
        createdAt: (g.end_time || 0) * 1000, speed: g.time_class || 'standard', timeControl: g.time_control || '',
        white: { name: g.white?.username || 'White', rating: g.white?.rating || null },
        black: { name: g.black?.username || 'Black', rating: g.black?.rating || null },
        winner, status: winner ? 'decisive' : (g.white?.result || 'draw'), opening: '',
        pgn: g.pgn || '', moves: '', serverAnalysis: null,
      };
    });
  }

  async function fetchExplorerPosition(fen, source = 'masters') {
    const endpoint = source === 'masters' ? 'https://explorer.lichess.ovh/masters' : 'https://explorer.lichess.ovh/lichess';
    const res = await fetchWithTimeout(`${endpoint}?fen=${encodeURIComponent(fen)}&moves=0&topGames=0`, {}, 1800);
    if (!res.ok) throw new Error(`Opening Explorer HTTP ${res.status}`);
    return res.json();
  }

  async function detectBookAndOpeningStatic(fens) {
    const bookFlags = new Array(fens.length).fill(false);
    let opening = null;
    const maxCheck = Math.min(Math.max(0, fens.length - 1), 20);
    for (let i = 1; i <= maxCheck; i++) {
      try {
        const data = await fetchExplorerPosition(fens[i], 'masters');
        if (data.opening?.name) opening = { eco: data.opening.eco || '', name: data.opening.name };
        const count = (data.white || 0) + (data.draws || 0) + (data.black || 0);
        if (count >= 5) bookFlags[i] = true; else break;
      } catch { break; }
    }
    if (!opening && fens.length > 1) {
      for (const idx of [Math.min(fens.length - 1, 8), Math.min(fens.length - 1, 4), 2]) {
        if (idx <= 0 || idx >= fens.length) continue;
        try {
          const data = await fetchExplorerPosition(fens[idx], 'lichess');
          if (data.opening?.name) { opening = { eco: data.opening.eco || '', name: data.opening.name }; break; }
        } catch { }
      }
    }
    return { bookFlags, opening };
  }

  function parseInfoLine(line) {
    const depthMatch = line.match(/\bdepth (\d+)/);
    const pvIdxMatch = line.match(/\bmultipv (\d+)/);
    const cpMatch = line.match(/\bscore cp (-?\d+)/);
    const mateMatch = line.match(/\bscore mate (-?\d+)/);
    const pvMatch = line.match(/\bpv ([a-h][1-8][a-h][1-8][qrbn]?(?:\s+[a-h][1-8][a-h][1-8][qrbn]?)*)/);
    if (!depthMatch || (!cpMatch && !mateMatch)) return null;
    const pvMoves = pvMatch ? pvMatch[1].trim().split(/\s+/).slice(0, 5) : [];
    return {
      depth: Number(depthMatch[1]),
      multipv: pvIdxMatch ? Number(pvIdxMatch[1]) : 1,
      cp: cpMatch ? Number(cpMatch[1]) : null,
      mate: mateMatch ? Number(mateMatch[1]) : null,
      move: pvMoves[0] || null,
      pv: pvMoves,
    };
  }

  function evaluateFen(engine, fen, depth) {
    return new Promise((resolve) => {
      const turn = fen.split(' ')[1] || 'w';
      const sign = turn === 'w' ? 1 : -1;
      const pv1 = { depth: -1, cp: 0, mate: null, move: null, pv: [] };
      const pv2 = { depth: -1, cp: undefined, mate: undefined, move: null, pv: [] };
      let settled = false;

      const finish = (bestFromLine) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        engine.removeEventListener('message', onMsg);
        const bestMove = bestFromLine && bestFromLine !== '(none)' ? bestFromLine : pv1.move;
        resolve({
          cp: pv1.cp,
          mate: pv1.mate,
          bestMove,
          pv: pv1.pv,
          secondMove: pv2.move,
          secondCp: pv2.cp,
          secondMate: pv2.mate,
        });
      };

      const onMsg = (e) => {
        const line = String(e.data || '');
        if (line.startsWith('info ') && !line.includes('lowerbound') && !line.includes('upperbound')) {
          const parsed = parseInfoLine(line);
          if (!parsed) return;
          const target = parsed.multipv === 2 ? pv2 : pv1;
          if (parsed.depth >= target.depth) {
            target.depth = parsed.depth;
            target.cp = parsed.cp !== null ? parsed.cp * sign : null;
            target.mate = parsed.mate !== null ? parsed.mate * sign : null;
            target.move = parsed.move;
            target.pv = parsed.pv;
          }
        } else if (line.startsWith('bestmove ')) {
          finish(line.split(/\s+/)[1]);
        }
      };

      const timer = setTimeout(() => {
        try { engine.postMessage('stop'); } catch {}
        setTimeout(() => finish(pv1.move), 250);
      }, 15000);

      engine.addEventListener('message', onMsg);
      engine.postMessage(`position fen ${fen}`);
      engine.postMessage(`go depth ${depth}`);
    });
  }

  function parseGameMoves(game) {
    const chess = new ChessCtor();
    if (game.pgn) {
      try {
        chess.loadPgn(game.pgn);
        const history = chess.history();
        const c2 = new ChessCtor();
        const fens = [c2.fen()];
        for (const s of history) {
          c2.move(s);
          fens.push(c2.fen());
        }
        return { sans: history, fens };
      } catch {
        // Fallback to moves string
      }
    }
    if (game.moves) {
      const tokens = game.moves.trim().split(/\s+/);
      const sans = [];
      const fens = [chess.fen()];
      for (const t of tokens) {
        const m = chess.move(t);
        if (!m) break;
        sans.push(m.san);
        fens.push(chess.fen());
      }
      return { sans, fens };
    }
    return { sans: [], fens: [chess.fen()] };
  }

  function squareToCoords(sq, flipped) {
    const file = sq.charCodeAt(0) - 97;
    const rank = Number(sq[1]) - 1;
    return {
      col: flipped ? 7 - file : file,
      row: flipped ? rank : 7 - rank,
    };
  }

  function renderPlayers() {
    const g = state.activeGame;
    const wName = g?.white?.name || (state.lang === 'ru' ? 'Белые' : 'White');
    const bName = g?.black?.name || (state.lang === 'ru' ? 'Чёрные' : 'Black');
    const wRat = g?.white?.rating ? `(${g.white.rating})` : '';
    const bRat = g?.black?.rating ? `(${g.black.rating})` : '';

    if (state.flipped) {
      el('topSwatch').className = 'swatch swatch-w';
      el('topName').textContent = wName;
      el('topRating').textContent = wRat;
      el('bottomSwatch').className = 'swatch swatch-b';
      el('bottomName').textContent = bName;
      el('bottomRating').textContent = bRat;
    } else {
      el('topSwatch').className = 'swatch swatch-b';
      el('topName').textContent = bName;
      el('topRating').textContent = bRat;
      el('bottomSwatch').className = 'swatch swatch-w';
      el('bottomName').textContent = wName;
      el('bottomRating').textContent = wRat;
    }

    el('gameMetaTop').textContent = g ? [g.speed, g.timeControl].filter(Boolean).join(' · ') : '';
    renderOpeningBanner();
  }

  function parseOpeningFromPgn(pgn) {
    if (!pgn) return null;
    const eco = pgn.match(/\[ECO\s+"([^"]+)"\]/)?.[1] || '';
    const openingName = pgn.match(/\[Opening\s+"([^"]+)"\]/)?.[1] || '';
    if (openingName) return { eco, name: openingName };
    const ecoUrl = pgn.match(/\[ECOUrl\s+"https?:\/\/[^"]*\/openings\/([^"]+)"\]/)?.[1];
    if (ecoUrl) {
      return { eco, name: decodeURIComponent(ecoUrl).replace(/-/g, ' ') };
    }
    return null;
  }

  function renderOpeningBanner() {
    const banner = el('openingBanner');
    if (!banner) return;
    if (!state.opening?.name) {
      banner.classList.add('hidden');
      banner.innerHTML = '';
      return;
    }
    banner.classList.remove('hidden');
    const ecoHtml = state.opening.eco ? `<span class="opening-eco">${escapeHtml(state.opening.eco)}</span>` : '';
    banner.innerHTML = `${ecoHtml}<span>${escapeHtml(state.opening.name)}</span>`;
  }

  function getActiveFens() {
    return state.sandboxMode ? state.sandboxFens : state.fens;
  }

  function getActivePly() {
    return state.sandboxMode ? state.sandboxPly : state.ply;
  }

  function getCurrentFen() {
    const fens = getActiveFens();
    const ply = getActivePly();
    return fens[ply] || new ChessCtor().fen();
  }

  function formatPvSan(fen, pvUcis) {
    if (!Array.isArray(pvUcis) || !pvUcis.length) return '';
    try {
      const c = new ChessCtor(fen);
      const out = [];
      for (let i = 0; i < Math.min(pvUcis.length, 5); i++) {
        const u = pvUcis[i];
        const moveNo = c.moveNumber();
        const turn = c.turn();
        const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
        if (!m) break;
        out.push(turn === 'w' ? `${moveNo}. ${m.san}` : (i === 0 ? `${moveNo}... ${m.san}` : m.san));
      }
      return out.join(' ');
    } catch {
      return '';
    }
  }

  async function runLiveEval() {
    if (!state.sandboxMode) return;
    const job = ++state.liveEvalJob;
    const fen = getCurrentFen();
    state.liveEval = null;
    renderSandboxBar();
    renderEvalBar();

    try {
      const engine = await ensureStockfish();
      if (job !== state.liveEvalJob || !state.sandboxMode) return;
      const ev = await evaluateFen(engine, fen, Math.min(state.depth, 14));
      if (job !== state.liveEvalJob || !state.sandboxMode) return;
      state.liveEval = {
        ...ev,
        pvSan: formatPvSan(fen, ev.pv),
      };
      renderBoard();
      renderSandboxBar();
    } catch {
      // Ignore cancelled live eval
    }
  }

  function renderSandboxBar() {
    const bar = el('sandboxBar');
    if (!bar) return;
    if (!state.sandboxMode) {
      bar.classList.add('hidden');
      bar.innerHTML = '';
      return;
    }
    bar.classList.remove('hidden');
    const isRu = state.lang === 'ru';
    const title = state.isLab
      ? (isRu ? 'Лаборатория (создание партии)' : 'Lab (Board Editor)')
      : (isRu ? 'Проба варианта' : 'Analysis Variation');
    const evalText = state.liveEval
      ? `${C.formatEvalText(state.liveEval)}${state.liveEval.pvSan ? ` · ${state.liveEval.pvSan}` : ''}`
      : (isRu ? 'Расчёт Stockfish 19...' : 'Calculating Stockfish 19...');

    const backBtn = !state.isLab && state.fens.length > 0
      ? `<button type="button" class="btn btn-sm" id="sbBackBtn">${isRu ? 'Вернуться к партии' : 'Back to game'}</button>`
      : '';
    const analyzeLabBtn = state.isLab && state.sandboxSans.length > 0
      ? `<button type="button" class="btn btn-sm btn-primary" id="sbAnalyzeBtn">${isRu ? 'Обзор партии' : 'Full Review'}</button>`
      : '';

    bar.innerHTML = `
      <div class="sandbox-head">
        <strong>${title}</strong>
        <span class="mono" style="color:var(--accent);">${escapeHtml(evalText)}</span>
      </div>
      <div class="sandbox-actions">
        ${analyzeLabBtn}
        ${backBtn}
        <button type="button" class="btn btn-sm" id="sbFenBtn">FEN</button>
        <button type="button" class="btn btn-sm" id="sbResetBtn">${isRu ? 'Сброс' : 'Reset'}</button>
      </div>
    `;

    el('sbBackBtn')?.addEventListener('click', () => {
      state.sandboxMode = false;
      state.selectedSq = null;
      state.legalMoves = [];
      state.liveEval = null;
      renderBoard();
      renderReview();
      renderSandboxBar();
    });

    el('sbAnalyzeBtn')?.addEventListener('click', () => {
      state.isLab = false;
      state.sandboxMode = false;
      state.sans = [...state.sandboxSans];
      state.fens = [...state.sandboxFens];
      state.ply = 0;
      state.selectedSq = null;
      state.legalMoves = [];
      state.liveEval = null;
      state.activeGame = {
        id: `lab_${Date.now()}`,
        platform: 'lab',
        speed: 'Lab',
        timeControl: '',
        white: { name: 'Белые', rating: null },
        black: { name: 'Чёрные', rating: null },
      };
      renderPlayers();
      renderBoard();
      renderSandboxBar();
      startAnalysis();
    });

    el('sbFenBtn')?.addEventListener('click', () => {
      const cur = getCurrentFen();
      const nextFen = window.prompt(isRu ? 'Текущий FEN (вставьте новый, чтобы загрузить):' : 'Current FEN (paste new to load):', cur);
      if (!nextFen || nextFen.trim() === cur) return;
      try {
        const test = new ChessCtor(nextFen.trim());
        state.isLab = true;
        state.sandboxMode = true;
        state.sandboxSans = [];
        state.sandboxFens = [test.fen()];
        state.sandboxPly = 0;
        state.selectedSq = null;
        state.legalMoves = [];
        renderBoard();
        renderSandboxBar();
        runLiveEval();
      } catch {
        window.alert(isRu ? 'Некорректный FEN' : 'Invalid FEN');
      }
    });

    el('sbResetBtn')?.addEventListener('click', () => {
      enterLab();
    });
  }

  function enterLab() {
    state.cancelFlag = true;
    state.analyzing = false;
    state.isLab = true;
    state.sandboxMode = true;
    state.activeGame = {
      id: `lab_${Date.now()}`,
      platform: 'lab',
      speed: 'Lab',
      timeControl: '',
      white: { name: 'Белые', rating: null },
      black: { name: 'Чёрные', rating: null },
    };
    state.sans = [];
    state.fens = [];
    state.review = null;
    state.opening = null;
    state.sandboxSans = [];
    state.sandboxFens = [new ChessCtor().fen()];
    state.sandboxPly = 0;
    state.selectedSq = null;
    state.legalMoves = [];
    state.liveEval = null;

    renderGamesList();
    renderPlayers();
    renderBoard();
    renderReview();
    renderSandboxBar();
    renderSandboxBar();
    runLiveEval();
  }

  function onSquareClick(sqName) {
    if (state.analyzing || videoRecording) return;
    const fen = getCurrentFen();
    const chess = new ChessCtor(fen);

    if (state.selectedSq) {
      const targetMove = state.legalMoves.find((m) => m.to === sqName);
      if (targetMove) {
        const played = chess.move({ from: targetMove.from, to: targetMove.to, promotion: 'q' });
        if (played) {
          state.selectedSq = null;
          state.legalMoves = [];

          // If in main game and move matches the next game move, just step forward
          if (!state.sandboxMode && state.sans[state.ply] === played.san) {
            goToPly(state.ply + 1);
            return;
          }

          if (!state.sandboxMode) {
            state.sandboxMode = true;
            state.isLab = false;
            state.sandboxSans = state.sans.slice(0, state.ply);
            state.sandboxFens = state.fens.length ? state.fens.slice(0, state.ply + 1) : [new ChessCtor().fen()];
            state.sandboxPly = state.ply;
          } else {
            state.sandboxSans = state.sandboxSans.slice(0, state.sandboxPly);
            state.sandboxFens = state.sandboxFens.slice(0, state.sandboxPly + 1);
          }

          state.sandboxSans.push(played.san);
          state.sandboxFens.push(chess.fen());
          state.sandboxPly = state.sandboxFens.length - 1;

          renderBoard();
          renderSandboxBar();
          runLiveEval();
          return;
        }
      }
    }

    const piece = chess.get(sqName);
    if (piece && piece.color === chess.turn()) {
      if (state.selectedSq === sqName) {
        state.selectedSq = null;
        state.legalMoves = [];
      } else {
        state.selectedSq = sqName;
        state.legalMoves = chess.moves({ square: sqName, verbose: true });
      }
    } else {
      state.selectedSq = null;
      state.legalMoves = [];
    }
    renderBoard();
  }

  function renderBoard() {
    const grid = el('boardGrid');
    const overlay = el('boardOverlay');
    const activeFens = getActiveFens();
    const activePly = getActivePly();
    const fen = activeFens[activePly] || new ChessCtor().fen();
    const chess = new ChessCtor(fen);
    const board = chess.board();
    const curMove = !state.sandboxMode && activePly > 0 && state.review ? state.review.moves[activePly - 1] : null;
    const lastSquares = new Set();
    if (curMove) {
      lastSquares.add(curMove.from);
      lastSquares.add(curMove.to);
    } else if (activePly > 0) {
      const san = state.sandboxMode ? state.sandboxSans[activePly - 1] : state.sans[activePly - 1];
      if (san && activeFens[activePly - 1]) {
        const prev = new ChessCtor(activeFens[activePly - 1]);
        const m = prev.move(san);
        if (m) {
          lastSquares.add(m.from);
          lastSquares.add(m.to);
        }
      }
    }

    const legalTargets = new Set(state.legalMoves.map((m) => m.to));

    // Keep square and piece DOM nodes stable between renders to avoid board flicker.
    if (grid.children.length !== 64) {
      grid.innerHTML = '';
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const sq = document.createElement('div');
          sq.className = 'sq';
          sq.dataset.sq = '';
          grid.appendChild(sq);
        }
      }
    }

    let index = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const boardRow = state.flipped ? 7 - r : r;
        const boardCol = state.flipped ? 7 - c : c;
        const sqName = String.fromCharCode(97 + boardCol) + String(8 - boardRow);
        const isLight = (boardRow + boardCol) % 2 === 0;
        const isLast = lastSquares.has(sqName);
        const isSel = state.selectedSq === sqName;
        const piece = board[boardRow][boardCol];
        const pieceKey = piece ? `${piece.color}${piece.type}` : '';
        const sqEl = grid.children[index++];
        sqEl.className = `sq ${isLight ? 'light' : 'dark'}${isLast ? ' last' : ''}${isSel ? ' selected' : ''}`;
        sqEl.dataset.sq = sqName;
        sqEl.onclick = () => onSquareClick(sqName);

        // Coordinates are static for the square; only rebuild when needed.
        const coordRank = c === 0 ? `<span class="coord-rank">${8 - boardRow}</span>` : '';
        const coordFile = r === 7 ? `<span class="coord-file">${String.fromCharCode(97 + boardCol)}</span>` : '';
        const legalHtml = legalTargets.has(sqName)
          ? (piece ? '<span class="legal-capture"></span>' : '<span class="legal-dot"></span>')
          : '';
        const previousPiece = sqEl.dataset.piece || '';
        const previousLegal = sqEl.dataset.legal || '';
        const previousCoords = sqEl.dataset.coords || '';
        const coordsKey = `${coordRank}${coordFile}`;
        if (previousPiece !== pieceKey || previousLegal !== legalHtml || previousCoords !== coordsKey) {
          sqEl.innerHTML = `${coordRank}${coordFile}${pieceKey ? `<div class="sq-piece"><img src="assets/pieces/${pieceKey}.png" alt="${pieceKey}" draggable="false" /></div>` : ''}${legalHtml}`;
          sqEl.dataset.piece = pieceKey;
          sqEl.dataset.legal = legalHtml;
          sqEl.dataset.coords = coordsKey;
        }
      }
    }

    // Overlay: badge + best move arrow
    overlay.innerHTML = '';
    const arrowUci = state.sandboxMode
      ? state.liveEval?.bestMove
      : (curMove && curMove.bestUci && curMove.bestUci !== curMove.uci && ['inaccuracy', 'mistake', 'miss', 'blunder'].includes(curMove.category) ? curMove.bestUci : null);

    if (arrowUci) {
      const p1 = squareToCoords(arrowUci.slice(0, 2), state.flipped);
      const p2 = squareToCoords(arrowUci.slice(2, 4), state.flipped);
      const x1 = (p1.col + 0.5) * 12.5;
      const y1 = (p1.row + 0.5) * 12.5;
      const x2 = (p2.col + 0.5) * 12.5;
      const y2 = (p2.row + 0.5) * 12.5;
      overlay.innerHTML += `
        <svg class="board-arrows" viewBox="0 0 100 100">
          <defs>
            <marker id="web-arrow" markerWidth="4" markerHeight="4" refX="2.5" refY="2" orient="auto">
              <polygon points="0 0, 4 2, 0 4" fill="rgba(129, 182, 76, 0.9)" />
            </marker>
          </defs>
          <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(129, 182, 76, 0.85)" stroke-width="1.9" stroke-linecap="round" marker-end="url(#web-arrow)" />
        </svg>
      `;
    }

    if (curMove) {
      const cat = C.CATEGORIES[curMove.category];
      if (cat) {
        const { col, row } = squareToCoords(curMove.to, state.flipped);
        const badge = document.createElement('div');
        badge.className = 'board-badge';
        badge.style.left = `${(col + 1) * 12.5}%`;
        badge.style.top = `${row * 12.5}%`;
        badge.dataset.symbol = cat.symbol;
        badge.innerHTML = BADGES[curMove.category] || cat.symbol;
        overlay.appendChild(badge);
      }
    }

    renderEvalBar();
  }

  function renderEvalBar() {
    const fill = el('evalBarFill');
    const topLbl = el('evalTop');
    const botLbl = el('evalBottom');

    let ev = { cp: 0, mate: null };
    if (state.sandboxMode && state.liveEval) {
      ev = state.liveEval;
    } else if (!state.sandboxMode && state.review) {
      if (state.ply === 0 && state.review.moves[0]) ev = state.review.moves[0].evalBefore;
      else if (state.ply > 0 && state.review.moves[state.ply - 1]) ev = state.review.moves[state.ply - 1].evalAfter;
    }

    const winW = C.evalToWinPercent(ev, 'w');
    const txt = C.formatEvalText(ev);
    fill.style.height = `${winW}%`;
    if (winW >= 50) {
      topLbl.textContent = '';
      botLbl.textContent = txt;
    } else {
      botLbl.textContent = '';
      topLbl.textContent = txt;
    }
  }

  function renderReview() {
    const isRu = state.lang === 'ru';
    el('lblWhite').textContent = isRu ? 'Белые' : 'White';
    el('lblBlack').textContent = isRu ? 'Чёрные' : 'Black';

    if (state.analyzing) {
      el('reviewEmpty').classList.add('hidden');
      el('reviewProgress').classList.remove('hidden');
      el('reviewBody').classList.add('hidden');
      el('analyzeBtn').classList.add('hidden');
      el('cancelBtn').classList.remove('hidden');
      return;
    }

    el('cancelBtn').classList.add('hidden');
    el('analyzeBtn').classList.remove('hidden');
    el('analyzeBtn').disabled = state.sans.length === 0;
    el('reviewProgress').classList.add('hidden');

    if (!state.review) {
      el('reviewEmpty').classList.remove('hidden');
      el('reviewBody').classList.add('hidden');
      return;
    }

    el('reviewEmpty').classList.add('hidden');
    el('reviewBody').classList.remove('hidden');

    const r = state.review;
    el('accWhite').textContent = `${r.accuracy.w.toFixed(1)}%`;
    el('accBlack').textContent = `${r.accuracy.b.toFixed(1)}%`;

    // Graph
    const w = 360;
    const h = 76;
    const pts = [{ x: 0, y: h * (1 - C.evalToWinPercent(r.moves[0]?.evalBefore, 'w') / 100) }];
    r.moves.forEach((m, i) => {
      pts.push({
        x: ((i + 1) / r.moves.length) * w,
        y: h * (1 - C.evalToWinPercent(m.evalAfter, 'w') / 100),
        cat: m.category,
      });
    });
    const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L${w},${h} L0,${h} Z`;
    const curX = r.moves.length ? (state.ply / r.moves.length) * w : 0;
    const dots = pts
      .filter((p) => ['brilliant', 'great', 'mistake', 'miss', 'blunder'].includes(p.cat))
      .map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.7" fill="${C.CATEGORIES[p.cat].color}" />`)
      .join('');

    el('graphBox').innerHTML = `
      <svg class="graph-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <rect width="${w}" height="${h}" fill="#141513" />
        <path d="${areaPath}" fill="rgba(240,239,233,0.85)" />
        <line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="rgba(128,128,128,0.4)" stroke-width="0.8" stroke-dasharray="2,2" />
        <path d="${linePath}" fill="none" stroke="#26c2a3" stroke-width="1.3" />
        ${dots}
        <line x1="${curX.toFixed(1)}" y1="0" x2="${curX.toFixed(1)}" y2="${h}" stroke="#f7c631" stroke-width="1.5" />
      </svg>
    `;

    // Move explanation card
    const curMove = state.ply > 0 ? r.moves[state.ply - 1] : null;
    if (!curMove) {
      el('moveExplain').innerHTML = `<div class="muted">${isRu ? 'Начальная позиция. Выберите ход в списке или на графике.' : 'Starting position. Select a move below.'}</div>`;
    } else {
      const cat = C.CATEGORIES[curMove.category];
      const prefix = curMove.color === 'w' ? `${curMove.moveNumber}.` : `${curMove.moveNumber}...`;
      const pvHtml = curMove.bestLineSan && ['inaccuracy', 'mistake', 'miss', 'blunder', 'brilliant', 'great'].includes(curMove.category)
        ? `<div class="move-pv mono">${isRu ? 'Лучшая линия:' : 'Best line:'} ${escapeHtml(curMove.bestLineSan)}</div>`
        : '';
      el('moveExplain').innerHTML = `
        <span class="badge-pill" data-symbol="${cat.symbol}">${BADGES[curMove.category] || cat.symbol}</span>
        <div style="flex:1;min-width:0;">
          <div class="move-explain-head">
            <span>${prefix} ${escapeHtml(curMove.san)} — ${isRu ? cat.labelRu : cat.labelEn}</span>
            <span class="muted mono">${C.formatEvalText(curMove.evalAfter)}</span>
          </div>
          <div class="move-explain-text">${escapeHtml(curMove.comment)}</div>
          ${pvHtml}
        </div>
      `;
    }

    // Moves table
    let tableHtml = '';
    for (let i = 0; i < r.moves.length; i += 2) {
      const wm = r.moves[i];
      const bm = r.moves[i + 1];
      const renderCell = (m) => {
        if (!m) return '<div></div>';
        const notable = ['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder'].includes(m.category);
        const badge = notable
          ? `<span class="inline-badge">${BADGES[m.category] || C.CATEGORIES[m.category].symbol}</span>`
          : '';
        return `<div class="move-cell${state.ply === m.ply ? ' active' : ''}" data-ply="${m.ply}"><span>${escapeHtml(m.san)}</span>${badge}</div>`;
      };
      tableHtml += `<div class="move-num">${wm.moveNumber}.</div>${renderCell(wm)}${renderCell(bm)}`;
    }
    el('movesTable').innerHTML = tableHtml;
    el('movesTable').querySelectorAll('.move-cell').forEach((cell) => {
      cell.addEventListener('click', () => goToPly(Number(cell.getAttribute('data-ply'))));
    });

    // Stats grid
    el('statsGrid').innerHTML = C.CATEGORY_ORDER
      .filter((id) => r.counts.w[id] > 0 || r.counts.b[id] > 0)
      .map((id) => {
        const cat = C.CATEGORIES[id];
        return `
          <div class="stat-row" data-cat="${id}">
            <span class="stat-dot">${BADGES[id] || cat.symbol}</span>
            <span>${isRu ? cat.labelRu : cat.labelEn}</span>
            <span class="stat-num mono">${r.counts.w[id]}</span>
            <span class="stat-num mono">${r.counts.b[id]}</span>
          </div>
        `;
      })
      .join('');

    el('statsGrid').querySelectorAll('.stat-row').forEach((row) => {
      row.addEventListener('click', () => jumpToCategory(row.getAttribute('data-cat')));
    });
  }

  function jumpToCategory(catId) {
    if (!state.review) return;
    const moves = state.review.moves;
    for (let off = 1; off <= moves.length; off++) {
      const idx = (state.ply - 1 + off + moves.length) % moves.length;
      if (moves[idx].category === catId) {
        goToPly(idx + 1);
        return;
      }
    }
  }

  function goToPly(nextPly) {
    state.selectedSq = null;
    state.legalMoves = [];
    if (state.sandboxMode) {
      state.sandboxPly = Math.max(0, Math.min(state.sandboxFens.length - 1, nextPly));
      renderBoard();
      renderSandboxBar();
      runLiveEval();
      return;
    }
    state.ply = Math.max(0, Math.min(state.fens.length - 1, nextPly));
    saveSettings();
    renderBoard();
    renderReview();
  }

  function selectGame(game, autoRun = true) {
    state.cancelFlag = true;
    state.analyzing = false;
    state.sandboxMode = false;
    state.isLab = false;
    state.selectedSq = null;
    state.legalMoves = [];
    state.liveEval = null;
    state.activeGame = game;
    saveSettings();
    const { sans, fens } = parseGameMoves(game);
    state.sans = sans;
    state.fens = fens;
    state.ply = 0;
    state.review = null;
    state.opening = game.opening
      ? { eco: parseOpeningFromPgn(game.pgn)?.eco || '', name: game.opening }
      : parseOpeningFromPgn(game.pgn);

    // Auto-orient board to searched player if playing black
    if (state.username && game.black?.name?.toLowerCase() === state.username.toLowerCase()) {
      state.flipped = true;
    } else {
      state.flipped = false;
    }

    renderGamesList();
    renderPlayers();
    renderBoard();
    renderReview();
    renderSandboxBar();

    if (!state.opening && fens.length > 1) {
      detectBookAndOpeningStatic(fens.slice(0, 16))
        .then((d) => {
          if (state.activeGame?.id === game.id && d.opening?.name) {
            state.opening = d.opening;
            renderOpeningBanner();
          }
        })
        .catch(() => {});
    }

    if (autoRun && sans.length > 0) {
      startAnalysis();
    }
  }

  async function startAnalysis() {
    if (state.analyzing || !state.sans.length) return;
    state.analyzing = true;
    state.cancelFlag = false;
    renderReview();

    try {
      const engine = await ensureStockfish();
      engine.postMessage('ucinewgame');
      const evals = new Array(state.fens.length);

      for (let i = 0; i < state.fens.length; i++) {
        if (state.cancelFlag) return;
        evals[i] = await evaluateFen(engine, state.fens[i], state.depth);
        el('progressNums').textContent = `${i + 1} / ${state.fens.length}`;
        el('progressFill').style.width = `${Math.round(((i + 1) / state.fens.length) * 100)}%`;
      }

      if (state.cancelFlag) return;
      state.analyzing = false;
      state.review = C.analyzeGame({ Chess: ChessCtor, sans: state.sans, evals, lang: state.lang });
      renderBoard();
      renderReview();

      // Background book detection
      detectBookAndOpeningStatic(state.fens)
        .then((d) => {
          if (state.cancelFlag) return;
          if (d.opening?.name && !state.opening?.name) {
            state.opening = d.opening;
            renderOpeningBanner();
          }
          if (!Array.isArray(d.bookFlags)) return;
          let changed = false;
          d.bookFlags.forEach((b, idx) => {
            if (b && evals[idx]) { evals[idx].isBook = true; changed = true; }
          });
          if (changed) {
            state.review = C.analyzeGame({ Chess: ChessCtor, sans: state.sans, evals, lang: state.lang });
            renderBoard();
            renderReview();
          }
        })
        .catch(() => {});
    } catch (err) {
      state.analyzing = false;
      el('reviewEmpty').textContent = `Ошибка анализа: ${err.message || err}`;
      el('reviewEmpty').classList.remove('hidden');
      renderReview();
    }
  }

  function renderGamesList() {
    const list = el('gamesList');
    if (!state.games.length) {
      list.innerHTML = '';
      return;
    }
    const uLower = state.username.toLowerCase();
    list.innerHTML = state.games.map((g, idx) => {
      const isActive = state.activeGame?.id === g.id;
      const wName = g.white?.name || 'White';
      const bName = g.black?.name || 'Black';
      const wRat = g.white?.rating ? ` (${g.white.rating})` : '';
      const bRat = g.black?.rating ? ` (${g.black.rating})` : '';

      let resText = '½–½';
      let resCls = 'draw';
      if (g.winner === 'white') {
        resText = '1–0';
        resCls = uLower && wName.toLowerCase() === uLower ? 'win' : (uLower && bName.toLowerCase() === uLower ? 'loss' : 'win');
      } else if (g.winner === 'black') {
        resText = '0–1';
        resCls = uLower && bName.toLowerCase() === uLower ? 'win' : (uLower && wName.toLowerCase() === uLower ? 'loss' : 'win');
      }

      const dateStr = g.createdAt ? new Date(g.createdAt).toLocaleDateString('ru-RU') : '';
      return `
        <button type="button" class="game-item${isActive ? ' active' : ''}" data-idx="${idx}">
          <div>
            <div class="game-players">${escapeHtml(wName)}${wRat} vs ${escapeHtml(bName)}${bRat}</div>
            <div class="game-meta mono">${escapeHtml(g.speed)} · ${escapeHtml(g.timeControl)} · ${dateStr}</div>
          </div>
          <span class="game-result mono ${resCls}">${resText}</span>
        </button>
      `;
    }).join('');

    list.querySelectorAll('.game-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-idx'));
        if (state.games[idx]) selectGame(state.games[idx], true);
      });
    });
  }

  async function searchPlayerGames(e) {
    e.preventDefault();
    const username = el('usernameInput').value.trim();
    if (!username) return;
    state.username = username;
    saveSettings();
    el('gamesStatus').textContent = 'Загрузка...';
    el('searchBtn').disabled = true;

    try {
      state.games = state.platform === 'lichess'
        ? await fetchLichessGamesStatic(username, 20)
        : await fetchChessComGamesStatic(username, 20);
      el('gamesStatus').textContent = state.games.length
        ? `Найдено: ${state.games.length}`
        : 'Партии не найдены';
      renderGamesList();
      if (state.games.length > 0) {
        selectGame(state.games[0], false);
      }
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'Запрос к API истёк по времени' : (err.message || 'Ошибка загрузки');
      el('gamesStatus').textContent = msg.includes('Failed to fetch')
        ? 'API недоступно из браузера (CORS/сеть). Попробуйте PGN вручную.'
        : msg;
    } finally {
      el('searchBtn').disabled = false;
    }
  }

  // Event bindings
  document.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.platform = btn.getAttribute('data-platform');
      saveSettings();
    });
  });

  el('searchForm').addEventListener('submit', searchPlayerGames);
  el('depthSelect').addEventListener('change', (e) => { state.depth = Number(e.target.value); saveSettings(); });
  el('langSelect').addEventListener('change', (e) => {
    state.lang = e.target.value;
    saveSettings();
    if (state.review) {
      const evals = [state.review.moves[0]?.evalBefore, ...state.review.moves.map((m) => m.evalAfter)];
      state.review = C.analyzeGame({ Chess: ChessCtor, sans: state.sans, evals, lang: state.lang });
      renderReview();
    }
    renderPlayers();
  });

  el('btnFirst').addEventListener('click', () => goToPly(0));
  el('btnPrev').addEventListener('click', () => goToPly(getActivePly() - 1));
  el('btnNext').addEventListener('click', () => goToPly(getActivePly() + 1));
  el('btnLast').addEventListener('click', () => goToPly(getActiveFens().length - 1));
  el('btnFlip').addEventListener('click', () => {
    state.flipped = !state.flipped;
    saveSettings();
    renderPlayers();
    renderBoard();
  });

  async function ensureCanvasAssets() {
    if (pieceImagesCache) return pieceImagesCache;
    const pieceEntries = await Promise.all(
      PIECE_KEYS.map((key) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve([key, img]);
        img.onerror = () => resolve([key, null]);
        img.src = `assets/pieces/${key}.png`;
      }))
    );
    const badgeEntries = await Promise.all(
      Object.entries(BADGES).map(([key, svg]) => new Promise((resolve) => {
        const sizedSvg = svg.replace('<svg ', '<svg width="72" height="74" ');
        const url = URL.createObjectURL(new Blob([sizedSvg], { type: 'image/svg+xml;charset=utf-8' }));
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve([key, img]); };
        img.onerror = () => { URL.revokeObjectURL(url); resolve([key, null]); };
        img.src = url;
      }))
    );
    pieceImagesCache = {
      pieces: Object.fromEntries(pieceEntries),
      badges: Object.fromEntries(badgeEntries),
    };
    return pieceImagesCache;
  }

  function renderFrameToCanvas(ctx, width, height, ply, assets) {
    const padX = Math.round(width * 0.035);
    const headerH = Math.round(height * 0.055);
    const footerH = Math.round(height * 0.055);
    const boardSize = Math.min(width - padX * 2, height - headerH - footerH);
    const boardX = Math.round((width - boardSize) / 2);
    const boardY = headerH;
    const sqSize = boardSize / 8;
    const fontSize = Math.round(width * 0.022);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#141513';
    ctx.fillRect(0, 0, width, height);

    const g = state.activeGame;
    const wName = g?.white?.name || 'Белые';
    const bName = g?.black?.name || 'Чёрные';
    const wRat = g?.white?.rating ? ` (${g.white.rating})` : '';
    const bRat = g?.black?.rating ? ` (${g.black.rating})` : '';
    const topLabel = state.flipped ? `${wName}${wRat}` : `${bName}${bRat}`;
    const botLabel = state.flipped ? `${bName}${bRat}` : `${wName}${wRat}`;

    const curMove = ply > 0 && state.review ? state.review.moves[ply - 1] : null;
    const ev = curMove
      ? curMove.evalAfter
      : (ply === 0 && state.review?.moves[0] ? state.review.moves[0].evalBefore : { cp: 0, mate: null });
    const evalTxt = state.review ? C.formatEvalText(ev) : '';

    ctx.font = `600 ${fontSize}px "Plus Jakarta Sans", sans-serif`;
    ctx.fillStyle = '#ecebe7';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(topLabel, boardX, headerH / 2);
    if (evalTxt) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#26c2a3';
      ctx.fillText(evalTxt, boardX + boardSize, headerH / 2);
    }

    const fen = state.fens[ply] || new ChessCtor().fen();
    const chess = new ChessCtor(fen);
    const board = chess.board();

    const lastSquares = new Set();
    if (curMove) {
      lastSquares.add(curMove.from);
      lastSquares.add(curMove.to);
    } else if (ply > 0 && state.sans[ply - 1]) {
      const prev = new ChessCtor(state.fens[ply - 1]);
      const m = prev.move(state.sans[ply - 1]);
      if (m) {
        lastSquares.add(m.from);
        lastSquares.add(m.to);
      }
    }

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const bRow = state.flipped ? 7 - r : r;
        const bCol = state.flipped ? 7 - c : c;
        const sqName = String.fromCharCode(97 + bCol) + String(8 - bRow);
        const isLight = (bRow + bCol) % 2 === 0;
        const isLast = lastSquares.has(sqName);
        ctx.fillStyle = isLast
          ? (isLight ? '#f5f682' : '#b9ca43')
          : (isLight ? '#ebecd0' : '#739552');
        const x = boardX + c * sqSize;
        const y = boardY + r * sqSize;
        ctx.fillRect(x, y, sqSize + 0.5, sqSize + 0.5);

        const piece = board[bRow][bCol];
        if (piece) {
          const img = assets.pieces[`${piece.color}${piece.type}`];
          if (img) ctx.drawImage(img, x + sqSize * 0.05, y + sqSize * 0.05, sqSize * 0.9, sqSize * 0.9);
        }
      }
    }

    // Best move arrow on mistakes/blunders
    if (
      curMove?.bestUci &&
      curMove.bestUci !== curMove.uci &&
      ['inaccuracy', 'mistake', 'miss', 'blunder'].includes(curMove.category)
    ) {
      const p1 = squareToCoords(curMove.bestUci.slice(0, 2), state.flipped);
      const p2 = squareToCoords(curMove.bestUci.slice(2, 4), state.flipped);
      const x1 = boardX + (p1.col + 0.5) * sqSize;
      const y1 = boardY + (p1.row + 0.5) * sqSize;
      const x2 = boardX + (p2.col + 0.5) * sqSize;
      const y2 = boardY + (p2.row + 0.5) * sqSize;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = sqSize * 0.25;

      ctx.save();
      ctx.strokeStyle = 'rgba(129, 182, 76, 0.88)';
      ctx.fillStyle = 'rgba(129, 182, 76, 0.88)';
      ctx.lineWidth = Math.max(5, sqSize * 0.095);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2 - Math.cos(angle) * headLen * 0.5, y2 - Math.sin(angle) * headLen * 0.5);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Chess.com SVG classification badge on canvas
    if (curMove && C.CATEGORIES[curMove.category]) {
      const cat = C.CATEGORIES[curMove.category];
      const { col, row } = squareToCoords(curMove.to, state.flipped);
      const badgeSize = sqSize * 0.42;
      const bx = boardX + (col + 1) * sqSize - badgeSize * 0.72;
      const by = boardY + row * sqSize - badgeSize * 0.22;
      const bImg = assets.badges[curMove.category];
      if (bImg) {
        ctx.drawImage(bImg, bx, by, badgeSize, badgeSize * (18.5 / 18));
      }
    }

    // Footer: bottom player + move info
    ctx.font = `600 ${fontSize}px "Plus Jakarta Sans", sans-serif`;
    ctx.fillStyle = '#ecebe7';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(botLabel, boardX, boardY + boardSize + footerH / 2);

    if (curMove) {
      const cat = C.CATEGORIES[curMove.category];
      const prefix = curMove.color === 'w' ? `${curMove.moveNumber}.` : `${curMove.moveNumber}...`;
      const moveLabel = `${prefix} ${curMove.san} (${state.lang === 'ru' ? cat.labelRu : cat.labelEn})`;
      ctx.textAlign = 'right';
      ctx.fillStyle = cat.color;
      ctx.fillText(moveLabel, boardX + boardSize, boardY + boardSize + footerH / 2);
    }
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function savePositionPng() {
    const assets = await ensureCanvasAssets();
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1200;
    const ctx = canvas.getContext('2d');
    renderFrameToCanvas(ctx, canvas.width, canvas.height, state.ply, assets);
    canvas.toBlob((blob) => {
      if (blob) triggerDownload(blob, `chess-position-ply-${state.ply}.png`);
    }, 'image/png');
  }

  async function recordGameVideo() {
    const btn = el('btnMakeVideo');
    if (videoRecording) {
      videoCancelFlag = true;
      return;
    }
    if (!state.fens.length || typeof MediaRecorder === 'undefined') return;

    videoRecording = true;
    videoCancelFlag = false;
    btn.textContent = 'Стоп...';

    try {
      const assets = await ensureCanvasAssets();
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1200;
      const ctx = canvas.getContext('2d');

      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
        .find((m) => MediaRecorder.isTypeSupported(m)) || '';
      const stream = canvas.captureStream(60);
      const opts = { videoBitsPerSecond: 6000000 };
      if (mime) opts.mimeType = mime;
      const recorder = new MediaRecorder(stream, opts);
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

      const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
      recorder.start(100);

      for (let i = 0; i < state.fens.length; i++) {
        if (videoCancelFlag) break;
        btn.textContent = `Видео ${i + 1}/${state.fens.length}`;
        renderFrameToCanvas(ctx, canvas.width, canvas.height, i, assets);
        const cat = i > 0 && state.review ? state.review.moves[i - 1]?.category : null;
        const holdMs = ['brilliant', 'great', 'blunder'].includes(cat) || i === state.fens.length - 1 ? 950 : 520;
        await new Promise((r) => setTimeout(r, holdMs));
      }

      recorder.stop();
      await stopped;

      if (!videoCancelFlag && chunks.length) {
        const blob = new Blob(chunks, { type: mime || 'video/webm' });
        triggerDownload(blob, `chess-game-${Date.now()}.webm`);
      }
    } finally {
      videoRecording = false;
      videoCancelFlag = false;
      btn.textContent = 'Видео';
    }
  }

  async function copyGamePgn() {
    const activeSans = state.sandboxMode ? state.sandboxSans : state.sans;
    if (!activeSans.length && !state.sandboxMode) return;
    let pgn = !state.sandboxMode ? (state.activeGame?.pgn || '') : '';
    if (!pgn) {
      const startFen = (state.sandboxMode ? state.sandboxFens[0] : state.fens[0]) || new ChessCtor().fen();
      const c = new ChessCtor(startFen);
      for (const s of activeSans) c.move(s);
      pgn = c.pgn();
    }
    try {
      await navigator.clipboard.writeText(pgn);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = pgn;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const btn = el('btnCopyPgn');
    const prev = btn.textContent;
    btn.textContent = 'Скопировано';
    setTimeout(() => { btn.textContent = prev; }, 1500);
  }

  el('btnCopyPgn').addEventListener('click', copyGamePgn);
  el('btnSavePng').addEventListener('click', savePositionPng);
  el('btnMakeVideo').addEventListener('click', recordGameVideo);

  el('analyzeBtn').addEventListener('click', startAnalysis);
  el('cancelBtn').addEventListener('click', () => {
    state.cancelFlag = true;
    state.analyzing = false;
    if (sfWorker) sfWorker.postMessage('stop');
    renderReview();
  });

  el('graphBox').addEventListener('click', (e) => {
    if (!state.review) return;
    const rect = el('graphBox').getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    goToPly(Math.round(ratio * state.review.moves.length));
  });

  el('openPgnBtn').addEventListener('click', () => el('pgnModal').classList.remove('hidden'));
  el('btnLab').addEventListener('click', enterLab);
  el('closePgnBtn').addEventListener('click', () => el('pgnModal').classList.add('hidden'));
  el('loadPgnBtn').addEventListener('click', () => {
    const pgn = el('pgnInput').value.trim();
    if (!pgn) return;
    el('pgnModal').classList.add('hidden');
    selectGame({
      id: `pgn_${Date.now()}`,
      platform: 'pgn',
      speed: 'PGN',
      timeControl: '',
      white: { name: 'Белые', rating: null },
      black: { name: 'Чёрные', rating: null },
      pgn,
    }, true);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); goToPly(getActivePly() - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); goToPly(getActivePly() + 1); }
    else if (e.key === 'Home') { e.preventDefault(); goToPly(0); }
    else if (e.key === 'End') { e.preventDefault(); goToPly(getActiveFens().length - 1); }
    else if (e.key.toLowerCase() === 'f') {
      state.flipped = !state.flipped;
      saveSettings();
      renderPlayers();
      renderBoard();
    }
  });

  // Restore preferences and the last opened PGN after page reload.
  el('usernameInput').value = state.username;
  el('depthSelect').value = String(state.depth);
  el('langSelect').value = state.lang;
  document.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-platform') === state.platform);
  });
  // Initial render
  renderPlayers();
  renderBoard();
  renderReview();
  if (savedSettings.lastGamePgn) {
    const restored = {
      id: 'restored_last_game',
      platform: 'pgn',
      speed: 'Saved',
      timeControl: '',
      white: { name: savedSettings.lastGameWhite || 'Белые', rating: null },
      black: { name: savedSettings.lastGameBlack || 'Чёрные', rating: null },
      pgn: savedSettings.lastGamePgn,
    };
    selectGame(restored, false);
    if (Number.isFinite(Number(savedSettings.lastPly))) goToPly(Number(savedSettings.lastPly));
  }
})();
