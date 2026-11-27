# Chess Review

**Chess Review** is a browser-based chess game review tool for analyzing games, understanding mistakes, and learning from positions.

**Live website:** https://burgeeeer.github.io/chess-review/

## Features

- Analyze games move by move with Stockfish 19
- Quick, Standard, and Deep analysis modes
- Move classifications: Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, and Blunder
- Import games from Lichess and Chess.com by player name
- Import games from PGN
- Work with FEN positions in the Lab
- Evaluation bar and evaluation graph
- Accuracy statistics and move explanations
- Move navigation and board flipping
- Export PGN, save board positions as PNG, and record game video (WebM)
- Responsive interface for desktop and mobile
- Russian and English interface

## Technology

- HTML, CSS, JavaScript
- Stockfish 19
- Chess.js
- Anime.js

## Use online

Open the website:

**https://burgeeeer.github.io/chess-review/**

No installation is required for the GitHub Pages version.

## Run locally

The repository also includes a Node.js server for local development.

```bash
npm install
npm start
```

Open the local address printed by the server.

## GitHub Pages

The static website is published from the `web/` directory through GitHub Actions. Pushes to the `main` branch trigger deployment automatically.

The Pages version runs Stockfish in the browser and accesses public Lichess and Chess.com APIs directly. Player-game imports may be affected by network restrictions or browser CORS policies. If importing by username does not work, use PGN import as an alternative.

## Termux

You can run the local Node.js version in Termux:

```bash
pkg install nodejs
npm install
npm start
``

## Languages

The interface supports **Russian** and **English**.

---

# Chess Review (Русский)

**Chess Review** — веб-приложение для анализа шахматных партий, поиска ошибок и изучения сильных ходов. Работает на компьютерах и мобильных устройствах.

**Сайт:** https://burgeeeer.github.io/chess-review/

## Возможности

- Анализ партии по ходам с помощью Stockfish 19
- Режимы анализа: Быстро, Стандартно и Глубоко
- Классификация ходов: Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake и Blunder
- Загрузка партий по никнейму из Lichess и Chess.com
- Импорт PGN
- Работа с позициями FEN в лаборатории
- Шкала оценки позиции и граф оценки
- Статистика точности и объяснения ходов
- Навигация по ходам и переворот доски
- Экспорт PGN, сохранение позиции в PNG и запись видео партии (WebM)
- Адаптивный интерфейс для компьютеров и телефонов
- Русский и английский интерфейсы

## Технологии

- HTML, CSS, JavaScript
- Stockfish 19
- Chess.js
- Anime.js

## Использование онлайн

Откройте:

**https://burgeeeer.github.io/chess-review/**

Установка не требуется.

## Локальный запуск

В проекте также есть Node.js-сервер. В папке проекта выполните:

```bash
npm install
npm start
```

Откройте локальный адрес, который появится в терминале.

## GitHub Pages

Статическая версия сайта публикуется из папки `web/` с помощью GitHub Actions. При push в ветку `main` запускается автоматическая публикация.

Stockfish работает непосредственно в браузере. Загрузка партий по никнейму использует публичные API Lichess и Chess.com, поэтому на некоторых сетях или браузерах она может не работать из-за ограничений. В таком случае можно импортировать PGN вручную.

## Termux

Для локального запуска в Termux:

```bash
pkg install nodejs
npm install
npm start
``

## Языки

Интерфейс поддерживает **русский** и **английский** языки.
