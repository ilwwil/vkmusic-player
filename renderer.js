// ---------- Оболочка приложения: рамка окна, сайдбар, опрос VK, нижний плеер ----------
// Разделы (Главная, Моя музыка) живут в своих файлах — см. views/home.js и
// views/mymusic.js. Здесь только то, что общее для всего приложения.
const { webview, contentEl, SELECTORS, pickHelper, sendTrustedClick, wait, beginAutomation, endAutomation } = window.Shared;

// ---------- Кастомная рамка окна ----------
document.getElementById('btn-min').onclick = () => window.app.windowControl('minimize');
document.getElementById('btn-max').onclick = () => window.app.windowControl('maximize');
document.getElementById('btn-close').onclick = () => window.app.windowControl('close');

// ---------- Сайдбар: навигация по разделам VK Музыки ----------
document.querySelectorAll('.nav-item[data-url]').forEach(btn => {
  btn.addEventListener('click', () => {
    webview.loadURL(btn.dataset.url).catch(() => {
      webview.src = btn.dataset.url;
    });
  });
});

// ---------- Сайдбар: переключение наших собственных разделов ----------
document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    // Безусловно и первым делом: альбом/артист из поиска открываются поверх
    // текущего раздела через служебные экраны "Плейлисты"/"Страница артиста"
    // без настоящего клика по пункту навигации (см. views/search.js) — если
    // после этого пользователь жмёт РЕАЛЬНЫЙ пункт меню (в т.ч. те же
    // "Плейлисты"), эти экраны нужно сначала честно закрыть, иначе останется
    // висеть чужая карточка вместо своего содержимого раздела. Обе функции
    // no-op, если ничего такого не открыто.
    window.PlaylistsView.closeCard();
    window.ArtistView.closeIfOpenSilently();
    document.querySelectorAll('.nav-item[data-view]').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.app-view').forEach(v => v.classList.toggle('hidden', v.id !== `${btn.dataset.view}-view`));
    if (btn.dataset.view === 'home') window.HomeView.loadHome();
    if (btn.dataset.view === 'mymusic') window.MyMusicView.loadMyMusic();
    if (btn.dataset.view === 'playlists') window.PlaylistsView.loadPlaylists();
    if (btn.dataset.view === 'search') window.SearchView.focus();
    // При уходе из "Поиска" сбрасываем поиск в VK — иначе каталог остаётся в
    // режиме результатов и секция "Треки" моей библиотеки недоступна
    if (btn.dataset.view !== 'search') window.SearchView.reset();
  });
});

document.getElementById('btn-devtools').onclick = () => {
  webview.openDevTools();
};

// Свёрнутая секция служебных кнопок — чтобы не мозолили глаза в обычной работе
const debugToggle = document.getElementById('debug-toggle');
debugToggle.onclick = () => {
  document.getElementById('debug-section').classList.toggle('open');
  debugToggle.classList.toggle('open');
};

document.getElementById('btn-app-devtools').onclick = () => {
  window.app.openAppDevTools();
};

// ---------- Debug: показать/скрыть настоящий VK вместо нашей оболочки ----------
const btnToggleVk = document.getElementById('btn-toggle-vk');
btnToggleVk.onclick = () => {
  const showing = contentEl.classList.toggle('vk-visible');
  btnToggleVk.lastChild.textContent = showing ? ' Скрыть VK' : ' Показать VK';
};

// Прячем родной интерфейс VK (шапку/сайдбар сайта), оставляя только плеер/контент,
// т.к. навигацию и управление мы теперь делаем своими элементами.
webview.addEventListener('dom-ready', () => {
  webview.insertCSS(`
    /* Эти селекторы могут потребовать правки после обновлений VK — см. selectors.js */
    header, .TopNav, .SplitLayout__aside, .Header { display: none !important; }
    /* Страница VK почти всегда невидима, но её CSS-анимации (эквалайзеры,
       переходы, прогресс-бары) без троттлинга крутятся на 60fps впустую.
       Обнуляем длительности вместо animation:none — так события
       animationend/transitionend продолжают приходить и логика VK,
       ожидающая их, не ломается. */
    *, *::before, *::after {
      animation-duration: 0s !important;
      transition-duration: 0s !important;
    }
  `);
});

// ---------- Состояние "сейчас играет": push из VK вместо поллинга ----------
// Раньше мы каждые 1.5с гоняли executeJavaScript со скриптом-экстрактором — это
// будило оба процесса даже когда ничего не менялось. Теперь один раз ставим в
// страницу VK MutationObserver на контейнер верхнего плеера: он сам собирает
// состояние при реальных изменениях DOM и шлёт его сюда через console.log с
// магическим префиксом (webview отдаёт его событием console-message). В простое —
// ноль работы, при смене трека — обновление сразу, а не через 1.5с.
const STATE_PREFIX = '__VK_PLAYER_STATE__';

