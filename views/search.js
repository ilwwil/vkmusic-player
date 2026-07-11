// ---------- Раздел "Поиск" + глобальная строка поиска сверху ----------
// У VK на странице каталога есть свой музыкальный поиск (input
// search_audio_input "Поиск музыки"). Печатаем туда запрос "по-реактовски"
// (нативный сеттер value + событие input — простое присваивание React не
// замечает), жмём синтетический Enter, ждём появления результатов и собираем
// секции: "Мои треки", "Все треки", "Альбомы", "Музыканты". Запуск трека —
// доверенным кликом, как везде.
// Глобальная строка сверху (по макету) — единая точка входа: там живут
// история запросов и живые подсказки VK; submit переключает на раздел Поиск.
window.SearchView = (function () {
  const { webview, contentEl, wait, ensureBasePage, playViaTrustedClick, sendTrustedClick, beginAutomation, endAutomation } = window.Shared;

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
  // в его ближайшем <section>. Секции может не быть вовсе.
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
      // Обложки альбомов — background-image, иногда на вложенном элементе
      function coverOf(item) {
        const pv = item.querySelector('[data-testid="MusicPlaylistItem_PreviewImage"]');
        if (!pv) return '';
        let bg = getComputedStyle(pv).backgroundImage;
        if (bg === 'none') {
          const inner = Array.from(pv.querySelectorAll('*')).find(e => getComputedStyle(e).backgroundImage !== 'none');
          bg = inner ? getComputedStyle(inner).backgroundImage : 'none';
        }
        if (bg === 'none') return '';
        return bg.replace(/^url\\(["']?/, '').replace(/["']?\\)$/, '');
      }
      function collectAlbums() {
        const sec = document.querySelector('[data-testid="AudioCatalog_SectionAlbums"]');
        if (!sec) return [];
        return Array.from(sec.querySelectorAll('[data-testid="music-playlists-slider-block-item"]')).map(item => {
          const t = item.querySelector('[data-testid="MusicPlaylistItem_Title"]');
          const a = item.querySelector('[data-testid="MusicPlaylistItem_AuthorLink"]');
          const y = item.querySelector('[data-testid="MusicPlaylistItem_ReleaseYear"]');
          return {
            title: t ? t.textContent.trim() : '',
            author: a ? a.textContent.trim() : '',
            year: y ? y.textContent.trim() : '',
            cover: coverOf(item)
          };
        }).filter(al => al.title);
      }
      function collectArtists() {
        const sec = document.querySelector('[data-testid="AudioCatalog_SectionMusicians"]');
        if (!sec) return [];
        return Array.from(sec.querySelectorAll('[data-testid="links-cell"]')).map(cell => {
          const link = cell.querySelector('a[href*="/artist/"]');
          const img = cell.querySelector('img');
          return {
            name: link ? link.textContent.trim() : '',
            photo: img ? img.src : ''
          };
        }).filter(ar => ar.name);
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
          return JSON.stringify({
            ok: true,
            my: mapRows(myTracksRows()),
            all: mapRows(allTracksRows()),
            albums: collectAlbums(),
            artists: collectArtists()
          });
        } catch (e) {
          return JSON.stringify({ ok: false, reason: String(e) });
        }
      })();
    `;
  }

  // Координаты строки результата для доверенного клика. Если VK успел уйти со
  // страницы результатов — повторяем запрос перед кликом. scope: 'my' — из
  // секции "Мои треки", 'all' — из "Все треки" (индексы в каждой свои).
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

  // Живые подсказки: печатаем запрос в VK-инпут (без Enter) и читаем
  // выпадающий автокомплит VK (data-testid="search_suggestion"). Работает и
  // при полностью скрытом webview — проверено.
  function suggestionsScript(query) {
    return `
      (async function() {
        try {
          const input = document.querySelector('[data-testid="search_audio_input"]');
          if (!input) return JSON.stringify({ ok: false, reason: 'no-input' });
          const read = () => Array.from(document.querySelectorAll('[data-testid="search_suggestion"]')).map(el => el.textContent.trim());
          // В DOM могут висеть подсказки предыдущего запроса — ждём не просто
          // «список непустой», а «список ИЗМЕНИЛСЯ» (иначе отдавали старые)
          const before = read().join('|');
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, ${JSON.stringify(query)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const start = Date.now();
          let items = [];
          while (Date.now() - start < 1500) {
            await new Promise(r => setTimeout(r, 80));
            items = read();
            if (items.length && items.join('|') !== before) break;
          }
          return JSON.stringify({ ok: true, items });
        } catch (e) {
          return JSON.stringify({ ok: false, reason: String(e) });
        }
      })();
    `;
  }

  // Сброс поиска в VK при уходе из раздела: иначе каталог остаётся в режиме
  // результатов (q=...) и секция "Треки" библиотеки отсутствует.
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
  const searchSubmitEl = document.getElementById('search-submit');
  const searchStatusEl = document.getElementById('search-status');
  const searchListEl = document.getElementById('search-track-list');
  const globalInputEl = document.getElementById('global-search-input');
  const globalClearEl = document.getElementById('global-search-clear');
  const suggestionsEl = document.getElementById('search-suggestions');
  let searchTracks = []; // плоский список отрисованных строк: {scope, ...track}
  let lastQuery = '';
  let searching = false;
  let vkSearchActive = false;

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
  function removeFromHistory(query) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(readHistory().filter(q => q !== query)));
  }
  function clearHistory() {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([]));
  }

  // ---------- Дропдаун глобального поиска: история + подсказки ----------
  const HISTORY_ICON_D = 'M12 20q-3.35 0-5.675-2.325T4 12t2.325-5.675T12 4q1.9 0 3.575.813T18.2 7H16q-.275 0-.475.2T15.325 7.7q0 .275.2.475t.475.2H19q.425 0 .713-.288T20 7.4V4q0-.275-.2-.475T19.3 3.325q-.275 0-.475.2t-.2.475v1.6q-1.35-1.325-3.15-2.063T12 3q-3.75 0-6.375 2.625T3 12t2.625 6.375T12 21q3.05 0 5.4-1.788T20.65 14.6q.075-.375-.125-.65t-.575-.375q-.35-.075-.65.113t-.4.512q-.55 2.075-2.35 3.487T12 20m.5-8.7V6.5q0-.2-.15-.35T12 6t-.35.15t-.15.35v5l4.15 4.15q.15.15.35.15t.35-.15t.15-.35t-.15-.35z';
  const SEARCH_ICON_D = 'M9.5 16q-2.725 0-4.612-1.888T3 9.5t1.888-4.612T9.5 3t4.613 1.888T16 9.5q0 1.1-.35 2.075T14.7 13.3l5.6 5.6q.275.275.275.7t-.275.7t-.7.275t-.7-.275l-5.6-5.6q-.75.6-1.725.95T9.5 16m0-2q1.875 0 3.188-1.312T14 9.5t-1.312-3.187T9.5 5T6.313 6.313T5 9.5t1.313 3.188T9.5 14';
  const REMOVE_ICON_D = 'm12 13.4l-4.9 4.9q-.275.275-.7.275t-.7-.275t-.275-.7t.275-.7l4.9-4.9l-4.9-4.9q-.275-.275-.275-.7t.275-.7t.7-.275t.7.275l4.9 4.9l4.9-4.9q.275-.275.7-.275t.7.275t.275.7t-.275.7L13.4 12l4.9 4.9q.275.275.275.7t-.275.7t-.7.275t-.7-.275z';

  let suggestDebounceTimer = null;
  let suggestToken = 0; // растёт на каждый hide/новый запрос — отбрасывает устаревшие ответы
  let currentSuggestions = []; // строки под клавиатурную навигацию
  let activeSuggestionIndex = -1;

  function hideSuggestions() {
    suggestToken++;
    suggestionsEl.classList.add('hidden');
    suggestionsEl.innerHTML = '';
    currentSuggestions = [];
    activeSuggestionIndex = -1;
  }

  function moveActiveSuggestion(delta) {
    const items = Array.from(suggestionsEl.querySelectorAll('.search-suggestion-item'));
    if (!items.length) return;
    activeSuggestionIndex = (activeSuggestionIndex + delta + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('active', i === activeSuggestionIndex));
    items[activeSuggestionIndex].scrollIntoView({ block: 'nearest' });
  }

  function submitGlobal(text) {
    const q = (text || '').trim();
    if (!q) return;
    globalInputEl.value = q;
    searchInputEl.value = q;
    hideSuggestions();
    globalInputEl.blur();
    showSearchView();
    doSearch();
  }

  function makeSuggestionItem(text, { removable } = {}) {
    const el = document.createElement('div');
    el.className = 'search-suggestion-item';
    el.innerHTML = `
      <svg viewBox="0 0 24 24"><path d="${removable ? HISTORY_ICON_D : SEARCH_ICON_D}"/></svg>
      <div class="sug-text"></div>
    `;
    el.querySelector('.sug-text').textContent = text;
    // mousedown, а не click — срабатывает раньше blur поля ввода
    el.addEventListener('mousedown', (e) => { e.preventDefault(); submitGlobal(text); });
    if (removable) {
      const rm = document.createElement('button');
      rm.className = 'suggest-remove';
      rm.title = 'Удалить';
      rm.innerHTML = `<svg viewBox="0 0 24 24"><path d="${REMOVE_ICON_D}"/></svg>`;
      rm.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        removeFromHistory(text);
        renderHistoryDropdown(); // перерисовать без удалённого
      });
      el.appendChild(rm);
    }
    return el;
  }

  function renderHistoryDropdown() {
    const history = readHistory();
    if (!history.length) { hideSuggestions(); return; }
    suggestionsEl.innerHTML = '';
    const cap = document.createElement('div');
    cap.className = 'suggest-caption';
    cap.textContent = 'Недавние запросы';
    suggestionsEl.appendChild(cap);
    currentSuggestions = history.slice();
    activeSuggestionIndex = -1;
    history.forEach(q => suggestionsEl.appendChild(makeSuggestionItem(q, { removable: true })));
    suggestionsEl.classList.remove('hidden');
  }

  function renderSuggestionsDropdown(items) {
    if (!items.length) { hideSuggestions(); return; }
    suggestionsEl.innerHTML = '';
    const cap = document.createElement('div');
    cap.className = 'suggest-caption';
    cap.textContent = 'Подсказки';
    suggestionsEl.appendChild(cap);
    currentSuggestions = items.slice();
    activeSuggestionIndex = -1;
    items.forEach(text => suggestionsEl.appendChild(makeSuggestionItem(text)));
    suggestionsEl.classList.remove('hidden');
  }

  // Автокомплит VK включается только после НАСТОЯЩЕГО (доверенного) клика по
  // его полю поиска: программный focus()/setter не заводит popover вовсе, а
  // после одного trusted-клика тот же программный ввод исправно рисует
  // подсказки (проверено). Прогреваем один раз за сессию.
  let suggestPrimed = false;
  async function primeSuggestions() {
    if (suggestPrimed) return true;
    const manual = beginAutomation();
    await wait(80); // дать компоновщику кадр перед доверенным кликом
    try {
      const raw = await webview.executeJavaScript(`
        (function() {
          const input = document.querySelector('[data-testid="search_audio_input"]');
          if (!input) return JSON.stringify({ ok: false });
          input.scrollIntoView({ block: 'center' });
          const r = input.getBoundingClientRect();
          return JSON.stringify({ ok: true, x: r.left + 24, y: r.top + r.height / 2 });
        })();
      `);
      const res = JSON.parse(raw);
      if (!res.ok) return false;
      sendTrustedClick(Math.round(res.x), Math.round(res.y));
      await wait(150);
      suggestPrimed = true;
      return true;
    } catch (e) {
      return false;
    } finally {
      endAutomation(manual);
    }
  }

  async function fetchSuggestions(query) {
    const myToken = ++suggestToken;
    try {
      // Автокомплит VK рисуется только на базовой странице каталога: на
      // подстранице плейлистов поле есть, но подсказки не появляются вовсе
      // (проверено). Проверка дешёвая — если страница чистая, вернётся сразу.
      if (!(await ensureBasePage())) return;
      await primeSuggestions();
      if (myToken !== suggestToken) return; // пока готовились — запрос устарел
      const raw = await webview.executeJavaScript(suggestionsScript(query));
      const res = JSON.parse(raw);
      if (myToken !== suggestToken) return; // пришёл более новый запрос
      renderSuggestionsDropdown(res.ok ? res.items.slice(0, 8) : []);
    } catch (e) {
      if (myToken === suggestToken) hideSuggestions();
    }
  }

  globalInputEl.addEventListener('input', () => {
    const query = globalInputEl.value.trim();
    globalClearEl.classList.toggle('hidden', !query);
    clearTimeout(suggestDebounceTimer);
    if (!query) { renderHistoryDropdown(); return; }
    suggestDebounceTimer = setTimeout(() => fetchSuggestions(query), 300);
  });
  globalInputEl.addEventListener('focus', () => {
    const query = globalInputEl.value.trim();
    if (!query) renderHistoryDropdown();
    else fetchSuggestions(query);
  });
  globalInputEl.addEventListener('blur', () => {
    // mousedown на пункте уже сделал preventDefault — сюда попадаем только
    // при настоящем уходе фокуса
    clearTimeout(suggestDebounceTimer);
    hideSuggestions();
  });
  globalInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (activeSuggestionIndex >= 0 && currentSuggestions[activeSuggestionIndex]) {
        submitGlobal(currentSuggestions[activeSuggestionIndex]);
      } else {
        submitGlobal(globalInputEl.value);
      }
      return;
    }
    if (e.key === 'Escape') { hideSuggestions(); globalInputEl.blur(); return; }
    if (!currentSuggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); moveActiveSuggestion(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActiveSuggestion(-1); }
  });
  globalClearEl.addEventListener('click', () => {
    globalInputEl.value = '';
    globalClearEl.classList.add('hidden');
    globalInputEl.focus();
    renderHistoryDropdown();
  });

  function showSearchView() {
    const navBtn = document.querySelector('.nav-item[data-view="search"]');
    if (navBtn && !navBtn.classList.contains('active')) navBtn.click();
  }

  // ---------- Страница Поиск ----------
  // Пустое состояние до первого запроса: подсказка + недавние запросы
  function renderIdle() {
    searchListEl.innerHTML = '';
    const history = readHistory();
    const card = document.createElement('div');
    card.className = 'search-idle-card';

    const intro = document.createElement('div');
    intro.className = 'search-idle-intro' + (history.length ? ' with-history' : '');
    intro.innerHTML = `
      <div class="search-idle-icon"><svg viewBox="0 0 24 24"><path d="${SEARCH_ICON_D}"/></svg></div>
      <div class="search-idle-hint">Ищите по всей музыке ВКонтакте — треки, которых нет в вашей библиотеке, тоже найдутся.</div>
    `;
    card.appendChild(intro);

    if (history.length) {
      const historyBlock = document.createElement('div');
      historyBlock.className = 'search-idle-history';

      const header = document.createElement('div');
      header.className = 'search-idle-history-header';
      const title = document.createElement('div');
      title.className = 'search-idle-history-title';
      title.textContent = 'Недавние запросы';
      const clearBtn = document.createElement('button');
      clearBtn.className = 'search-idle-clear';
      clearBtn.textContent = 'Очистить';
      clearBtn.addEventListener('click', () => { clearHistory(); renderIdle(); });
      header.appendChild(title);
      header.appendChild(clearBtn);
      historyBlock.appendChild(header);

      const list = document.createElement('div');
      list.className = 'search-idle-history-list';
      history.forEach(q => {
        const row = document.createElement('div');
        row.className = 'search-idle-history-row';
        row.innerHTML = `
          <svg viewBox="0 0 24 24"><path d="${HISTORY_ICON_D}"/></svg>
          <span class="search-idle-history-text"></span>
        `;
        row.querySelector('.search-idle-history-text').textContent = q;
        row.addEventListener('click', () => { searchInputEl.value = q; doSearch(); });
        const rm = document.createElement('button');
        rm.className = 'search-idle-history-remove';
        rm.title = 'Удалить';
        rm.innerHTML = `<svg viewBox="0 0 24 24"><path d="${REMOVE_ICON_D}"/></svg>`;
        rm.addEventListener('click', (e) => { e.stopPropagation(); removeFromHistory(q); renderIdle(); });
        row.appendChild(rm);
        list.appendChild(row);
      });
      historyBlock.appendChild(list);
      card.appendChild(historyBlock);
    }

    searchListEl.appendChild(card);
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
    if (!tracks.length) return null;
    const card = document.createElement('div');
    card.className = 'search-card';
    const title = document.createElement('div');
    title.className = 'search-section-title';
    title.textContent = titleText;
    card.appendChild(title);
    const grid = document.createElement('div');
    grid.className = 'search-track-grid';
    tracks.forEach(track => {
      searchTracks.push({ ...track, scope });
      grid.appendChild(formatSearchRow(track, scope));
    });
    card.appendChild(grid);
    return card;
  }

  // Альбомы и музыканты — витрина; клик запускает новый поиск по названию
  // (открытие страниц альбома/артиста у нас пока нет — см. отчёт по дизайну)
  function renderAlbums(albums) {
    if (!albums.length) return null;
    const card = document.createElement('div');
    card.className = 'search-card';
    const title = document.createElement('div');
    title.className = 'search-section-title';
    title.textContent = 'Альбомы';
    card.appendChild(title);
    const strip = document.createElement('div');
    strip.className = 'search-carousel';
    albums.forEach(al => {
      const item = document.createElement('button');
      item.className = 'search-album';
      item.innerHTML = `
        <img class="search-album-cover" alt="">
        <div class="search-album-title"></div>
        <div class="search-album-sub"></div>
      `;
      const img = item.querySelector('.search-album-cover');
      if (al.cover) img.src = al.cover;
      item.querySelector('.search-album-title').textContent = al.title;
      item.querySelector('.search-album-sub').textContent = [al.author, al.year].filter(Boolean).join(' · ');
      item.addEventListener('click', () => {
        searchInputEl.value = `${al.author} ${al.title}`.trim();
        doSearch();
      });
      strip.appendChild(item);
    });
    card.appendChild(strip);
    return card;
  }

  function renderArtists(artists) {
    if (!artists.length) return null;
    const card = document.createElement('div');
    card.className = 'search-card';
    const title = document.createElement('div');
    title.className = 'search-section-title';
    title.textContent = 'Музыканты';
    card.appendChild(title);
    const strip = document.createElement('div');
    strip.className = 'search-carousel';
    artists.forEach(ar => {
      const item = document.createElement('button');
      item.className = 'search-artist';
      item.innerHTML = `
        <img class="search-artist-photo" alt="">
        <div class="search-artist-name"></div>
      `;
      const img = item.querySelector('.search-artist-photo');
      if (ar.photo) img.src = ar.photo;
      item.querySelector('.search-artist-name').textContent = ar.name;
      item.addEventListener('click', () => {
        searchInputEl.value = ar.name;
        doSearch();
      });
      strip.appendChild(item);
    });
    card.appendChild(strip);
    return card;
  }

  async function doSearch() {
    const query = searchInputEl.value.trim();
    if (!query || searching) return;
    hideSuggestions();
    clearTimeout(suggestDebounceTimer);
    searching = true;
    lastQuery = query;
    globalInputEl.value = query;
    globalClearEl.classList.remove('hidden');
    searchStatusEl.textContent = 'Ищу…';
    searchStatusEl.classList.add('loading');
    searchListEl.innerHTML = '';
    searchTracks = [];
    try {
      // Поиск работает только с базовой страницы каталога: на подстранице
      // плейлистов запрос уходил в никуда (q задваивался в URL)
      if (!(await ensureBasePage())) { searchStatusEl.textContent = 'Не удалось: vk-page-not-ready'; return; }
      const raw = await webview.executeJavaScript(searchScript(query));
      const res = JSON.parse(raw);
      if (!res.ok) { searchStatusEl.textContent = 'Не удалось: ' + res.reason; return; }
      vkSearchActive = true;
      saveToHistory(query);
      // Как у VK: сперва совпадения из своей библиотеки, затем общий каталог
      const resultsWrap = document.createElement('div');
      resultsWrap.className = 'search-results';
      const myCard = renderSection('Мои треки', res.my, 'my');
      if (myCard) resultsWrap.appendChild(myCard);
      const allCard = renderSection('Все треки', res.all, 'all');
      if (allCard) resultsWrap.appendChild(allCard);
      const albumsCard = renderAlbums(res.albums || []);
      const artistsCard = renderArtists(res.artists || []);
      if (albumsCard || artistsCard) {
        const row = document.createElement('div');
        row.className = 'search-albums-row';
        if (albumsCard) row.appendChild(albumsCard);
        if (artistsCard) row.appendChild(artistsCard);
        resultsWrap.appendChild(row);
      }
      searchListEl.appendChild(resultsWrap);
      searchStatusEl.textContent = searchTracks.length ? '' : 'Ничего не найдено';
    } catch (err) {
      searchStatusEl.textContent = 'Ошибка: ' + err.message;
    } finally {
      searching = false;
      searchStatusEl.classList.remove('loading');
    }
  }

  searchInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });
  searchSubmitEl.addEventListener('click', doSearch);

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
