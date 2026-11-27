(() => {
  const dictionary = {
    en: {
      'Chess Review': 'Chess Review', 'Stockfish 19 Full NNUE': 'Stockfish 19 Full NNUE',
      'Никнейм игрока (например, DrNykterstein)': 'Player username (e.g. DrNykterstein)',
      'Найти партии': 'Find games', 'Вставить PGN': 'Import PGN', 'Лаборатория': 'Lab',
      'Создать партию или расставить FEN': 'Create a game or set up a FEN',
      'Быстро': 'Quick', 'Стандартно': 'Standard', 'Глубоко': 'Deep',
      'Партии игрока': 'Player games', 'Введите никнейм или вставьте PGN': 'Enter a username or paste PGN',
      'Обзор партии (Game Review)': 'Game Review', 'Анализировать': 'Analyze', 'Стоп': 'Stop',
      'Белые': 'White', 'Чёрные': 'Black', 'Вставить PGN партии': 'Import a PGN game',
      'Закрыть': 'Close', 'Загрузить и анализировать': 'Load & analyze',
      'Перевернуть': 'Flip board', 'Видео': 'Video', 'Начало': 'Start', 'Назад': 'Previous',
      'Вперёд': 'Next', 'В конец': 'End', 'Скопировать PGN партии': 'Copy game PGN',
      'Скачать PNG текущей позиции': 'Save current position as PNG', 'Записать видео партии (WebM)': 'Record game video (WebM)',
      'Перевернуть доску (F)': 'Flip board (F)', 'Платформа': 'Platform', 'Язык': 'Language',
      'Режим анализа': 'Analysis mode', 'Выберите партию из списка или вставьте PGN, чтобы получить классификацию ходов, точность и объяснения от Stockfish 19.':
        'Select a game or paste PGN to get move classifications, accuracy, and Stockfish 19 explanations.',
      'Начальная позиция. Выберите ход в списке или на графике.': 'Initial position. Select a move from the list or graph.',
      'Загрузка...': 'Loading…', 'Партии не найдены': 'No games found', 'Ошибка загрузки': 'Loading error',
      'Анализ Stockfish 19...': 'Analyzing with Stockfish 19…', 'Теория': 'Book', 'Неточность': 'Inaccuracy',
      'Ошибка': 'Mistake', 'Упущение': 'Miss', 'Зевок': 'Blunder', 'Блестящий': 'Brilliant',
      'Замечательный': 'Great', 'Лучший': 'Best', 'Отличный': 'Excellent', 'Хороший': 'Good'
    }
  };
  const ru = {};
  Object.keys(dictionary.en).forEach(k => ru[k] = k);
  function translateString(text, lang) {
    if (!text) return text;
    if (lang === 'ru') return text;
    let out = text;
    for (const [r, e] of Object.entries(dictionary.en)) out = out.split(r).join(e);
    out = out.replace(/Найдено:\s*(\d+)/g, 'Found: $1').replace(/Видео\s*(\d+)\/(\d+)/g, 'Video $1/$2');
    return out;
  }
  function apply(lang) {
    document.querySelectorAll('body *').forEach(node => {
      if (node.children.length === 0 && node.textContent.trim()) {
        const original = node.dataset.ruText || node.textContent;
        if (!node.dataset.ruText && lang === 'en') node.dataset.ruText = original;
        const translated = translateString(node.dataset.ruText || original, lang);
        if (node.textContent !== translated) node.textContent = translated;
      }
      ['placeholder','title','aria-label'].forEach(attr => {
        if (node.hasAttribute(attr)) {
          const original = node.dataset['ru' + attr] || node.getAttribute(attr);
          if (!node.dataset['ru' + attr] && lang === 'en') node.dataset['ru' + attr] = original;
          const translatedAttr = translateString(node.dataset['ru' + attr] || original, lang);
          if (node.getAttribute(attr) !== translatedAttr) node.setAttribute(attr, translatedAttr);
        }
      });
    });
    document.documentElement.lang = lang;
  }
  document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('langSelect');
    if (!select) return;
    apply(select.value);
    select.addEventListener('change', () => apply(select.value));
    const observer = new MutationObserver(() => apply(select.value));
    observer.observe(document.body, {subtree:true, childList:true, characterData:true});
    if (window.anime) {
      anime({targets: '.topbar', opacity: [0,1], translateY: [-18,0], duration: 650, easing: 'easeOutExpo'});
      anime({targets: '.workspace > section', opacity: [0,1], translateY: [24,0], delay: anime.stagger(100), duration: 700, easing: 'easeOutCubic'});
      anime({targets: '.card', scale: [.985,1], opacity: [0,1], delay: anime.stagger(120), duration: 650, easing: 'easeOutBack'});
      document.addEventListener('click', e => {
        const b = e.target.closest('.btn, .seg-btn');
        if (!b || b.disabled) return;
        anime({targets: b, scale: [1, .94, 1], duration: 260, easing: 'easeOutQuad'});
      });
      // Do not animate all board pieces on every DOM redraw: this caused a visible blink after each move.
      // Board updates are kept immediate; Anime.js remains active for the surrounding UI.
    }
  });
})();