function installStateObserverScript() {
  return `
    (function() {
      if (window.__vkStateObserverTimer) return 'already-installed';
      ${pickHelper()}
      const sel = ${JSON.stringify(SELECTORS)};
      // Настоящий <audio> плеера VK не прикреплён к DOM (создаётся через
      // createElement и живёт только в JS-куче) — querySelector его не видит.
      // Поэтому перехватываем создание медиа-элементов: наш скрипт ставится на
      // dom-ready, а плеер VK создаёт лениво при первом воспроизведении — успеваем.
      const mediaEls = window.__vkMediaEls = [];
      const pushMediaEl = (el) => { if (el && mediaEls.indexOf(el) === -1) mediaEls.push(el); };
      const OrigAudio = window.Audio;
      function AudioHook() { const el = new OrigAudio(...arguments); pushMediaEl(el); return el; }
      AudioHook.prototype = OrigAudio.prototype;
      window.Audio = AudioHook;
      const origCreateElement = Document.prototype.createElement;
      Document.prototype.createElement = function(name) {
        const el = origCreateElement.apply(this, arguments);
        const n = String(name).toLowerCase();
        if (n === 'audio' || n === 'video') pushMediaEl(el);
        return el;
      };
      // Страховка на случай, когда сам <audio> создан ДО нашей инъекции (VK
      // делает это при восстановлении «продолжить прослушивание» и дальше
      // переиспользует один элемент): MediaSource VK создаёт заново на каждый
      // трек, так что ловим его конструктор — духовный "текущий трек" всегда
      // последний созданный MediaSource.
      const msList = window.__vkMediaSources = [];
      const OrigMS = window.MediaSource;
      if (OrigMS) {
        function MSHook() {
          const ms = new OrigMS(...arguments);
          msList.push(ms);
          if (msList.length > 4) msList.shift();
          return ms;
        }
        MSHook.prototype = OrigMS.prototype;
        if (OrigMS.isTypeSupported) MSHook.isTypeSupported = OrigMS.isTypeSupported.bind(OrigMS);
        window.MediaSource = MSHook;
      }
      function readState() {
        const titleEl = pick(sel.trackTitle);
        const artistEl = pick(sel.trackArtist);
        const coverEl = pick(sel.cover);
        const playBtn = pick(sel.playPauseButton);
        const timeEl = pick(sel.progressTime);
        const sliderEl = pick(sel.progressSlider);
        const bufferedEl = pick(sel.bufferedSlider);
        const shuffleEl = pick(sel.shuffleButton);
        const repeatEl = pick(sel.repeatButton);
        const likeEl = pick(sel.likeButton);
        const dislikeEl = pick(sel.dislikeButton);
        const volumeEl = pick(sel.volumeSlider);
        const muteEl = pick(sel.muteButton);
        // Точное время из настоящего <audio> (см. перехват выше) — надёжнее,
        // чем оценка "прошло/процент" из округлённых текста и aria-valuenow.
        // Среди перехваченных есть служебные коротышки VK (bb1-3.mp3, beep'ы) —
        // они paused и с currentTime 0, поэтому отсеиваются; у радио/эфиров
        // duration Infinity — тогда остаёмся на старой оценке по проценту.
        // ВАЖНО: у MSE-стрима duration РАСТЁТ по мере докачки сегментов
        // (у 11-минутного трека в середине буферизации была 88с) — доверяем
        // длительности только когда трек докачан целиком (буфер дотянулся до
        // duration) либо когда MediaSource получил endOfStream ('ended').
        const mediaCandidates = mediaEls.filter(a => isFinite(a.duration) && a.duration > 0);
        const audio = mediaCandidates.find(a => !a.paused)
          || mediaCandidates.find(a => a.currentTime > 0) || null;
        let durationSec = null;
        let currentSec = null;
        if (audio) {
          currentSec = audio.currentTime;
          const buffEnd = audio.buffered.length ? audio.buffered.end(audio.buffered.length - 1) : 0;
          if (audio.duration - buffEnd < 1.5) durationSec = audio.duration;
        }
        // Точные длительности всех перехваченных MediaSource. Который из них —
        // текущий трек, гость не знает (VK предзагружает следующий трек в
        // отдельный MediaSource, а endOfStream не вызывает), поэтому выбор
        // делает хост: сверяет с оценкой по проценту (см. updateUI).
        const msDurations = (window.__vkMediaSources || [])
          .map(m => m.duration)
          .filter(d => isFinite(d) && d > 0);
        return JSON.stringify({
          durationSec,
          currentSec,
          msDurations,
          title: titleEl ? titleEl.textContent.trim() : null,
          artist: artistEl ? artistEl.textContent.trim() : null,
          cover: coverEl ? coverEl.src : null,
          isPlaying: playBtn ? playBtn.getAttribute('data-testactive') === 'true' : null,
          time: timeEl ? timeEl.textContent.trim() : null,
          progress: sliderEl ? parseFloat(sliderEl.getAttribute('aria-valuenow')) || 0 : 0,
          buffered: bufferedEl ? parseFloat(bufferedEl.getAttribute('aria-valuenow')) || 0 : 0,
          shuffleOn: shuffleEl ? shuffleEl.getAttribute('data-testactive') === 'true' : false,
          repeatState: repeatEl ? repeatEl.getAttribute('data-teststate') : 'none',
          liked: likeEl ? likeEl.getAttribute('data-testactive') === 'true' : false,
          disliked: dislikeEl ? dislikeEl.getAttribute('data-testactive') === 'true' : false,
          volume: volumeEl ? parseFloat(volumeEl.getAttribute('aria-valuenow')) || 0 : 0,
          muted: muteEl ? muteEl.getAttribute('aria-label') === 'Включить звук' : false
        });
      }
      let lastJson = '';
      let emitTimer = null;
      function emit(force) {
        const json = readState();
        if (!force && json === lastJson) return;
        lastJson = json;
        console.log('${STATE_PREFIX}' + json);
      }
      // Мутации приходят пачками (React перерисовывает несколько узлов за раз) —
      // копим их 150мс и читаем состояние один раз на пачку.
      function scheduleEmit() {
        if (emitTimer) return;
        emitTimer = setTimeout(() => { emitTimer = null; emit(false); }, 150);
      }
      const observer = new MutationObserver(scheduleEmit);
      let observedNode = null;
      // Контейнер плеера не ищем отдельным селектором — берём наименьшего общего
      // предка уже известных элементов (название/play/прогресс/громкость), чтобы
      // не зависеть от ещё одного куска вёрстки VK.
      function findPlayerRoot() {
        const anchors = [pick(sel.trackTitle), pick(sel.playPauseButton), pick(sel.progressSlider), pick(sel.volumeSlider)].filter(Boolean);
        if (!anchors.length) return null;
        let root = anchors[0];
        for (const el of anchors.slice(1)) {
          while (root && !root.contains(el)) root = root.parentElement;
        }
        return root;
      }
      function attach() {
        const root = findPlayerRoot();
        if (!root) return;
        observer.disconnect();
        observedNode = root;
        observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
        emit(true);
      }
      // Страховка: при старте плеера может ещё не быть в DOM, а React может
      // пересоздать его контейнер целиком — тогда переприкрепляем наблюдателя.
      window.__vkStateObserverTimer = setInterval(() => {
        if (!observedNode || !observedNode.isConnected) attach();
      }, 3000);
      attach();
      return 'installed';
    })();
  `;
}

