(function () {
  'use strict';

  const C = window.GameReviewClassifier;
  const ChessCtor = window.Chess;
  const BADGES = window.CHESSCOM_BADGES || {};
  const PIECE_KEYS = ['wp', 'wn', 'wb', 'wr', 'wq', 'wk', 'bp', 'bn', 'bb', 'br', 'bq', 'bk'];

  let state = {
    platform: 'lichess', username: '', depth: 12, lang: 'ru', flipped: false,
    games: [], activeGame: null, sans: [], fens: [], ply: 0, review: null, opening: null,
    analyzing: false, cancelFlag: false, selectedSq: null, legalMoves: [], sandboxMode: false,
    isLab: false, sandboxSans: [], sandboxFens: [], sandboxPly: 0, liveEval: null, liveEvalJob: 0,
  };

  let sfWorker = null;
  let sfReady = null;
  let pieceImagesCache = null;
  let videoRecording = false;
  let videoCancelFlag = false;

  const el = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Static Pages mode: call public APIs directly from the browser; no Node.js API routes.
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
    const text = await res.text();
    const records = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line));
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
    const archives = (await archiveRes.json()).archives || [];
    const collected = [];
    for (let i = archives.length - 1; i >= 0 && collected.length < max; i--) {
      const res = await fetchWithTimeout(archives[i], {}, 12000);
      if (!res.ok) continue;
      const month = await res.json();
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
        winner, status: winner ? 'decisive' : (g.white?.result || 'draw'), opening: '', pgn: g.pgn || '', moves: '', serverAnalysis: null,
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
    return { depth: Number(depthMatch[1]), multipv: pvIdxMatch ? Number(pvIdxMatch[1]) : 1, cp: cpMatch ? Number(cpMatch[1]) : null, mate: mateMatch ? Number(mateMatch[1]) : null, move: pvMoves[0] || null, pv: pvMoves };
  }

  function evaluateFen(engine, fen, depth) {
    return new Promise((resolve) => {
      const turn = fen.split(' ')[1] || 'w';
      const sign = turn === 'w' ? 1 : -1;
      let best = null;
      const onMessage = (e) => {
        const line = String(e.data || '');
        if (line.startsWith('info ')) {
          const parsed = parseInfoLine(line);
          if (parsed && parsed.multipv === 1) best = parsed;
        } else if (line.startsWith('bestmove')) {
          engine.removeEventListener('message', onMessage);
          if (!best) best = { depth, cp: 0, mate: null, move: null, pv: [] };
          resolve({ cp: best.cp == null ? null : best.cp * sign, mate: best.mate == null ? null : best.mate * sign, move: best.move, pv: best.pv, depth: best.depth });
        }
      };
      engine.addEventListener('message', onMessage);
      engine.postMessage(`position fen ${fen}`);
      engine.postMessage(`go depth ${depth}`);
    });
  }

  function ensureStockfish() {
    if (sfReady) return sfReady;
    sfReady = new Promise((resolve, reject) => {
      try {
        sfWorker = new Worker('vendor/stockfish-19-single.js');
        let uciOk = false;
        const onInit = (e) => {
          const line = String(e.data || '');
          if (line === 'uciok' && !uciOk) { uciOk = true; sfWorker.postMessage('setoption name MultiPV value 2'); sfWorker.postMessage('setoption name Hash value 32'); sfWorker.postMessage('isready'); }
          else if (line === 'readyok') { sfWorker.removeEventListener('message', onInit); resolve(sfWorker); }
        };
        sfWorker.addEventListener('message', onInit);
        sfWorker.addEventListener('error', (err) => reject(err));
        sfWorker.postMessage('uci');
      } catch (err) { reject(err); }
    });
    return sfReady;
  }

  // Remaining application code is unchanged from the original build.
  function renderReview() { /* PATCH PLACEHOLDER */ }
})();
