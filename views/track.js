// ---------- Страница трека ----------
// Показывает детали ТЕКУЩЕГО играющего трека (VK не даёt отдельных "страниц"
// произвольного трека вне плеера, поэтому это витрина вокруг уже играющего,
// а не независимая карточка любого трека из списка). Открывается кликом по
// названию в нижнем плеере (мини или полноэкранном).
window.TrackView = (function () {
  const { webview, ensureBasePage, wait } = window.Shared;

  const viewEl = document.getElementById('track-view');
  const backBtn = document.getElementById('track-back');
  const coverEl = document.getElementById('track-cover-big');
  const titleEl = document.getElementById('track-title-big');
  const artistBtn = document.getElementById('track-artist-big');
  const playLabelEl = document.getElementById('track-playpause-label');
  const statusEl = document.getElementById('track-status');

  let isOpen = false;
  let restoreView = null; // id экрана, на который вернуться по "Назад"
  let currentState = null;

  function applyState(state) {
    currentState = state;
    if (!isOpen) return;
    titleEl.textContent = state.title || 'Ничего не играет';
    artistBtn.textContent = state.artist || '';
    if (state.cover) coverEl.src = state.cover;
    playLabelEl.textContent = state.isPlaying ? 'Пауза' : 'Слушать';
  }
  window.addEventListener('vk-player-state', (e) => applyState(e.detail));

  function open() {
    if (isOpen) return;
    isOpen = true;
    restoreView = document.querySelector('.app-view:not(.hidden)')?.id || 'home-view';
    document.querySelectorAll('.nav-item[data-view]').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.app-view').forEach((v) => v.classList.toggle('hidden', v.id !== 'track-view'));
    statusEl.textContent = '';
    if (currentState) applyState(currentState);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    document.querySelectorAll('.app-view').forEach((v) => v.classList.toggle('hidden', v.id !== restoreView));
    const navBtn = document.querySelector(`.nav-item[data-view="${restoreView.replace('-view', '')}"]`);
    if (navBtn) navBtn.classList.add('active');
  }

  backBtn.addEventListener('click', close);

  // Пользователь ушёл в другой раздел напрямую через сайдбар, минуя кнопку
  // "Назад" — просто забываем состояние (видимость уже переключит общий
  // переключатель разделов в renderer.js), как у ArtistView/PlaylistsView.
  function closeIfOpenSilently() {
    isOpen = false;
  }

  // Открыть страницу трека — вызывается из плеер-бара (renderer.js навешивает
  // клики на #track-title-mini/#track-title-full)
  window.addEventListener('open-track-view', open);

  // ---------- Клик по имени артиста: найти его страницу через поиск VK и
  // открыть уже проверенным ArtistView (без своего дублирующего сканирования
  // DOM артиста) ----------
  // Тот же приём, что в search.js submitQueryHelper: дожидаемся не просто
  // появления секции музыкантов, а что URL реально дошёл до нашего запроса
  // (у VK поиск живой, Enter раньше отладки/автодополнения мог утащить не
  // туда — так однажды нашёлся совсем не тот артист).
  function findArtistScript(name) {
    return `
      (async function() {
        function waitFor(fn, timeoutMs) {
          return new Promise(resolve => {
            const start = Date.now();
            (function poll() {
              const el = fn();
              if (el) return resolve(el);
              if (Date.now() - start > timeoutMs) return resolve(null);
              setTimeout(poll, 100);
            })();
          });
        }
        function queryFromUrl() {
          let s = new URLSearchParams(location.search).get('q') || '';
          try {
            for (let i = 0; i < 3; i++) {
              const d = decodeURIComponent(s);
              if (d === s) break;
              s = d;
            }
          } catch (e) {}
          return s;
        }
        try {
          const modalClose = document.querySelector('[data-testid="MusicPlaylistModal_Close"]');
          if (modalClose) { modalClose.click(); await new Promise(r => setTimeout(r, 400)); }
          const input = document.querySelector('[data-testid="search_audio_input"]');
          if (!input) return JSON.stringify({ ok: false, reason: 'search-input-not-found' });
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, ${JSON.stringify(name)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 250));
          input.focus();
          ['keydown', 'keypress', 'keyup'].forEach(type =>
            input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })));
          const start = Date.now();
          let submitted = false;
          while (Date.now() - start < 6000) {
            await new Promise(r => setTimeout(r, 200));
            if (queryFromUrl() === ${JSON.stringify(name)}) { submitted = true; break; }
          }
          if (!submitted) return JSON.stringify({ ok: false, reason: 'search-not-submitted' });
          await new Promise(r => setTimeout(r, 300)); // дать секциям дорендериться
          const sec = await waitFor(() => document.querySelector('[data-testid="AudioCatalog_SectionMusicians"]'), 3000);
          if (!sec) return JSON.stringify({ ok: false, reason: 'artist-not-found' });
          const cell = sec.querySelector('[data-testid="links-cell"]');
          const link = cell ? cell.querySelector('a[href*="/artist/"]') : null;
          if (!link) return JSON.stringify({ ok: false, reason: 'artist-not-found' });
          const img = cell.querySelector('img');
          return JSON.stringify({ ok: true, name: link.textContent.trim(), href: link.getAttribute('href'), photo: img ? img.src : '' });
        } catch (e) {
          return JSON.stringify({ ok: false, reason: String(e) });
        }
      })();
    `;
  }

  artistBtn.addEventListener('click', async () => {
    const artistName = (currentState && currentState.artist) || '';
    if (!artistName) return;
    statusEl.textContent = 'Ищу артиста…';
    try {
      await ensureBasePage();
      const raw = await webview.executeJavaScript(findArtistScript(artistName));
      const res = JSON.parse(raw);
      if (!isOpen) return; // ушли со страницы, пока искали
      if (!res.ok) { statusEl.textContent = 'Артист не найден'; return; }
      statusEl.textContent = '';
      const trackRestoreView = restoreView;
      window.ArtistView.openArtist(res, () => {
        // Возврат из артиста — снова на страницу трека
        restoreView = trackRestoreView;
        isOpen = true;
        document.querySelectorAll('.app-view').forEach((v) => v.classList.toggle('hidden', v.id !== 'track-view'));
        if (currentState) applyState(currentState);
      });
      isOpen = false; // страница трека сейчас не видна, артист занял её место
    } catch (err) {
      if (isOpen) statusEl.textContent = 'Ошибка: ' + err.message;
    }
  });

  return { open, close, closeIfOpenSilently };
})();