function clickScript(kind) {
  const map = {
    playpause: 'playPauseButton', next: 'nextButton', prev: 'prevButton',
    shuffle: 'shuffleButton', repeat: 'repeatButton', like: 'likeButton',
    dislike: 'dislikeButton', similar: 'openSimilarButton', lyrics: 'openLyricsButton',
    broadcast: 'broadcastButton', share: 'shareButton', mute: 'muteButton'
  };
  return `
    (function() {
      ${pickHelper()}
      const sel = ${JSON.stringify(SELECTORS)};
      const el = pick(sel['${map[kind]}']);
      if (el) el.click();
      return !!el;
    })();
  `;
}

function seekScript(ratio) {
  return `
    (function() {
      ${pickHelper()}
      const sel = ${JSON.stringify(SELECTORS)};
      const diag = { ratio: ${ratio} };
      // Если найдём настоящий <audio> — это самый надёжный способ перемотки.
      const audios = Array.from(document.querySelectorAll('audio'));
      diag.audioCount = audios.length;
      const audio = audios.find(a => isFinite(a.duration) && a.duration > 0);
      if (audio) {
        audio.currentTime = audio.duration * ${ratio};
        diag.method = 'audio';
        return JSON.stringify(diag);
      }
      // Иначе просто возвращаем координаты трека — реальный клик отправит хост
      // через webview.sendInputEvent (доверенное событие, в отличие от dispatchEvent).
      const track = pick(sel.progressTrack);
      diag.trackFound = !!track;
      if (!track) { diag.method = 'none'; return JSON.stringify(diag); }
      const rect = track.getBoundingClientRect();
      diag.rect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      diag.method = 'input-event';
      return JSON.stringify(diag);
    })();
  `;
}

function volumeSeekScript(ratio) {
  return `
    (function() {
      ${pickHelper()}
      const sel = ${JSON.stringify(SELECTORS)};
      const diag = { ratio: ${ratio} };
      const audios = Array.from(document.querySelectorAll('audio'));
      const audio = audios[0];
      if (audio) {
        audio.volume = Math.min(1, Math.max(0, ${ratio}));
        diag.method = 'audio';
        return JSON.stringify(diag);
      }
      const track = pick(sel.volumeTrack);
      diag.trackFound = !!track;
      if (!track) { diag.method = 'none'; return JSON.stringify(diag); }
      const rect = track.getBoundingClientRect();
      diag.rect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      diag.method = 'input-event';
      return JSON.stringify(diag);
    })();
  `;
}

let seeking = false;
let volumeDragging = false;
let lastState = null;

// Локальное состояние прогресса — между опросами VK (раз в 1.5с) тикаем сами,
// чтобы полоска двигалась плавно, а не рывками. Ресинк на каждом опросе.
const progressState = {
  baseElapsedSec: 0,   // прошедшее время на момент последнего опроса
  totalSec: 0,         // полная длительность трека (стабилизируется на трек)
  isPlaying: false,
  lastSyncTs: 0,       // performance.now() последнего опроса
  trackKey: null,      // title|artist — для детекта смены трека
  hasTrack: false,     // есть ли вообще загруженный трек
  bufferedPct: 0       // сколько трека уже скачано (из VK, 0-100)
};

