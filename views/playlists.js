// ---------- Раздел "Плейлисты": сетка плейлистов + наша карточка плейлиста ----------
// Данные берём из блока плейлистов на "Моей музыке" VK
// (AudioCatalog_SectionPlaylists). Клик по названию плейлиста в VK открывает
// его модалку (MusicPlaylistModal) — мы держим её открытой в скрытом VK как
// источник списка треков и мишень для доверенных кликов, а пользователю
// показываем собственную карточку в стиле приложения.
window.PlaylistsView = (function () {
  const { webview, SELECTORS, pickHelper, wait, ensureBasePage, playViaTrustedClick } = window.Shared;

  // Странице плейлистов (block=my_playlists) не мешает сама по себе — а вот
  // остаточный q= от поиска ломает её: клики по названиям перестают открывать
  // модалку. Если q= затесался в URL — сбрасываем VK на базовую страницу,
  // дальше ensurePlaylistItems сам дойдёт до полной страницы плейлистов.
  async function ensureCleanQuery() {
    let href = '';
    try { href = await webview.executeJavaScript('location.href'); } catch (e) {}
    if (/[?&]q=/.test(href)) await ensureBasePage();
  }

  // Общий для скрейпа и открытия фрагмент: убедиться, что открыта ПОЛНАЯ
  // страница плейлистов (block=my_playlists — там все, а не ~10 из слайдера
  // на вкладке каталога). Если её нет — доходим до неё через вкладку
  // "Моя музыка" и ссылку "Показать все" у секции плейлистов.
  function ensurePlaylistsPageHelper() {
    return `
      async function ensurePlaylistItems() {
        const q = () => document.querySelectorAll('[data-testid="music_playlist_item_block"]');
        if (q().length) return q();
        const tab = pick(sel.catalogTabAllMusic);
        if (tab) tab.click();
        const sec = await waitFor(() => document.querySelector('[data-testid="AudioCatalog_SectionPlaylists"]'), 4000);
        if (!sec) return null;
        const link = sec.querySelector('[data-testid="AudioCatalogTextLinkAction"]');
        if (!link) return null;
        link.click();
        await waitFor(() => q().length ? true : null, 4000);
        if (!q().length) return null;
        // Ленивый рендер: прогоняем страницу вниз-вверх, чтобы все карточки
        // (названия/обложки) отрисовались
        const el = document.scrollingElement;
        el.scrollTop = el.scrollHeight;
        await new Promise(r => setTimeout(r, 350));
        el.scrollTop = 0;
        await new Promise(r => setTimeout(r, 250));
        return q();
      }
    `;
  }

  function scrapePlaylistsScript() {
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
        ${ensurePlaylistsPageHelper()}
        const items = await ensurePlaylistItems();
        if (!items) return JSON.stringify({ ok: false, reason: 'no-playlists-found' });
        // Обложки у VK — background-image, иногда на вложенном элементе
        function coverOf(item) {
          const pv = item.querySelector('[data-testid="MusicPlaylistItem_PreviewImage"]');
          if (!pv) return null;
          let bg = getComputedStyle(pv).backgroundImage;
          if (bg === 'none') {
            const inner = Array.from(pv.querySelectorAll('*')).find(e => getComputedStyle(e).backgroundImage !== 'none');
            bg = inner ? getComputedStyle(inner).backgroundImage : 'none';
          }
          if (bg === 'none') return null;
          return bg.replace(/^url\\(["']?/, '').replace(/["']?\\)$/, '');
        }
        const playlists = Array.from(items).map((item, index) => {
          const titleEl = item.querySelector('[data-testid="MusicPlaylistItem_Title"]');
          const authorEl = item.querySelector('[data-testid="MusicPlaylistItem_AuthorLink"]');
          const yearEl = item.querySelector('[data-testid="MusicPlaylistItem_ReleaseYear"]');
          return {
            index,
            title: titleEl ? titleEl.textContent.trim() : '',
            author: authorEl ? authorEl.textContent.trim() : '',
            year: yearEl ? yearEl.textContent.trim() : '',
            cover: coverOf(item)
          };
        });
        return JSON.stringify({ ok: true, playlists });
      })();
    `;
  }

  // Открыть модалку плейлиста в VK (кликом по названию карточки) и собрать из
  // неё шапку и список треков. Модалку НЕ закрываем — она нужна открытой для
  // последующих кликов по трекам/кнопкам.
  function openPlaylistScript(index) {
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
        ${ensurePlaylistsPageHelper()}
        // Защита: если от прошлого открытия осталась модалка, клик по названию
        // нового плейлиста уйдёт в неё (она перекрывает страницу), а waitFor
        // найдёт её же заголовок — и любой плейлист "откроет" старый. Закрываем.
        const oldClose = document.querySelector('[data-testid="MusicPlaylistModal_Close"]');
        if (oldClose) oldClose.click();
        // Ждём исчезновения всего контейнера модалки, а не только заголовка:
        // при быстром "назад → открыть другой" оверлей закрывающейся модалки
        // ещё висит и проглатывает клик по названию нового плейлиста.
        await waitFor(() => !document.querySelector('.vkitInternalModalBox') ? true : null, 3000);
        // VK мог уйти с полной страницы плейлистов (например, после захода в
        // "Мою музыку") — возвращаемся, индексы совпадают со скрейпом сетки
        const items = await ensurePlaylistItems();
        if (!items) return JSON.stringify({ ok: false, reason: 'playlists-page-not-found' });
        const item = items[${index}];
        if (!item) return JSON.stringify({ ok: false, reason: 'playlist-not-found' });
        // Карточку сперва прокручиваем в кадр — вне видимости её содержимое
        // (включая название) может быть не отрендерено
        item.scrollIntoView({ block: 'center', inline: 'center' });
        const titleEl = await waitFor(() => item.querySelector('[data-testid="MusicPlaylistItem_Title"]'), 3000);
        if (!titleEl) return JSON.stringify({ ok: false, reason: 'playlist-title-not-found' });
        // Клик может пропасть впустую (например, остаточный оверлей ещё
        // перехватывает события) — пробуем несколько раз
        let header = null;
        for (let attempt = 0; attempt < 3 && !header; attempt++) {
          titleEl.click();
          header = await waitFor(() => document.querySelector('[data-testid="MusicPlaylistModal_Header"]'), 1500 + attempt * 700);
        }
        if (!header) return JSON.stringify({ ok: false, reason: 'modal-not-opened' });
        const modal = header.closest('.vkitInternalModalBox') || document;
        // Трекам модалки нужно мгновение на отрисовку
        let rows = await waitFor(() => {
          const list = modal.querySelectorAll('[data-testid="MusicTrackRow"]');
          return list.length ? list : null;
        }, 3000);
        // Длинные списки VK сворачивает за кнопкой "Показать все" — раскрываем.
        // ВАЖНО: кнопка исчезает сразу по клику, а строки приезжают позже
        // (асинхронная подгрузка) — ждать "кнопка пропала" недостаточно,
        // ждём фактического роста списка и затем его стабилизации.
        const countRows = () => modal.querySelectorAll('[data-testid="MusicTrackRow"]').length;
        let expanded = false;
        for (let i = 0; i < 6; i++) {
          const expand = modal.querySelector('[data-testid="audiolistitems-expandbutton"]');
          if (!expand) break;
          const before = countRows();
          expand.click();
          expanded = true;
          await waitFor(() => countRows() > before ? true : null, 4000);
        }
        if (expanded) {
          let prev = countRows();
          for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 500));
            const n = countRows();
            if (n === prev) break;
            prev = n;
          }
        }
        rows = modal.querySelectorAll('[data-testid="MusicTrackRow"]');
        if (!rows.length) rows = null;
        const titleNode = modal.querySelector('[data-testid="MusicPlaylistModal_Title"]');
        // У пользовательских плейлистов авторы/подзаголовок под другими testid,
        // чем у альбомов (AudioList_Author + ...headerinfo-subtitle с "обновлён...")
        const authorsNode = modal.querySelector('[data-testid="MusicAlbumPlaylist_Authors"]')
          || modal.querySelector('[data-testid="AudioList_Author"]');
        const subNode = modal.querySelector('[data-testid="MusicAlbumPlaylist_Subtitle"]')
          || modal.querySelector('[data-testid="musicplaylistmodalheaderinfo-subtitle"]');
        // Блок статистики над списком: "Треки 20" + "35,2K прослушиваний·58 минут"
        const statCountNode = modal.querySelector('[data-testid="musicplayliststatistics-count"]');
        const statSubNode = modal.querySelector('[data-testid="musicplayliststatistics-subtitle"]');
        const tracks = rows ? Array.from(rows).map((row, i) => {
          const img = row.querySelector('img');
          return {
            index: i,
            title: (row.querySelector('[data-testid="MusicTrackRow_Title"]') || {}).textContent || '',
            artist: (row.querySelector('[data-testid="MusicTrackRow_Authors"]') || {}).textContent || '',
            duration: ((row.querySelector('[data-testid="MusicTrackRow_Duration"]') || {}).textContent || '').trim(),
            cover: img ? img.src : ''
          };
        }) : [];
        return JSON.stringify({
          ok: true,
          title: titleNode ? titleNode.textContent.trim() : '',
          authors: authorsNode ? authorsNode.textContent.trim() : '',
          subtitle: subNode ? subNode.textContent.trim() : '',
          trackCount: statCountNode ? statCountNode.textContent.trim() : '',
          stats: statSubNode ? statSubNode.textContent.trim() : '',
          tracks
        });
      })();
    `;
  }

  function closePlaylistScript() {
    return `
      (function() {
        const btn = document.querySelector('[data-testid="MusicPlaylistModal_Close"]');
        if (btn) btn.click();
        return JSON.stringify({ ok: !!btn });
      })();
    `;
  }

  // Координаты трека модалки для доверенного клика (запуск воспроизведения)
  function selectModalTrackScript(index) {
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
        const header = document.querySelector('[data-testid="MusicPlaylistModal_Header"]');
        if (!header) return JSON.stringify({ ok: false, reason: 'modal-not-open' });
        const modal = header.closest('.vkitInternalModalBox') || document;
        const rows = modal.querySelectorAll('[data-testid="MusicTrackRow"]');
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
      })();
    `;
  }

  // Координаты кнопки модалки "Слушать" / "Перемешать" / "Похожие"
  // (Action_PlayMix — запуск микса по мотивам плейлиста, 4-я кнопка модалки VK)
  function modalActionScript(action) {
    const testid = action === 'shuffle' ? 'Action_PlayWithShuffle'
      : action === 'mix' ? 'Action_PlayMix'
      : 'Action_TogglePlaying';
    return `
      (function() {
        const header = document.querySelector('[data-testid="MusicPlaylistModal_Header"]');
        if (!header) return JSON.stringify({ ok: false, reason: 'modal-not-open' });
        const modal = header.closest('.vkitInternalModalBox') || document;
        const btn = modal.querySelector('[data-testid="${testid}"]');
        if (!btn) return JSON.stringify({ ok: false, reason: 'action-not-found' });
        const r = btn.getBoundingClientRect();
        return JSON.stringify({ ok: true, needsTrustedClick: true, x: r.left + r.width / 2, y: r.top + r.height / 2 });
      })();
    `;
  }

  const statusEl = document.getElementById('playlists-status');
  const gridEl = document.getElementById('playlists-grid');
  const homeEl = document.getElementById('playlists-home');
  const detailEl = document.getElementById('playlist-detail');
  const cardCoverEl = document.getElementById('plcard-cover');
  const cardTitleEl = document.getElementById('plcard-title');
  const cardSubEl = document.getElementById('plcard-sub');
  const cardStatsEl = document.getElementById('plcard-stats');
  const cardTracksEl = document.getElementById('plcard-tracks');
  const cardStatusEl = document.getElementById('plcard-status');
  let playlists = [];
  let playlistsLoaded = false;
  let cardOpen = false;
  let cardTracks = []; // треки открытого плейлиста — для подсветки играющего
  // Кэш содержимого открывавшихся плейлистов (по index сетки): повторное
  // открытие рисует список мгновенно, пока модалка VK открывается в фоне.
  // Клики по трекам всё равно ждут модалку (modalReadyPromise) — она мишень
  // для доверенных кликов.
  const cardCache = new Map();
  let modalReadyPromise = null;

  function formatPlaylistCard(pl) {
    const card = document.createElement('button');
    card.className = 'playlist-card';
    card.dataset.index = pl.index;
    card.innerHTML = `
      <div class="playlist-card-cover"></div>
      <div class="playlist-card-title"></div>
      <div class="playlist-card-sub"></div>
    `;
    if (pl.cover) card.querySelector('.playlist-card-cover').style.backgroundImage = `url("${pl.cover}")`;
    card.querySelector('.playlist-card-title').textContent = pl.title || 'Без названия';
    card.querySelector('.playlist-card-sub').textContent = [pl.author, pl.year].filter(Boolean).join ? [pl.author, pl.year].filter(Boolean).join(' · ') : '';
    card.addEventListener('click', () => openCard(pl));
    return card;
  }

  async function loadPlaylists() {
    if (playlistsLoaded) return;
    statusEl.textContent = 'Загружаю плейлисты…';
    try {
      await ensureCleanQuery();
      const raw = await webview.executeJavaScript(scrapePlaylistsScript());
      const res = JSON.parse(raw);
      if (!res.ok) { statusEl.textContent = 'Не удалось загрузить: ' + res.reason; return; }
      playlists = res.playlists;
      playlistsLoaded = true;
      gridEl.innerHTML = '';
      playlists.forEach(pl => gridEl.appendChild(formatPlaylistCard(pl)));
      statusEl.textContent = '';
    } catch (err) {
      statusEl.textContent = 'Ошибка: ' + err.message;
    }
  }

  // Суммарная длительность по строкам ("m:ss") — VK в статистике пользовательских
  // плейлистов её не всегда отдаёт, а посчитать локально дёшево
  function totalDurationText(tracks) {
    let sec = 0;
    for (const t of tracks) {
      const parts = (t.duration || '').split(':').map(Number);
      if (parts.length < 2 || parts.some(isNaN)) continue;
      sec += parts.reduce((acc, v) => acc * 60 + v, 0);
    }
    if (!sec) return '';
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return h ? `${h} ч ${m} мин` : `${m} мин`;
  }

  function renderCard(pl, res) {
    cardTitleEl.textContent = res.title || pl.title;
    cardSubEl.textContent = [res.authors, res.subtitle].filter(Boolean).join(' — ');
    // Строка статистики, как в оригинале VK: "20 треков · 35,2K прослушиваний · 58 минут"
    const statsParts = [];
    if (res.trackCount) statsParts.push(res.trackCount + ' треков');
    if (res.stats) statsParts.push(res.stats.split('·').map(s => s.trim()).filter(s => s && !s.startsWith('0 прослушиван')).join(' · '));
    let statsText = statsParts.filter(Boolean).join(' · ');
    // Если VK не отдал длительность — добавляем свою, посчитанную по трекам
    if (!/мин|час|\sч\b/.test(statsText)) {
      const dur = totalDurationText(res.tracks);
      if (dur) statsText = [statsText, dur].filter(Boolean).join(' · ');
    }
    cardStatsEl.textContent = statsText;
    cardStatusEl.textContent = '';
    cardTracks = res.tracks;
    cardTracksEl.innerHTML = '';
    res.tracks.forEach((track, orderIndex) => {
      const row = document.createElement('div');
      row.className = 'plcard-row';
      row.dataset.index = track.index;
      row.innerHTML = `
        <div class="plcard-row-num"></div>
        <img class="plcard-row-cover" alt="">
        <div class="plcard-row-info">
          <div class="plcard-row-title"></div>
          <div class="plcard-row-artist"></div>
        </div>
        <div class="plcard-row-duration"></div>
      `;
      row.querySelector('.plcard-row-num').textContent = orderIndex + 1;
      const coverEl = row.querySelector('.plcard-row-cover');
      if (track.cover) coverEl.src = track.cover; else coverEl.remove();
      row.querySelector('.plcard-row-title').textContent = track.title;
      row.querySelector('.plcard-row-artist').textContent = track.artist;
      row.querySelector('.plcard-row-duration').textContent = track.duration;
      row.addEventListener('click', async () => {
        if (row.classList.contains('loading')) return;
        row.classList.add('loading');
        // Модалка VK могла ещё открываться в фоне (мгновенный рендер из кэша)
        if (modalReadyPromise) await modalReadyPromise;
        const result = await playViaTrustedClick(selectModalTrackScript(track.index));
        row.classList.remove('loading');
        if (!result.ok) cardStatusEl.textContent = 'Не удалось запустить: ' + result.reason;
      });
      cardTracksEl.appendChild(row);
    });
  }

  async function openCard(pl) {
    cardOpen = true;
    homeEl.classList.add('hidden');
    detailEl.classList.remove('hidden');
    cardCoverEl.style.backgroundImage = pl.cover ? `url("${pl.cover}")` : '';
    cardTitleEl.textContent = pl.title;
    cardSubEl.textContent = '';
    cardStatsEl.textContent = '';
    cardTracksEl.innerHTML = '';
    const cached = cardCache.get(pl.index);
    if (cached) {
      renderCard(pl, cached); // мгновенно из кэша; модалка догонит в фоне
    } else {
      cardStatusEl.textContent = 'Загружаю…';
    }
    modalReadyPromise = (async () => {
      await ensureCleanQuery();
      const raw = await webview.executeJavaScript(openPlaylistScript(pl.index));
      return JSON.parse(raw);
    })();
    try {
      const res = await modalReadyPromise;
      if (!cardOpen) return; // карточку уже закрыли, пока грузилось
      if (!res.ok) { if (!cached) cardStatusEl.textContent = 'Не удалось: ' + res.reason; return; }
      cardCache.set(pl.index, res);
      renderCard(pl, res); // свежие данные из модалки (могли измениться)
    } catch (err) {
      if (!cached) cardStatusEl.textContent = 'Ошибка: ' + err.message;
    }
  }

  async function closeCard() {
    if (!cardOpen) return;
    cardOpen = false;
    detailEl.classList.add('hidden');
    homeEl.classList.remove('hidden');
    try { await webview.executeJavaScript(closePlaylistScript()); } catch (e) { /* VK мог сам закрыть */ }
  }

  document.getElementById('plcard-back').addEventListener('click', closeCard);

  // Локальный фильтр по сетке — данные уже в памяти, VK не трогаем
  const filterEl = document.getElementById('playlists-filter');
  filterEl.addEventListener('input', () => {
    const q = filterEl.value.trim().toLowerCase();
    gridEl.querySelectorAll('.playlist-card').forEach(card => {
      const pl = playlists[Number(card.dataset.index)];
      const match = !q || !pl
        || (pl.title || '').toLowerCase().includes(q)
        || (pl.author || '').toLowerCase().includes(q);
      card.classList.toggle('filtered-out', !match);
    });
  });

  // Подсветка играющего трека в открытом плейлисте (см. аналог в mymusic.js)
  window.addEventListener('vk-player-state', (e) => {
    if (!cardOpen) return;
    const state = e.detail;
    const key = (state.title || '') + '|' + (state.artist || '');
    cardTracksEl.querySelectorAll('.plcard-row').forEach(row => {
      const track = cardTracks.find(t => t.index === Number(row.dataset.index));
      row.classList.toggle('playing', !!track && !!state.title && (track.title + '|' + track.artist) === key);
    });
  });

  document.querySelectorAll('[data-plcard-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.classList.contains('loading')) return;
      btn.classList.add('loading');
      const result = await playViaTrustedClick(modalActionScript(btn.dataset.plcardAction));
      btn.classList.remove('loading');
      if (!result.ok) cardStatusEl.textContent = 'Не удалось: ' + result.reason;
    });
  });

  return { loadPlaylists, closeCard };
})();
