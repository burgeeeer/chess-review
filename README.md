# Chess Review

**Chess Review** is a web-based chess game analysis tool for reviewing games, identifying mistakes and strong moves, and learning from positions. It features a responsive interface for desktop and mobile, Stockfish-powered analysis, PGN/FEN support, move classifications, and Russian/English UI.

## Features

- Move-by-move game review
- Stockfish analysis
- Quick, Standard, and Deep analysis modes
- Move classification: Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, and Blunder
- PGN import and review
- FEN position support
- Move navigation and game history
- Position evaluation
- Responsive mobile and desktop layout
- Material Design-inspired interface
- UI animations powered by Anime.js
- Russian and English language support

## Technology

- HTML, CSS, JavaScript
- Stockfish
- Chess.js
- Anime.js

## Run locally

The project includes a web client and a Node.js server. From the project directory:


```bash
npm install
npm start
```

Then open the local URL shown by the server in your browser.

## GitHub deployment

The project can be pushed to the repository `burgeeeer/chess-review`. The frontend is adapted for static GitHub Pages: Stockfish runs in the browser, opening/book lookups use the Lichess Opening Explorer, and player-game imports call the public Lichess and Chess.com APIs directly from the browser. Because browser cross-origin (CORS) policies are controlled by those services, player import can fail on some networks/browsers; manual PGN import and local Stockfish analysis remain the fallback. The included Node.js server is still available for local development and is not required by the Pages frontend.

### One-command deployment from Termux

1. Install Git: `pkg install git`
2. Authenticate GitHub once using your preferred Git authentication method.
3. Run `bash setup-deploy-termux.sh` once from the project folder. The installer puts the `deploy` command in your Termux home directory, not in the Git repository.
4. After installation, run `deploy` from the project folder whenever you want to commit and push to `main`.

The local helper files `deploy.sh` and `setup-deploy-termux.sh` are excluded by `.gitignore` and will not be published. The command stages changes, commits if needed, and pushes to GitHub. It does not deploy to GitHub Pages or modify other repositories.

## Termux

Install Node.js in Termux, extract the project, and run:


```bash
pkg install nodejs
npm install
npm start
```

## Languages

The interface supports Russian and English.

---

# Chess Review (Русский)

**Chess Review** — веб-приложение для анализа шахматных партий, изучения ошибок, поиска сильных ходов и улучшения шахматной игры. Приложение адаптировано для компьютеров и мобильных устройств, использует Stockfish, поддерживает PGN/FEN и русский и английский интерфейсы.

## Возможности

- Анализ партии по ходам
- Анализ позиций с помощью Stockfish
- Режимы анализа: Быстро, Стандартно и Глубоко
- Классификация ходов: Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake и Blunder
- Импорт и анализ PGN
- Поддержка FEN
- Навигация по ходам и история партии
- Оценка позиции
- Адаптивный интерфейс для компьютеров и телефонов
- Интерфейс в стиле Material Design
- Анимации с Anime.js
- Русский и английский языки

## Технологии

- HTML, CSS, JavaScript
- Stockfish
- Chess.js
- Anime.js

## Локальный запуск

В проекте есть веб-клиент и сервер Node.js. В каталоге проекта выполните:

```bash
npm install
npm start
```

Затем откройте в браузере локальный адрес, который выведет сервер.

## GitHub Pages

GitHub Pages размещает статические файлы и не запускает Node.js-сервер. Поэтому серверные функции проекта потребуют адаптации или отдельного backend-сервера для полноценной работы на GitHub Pages. Перед публикацией статической версии нужно проверить пути к ресурсам и запросы к серверу.

## Termux

Установите Node.js в Termux, распакуйте проект и выполните:

```bash
pkg install nodejs
npm install
npm start
```

## Языки

Интерфейс поддерживает русский и английский языки.