const PLAY_D = 'M8 17.175V6.825q0-.425.3-.713t.7-.287q.125 0 .263.037t.262.113l8.15 5.175q.225.15.338.375t.112.475t-.112.475t-.338.375l-8.15 5.175q-.125.075-.262.113T9 18.175q-.4 0-.7-.288t-.3-.712';
const PAUSE_D = 'M16 19q-.825 0-1.412-.587T14 17V7q0-.825.588-1.412T16 5t1.413.588T18 7v10q0 .825-.587 1.413T16 19m-8 0q-.825 0-1.412-.587T6 17V7q0-.825.588-1.412T8 5t1.413.588T10 7v10q0 .825-.587 1.413T8 19';
const LIKE_OUTLINE_D = 'M11.288 20.2q-.363-.125-.638-.4l-1.725-1.575q-2.65-2.425-4.787-4.812T2 8.15Q2 5.8 3.575 4.225T7.5 2.65q1.325 0 2.5.562t2 1.538q.825-.975 2-1.537t2.5-.563q2.35 0 3.925 1.575T22 8.15q0 2.875-2.125 5.275T15.05 18.25l-1.7 1.55q-.275.275-.637.4t-.713.125t-.712-.125M11.05 6.75q-.725-1.025-1.55-1.562t-2-.538q-1.5 0-2.5 1t-1 2.5q0 1.3.925 2.763t2.213 2.837t2.65 2.575T12 18.3q.85-.775 2.213-1.975t2.65-2.575t2.212-2.837T20 8.15q0-1.5-1-2.5t-2.5-1q-1.175 0-2 .538T12.95 6.75q-.175.25-.425.375T12 7.25t-.525-.125t-.425-.375m.95 4.725';
const LIKE_FILLED_D = 'M11.288 20.2q-.363-.125-.638-.4l-1.725-1.575q-2.65-2.425-4.787-4.812T2 8.15Q2 5.8 3.575 4.225T7.5 2.65q1.325 0 2.5.562t2 1.538q.825-.975 2-1.537t2.5-.563q2.35 0 3.925 1.575T22 8.15q0 2.875-2.125 5.275T15.05 18.25l-1.7 1.55q-.275.275-.637.4t-.713.125t-.712-.125M11.05 6.75q-.725-1.025-1.55-1.562t-2-.538q-1.5 0-2.5 1t-1 2.5q0 1.3.925 2.763t2.213 2.837t2.65 2.575T12 18.3q.85-.775 2.213-1.975t2.65-2.575t2.212-2.837T20 8.15q0-1.5-1-2.5t-2.5-1q-1.175 0-2 .538T12.95 6.75q-.175.25-.425.375T12 7.25t-.525-.125t-.425-.375m.95 4.725';
const REPEAT_D = 'm6.85 19l.85.85q.3.3.288.7t-.288.7q-.3.3-.712.313t-.713-.288L3.7 18.7q-.15-.15-.213-.325T3.426 18t.063-.375t.212-.325l2.575-2.575q.3-.3.713-.287t.712.312q.275.3.288.7t-.288.7l-.85.85H17v-3q0-.425.288-.712T18 13t.713.288T19 14v3q0 .825-.587 1.413T17 19zm10.3-12H7v3q0 .425-.288.713T6 11t-.712-.288T5 10V7q0-.825.588-1.412T7 5h10.15l-.85-.85q-.3-.3-.288-.7t.288-.7q.3-.3.712-.312t.713.287L20.3 5.3q.15.15.213.325t.062.375t-.062.375t-.213.325l-2.575 2.575q-.3.3-.712.288T16.3 9.25q-.275-.3-.288-.7t.288-.7z';
const REPEAT_ONE_D = 'M11.5 10.5h-.75q-.325 0-.537-.213T10 9.75t.213-.537T10.75 9H12q.425 0 .713.288T13 10v4.25q0 .325-.213.538T12.25 15t-.537-.213t-.213-.537zM6.85 19l.85.85q.3.3.288.7t-.288.7q-.3.3-.712.313t-.713-.288L3.7 18.7q-.15-.15-.213-.325T3.426 18t.063-.375t.212-.325l2.575-2.575q.3-.3.713-.287t.712.312q.275.3.288.7t-.288.7l-.85.85H17v-3q0-.425.288-.712T18 13t.713.288T19 14v3q0 .825-.587 1.413T17 19zm10.3-12H7v3q0 .425-.288.713T6 11t-.712-.288T5 10V7q0-.825.588-1.412T7 5h10.15l-.85-.85q-.3-.3-.288-.7t.288-.7q.3-.3.712-.312t.713.287L20.3 5.3q.15.15.213.325t.062.375t-.062.375t-.213.325l-2.575 2.575q-.3.3-.712.288T16.3 9.25q-.275-.3-.288-.7t.288-.7z';
const VOLUME_UP_D = 'M19 11.975q0-2.075-1.1-3.787t-2.95-2.563q-.375-.175-.55-.537t-.05-.738q.15-.4.538-.575t.787 0Q18.1 4.85 19.55 7.063T21 11.974t-1.45 4.913t-3.875 3.287q-.4.175-.788 0t-.537-.575q-.125-.375.05-.737t.55-.538q1.85-.85 2.95-2.562t1.1-3.788M7 15H4q-.425 0-.712-.288T3 14v-4q0-.425.288-.712T4 9h3l3.3-3.3q.475-.475 1.088-.213t.612.938v11.15q0 .675-.612.938T10.3 18.3zm9.5-3q0 1.05-.475 1.988t-1.25 1.537q-.25.15-.513.013T14 15.1V8.85q0-.3.263-.437t.512.012q.775.625 1.25 1.575t.475 2';
const VOLUME_OFF_D = 'M16.775 19.575q-.275.175-.55.325t-.575.275q-.375.175-.762 0t-.538-.575q-.15-.375.038-.737t.562-.538q.1-.05.188-.1t.187-.1L12 14.8v2.775q0 .675-.612.938T10.3 18.3L7 15H4q-.425 0-.712-.288T3 14v-4q0-.425.288-.712T4 9h2.2L2.1 4.9q-.275-.275-.275-.7t.275-.7t.7-.275t.7.275l17 17q.275.275.275.7t-.275.7t-.7.275t-.7-.275zm2.225-7.6q0-2.075-1.1-3.787t-2.95-2.563q-.375-.175-.55-.537t-.05-.738q.15-.4.538-.575t.787 0Q18.1 4.85 19.55 7.05T21 11.975q0 .825-.15 1.638t-.425 1.562q-.2.55-.612.688t-.763.012t-.562-.45t-.013-.75q.275-.65.4-1.312T19 11.975m-4.225-3.55Q15.6 8.95 16.05 10t.45 2v.25q0 .125-.025.25q-.05.325-.35.425t-.55-.15L14.3 11.5q-.15-.15-.225-.337T14 10.775V8.85q0-.3.263-.437t.512.012M9.75 6.95Q9.6 6.8 9.6 6.6t.15-.35l.55-.55q.475-.475 1.087-.213t.613.938V8q0 .35-.3.475t-.55-.125z';

function parseTimeToSeconds(str) {
  if (!str) return null;
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  return parts.reduce((acc, val) => acc * 60 + val, 0);
}

