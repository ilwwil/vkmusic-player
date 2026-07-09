// ---------- Раздел "Главная": VK Микс, шафл и превью-секции ----------
window.HomeView = (function () {
  const { webview, SELECTORS, pickHelper, ensureBasePage, playViaTrustedClick } = window.Shared;

  // Переключение вкладок каталога — SPA-навигация (без перезагрузки страницы),
  // поэтому не сбивает текущее воспроизведение/поллинг нижней панели.
  // VK Микс запускается обычной кнопкой (клик el.click() срабатывает нормально).
  // А вот запуск конкретного трека из каталога (в т.ч. родная кнопка VK
  // "Перемешать все") у VK реагирует ТОЛЬКО на настоящий доверенный клик мыши —
  // ни el.click(), ни клик через отдельное CDP-подключение к webview не сработали
  // (см. память project_custom_shell), сработал только webview.sendInputEvent.
  // Поэтому для шафла сами выбираем случайный загруженный трек из "Моей музыки"
  // и кликаем по нему уже проверенным доверенным способом (как при перемотке).
  function homeActionScript(action) {
    return `
      (async function() {
        ${pickHelper()}
        const sel = ${JSON.stringify(SELECTORS)};
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
          if ('${action}' === 'mix') {
            const tab = pick(sel.catalogTabGeneral);
            if (tab) tab.click();
            const btn = await waitFor(() => pick(sel.mixToggleButton), 3000);
            if (!btn) return JSON.stringify({ ok: false, reason: 'mix-button-not-found' });
            btn.click();
            return JSON.stringify({ ok: true });
          }
          if ('${action}' === 'shuffle') {
            const tab = pick(sel.catalogTabAllMusic);
            if (tab) tab.click();
            // ВАЖНО: "Моя музыка" содержит несколько блоков с одинаковым компонентом
            // MusicTrackRow — "Недавно прослушанные", плейлисты, "Друзья слушают" и
            // сам список "Треки" (данные всей библиотеки). Без явного скоупинга по
            // AudioCatalog_SectionTracks можно случайно попасть в чужой блок —
            // именно поэтому "шафл" запускал "недавно прослушанные" вместо
            // фактических "моих треков".
            const rows = await waitFor(() => {
              const list = document.querySelectorAll('[data-testid="AudioCatalog_SectionTracks"] [data-testid="MusicTrackRow"]');
              return list.length ? list : null;
            }, 3000);
            if (!rows) return JSON.stringify({ ok: false, reason: 'no-tracks-found' });
            const index = Math.floor(Math.random() * rows.length);
            return selectTrackRowByIndex(rows, index);
          }
          return JSON.stringify({ ok: false, reason: 'unknown-action' });
        } catch (e) {
          return JSON.stringify({ ok: false, reason: String(e) });
        }

        function selectTrackRowByIndex(rows, index) {
          const row = rows[index];
          if (!row) return JSON.stringify({ ok: false, reason: 'row-not-found' });
          const controls = row.querySelector('[data-testid="MusicTrackRow_PlaybackControls"]');
          if (!controls) return JSON.stringify({ ok: false, reason: 'row-controls-not-found' });
          controls.scrollIntoView({ block: 'center' });
          const r = controls.getBoundingClientRect();
          return JSON.stringify({ ok: true, needsTrustedClick: true, x: r.left + r.width / 2, y: r.top + r.height / 2 });
        }
      })();
    `;
  }

  const homeStatusEl = document.getElementById('home-status');
  document.querySelectorAll('[data-home-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.homeAction;
      homeStatusEl.textContent = 'Запускаю…';
      if (action === 'mix') {
        try {
          await ensureBasePage();
          const raw = await webview.executeJavaScript(homeActionScript(action));
          const res = JSON.parse(raw);
          homeStatusEl.textContent = res.ok ? '' : 'Не удалось: ' + res.reason;
        } catch (err) {
          homeStatusEl.textContent = 'Ошибка: ' + err.message;
        }
        return;
      }
      await ensureBasePage();
      const result = await playViaTrustedClick(homeActionScript(action));
      homeStatusEl.textContent = result.ok ? '' : 'Не удалось: ' + result.reason;
    });
  });

  // ---------- Превью-секции: "Недавно прослушанные" и "Мои треки" ----------
  // Обе живут на вкладке "Моя музыка" каталога VK: недавние — секция при
  // заголовке AudioCatalog_BlockHeaderRecentlyPlayed (строки лежат в её
  // ближайшем <section>, отдельного testid у секции нет), треки — привычная
  // AudioCatalog_SectionTracks. Один скрейп собирает обе.
  const RECENT_LIMIT = 6;
  const MYTRACKS_LIMIT = 8;

  function scrapeHomeScript() {
    return `
      (async function() {
        ${pickHelper()}
        const sel = ${JSON.stringify(SELECTORS)};
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
        function mapRows(rows, limit) {
          return Array.from(rows).slice(0, limit).map((row, index) => {
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
        try {
          const tab = pick(sel.catalogTabAllMusic);
          if (tab) tab.click();
          const tracksRows = await waitFor(() => {
            const list = document.querySelectorAll('[data-testid="AudioCatalog_SectionTracks"] [data-testid="MusicTrackRow"]');
            return list.length ? list : null;
          }, 4000);
          const recentHeader = document.querySelector('[data-testid="AudioCatalog_BlockHeaderRecentlyPlayed"]');
          const recentSec = recentHeader ? recentHeader.closest('section') : null;
          const recentRows = recentSec ? recentSec.querySelectorAll('[data-testid="MusicTrackRow"]') : [];
          return JSON.stringify({
            ok: true,
            recent: mapRows(recentRows, ${RECENT_LIMIT}),
            tracks: mapRows(tracksRows || [], ${MYTRACKS_LIMIT})
          });
        } catch (e) {
          return JSON.stringify({ ok: false, reason: String(e) });
        }
      })();
    `;
  }

  // Координаты строки для доверенного клика: scope 'recent' — внутри секции
  // недавних, 'tracks' — внутри AudioCatalog_SectionTracks (индексы свои)
  function selectHomeRowScript(scope, index) {
    return `
      (async function() {
        ${pickHelper()}
        const sel = ${JSON.stringify(SELECTORS)};
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
          const tab = pick(sel.catalogTabAllMusic);
          if (tab) tab.click();
          const rows = await waitFor(() => {
            let list;
            if (${JSON.stringify(scope)} === 'recent') {
              const header = document.querySelector('[data-testid="AudioCatalog_BlockHeaderRecentlyPlayed"]');
              const sec = header ? header.closest('section') : null;
              list = sec ? sec.querySelectorAll('[data-testid="MusicTrackRow"]') : [];
            } else {
              list = document.querySelectorAll('[data-testid="AudioCatalog_SectionTracks"] [data-testid="MusicTrackRow"]');
            }
            return list.length ? list : null;
          }, 4000);
          if (!rows) return JSON.stringify({ ok: false, reason: 'no-rows-found' });
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

  const recentSectionEl = document.getElementById('home-recent-section');
  const recentListEl = document.getElementById('home-recent-list');
  const mytracksSectionEl = document.getElementById('home-mytracks-section');
  const mytracksListEl = document.getElementById('home-mytracks-list');
  let homeTracks = { recent: [], tracks: [] };
  let homeLoading = false;

  function formatHomeRow(track, scope) {
    const row = document.createElement('div');
    row.className = 'mymusic-row';
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
      await ensureBasePage();
      const result = await playViaTrustedClick(selectHomeRowScript(scope, track.index));
      row.classList.remove('loading');
      if (!result.ok) homeStatusEl.textContent = 'Не удалось запустить: ' + result.reason;
    });
    return row;
  }

  // Загружает/обновляет секции Главной. Перезапрашиваем на каждый заход в
  // раздел: "недавно прослушанные" меняются после каждого трека, а сам скрейп
  // дёшев (SPA-клик по вкладке + чтение DOM, без перезагрузок).
  async function loadHome() {
    if (homeLoading) return;
    homeLoading = true;
    try {
      if (!(await ensureBasePage())) return;
      const raw = await webview.executeJavaScript(scrapeHomeScript());
      const res = JSON.parse(raw);
      if (!res.ok) return;
      homeTracks = res;
      recentListEl.innerHTML = '';
      res.recent.forEach(t => recentListEl.appendChild(formatHomeRow(t, 'recent')));
      mytracksListEl.innerHTML = '';
      res.tracks.forEach(t => mytracksListEl.appendChild(formatHomeRow(t, 'tracks')));
      // Видимость — от фактически отрисованных строк, чтобы не мигать
      // заголовком над пустым местом
      recentSectionEl.classList.toggle('hidden', !recentListEl.children.length);
      mytracksSectionEl.classList.toggle('hidden', !mytracksListEl.children.length);
    } catch (err) {
      // Секции опциональны — при сбое просто не показываем
    } finally {
      homeLoading = false;
    }
  }

  document.getElementById('home-mytracks-all').addEventListener('click', () => {
    const navBtn = document.querySelector('.nav-item[data-view="mymusic"]');
    if (navBtn) navBtn.click();
  });

  // Подсветка играющего трека в обеих секциях
  window.addEventListener('vk-player-state', (e) => {
    const state = e.detail;
    const key = (state.title || '') + '|' + (state.artist || '');
    [[recentListEl, homeTracks.recent], [mytracksListEl, homeTracks.tracks]].forEach(([listEl, tracks]) => {
      listEl.querySelectorAll('.mymusic-row').forEach((row, i) => {
        const track = tracks[i];
        row.classList.toggle('playing', !!track && !!state.title && (track.title + '|' + track.artist) === key);
      });
    });
  });

  // Первичная загрузка: ждём, пока VK внутри webview поднимется (dom-ready —
  // это только каркас, React рисует каталог позже; скрейп сам подождёт секции).
  // Если первая попытка пришлась на недогруженный VK и секции остались пустыми —
  // повторяем ещё пару раз с паузой.
  webview.addEventListener('dom-ready', () => {
    let attempts = 0;
    const tryLoad = async () => {
      attempts++;
      await loadHome();
      const empty = !recentListEl.children.length && !mytracksListEl.children.length;
      if (empty && attempts < 3) setTimeout(tryLoad, 4000);
    };
    setTimeout(tryLoad, 1500);
  }, { once: true });

  return { loadHome };
})();
