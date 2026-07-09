// ---------- Раздел "Поиск": поиск по каталогу музыки VK ----------
// У VK на странице каталога есть свой музыкальный поиск (input
// search_audio_input "Поиск музыки"). Печатаем туда запрос "по-реактовски"
// (нативный сеттер value + событие input — простое присваивание React не
// замечает), жмём синтетический Enter, ждём появления результатов в секции
// AudioCatalog_SectionAllTracks и собираем их. Запуск трека — тем же
// доверенным кликом, что и везде.
window.SearchView = (function () {
  const { webview, contentEl, wait, ensureBasePage, playViaTrustedClick } = window.Shared;

  function submitQueryHelper() {
    return `
      // VK кладёт запрос в URL с двойным кодированием (q=%25D0%259A... для
      // "Кино"), поэтому прямое сравнение q === query не срабатывало —
      // раскодируем до упора
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
      async function submitQuery(query) {
        const input = document.querySelector('[data-testid="search_audio_input"]');
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, query);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 250));
        input.focus();
        ['keydown', 'keypress', 'keyup'].forEach(type =>
          input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })));
        const start = Date.now();
        while (Date.now() - start < 6000) {
          await new Promise(r => setTimeout(r, 200));
          const rows = document.querySelectorAll('[data-testid="AudioCatalog_SectionAllTracks"] [data-testid="MusicTrackRow"]');
          if (queryFromUrl() === query && rows.length) return true;
        }
        return false;
      }
    `;
  }

  // Строки "Моих треков" в результатах: у VK для них нет секции с отдельным
  // testid — только заголовок AudioCatalog_BlockHeaderMyTracks, а строки лежат
  // в его ближайшем <section> (проверено на живой выдаче). Секции может не
  // быть вовсе, если в библиотеке нет совпадений.
  function collectResultsHelper() {
    return `
      function mapRows(rows) {
        return Array.from(rows).map((row, index) => {
          const titleEl = row.querySelector('[data-testid="MusicTrackRow_Title"]');
          const authorsEl = row.querySelector('[data-testid="MusicTrackRow_Authors"]');
          const durationEl = row.querySelector('[data-testid="MusicTrackRow_Duration"]');
          const img = row.querySelector('img');
          return {
            index,
            title: titleEl ? titleEl.textContent.trim() : '',
            artist: authorsEl ? authorsEl.textContent.trim() : '',
            duration: durationEl ? durationEl.textContent.trim() : '',
            cover: img ? img.src : ''
          };
        });
      }
      function myTracksRows() {
        const header = document.querySelector('[data-testid="AudioCatalog_BlockHeaderMyTracks"]');
        const sec = header ? header.closest('section') : null;
        return sec ? sec.querySelectorAll('[data-testid="MusicTrackRow"]') : [];
      }
      function allTracksRows() {
        return document.querySelectorAll('[data-testid="AudioCatalog_SectionAllTracks"] [data-testid="MusicTrackRow"]');
      }
    `;
  }

  function searchScript(query) {
    return `
      (async function() {
        ${submitQueryHelper()}
        ${collectResultsHelper()}
        try {
          // Если открыта модалка плейлиста — уберём, она перехватывает события
          const modalClose = document.querySelector('[data-testid="MusicPlaylistModal_Close"]');
          if (modalClose) { modalClose.click(); await new Promise(r => setTimeout(r, 600)); }
          const ok = await submitQuery(${JSON.stringify(query)});
          if (!ok) return JSON.stringify({ ok: false, reason: 'search-failed' });
          await new Promise(r => setTimeout(r, 300)); // дать секциям дорендериться
          return JSON.stringify({ ok: true, my: mapRows(myTracksRows()), all: mapRows(allTracksRows()) });
        } catch (e) {
          return JSON.stringify({ ok: false, reason: String(e) });
        }
      })();
    `;
  }

  // Координаты строки результата для доверенного клика. Если VK успел уйти со
  // страницы результатов (например, побывали в "Моей музыке") — повторяем
  // запрос перед кликом. scope: 'my' — строка из секции "Мои треки",
  // 'all' — из "Все треки" (индексы в каждой секции свои).
  function selectSearchTrackScript(query, scope, index) {
    return `
      (async function() {
        ${submitQueryHelper()}
        ${collectResultsHelper()}
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
        try {
          const rowsOfScope = () => ${JSON.stringify(scope)} === 'my' ? myTracksRows() : allTracksRows();
          let rows = rowsOfScope();
          if (!rows.length || queryFromUrl() !== ${JSON.stringify(query)}) {
            const ok = await submitQuery(${JSON.stringify(query)});
            if (!ok) return JSON.stringify({ ok: false, reason: 'search-restore-failed' });
            rows = rowsOfScope();
          }
          const row = rows[${index}];
          if (!row) return JSON.stringify({ ok: false, reason: 'row-not-found' });
          const controls = row.querySelector('[data-testid="MusicTrackRow_PlaybackControls"]') || row;
          controls.scrollIntoView({ block: 'center' });
          const settled = await waitFor(() => {
            const rr = controls.getBoundingClientRect();
            return (rr.top >= 0 && rr.top < window.innerHeight && rr.height > 0) ? rr : null;
          }, 2000);
          const r = settled || controls.getBoundingClientRect();
          return JSON.stringify({ ok: true, needsTrustedClick: true, x: r.left + r.width / 2, y: r.top + r.height / 2 });
        } catch (e) {
          return JSON.stringify({ ok: false, reason: String(e) });
        }
      })();
    `;
  }

  // Живые подсказки (как в оригинале VK): печатаем запрос в тот же VK-инпут
  // (нативный сеттер + событие input — без Enter) и читаем отрисованный VK
  // выпадающий список автокомплита (data-testid="search_suggestion"). Не
  // требует видимости webview — проверено, подсказки строятся и в скрытом
  // состоянии, в отличие от play/pause.
  function suggestionsScript(query) {
    return `
      (async function() {
        try {
          const input = document.querySelector('[data-testid="search_audio_input"]');
          if (!input) return JSON.stringify({ ok: false, reason: 'no-input' });
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, ${JSON.stringify(query)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const start = Date.now();
          let items = [];
          while (Date.now() - start < 1200) {
            await new Promise(r => setTimeout(r, 80));
            items = Array.from(document.querySelectorAll('[data-testid="search_suggestion"]')).map(el => el.textContent.trim());
            if (items.length) break;
          }
          return JSON.stringify({ ok: true, items });
        } catch (e) {
          return JSON.stringify({ ok: false, reason: String(e) });
        }
      })();
    `;
  }

  // Сброс поиска в VK при уходе из раздела: иначе каталог остаётся в режиме
  // результатов (q=...) и секция "Треки" моей библиотеки отсутствует — клики
  // по трекам "Моей музыки" перестали бы находить строки.
  function clearSearchScript() {
    return `
      (function() {
        const clear = document.querySelector('[data-testid="search_audio_clear"]');
        if (clear) clear.click();
        return JSON.stringify({ ok: !!clear });
      })();
    `;
  }

  const searchInputEl = document.getElementById('search-input');
  const searchStatusEl = document.getElementById('search-status');
  const searchListEl = document.getElementById('search-track-list');
  const suggestionsEl = document.getElementById('search-suggestions');
  let searchTracks = []; // плоский список отрисованных строк: {scope, ...track}
  let lastQuery = '';
  let searching = false;
  let vkSearchActive = false;

  // ---------- Живые подсказки ----------
  let suggestDebounceTimer = null;
  let suggestToken = 0; // растёт на каждый hide/новый запрос — отбрасывает устаревшие ответы
  let currentSuggestions = [];
  let activeSuggestionIndex = -1;

  function hideSuggestions() {
    suggestToken++; // инвалидируем любой ещё летящий запрос подсказок
    suggestionsEl.classList.add('hidden');
    suggestionsEl.innerHTML = '';
    currentSuggestions = [];
    activeSuggestionIndex = -1;
  }

  function moveActiveSuggestion(delta) {
    const items = Array.from(suggestionsEl.children);
    if (!items.length) return;
    activeSuggestionIndex = (activeSuggestionIndex + delta + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('active', i === activeSuggestionIndex));
    items[activeSuggestionIndex].scrollIntoView({ block: 'nearest' });
  }

  function selectSuggestion(text) {
    searchInputEl.value = text;
    hideSuggestions();
    doSearch();
  }

  function renderSuggestions(items) {
    if (!items.length) { hideSuggestions(); return; }
    currentSuggestions = items;
    activeSuggestionIndex = -1;
    suggestionsEl.innerHTML = '';
    items.forEach(text => {
      const el = document.createElement('div');
      el.className = 'search-suggestion-item';
      el.textContent = text;
      // mousedown, а не click — срабатывает раньше blur поля ввода
      el.addEventListener('mousedown', (e) => { e.preventDefault(); selectSuggestion(text); });
      suggestionsEl.appendChild(el);
    });
    suggestionsEl.classList.remove('hidden');
  }

  async function fetchSuggestions(query) {
    const myToken = ++suggestToken;
    try {
      let raw = await webview.executeJavaScript(suggestionsScript(query));
      let res = JSON.parse(raw);
      if (!res.ok && res.reason === 'no-input') {
        // VK мог остаться на подстранице (плейлисты) без строки поиска в DOM
        if (!(await ensureBasePage())) return;
        raw = await webview.executeJavaScript(suggestionsScript(query));
        res = JSON.parse(raw);
      }
      if (myToken !== suggestToken) return; // пришёл более новый запрос — этот ответ устарел
      renderSuggestions(res.ok ? res.items.slice(0, 8) : []);
    } catch (e) {
      if (myToken === suggestToken) renderSuggestions([]);
    }
  }

  searchInputEl.addEventListener('input', () => {
    const query = searchInputEl.value.trim();
    clearTimeout(suggestDebounceTimer);
    if (!query) { hideSuggestions(); return; }
    suggestDebounceTimer = setTimeout(() => fetchSuggestions(query), 300);
  });

  searchInputEl.addEventListener('blur', () => {
    // Небольшая задержка ни к чему: mousedown на подсказке уже вызвал
    // preventDefault и не даёт полю потерять фокус, так что здесь безопасно
    hideSuggestions();
  });

  // История запросов — локальная, VK не трогаем
  const HISTORY_KEY = 'vkmp-search-history';
  const HISTORY_MAX = 8;
  function readHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch (e) { return []; }
  }
  function saveToHistory(query) {
    const list = [query, ...readHistory().filter(q => q !== query)].slice(0, HISTORY_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  }

  // Пустое состояние до первого запроса: подсказка + недавние запросы
  function renderIdle() {
    searchListEl.innerHTML = '';
    const idle = document.createElement('div');
    idle.className = 'search-idle';
    const history = readHistory();
    idle.innerHTML = '<div class="search-idle-hint">Ищите по всей музыке ВКонтакте — треки, которых нет в вашей библиотеке, тоже найдутся.</div>';
    if (history.length) {
      const title = document.createElement('div');
      title.className = 'search-section-title';
      title.textContent = 'Недавние запросы';
      idle.appendChild(title);
      const chips = document.createElement('div');
      chips.className = 'search-history';
      history.forEach(q => {
        const chip = document.createElement('button');
        chip.className = 'search-chip';
        chip.textContent = q;
        chip.addEventListener('click', () => { searchInputEl.value = q; doSearch(); });
        chips.appendChild(chip);
      });
      idle.appendChild(chips);
    }
    searchListEl.appendChild(idle);
  }

  function formatSearchRow(track, scope) {
    const row = document.createElement('div');
    row.className = 'mymusic-row'; // тот же стиль строк, что в "Моей музыке"
    row.innerHTML = `
      <img class="mymusic-row-cover" src="${track.cover}" alt="">
      <div class="mymusic-row-info">
        <div class="mymusic-row-title"></div>
        <div class="mymusic-row-artist"></div>
      </div>
      <div class="mymusic-row-duration"></div>
    `;
    row.querySelector('.mymusic-row-title').textContent = track.title || 'Без названия';
    row.querySelector('.mymusic-row-artist').textContent = track.artist;
    row.querySelector('.mymusic-row-duration').textContent = track.duration;
    row.addEventListener('click', async () => {
      if (row.classList.contains('loading')) return;
      row.classList.add('loading');
      await ensureBasePage(); // selectSearchTrackScript сам повторит запрос, но только с базовой страницы
      const result = await playViaTrustedClick(selectSearchTrackScript(lastQuery, scope, track.index));
      row.classList.remove('loading');
      if (!result.ok) searchStatusEl.textContent = 'Не удалось запустить: ' + result.reason;
    });
    return row;
  }

  function renderSection(titleText, tracks, scope) {
    if (!tracks.length) return;
    const title = document.createElement('div');
    title.className = 'search-section-title';
    title.textContent = titleText;
    searchListEl.appendChild(title);
    tracks.forEach(track => {
      searchTracks.push({ ...track, scope });
      searchListEl.appendChild(formatSearchRow(track, scope));
    });
  }

  async function doSearch() {
    const query = searchInputEl.value.trim();
    if (!query || searching) return;
    hideSuggestions();
    clearTimeout(suggestDebounceTimer);
    searching = true;
    lastQuery = query;
    searchStatusEl.textContent = 'Ищу…';
    searchStatusEl.classList.add('loading');
    searchListEl.innerHTML = '';
    searchTracks = [];
    try {
      // Поиск работает только с базовой страницы каталога: на подстранице
      // плейлистов запрос уходил в никуда (q задваивался в URL) — search-failed
      if (!(await ensureBasePage())) { searchStatusEl.textContent = 'Не удалось: vk-page-not-ready'; return; }
      const raw = await webview.executeJavaScript(searchScript(query));
      const res = JSON.parse(raw);
      if (!res.ok) { searchStatusEl.textContent = 'Не удалось: ' + res.reason; return; }
      vkSearchActive = true;
      saveToHistory(query);
      // Как у VK: сперва совпадения из своей библиотеки, затем общий каталог
      renderSection('Мои треки', res.my, 'my');
      renderSection('Все треки', res.all, 'all');
      searchStatusEl.textContent = searchTracks.length ? '' : 'Ничего не найдено';
    } catch (err) {
      searchStatusEl.textContent = 'Ошибка: ' + err.message;
    } finally {
      searching = false;
      searchStatusEl.classList.remove('loading');
    }
  }

  searchInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (activeSuggestionIndex >= 0 && currentSuggestions[activeSuggestionIndex]) {
        selectSuggestion(currentSuggestions[activeSuggestionIndex]);
      } else {
        hideSuggestions();
        doSearch();
      }
      return;
    }
    if (e.key === 'Escape') { hideSuggestions(); return; }
    if (!currentSuggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); moveActiveSuggestion(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActiveSuggestion(-1); }
  });

  renderIdle();

  // Подсветка играющего трека в результатах
  window.addEventListener('vk-player-state', (e) => {
    const state = e.detail;
    const key = (state.title || '') + '|' + (state.artist || '');
    searchListEl.querySelectorAll('.mymusic-row').forEach((row, i) => {
      const track = searchTracks[i];
      row.classList.toggle('playing', !!track && !!state.title && (track.title + '|' + track.artist) === key);
    });
  });

  function focus() {
    searchInputEl.focus();
  }

  // Вызывается оболочкой при уходе из раздела
  function reset() {
    clearTimeout(suggestDebounceTimer);
    hideSuggestions();
    if (!vkSearchActive) return;
    vkSearchActive = false;
    webview.executeJavaScript(clearSearchScript()).catch(() => {});
  }

  return { focus, reset };
})();