function formatSeconds(sec) {
  if (!isFinite(sec) || sec < 0) return '';
  sec = Math.round(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function setIconPath(selector, d) {
  document.querySelectorAll(selector + ' path').forEach(path => path.setAttribute('d', d));
}

function setActive(selector, isActive) {
  document.querySelectorAll(selector).forEach(el => el.classList.toggle('active', !!isActive));
}

// Отрисовка прогресса из локального состояния. Если трек играет — интерполируем
// прошедшее время от момента последнего опроса, иначе показываем замороженное.
function renderProgress() {
  if (seeking) return; // во время перемотки за fill отвечает обработчик драга
  const ps = progressState;
  const scrubberMini = document.getElementById('progress-scrubber');
  const scrubberFull = document.getElementById('progress-track-full');

  // Пока не знаем длительность трека (первые секунды после старта — VK ещё
  // не даёт достаточно данных, чтобы её вычислить) — показываем анимацию
  // загрузки вместо пустой/дёрганой полоски. Но только пока трек реально
  // играет: на паузе (например, сразу после запуска приложения) длительность
  // ждать неоткуда, и штриховка крутилась бы вечно.
  const isLoading = ps.hasTrack && ps.isPlaying && !(ps.totalSec > 0);
  if (scrubberMini) scrubberMini.classList.toggle('loading', isLoading);
  if (scrubberFull) scrubberFull.classList.toggle('loading', isLoading);
  if (isLoading) return;

  let elapsed = ps.baseElapsedSec;
  if (ps.isPlaying && ps.totalSec > 0) {
    elapsed += (performance.now() - ps.lastSyncTs) / 1000;
  }
  // Клэмпим вне зависимости от isPlaying — иначе после паузы (или на стыке
  // опроса) текст времени и сама полоска могут разъехаться.
  if (ps.totalSec > 0 && elapsed > ps.totalSec) elapsed = ps.totalSec;
  const pct = ps.totalSec > 0 ? Math.min(100, (elapsed / ps.totalSec) * 100) : 0;
  const fillMini = document.getElementById('progress-fill-mini');
  const fillFull = document.getElementById('progress-fill-full');
  const bufferedMini = document.getElementById('progress-buffered-mini');
  const bufferedFull = document.getElementById('progress-buffered-full');
  if (fillMini) fillMini.style.width = pct + '%';
  if (fillFull) fillFull.style.width = pct + '%';
  if (bufferedMini) bufferedMini.style.width = ps.bufferedPct + '%';
  if (bufferedFull) bufferedFull.style.width = ps.bufferedPct + '%';
  const elapsedText = formatSeconds(elapsed) || '0:00';
  const totalText = ps.totalSec > 0 ? formatSeconds(ps.totalSec) : '';
  const readoutText = totalText ? `${elapsedText} / ${totalText}` : elapsedText;
  const elReadout = document.getElementById('time-readout');
  const elFull = document.getElementById('progress-time-full');
  if (elReadout) elReadout.textContent = readoutText;
  if (elFull) elFull.textContent = readoutText;
}

function updateUI(state) {
  if (!state) return;
  const titleMini = document.getElementById('track-title-mini');
  const artistMini = document.getElementById('track-artist-mini');
  const coverMini = document.getElementById('cover-mini');
  const titleFull = document.getElementById('track-title-full');
  const artistFull = document.getElementById('track-artist-full');
  const coverFull = document.getElementById('cover-full');

  titleMini.textContent = state.title || 'Ничего не играет';
  artistMini.textContent = state.artist || 'Открой трек в VK Музыке';
  titleFull.textContent = state.title || 'Ничего не играет';
  artistFull.textContent = state.artist || '';
  if (state.cover) {
    coverMini.src = state.cover;
    coverFull.src = state.cover;
    updateDynamicAccent(state.cover);
  }

  setIconPath('.btn-playpause', state.isPlaying ? PAUSE_D : PLAY_D);
  // Эквалайзер у названия трека оживает только пока музыка реально играет
  const eqMini = document.getElementById('eq-mini');
  if (eqMini) eqMini.classList.toggle('playing', !!state.isPlaying);

  // Синхронизируем базовое состояние прогресса из опроса; между опросами
  // отрисовкой занимается renderProgress (см. локальный тикер).
  // Предпочитаем точные секунды из <audio>; текст таймера и процент слайдера —
  // запасной путь (например, пока <audio> ещё не создан или у эфира duration
  // Infinity). Оценка по проценту дрожит из-за округлений — из-за неё общая
  // длительность раньше «плавала» на каждом обновлении.
  const elapsedSec = state.currentSec != null ? state.currentSec : parseTimeToSeconds(state.time);
  const trackKey = (state.title || '') + '|' + (state.artist || '');
  let totalCandidate = state.durationSec > 0
    ? state.durationSec
    : ((elapsedSec != null && state.progress > 0) ? elapsedSec / (state.progress / 100) : 0);
  // "Пристёгиваем" дрожащую оценку к точной длительности одного из
  // перехваченных MediaSource: берём ближайшую, если она согласуется с
  // оценкой (не согласуется — значит это чужой стрим, например предзагрузка
  // следующего трека). Промах на близких длительностях не страшен — ошибка
  // тогда того же масштаба, что и у самой оценки.
  if (!(state.durationSec > 0) && totalCandidate > 0 && Array.isArray(state.msDurations)) {
    const tolerance = Math.max(4, totalCandidate * 0.2);
    let best = null;
    for (const d of state.msDurations) {
      const diff = Math.abs(d - totalCandidate);
      if (diff <= tolerance && (best === null || diff < Math.abs(best - totalCandidate))) best = d;
    }
    if (best !== null) totalCandidate = best;
  }
  const sameTrack = progressState.trackKey === trackKey;
  // Длительность пересчитываем на каждом опросе (а не фиксируем один раз на трек):
  // для обычных треков соотношение прошло/процент стабильно и пересчёт почти не
  // меняет результат, а для радио/эфиров (где нет фиксированной длины и процент
  // VK живёт своей жизнью) пересчёт не даёт оценке застрять на заниженном значении —
  // из-за которого полоска раньше времени показывала 100%, пока эфир ещё игрался.
  // Пропускаем только явно нулевые/битые чтения (progress<=0), чтобы не занулить
  // уже известную хорошую оценку из-за одного глючного опроса.
  if (!sameTrack || totalCandidate > 0) {
    progressState.totalSec = totalCandidate;
  }
  let newBaseElapsedSec = elapsedSec != null ? elapsedSec : 0;
  // VK отдаёт время округлённым до секунды и с задержкой самого опроса — новое
  // значение почти всегда чуть меньше того, что уже показывает локальный тикер.
  // Если разница небольшая (обычный джиттер округления/задержки), не отматываем
  // полоску назад, а продолжаем с уже показанной позиции; настоящий скачок
  // (перемотка, смена трека, пауза) всё равно применится.
  if (sameTrack && progressState.isPlaying && state.isPlaying && progressState.totalSec > 0) {
    const predicted = progressState.baseElapsedSec + (performance.now() - progressState.lastSyncTs) / 1000;
    if (newBaseElapsedSec < predicted && (predicted - newBaseElapsedSec) < 1.5) {
      newBaseElapsedSec = predicted;
    }
  }
  // Смена трека — обновляем тултип иконки в трее
  if (trackKey !== progressState.trackKey && window.app.setTrackInfo) {
    window.app.setTrackInfo(state.title ? `${state.title} — ${state.artist || ''}` : '');
  }
  progressState.baseElapsedSec = newBaseElapsedSec;
  progressState.isPlaying = !!state.isPlaying;
  progressState.trackKey = trackKey;
  progressState.hasTrack = !!state.title;
  progressState.bufferedPct = Math.min(100, Math.max(0, state.buffered || 0));
  progressState.lastSyncTs = performance.now();
  renderProgress();

  setActive('.btn-shuffle', state.shuffleOn);
  setActive('.btn-repeat', state.repeatState && state.repeatState !== 'none');
  setIconPath('.btn-repeat', state.repeatState === 'one' ? REPEAT_ONE_D : REPEAT_D);
  setActive('.btn-like', state.liked);
  setIconPath('.btn-like', state.liked ? LIKE_FILLED_D : LIKE_OUTLINE_D);
  setActive('.btn-dislike', state.disliked);

  if (!volumeDragging) {
    const vol = Math.min(100, Math.max(0, state.volume || 0));
    document.querySelectorAll('.volume-fill-el').forEach(el => { el.style.width = vol + '%'; });
  }
  setIconPath('.btn-mute', state.muted ? VOLUME_OFF_D : VOLUME_UP_D);
  // Фон развёрнутого плеера (#cover-bg) теперь — амбиент из акцентного цвета,
  // целиком на CSS-переменных; картинку сюда больше не подставляем.
}

// ---------- Динамический акцент от обложки ----------
// По макету: --accent по умолчанию #FFB454, но если удаётся вытащить
// доминирующий цвет обложки — красим им весь интерфейс (переменные --accent /
// --accent-rgb). Обложки VK лежат на CDN; если он не отдаёт CORS-заголовки,
// canvas окажется "испорченным" и чтение пикселей бросит — тогда молча
// остаёмся на дефолте.
const ACCENT_DEFAULT = { r: 255, g: 180, b: 84 };
let lastAccentCover = null;
function applyAccent({ r, g, b }) {
  const root = document.documentElement;
  root.style.setProperty('--accent', `rgb(${r},${g},${b})`);
  root.style.setProperty('--accent-rgb', `${r},${g},${b}`);
}
function updateDynamicAccent(coverUrl) {
  if (coverUrl === lastAccentCover) return;
  lastAccentCover = coverUrl;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const size = 24; // уменьшенная копия — быстрее и усредняет шум
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      // Средний цвет по "живым" пикселям (не почти-чёрным и не почти-белым),
      // чтобы фон/виньетки обложки не утаскивали акцент в серость
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const pr = data[i], pg = data[i + 1], pb = data[i + 2];
        const lum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
        if (lum < 28 || lum > 235) continue;
        r += pr; g += pg; b += pb; n++;
      }
      if (!n) { applyAccent(ACCENT_DEFAULT); return; }
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
      // Подсветляем и насыщаем до читаемого акцента (среднее часто мутное)
      const max = Math.max(r, g, b) || 1;
      const boost = 215 / max;
      r = Math.min(255, Math.round(r * boost));
      g = Math.min(255, Math.round(g * boost));
      b = Math.min(255, Math.round(b * boost));
      applyAccent({ r, g, b });
    } catch (e) {
      applyAccent(ACCENT_DEFAULT); // canvas taint / CORS — остаёмся на дефолте
    }
  };
  img.onerror = () => applyAccent(ACCENT_DEFAULT);
  img.src = coverUrl;
}

