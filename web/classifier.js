(function (root) {
  'use strict';

  const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

  const PIECE_NAMES_ACC_RU = {
    p: 'пешку',
    n: 'коня',
    b: 'слона',
    r: 'ладью',
    q: 'ферзя',
    k: 'короля',
  };

  const PIECE_NAMES_NOM_RU = {
    p: 'пешка',
    n: 'конь',
    b: 'слон',
    r: 'ладья',
    q: 'ферзь',
    k: 'король',
  };

  const PIECE_NAMES_EN = {
    p: 'a pawn',
    n: 'a knight',
    b: 'a bishop',
    r: 'a rook',
    q: 'the queen',
    k: 'the king',
  };

  const CENTER_SQUARES = new Set(['d4', 'd5', 'e4', 'e5']);

  const CATEGORIES = {
    brilliant:  { id: 'brilliant',  symbol: '!!', color: '#26c2a3', labelRu: 'Блестящий',    labelEn: 'Brilliant' },
    great:      { id: 'great',      symbol: '!',  color: '#5c8bb0', labelRu: 'Замечательный', labelEn: 'Great' },
    best:       { id: 'best',       symbol: '★',  color: '#81b64c', labelRu: 'Лучший',       labelEn: 'Best' },
    excellent:  { id: 'excellent',  symbol: '✓',  color: '#81b64c', labelRu: 'Отличный',     labelEn: 'Excellent' },
    good:       { id: 'good',       symbol: '○',  color: '#95b776', labelRu: 'Хороший',      labelEn: 'Good' },
    book:       { id: 'book',       symbol: '📖', color: '#a88865', labelRu: 'Теория',       labelEn: 'Book' },
    inaccuracy: { id: 'inaccuracy', symbol: '?!', color: '#f7c631', labelRu: 'Неточность',   labelEn: 'Inaccuracy' },
    mistake:    { id: 'mistake',    symbol: '?',  color: '#ffa459', labelRu: 'Ошибка',       labelEn: 'Mistake' },
    miss:       { id: 'miss',       symbol: '✕',  color: '#ff7769', labelRu: 'Упущение',     labelEn: 'Miss' },
    blunder:    { id: 'blunder',    symbol: '??', color: '#fa412d', labelRu: 'Зевок',        labelEn: 'Blunder' },
  };

  const CATEGORY_ORDER = [
    'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'
  ];

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function evalToWinPercent(ev, color) {
    if (!ev) return 50;
    const sign = color === 'w' ? 1 : -1;

    if (ev.mate !== null && ev.mate !== undefined) {
      if (ev.mate === 0) return 0;
      const signedMate = ev.mate * sign;
      return signedMate > 0 ? 100 : 0;
    }

    const cp = (ev.cp ?? 0) * sign;
    const clampedCp = clamp(cp, -2000, 2000);
    const win = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clampedCp)) - 1);
    return clamp(win, 0, 100);
  }

  function moveAccuracyFromLoss(winLoss) {
    if (winLoss <= 0) return 100;
    const acc = 103.1668 * Math.exp(-0.04354 * winLoss) - 3.1669;
    return clamp(acc, 0, 100);
  }

  function formatEvalText(ev) {
    if (!ev) return '0.0';
    if (ev.mate !== null && ev.mate !== undefined) {
      return (ev.mate > 0 ? '+' : '-') + 'M' + Math.abs(ev.mate);
    }
    const pawns = (ev.cp ?? 0) / 100;
    return (pawns > 0 ? '+' : '') + pawns.toFixed(1);
  }

  function uciToSan(ChessCtor, fen, uci) {
    if (!uci || !ChessCtor) return uci || '';
    try {
      const c = new ChessCtor(fen);
      const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
      return m ? m.san : uci;
    } catch {
      return uci;
    }
  }

  function uciLineToSan(ChessCtor, fen, pvUcis, maxPlies = 4) {
    if (!ChessCtor || !Array.isArray(pvUcis) || !pvUcis.length) return '';
    try {
      const c = new ChessCtor(fen);
      const parts = [];
      for (let i = 0; i < Math.min(pvUcis.length, maxPlies); i++) {
        const uci = pvUcis[i];
        const moveNo = c.moveNumber();
        const turn = c.turn();
        const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
        if (!m) break;
        if (turn === 'w') {
          parts.push(`${moveNo}. ${m.san}`);
        } else if (i === 0) {
          parts.push(`${moveNo}... ${m.san}`);
        } else {
          parts.push(m.san);
        }
      }
      return parts.join(' ');
    } catch {
      return '';
    }
  }

  function isPieceSacrifice(ChessCtor, fenBefore, moveObj, fenAfter) {
    if (!ChessCtor || !moveObj) return false;
    try {
      const color = moveObj.color;
      const movedVal = PIECE_VALUES[moveObj.piece] || 0;
      const capturedVal = moveObj.captured ? (PIECE_VALUES[moveObj.captured] || 0) : 0;
      // The king can never be captured, so it cannot be "sacrificed".
      if (moveObj.piece === 'k' || movedVal < 3) return false;

      const after = new ChessCtor(fenAfter);
      if (after.isCheckmate()) return false;

      // Only captures of the piece that just moved count. Other pieces that were
      // already hanging before the move are not part of this move's sacrifice.
      const oppMoves = after.moves({ verbose: true });
      for (const om of oppMoves) {
        if (!om.captured || om.to !== moveObj.to) continue;
        const targetVal = PIECE_VALUES[om.captured] || 0;
        if (targetVal < 3) continue;
        if (targetVal > capturedVal + 1) {
          const attackerVal = PIECE_VALUES[om.piece] || 0;
          if (attackerVal < targetVal) return true;
          const testAfter = new ChessCtor(fenAfter);
          testAfter.move(om);
          if (!testAfter.isAttacked(om.to, color)) return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  function isQueenSacrificeMateTrap(ChessCtor, chessAfterMove, sans, index) {
    if (!ChessCtor || !chessAfterMove || !sans || index + 2 >= sans.length) return false;
    try {
      const line = new ChessCtor(chessAfterMove.fen());
      const opponentReply = line.move(sans[index + 1]);
      if (!opponentReply || opponentReply.captured !== 'q') return false;
      const matingMove = line.move(sans[index + 2]);
      return Boolean(matingMove && line.isCheckmate());
    } catch {
      return false;
    }
  }

  function detectOppRefutation(ChessCtor, fenAfter, evAfter) {
    if (!ChessCtor || !evAfter?.bestMove) return null;
    try {
      const c = new ChessCtor(fenAfter);
      const uci = evAfter.bestMove;
      const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
      if (!m) return null;
      return {
        san: m.san,
        to: m.to,
        captured: m.captured || null,
        isCheck: m.san.includes('+') || m.san.includes('#'),
      };
    } catch {
      return null;
    }
  }

  function inspectBoardMotifs(ChessCtor, fenBefore, moveObj, fenAfter) {
    const motifs = {
      isCheck: moveObj.san.includes('+'),
      isCastle: moveObj.flags.includes('k') || moveObj.flags.includes('q'),
      isCapture: Boolean(moveObj.captured),
      isPromotion: Boolean(moveObj.promotion),
      isCenterControl: CENTER_SQUARES.has(moveObj.to) || (moveObj.piece === 'p' && ['c', 'd', 'e', 'f'].includes(moveObj.to[0])),
      isDevelopment: false,
      forkTargets: [],
      isEndgame: false,
    };

    try {
      const before = new ChessCtor(fenBefore);
      const startRank = moveObj.color === 'w' ? '1' : '8';
      if ((moveObj.piece === 'n' || moveObj.piece === 'b') && moveObj.from[1] === startRank && moveObj.to[1] !== startRank) {
        motifs.isDevelopment = true;
      }

      // Count pieces for endgame detection
      const board = before.board();
      let majorMinorCount = 0;
      for (const row of board) {
        for (const sq of row) {
          if (sq && sq.type !== 'p' && sq.type !== 'k') majorMinorCount++;
        }
      }
      motifs.isEndgame = majorMinorCount <= 6;

      // Detect fork / double attack on valuable opponent pieces
      const oppColor = moveObj.color === 'w' ? 'b' : 'w';
      const after = new ChessCtor(fenAfter);
      // Flip turn in FEN temporarily to inspect pseudo-attacks from `moveObj.to`
      const parts = after.fen().split(' ');
      parts[1] = moveObj.color;
      parts[3] = '-';
      const testTurn = new ChessCtor(parts.join(' '));
      const attacks = testTurn.moves({ square: moveObj.to, verbose: true });
      const seen = new Set();
      const attackerVal = PIECE_VALUES[moveObj.piece] || 0;
      for (const am of attacks) {
        const targetVal = PIECE_VALUES[am.captured] || 0;
        if (!am.captured || targetVal < 3 || seen.has(am.to)) continue;
        // A real fork target is either undefended or worth more than the forking piece.
        // Otherwise the "attack" is just a defended piece that can be traded.
        const defended = after.isAttacked(am.to, oppColor);
        if (defended && targetVal <= attackerVal) continue;
        seen.add(am.to);
        motifs.forkTargets.push(am.captured);
      }
      // Also check if opponent king is in check + another valuable piece is attacked
      if (motifs.isCheck && seen.size >= 1) {
        motifs.forkTargets.push('k');
      }
    } catch {
      // Optional motif enrichment
    }

    return motifs;
  }

  function describeBestMovePurpose(ChessCtor, fenBefore, bestUci, lang) {
    if (!ChessCtor || !bestUci) return '';
    try {
      const c = new ChessCtor(fenBefore);
      const m = c.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4] || undefined });
      if (!m) return '';
      const isRu = lang === 'ru';
      if (c.isCheckmate()) return isRu ? 'чтобы сразу поставить мат' : 'to deliver immediate checkmate';
      if (m.san.includes('+')) return isRu ? 'чтобы перехватить инициативу шахом' : 'to seize the initiative with check';
      if (m.captured) {
        const cap = isRu ? (PIECE_NAMES_ACC_RU[m.captured] || 'материал') : (PIECE_NAMES_EN[m.captured] || 'material');
        return isRu ? `чтобы забрать ${cap}` : `to win ${cap}`;
      }
      if (m.flags.includes('k') || m.flags.includes('q')) {
        return isRu ? 'чтобы увести короля в безопасность' : 'to castle the king to safety';
      }
      if (CENTER_SQUARES.has(m.to)) {
        return isRu ? 'чтобы укрепить контроль над центром' : 'to fight for central control';
      }
      return '';
    } catch {
      return '';
    }
  }

  function buildCoachExplanation({
    ChessCtor,
    ply,
    category,
    moveObj,
    fenBefore,
    fenAfter,
    evBefore,
    evAfter,
    bestUci,
    bestSan,
    secondSan,
    bestLineSan,
    isCheckmate,
    walkedIntoMate,
    gaveUpMate,
    lang,
  }) {
    const isRu = lang === 'ru';
    const san = moveObj.san;
    const pieceRuAcc = PIECE_NAMES_ACC_RU[moveObj.piece] || 'фигуру';
    const pieceEn = PIECE_NAMES_EN[moveObj.piece] || 'a piece';
    const motifs = inspectBoardMotifs(ChessCtor, fenBefore, moveObj, fenAfter);
    const refutation = detectOppRefutation(ChessCtor, fenAfter, evAfter);
    const bestPurpose = describeBestMovePurpose(ChessCtor, fenBefore, bestUci, lang);
    const evalAfterStr = formatEvalText(evAfter);

    if (isCheckmate) {
      return isRu
        ? `Точка в партии! Ход ${san} ставит красивый мат — у короля соперника больше нет защиты.`
        : `Game over! ${san} delivers checkmate with no defense left for the opponent's king.`;
    }

    if (category === 'brilliant') {
      const idea = bestLineSan ? (isRu ? ` Главная идея: ${bestLineSan}.` : ` Main idea: ${bestLineSan}.`) : '';
      return isRu
        ? `Браво! Смелая жертва (${pieceRuAcc}) полностью оправдана: принимать её опасно, а ваша атака становится решающей.${idea}`
        : `Bravo! Bold sacrifice (${pieceEn}): accepting it runs into a crushing attack.${idea}`;
    }

    if (category === 'great') {
      const alt = secondSan
        ? (isRu ? ` Другие продолжения, вроде ${secondSan}, уже выпускали перевес.` : ` Other tries like ${secondSan} would lose the edge.`)
        : '';
      return isRu
        ? `Отличный расчёт! В этой острой позиции ${san} был по сути единственным точным путём.${alt}`
        : `Sharp calculation! ${san} was virtually the only accurate move in this critical position.${alt}`;
    }

    if (category === 'book') {
      return isRu
        ? `Классическая теория: вы уверенно разыгрываете дебют, не теряя времени на лишние ходы.`
        : `Solid opening theory: developing smoothly along well-tested master lines.`;
    }

    if (category === 'best' || category === 'excellent' || category === 'good') {
      if (motifs.forkTargets.length >= 2) {
        return isRu
          ? `Отличная тактика — двойной удар! Фигура на ${moveObj.to} атакует сразу несколько целей соперника.`
          : `Nice tactic — a double attack! Your piece on ${moveObj.to} hits multiple targets at once.`;
      }
      if (motifs.isCastle) {
        return isRu
          ? `Грамотная рокировка: король уходит в безопасное укрытие, а ладья готовится включиться в борьбу.`
          : `Good castling: your king tucks into safety while activating the rook.`;
      }
      if (motifs.isPromotion) {
        return isRu
          ? `Пешка дошла до цели и превращается в сильную фигуру — решающее усиление!`
          : `The pawn reaches the end and promotes — a decisive material boost!`;
      }
      if (motifs.isCheck) {
        return isRu
          ? `Активный шах ${san}: вы заставляете соперника реагировать и сохраняете инициативу (${evalAfterStr}).`
          : `Active check ${san}: forces a response and keeps the initiative (${evalAfterStr}).`;
      }
      if (motifs.isDevelopment && ply <= 18) {
        return isRu
          ? `Правильное развитие в дебюте — выводим лёгкую фигуру в игру и боремся за ключевые поля.`
          : `Healthy opening development, bringing another minor piece into the game.`;
      }
      if (motifs.isCapture) {
        const capRu = PIECE_NAMES_ACC_RU[moveObj.captured] || 'фигуру';
        const capEn = PIECE_NAMES_EN[moveObj.captured] || 'material';
        return isRu
          ? `Своевременное взятие (${capRu}): вы улучшаете позицию и сохраняете контроль (${evalAfterStr}).`
          : `Well-timed capture (${capEn}), keeping the position under control (${evalAfterStr}).`;
      }
      if (motifs.isCenterControl && ply <= 20) {
        return isRu
          ? `Хороший позиционный ход: укрепляете центр и не даёте сопернику развернуть фигуры.`
          : `Strong positional move, reinforcing the center and limiting counterplay.`;
      }

      if (category === 'best') {
        return isRu
          ? `Идеальный ход по мнению движка — точнее здесь сыграть было нельзя (${evalAfterStr}).`
          : `Top engine choice — you found the most accurate continuation here (${evalAfterStr}).`;
      }
      if (category === 'excellent') {
        return isRu
          ? `Очень крепкий и точный ход: позиция остаётся под вашим контролем (${evalAfterStr}).`
          : `Very accurate move, keeping the position well in hand (${evalAfterStr}).`;
      }
      return isRu
        ? `Надёжный, спокойный ход без лишнего риска (${evalAfterStr}).`
        : `Solid, sensible move without taking unnecessary risks (${evalAfterStr}).`;
    }

    // Coach feedback for Inaccuracy / Mistake / Miss / Blunder
    const altBaseRu = bestSan && bestSan !== san
      ? ` Лучше было сыграть ${bestSan}${bestPurpose ? `, ${bestPurpose}` : ''}.`
      : '';
    const altBaseEn = bestSan && bestSan !== san
      ? ` Instead, ${bestSan} was stronger${bestPurpose ? ` ${bestPurpose}` : ''}.`
      : '';
    const lineRu = bestLineSan ? ` Идея: ${bestLineSan}.` : '';
    const lineEn = bestLineSan ? ` Line: ${bestLineSan}.` : '';

    if (walkedIntoMate && evAfter.mate !== null && evAfter.mate !== undefined) {
      const mCount = Math.abs(evAfter.mate);
      const via = refutation?.san ? ` после ${refutation.san}` : '';
      return isRu
        ? `Опасный просчёт! Король попадает под форсированный мат в ${mCount}${via}.${altBaseRu}`
        : `Critical mistake! Your king walks into forced mate in ${mCount}${refutation?.san ? ` after ${refutation.san}` : ''}.${altBaseEn}`;
    }

    if (gaveUpMate && evBefore.mate !== null && evBefore.mate !== undefined) {
      const mCount = Math.abs(evBefore.mate);
      return isRu
        ? `Вы упустили прямой мат в ${mCount}! Позиция всё ещё сложная, но победа была совсем рядом.${altBaseRu}`
        : `You missed a forced mate in ${mCount}! Victory was right there.${altBaseEn}`;
    }

    if (category === 'miss') {
      return isRu
        ? `Упущенный шанс: здесь был решающий удар, но после ${san} соперник выравнивает игру.${altBaseRu}${lineRu}`
        : `Missed win: there was a decisive blow here, while ${san} lets the opponent back in.${altBaseEn}${lineEn}`;
    }

    if (refutation?.captured) {
      const lostRu = PIECE_NAMES_ACC_RU[refutation.captured] || 'материал';
      const lostEn = PIECE_NAMES_EN[refutation.captured] || 'material';
      const lostNomRu = PIECE_NAMES_NOM_RU[refutation.captured] || 'фигура';
      if (category === 'blunder') {
        return isRu
          ? `Обидный зевок: после ${san} ваша ${lostNomRu} остаётся под боем, и соперник забирает ${lostRu} ходом ${refutation.san}.${altBaseRu}`
          : `Costly blunder: after ${san}, you hang ${lostEn} to ${refutation.san}.${altBaseEn}`;
      }
      return isRu
        ? `Неосторожно: ход ${san} позволяет сопернику выиграть ${lostRu} (${refutation.san}).${altBaseRu}`
        : `Careless move: ${san} allows ${refutation.san}, winning ${lostEn}.${altBaseEn}`;
    }

    if (refutation?.isCheck) {
      return isRu
        ? `Соперник сразу перехватывает инициативу неприятным шахом ${refutation.san}.${altBaseRu}${lineRu}`
        : `Allows an unpleasant check with ${refutation.san}, handing over the initiative.${altBaseEn}${lineEn}`;
    }

    if (category === 'inaccuracy') {
      return isRu
        ? `Небольшая неточность: ход ${san} немного ослабляет позицию и даёт сопернику передышку.${altBaseRu}`
        : `Slight inaccuracy: ${san} gives the opponent a bit more breathing room.${altBaseEn}`;
    }

    if (category === 'mistake') {
      return isRu
        ? `Серьёзная ошибка: вы отдаёте инициативу, и позиция заметно ухудшается (${formatEvalText(evBefore)} -> ${evalAfterStr}).${altBaseRu}${lineRu}`
        : `Serious mistake: concedes the initiative and worsens your position (${formatEvalText(evBefore)} -> ${evalAfterStr}).${altBaseEn}${lineEn}`;
    }

    return isRu
      ? `Тяжёлый зевок: после ${san} позиция рушится (${formatEvalText(evBefore)} -> ${evalAfterStr}).${altBaseRu}${lineRu}`
      : `Major blunder: ${san} collapses the position (${formatEvalText(evBefore)} -> ${evalAfterStr}).${altBaseEn}${lineEn}`;
  }

  function computePlayerAccuracy(moveAccuracies) {
    if (!moveAccuracies.length) return 100;
    const sum = moveAccuracies.reduce((a, b) => a + b, 0);
    const mean = sum / moveAccuracies.length;
    const harmDenom = moveAccuracies.reduce((a, b) => a + 1 / Math.max(10, b), 0);
    const harmonic = moveAccuracies.length / harmDenom;
    return Math.round(clamp((mean * 0.6 + harmonic * 0.4), 0, 100) * 10) / 10;
  }

  function analyzeGame({ Chess, sans, evals, lang = 'ru' }) {
    const chess = new Chess();
    const moves = [];
    const counts = {
      w: Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])),
      b: Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])),
    };
    const accs = { w: [], b: [] };

    for (let i = 0; i < sans.length; i++) {
      const fenBefore = chess.fen();
      const moveObj = chess.move(sans[i]);
      if (!moveObj) break;
      const fenAfter = chess.fen();
      const color = moveObj.color;
      const uci = moveObj.from + moveObj.to + (moveObj.promotion || '');
      const isMateMove = chess.isCheckmate();

      const evBefore = evals[i] || { cp: 0, mate: null };
      const evAfterRaw = evals[i + 1] || { cp: 0, mate: null };
      const evAfter = isMateMove
        ? { cp: null, mate: color === 'w' ? 1 : -1, isCheckmate: true }
        : evAfterRaw;

      const winBefore = evalToWinPercent(evBefore, color);
      const winAfter = isMateMove ? 100 : evalToWinPercent(evAfter, color);
      const winLoss = Math.max(0, winBefore - winAfter);
      const acc = moveAccuracyFromLoss(winLoss);
      accs[color].push(acc);

      const bestUci = evBefore.bestMove || null;
      const bestSan = bestUci ? uciToSan(Chess, fenBefore, bestUci) : null;
      const secondSan = evBefore.secondMove ? uciToSan(Chess, fenBefore, evBefore.secondMove) : null;
      const bestLineSan = uciLineToSan(Chess, fenBefore, evBefore.pv, 4);
      const isBestMove = Boolean(bestUci && bestUci === uci);

      let secondGap = 0;
      if (evBefore.secondCp !== undefined || evBefore.secondMate !== undefined) {
        const winSecond = evalToWinPercent(
          { cp: evBefore.secondCp ?? 0, mate: evBefore.secondMate ?? null },
          color
        );
        secondGap = Math.max(0, winBefore - winSecond);
      }

      const gaveUpMate =
        evBefore.mate !== null &&
        evBefore.mate !== undefined &&
        (color === 'w' ? evBefore.mate > 0 : evBefore.mate < 0) &&
        !isMateMove &&
        (evAfter.mate === null || evAfter.mate === undefined || (color === 'w' ? evAfter.mate <= 0 : evAfter.mate >= 0));

      const walkedIntoMate =
        evAfter.mate !== null &&
        evAfter.mate !== undefined &&
        (color === 'w' ? evAfter.mate < 0 : evAfter.mate > 0) &&
        (evBefore.mate === null || evBefore.mate === undefined || (color === 'w' ? evBefore.mate >= 0 : evBefore.mate <= 0));

      let category = 'good';
      if (evAfterRaw.isBook && winLoss <= 3.5 && i < 24) {
        category = 'book';
      } else if (walkedIntoMate && winLoss > 12) {
        category = 'blunder';
      } else if (
        (isBestMove || winLoss <= 2.0) &&
        winBefore < 94 &&
        winAfter >= 40 &&
        (isPieceSacrifice(Chess, fenBefore, moveObj, fenAfter) ||
          isQueenSacrificeMateTrap(Chess, chess, sans, i))
      ) {
        category = 'brilliant';
      } else if (isBestMove && secondGap >= 10 && winBefore < 93) {
        category = 'great';
      } else if (isBestMove || winLoss <= 0.5) {
        category = 'best';
      } else if (winLoss <= 2.5) {
        category = 'excellent';
      } else if (winLoss <= 5.5) {
        category = 'good';
      } else if ((winBefore >= 75 || gaveUpMate) && winAfter <= 62 && winAfter >= 30) {
        category = 'miss';
      } else if (winLoss <= 10.5) {
        category = 'inaccuracy';
      } else if (winLoss <= 20.5) {
        category = 'mistake';
      } else {
        category = 'blunder';
      }

      counts[color][category] = (counts[color][category] || 0) + 1;

      const comment = buildCoachExplanation({
        ChessCtor: Chess,
        ply: i + 1,
        category,
        moveObj,
        fenBefore,
        fenAfter,
        evBefore,
        evAfter,
        bestUci,
        bestSan,
        secondSan,
        bestLineSan,
        isCheckmate: isMateMove,
        walkedIntoMate,
        gaveUpMate,
        lang,
      });

      moves.push({
        ply: i + 1,
        moveNumber: Math.floor(i / 2) + 1,
        color,
        san: moveObj.san,
        uci,
        from: moveObj.from,
        to: moveObj.to,
        fenBefore,
        fenAfter,
        evalBefore: evBefore,
        evalAfter: evAfter,
        winBefore,
        winAfter,
        winLoss,
        accuracy: acc,
        category,
        bestUci,
        bestSan,
        bestLineSan,
        comment,
      });
    }

    return {
      moves,
      counts,
      accuracy: {
        w: computePlayerAccuracy(accs.w),
        b: computePlayerAccuracy(accs.b),
      },
      categories: CATEGORIES,
      categoryOrder: CATEGORY_ORDER,
    };
  }

  const api = {
    CATEGORIES,
    CATEGORY_ORDER,
    evalToWinPercent,
    moveAccuracyFromLoss,
    formatEvalText,
    analyzeGame,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.GameReviewClassifier = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