webview.addEventListener('console-message', (e) => {
  if (typeof e.message !== 'string' || !e.message.startsWith(STATE_PREFIX)) return;
  try {
    const state = JSON.parse(e.message.slice(STATE_PREFIX.length));
    lastState = state;
    updateUI(state);
    // Разделы (views/*) подписываются на это событие, чтобы реагировать на
    // смену трека (например, подсветка играющей строки в "Моей музыке"),
    // не залезая в код оболочки.
    window.dispatchEvent(new CustomEvent('vk-player-state', { detail: state }));
  } catch (err) { /* битое сообщение — пропускаем */ }
});

webview.addEventListener('dom-ready', () => {
  webview.executeJavaScript(installStateObserverScript()).catch(() => {});
});

// Локальный тикер прогресса — плавно двигает полоску между опросами VK.
setInterval(renderProgress, 250);

// ---------- Кнопки управления (мини-панель и полноэкранная, через data-action) ----------
function sendCommand(kind) {
  webview.executeJavaScript(clickScript(kind)).catch(() => {});
}

document.querySelectorAll('[data-action]').forEach(btn => {
  btn.addEventListener('click', () => sendCommand(btn.dataset.action));
});

// ---------- Перемотка (seek) кликом/драгом по прогресс-бару ----------
function setupSeek(trackEl, fillEl) {
  function ratioFromEvent(e) {
    const rect = trackEl.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  }
  function onMove(e) {
    const ratio = ratioFromEvent(e);
    document.getElementById('progress-fill-mini').style.width = (ratio * 100) + '%';
    document.getElementById('progress-fill-full').style.width = (ratio * 100) + '%';
  }
  function onUp(e) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    trackEl.classList.remove('seeking');
    const ratio = ratioFromEvent(e);
    // Доверенный клик (sendInputEvent) не доходит, пока webview скрыт
    // (visibility:hidden) — как и у остальных кликов по VK в приложении,
    // на время попытки временно делаем его видимым для компоновщика.
    const manual = beginAutomation();
    webview.executeJavaScript(seekScript(ratio))
      .then(async raw => {
        const diag = JSON.parse(raw);
        console.log('[VK Player] seek diag:', diag);
        if (diag.method === 'input-event' && diag.rect) {
          const x = Math.round(diag.rect.left + diag.rect.width * ratio);
          const y = Math.round(diag.rect.top + diag.rect.height / 2);
          await wait(80);
          sendTrustedClick(x, y);
          console.log('[VK Player] sent trusted click at', x, y);
          await wait(150);
        }
      })
      .catch(err => console.error('[VK Player] seek error:', err))
      .finally(() => endAutomation(manual));
    setTimeout(() => { seeking = false; }, 400);
  }
  trackEl.addEventListener('mousedown', (e) => {
    seeking = true;
    trackEl.classList.add('seeking');
    onMove(e);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

setupSeek(document.getElementById('progress-scrubber'), document.getElementById('progress-fill-mini'));
setupSeek(document.getElementById('progress-track-full'), document.getElementById('progress-fill-full'));

// ---------- Громкость кликом/драгом по ползунку ----------
function setupVolume(trackEl, fillEl) {
  function ratioFromEvent(e) {
    const rect = trackEl.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  }
  function onMove(e) {
    const ratio = ratioFromEvent(e);
    fillEl.style.width = (ratio * 100) + '%';
  }
  function onUp(e) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    trackEl.classList.remove('seeking');
    const ratio = ratioFromEvent(e);
    const manual = beginAutomation();
    webview.executeJavaScript(volumeSeekScript(ratio))
      .then(async raw => {
        const diag = JSON.parse(raw);
        console.log('[VK Player] volume diag:', diag);
        if (diag.method === 'input-event' && diag.rect) {
          const x = Math.round(diag.rect.left + diag.rect.width * ratio);
          const y = Math.round(diag.rect.top + diag.rect.height / 2);
          await wait(80);
          sendTrustedClick(x, y);
          await wait(150);
        }
      })
      .catch(err => console.error('[VK Player] volume error:', err))
      .finally(() => endAutomation(manual));
    setTimeout(() => { volumeDragging = false; }, 400);
  }
  trackEl.addEventListener('mousedown', (e) => {
    volumeDragging = true;
    trackEl.classList.add('seeking');
    onMove(e);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Колёсико над зоной громкости: шаг 5%
  function applyVolume(ratio) {
    const manual = beginAutomation();
    webview.executeJavaScript(volumeSeekScript(ratio))
      .then(async raw => {
        const diag = JSON.parse(raw);
        if (diag.method === 'input-event' && diag.rect) {
          const x = Math.round(diag.rect.left + diag.rect.width * ratio);
          const y = Math.round(diag.rect.top + diag.rect.height / 2);
          await wait(80);
          sendTrustedClick(x, y);
          await wait(150);
        }
      })
      .catch(() => {})
      .finally(() => endAutomation(manual));
  }
  const wheelZone = trackEl.parentElement; // #volume-control: кнопка mute + дорожка
  wheelZone.addEventListener('wheel', (e) => {
    e.preventDefault();
    const cur = parseFloat(fillEl.style.width) || 0;
    const next = Math.min(100, Math.max(0, cur + (e.deltaY < 0 ? 5 : -5)));
    fillEl.style.width = next + '%';
    applyVolume(next / 100);
  }, { passive: false });
}

setupVolume(document.getElementById('volume-track'), document.getElementById('volume-fill'));
setupVolume(document.getElementById('volume-track-full'), document.getElementById('volume-fill-full'));

// ---------- Пробел = play/pause (если фокус не в поле ввода) ----------
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  e.preventDefault(); // чтобы сфокусированная кнопка не "нажалась" пробелом вдобавок
  sendCommand('playpause');
});

// ---------- Полноэкранный Now Playing ----------
// В развёрнутом виде нижний бар прячем (иначе всё задублировано: два
// прогресса, два комплекта кнопок) — класс на body управляет этим из CSS
const fullView = document.getElementById('now-playing-full');
function setExpanded(expanded) {
  fullView.classList.toggle('hidden', !expanded);
  document.body.classList.toggle('player-expanded', expanded);
}
document.getElementById('btn-expand').onclick = () => setExpanded(fullView.classList.contains('hidden'));
document.getElementById('btn-collapse').onclick = () => setExpanded(false);

// ---------- Просмотр обложки (клик по мини-обложке в баре) ----------
const coverLightbox = document.getElementById('cover-lightbox');
const coverLightboxImg = document.getElementById('cover-lightbox-img');
const coverLightboxTitle = document.getElementById('cover-lightbox-title');
const coverLightboxArtist = document.getElementById('cover-lightbox-artist');
document.getElementById('cover-mini').addEventListener('click', () => {
  const src = document.getElementById('cover-mini').src;
  if (!src) return;
  coverLightboxImg.src = src;
  coverLightboxTitle.textContent = document.getElementById('track-title-mini').textContent;
  coverLightboxArtist.textContent = document.getElementById('track-artist-mini').textContent;
  coverLightbox.classList.remove('hidden');
});
coverLightbox.addEventListener('click', () => coverLightbox.classList.add('hidden'));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!coverLightbox.classList.contains('hidden')) { coverLightbox.classList.add('hidden'); return; }
  if (!fullView.classList.contains('hidden')) setExpanded(false);
});

// ---------- Медиа-клавиши клавиатуры ----------
window.app.onMediaKey((key) => sendCommand(key));

// ---------- Сплэш при запуске: последовательный прогрев всех страниц ----------
// VK-движок один на всё приложение, поэтому страницы грузятся строго по
// очереди: база VK -> Главная + Моя музыка (один и тот же скрейп-источник) ->
// тихий визит в плейлисты -> возврат на базу. Пользователь всё это время видит
// экран загрузки с чек-листом; титулбар остаётся доступным (сплэш ниже него).
const bootSplashEl = document.getElementById('boot-splash');
const bootBarFillEl = document.getElementById('boot-bar-fill');

function bootStage(name, state) {
  const el = bootSplashEl.querySelector(`.boot-stage[data-stage="${name}"]`);
  if (!el) return;
  el.classList.toggle('active', state === 'active');
  if (state === 'done') el.classList.add('done');
}

// Прогресс: границы отрезков — честные точки завершения этапов, а внутри
// отрезка полоска асимптотически ползёт к потолку, пока этап реально идёт
// (движение = работа; настоящая длительность этапов VK заранее неизвестна,
// поэтому «проценты внутри этапа» иначе не измерить). Достигнуть потолка
// полоска может только фактическим завершением этапа — bootPhase ставит
// floor мгновенно.
let bootPct = 0;
let bootCeil = 0;
const bootTicker = setInterval(() => {
  bootPct += (bootCeil - bootPct) * 0.055; // полпути к потолку за ~1.2с, дальше медленнее
  bootBarFillEl.style.width = bootPct + '%';
}, 100);
function bootPhase(floor, ceil) {
  bootPct = Math.max(bootPct, floor);
  bootCeil = ceil;
  bootBarFillEl.style.width = bootPct + '%';
}

function finishBoot() {
  if (bootSplashEl.classList.contains('fade-out')) return;
  clearInterval(bootTicker);
  bootBarFillEl.style.width = '100%';
  bootSplashEl.classList.add('fade-out');
  setTimeout(() => bootSplashEl.remove(), 700);
}

// ---------- Требуется внимание в VK: вход, капча, подтверждение устройства ----------
// Событие шлёт shared.js (ensureBasePage) — сам показывает настоящий VK
// (#content.vk-visible), здесь только текст плашки и досрочное завершение
// сплэша, если запрос пришёл во время загрузки.
const vkAttentionEl = document.getElementById('vk-attention');
window.addEventListener('vk-needs-attention', (e) => {
  vkAttentionEl.classList.toggle('visible', !!e.detail);
  if (e.detail) finishBoot();
});

async function runBootSequence() {
  // Страховка: что бы ни случилось с VK, дольше 60с сплэш не живёт
  const watchdog = setTimeout(finishBoot, 60000);
  try {
    // 1. Движок VK: dom-ready — только каркас, React рисует каталог позже.
    // ensureBasePage сам пережидает буту (пустой href) до 15с.
    bootStage('engine', 'active');
    bootPhase(0, 30);
    await wait(1500);
    await window.Shared.ensureBasePage();
    bootStage('engine', 'done');

    // 2. Главная + Моя музыка — с одной и той же базовой страницы VK.
    // Ретраи на случай, если первый скрейп пришёлся на недогруженный каталог.
    bootStage('library', 'active');
    bootPhase(33, 45); // подэтап: Главная
    for (let attempt = 0; attempt < 3; attempt++) {
      await window.HomeView.loadHome();
      if (!window.HomeView.isEmpty()) break;
      await wait(4000);
    }
    bootPhase(48, 63); // подэтап: список Моей музыки
    await window.MyMusicView.loadMyMusic();
    bootStage('library', 'done');

    // 3. Плейлисты: SPA-переход на подстраницу, скрейп сетки, возврат на базу
    bootStage('playlists', 'active');
    bootPhase(66, 88); // подэтап: скрейп сетки плейлистов
    await window.PlaylistsView.loadPlaylists();
    bootPhase(90, 99); // подэтап: возврат VK на базовую страницу
    await window.Shared.ensureBasePage();
    bootStage('playlists', 'done');
    bootPhase(100, 100);
  } catch (e) {
    // Прогрев — оптимизация: при сбое просто открываем приложение,
    // страницы догрузятся по старой схеме при первом заходе
  }
  clearTimeout(watchdog);
  setTimeout(finishBoot, 400); // дать глазу увидеть 100%
}

webview.addEventListener('dom-ready', () => { runBootSequence(); }, { once: true });
