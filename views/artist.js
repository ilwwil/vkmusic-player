// ---------- Страница артиста ----------
// Открывается настоящим SPA-переходом VK (клик по ссылке /artist/<slug> —
// React Router, не webview.loadURL) — в отличие от полной перезагрузки, это
// НЕ прерывает текущее воспроизведение (проверено). Назад — хлебная крошка
// "Музыка" (a[data-testid="breadcrumb"]), которую уже умеет жать
// ensureBasePage() при любой последующей операции с базовой страницы.
window.ArtistView = (function () {
  const { webview, ensureBasePage, playViaTrustedClick, modalScrapeScript } = window.Shared;

  function waitForHelper() {
    return `
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
    `;
  }

  // Клик по самой ссылке артиста (из текущих результатов поиска, ещё в DOM)
  // запускает SPA-переход; затем ждём баннер артиста и собираем: обложку,
  // имя, "Популярное" (треки — раздел находим по тексту заголовка, отдельного
  // testid у него нет, как и у "Недавно прослушанные" на Главной) и "Релизы"
  // (альбомы — тот же компонент-карусель, что и в поиске/плейлистах).
  function openArtistScript(href) {
    return `
      (async function() {
        ${waitForHelper()}
        try {
          const link = document.querySelector('a[href=${JSON.stringify(href)}]');
          if (!link) return JSON.stringify({ ok: false, reason: 'artist-link-not-found' });
          link.click();
          const banner = await waitFor(() => document.querySelector('[data-testid="audio-curator-banner"]'), 5000);
          if (!banner) return JSON.stringify({ ok: false, reason: 'artist-page-not-opened' });
          function coverOf(el) {
            if (!el) return '';
            const bg = getComputedStyle(el).backgroundImage;
            const m = bg.match(/url\\(["']?(.*?)["']?\\)/);
            return m ? m[1] : '';
          }
          const name = (banner.querySelector('[data-testid="headerlayout-in"]') || banner.querySelector('[data-testid="headerlayout"]') || banner).textContent.trim();

          function mapRows(rows, limit) {
            return Array.from(rows).slice(0, limit).map((row, index) => {
              const img = row.querySelector('img');
              return {
                index,
                title: (row.querySelector('[data-testid="MusicTrackRow_Title"]') || {}).textContent || '',
                artist: (row.querySelector('[data-testid="MusicTrackRow_Authors"]') || {}).textContent || '',
                duration: ((row.querySelector('[data-testid="MusicTrackRow_Duration"]') || {}).textContent || '').trim(),
                cover: img ? img.src : ''
              };
            });
          }
          const headers = Array.from(document.querySelectorAll('[data-testid="AudioCatalog_BlockHeader"]'));
          const popularHeader = headers.find(h => h.textContent.trim().startsWith('Популярное'));
          const popularSec = popularHeader ? popularHeader.closest('section') : null;
          const popularRows = popularSec ? popularSec.querySelectorAll('[data-testid="MusicTrackRow"]') : [];

          const releasesHeader = headers.find(h => h.textContent.trim().startsWith('Релизы'));
          const releasesSec = releasesHeader ? releasesHeader.closest('[data-testid="AudioCatalog_Section"]') : null;
          const releaseItems = releasesSec ? releasesSec.querySelectorAll('[data-testid="music-playlists-slider-block-item"]') : [];
          function coverOfCard(item) {
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
          const releases = Array.from(releaseItems).map(item => {
            const t = item.querySelector('[data-testid="MusicPlaylistItem_Title"]');
            const y = item.querySelector('[data-testid="MusicPlaylistItem_ReleaseYear"]');
            return { title: t ? t.textContent.trim() : '', year: y ? y.textContent.trim() : '', cover: coverOfCard(item) };
          }).filter(r => r.title);

          return JSON.stringify({
            ok: true,
            name,
            cover: coverOf(banner.firstElementChild),
            popular: mapRows(popularRows, 8),
            releases
          });
        } catch (e) {
          return JSON.stringify({ ok: false, reason: String(e) });
        }
      })();
    `;
  }

  function selectPopularTrackScript(index) {
    return `
      (async function() {
        ${waitForHelper()}
        const headers = Array.from(document.querySelectorAll('[data-testid="AudioCatalog_BlockHeader"]'));
        const popularHeader = headers.find(h => h.textContent.trim().startsWith('Популярное'));
        const sec = popularHeader ? popularHeader.closest('section') : null;
        const rows = sec ? sec.querySelectorAll('[data-testid="MusicTrackRow"]') : [];
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

  function openReleaseScript(index) {
    return `
      (async function() {
        ${waitForHelper()}
        try {
          const oldClose = document.querySelector('[data-testid="MusicPlaylistModal_Close"]');
          if (oldClose) { oldClose.click(); await new Promise(r => setTimeout(r, 300)); }
          const headers = Array.from(document.querySelectorAll('[data-testid="AudioCatalog_BlockHeader"]'));
          const releasesHeader = headers.find(h => h.textContent.trim().startsWith('Релизы'));
          const sec = releasesHeader ? releasesHeader.closest('[data-testid="AudioCatalog_Section"]') : null;
          const items = sec ? sec.querySelectorAll('[data-testid="music-playlists-slider-block-item"]') : [];
          const item = items[${index}];
          if (!item) return JSON.stringify({ ok: false, reason: 'release-not-found' });
          item.scrollIntoView({ block: 'center', inline: 'center' });
          const titleEl = await waitFor(() => item.querySelector('[data-testid="MusicPlaylistItem_Title"]'), 3000);
          if (!titleEl) return JSON.stringify({ ok: false, reason: 'release-title-not-found' });
          let header = null;
          for (let attempt = 0; attempt < 3 && !header; attempt++) {
            titleEl.click();
            header = await waitFor(() => document.querySelector('[data-testid="MusicPlaylistModal_Header"]'), 1500 + attempt * 700);
          }
          if (!header) return JSON.stringify({ ok: false, reason: 'modal-not-opened' });
          ${modalScrapeScript()}
        } catch (e) {
          return JSON.stringify({ ok: false, reason: String(e) });
        }
      })();
    `;
  }

  const viewEl = document.getElementById('artist-view');
  const statusEl = document.getElementById('artist-status');
  const heroBgEl = document.getElementById('artist-hero-bg');
  const heroNameEl = document.getElementById('artist-hero-name');
  const popularSectionEl = document.getElementById('artist-popular-section');
  const popularListEl = document.getElementById('artist-popular-list');
  const releasesSectionEl = document.getElementById('artist-releases-section');
  const releasesListEl = document.getElementById('artist-releases-list');

  let isOpen = false;
  let popularTracks = [];
  let onBackHandler = null;

  function formatPopularRow(track) {
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
      const result = await playViaTrustedClick(selectPopularTrackScript(track.index));
      row.classList.remove('loading');
      if (!result.ok) statusEl.textContent = 'Не удалось запустить: ' + result.reason;
    });
    return row;
  }

  function formatRelease(rel, index) {
    const item = document.createElement('button');
    item.className = 'search-album';
    item.innerHTML = `
      <img class="search-album-cover" alt="">
      <div class="search-album-title"></div>
      <div class="search-album-sub"></div>
    `;
    const img = item.querySelector('.search-album-cover');
    if (rel.cover) img.src = rel.cover;
    item.querySelector('.search-album-title').textContent = rel.title;
    item.querySelector('.search-album-sub').textContent = rel.year || '';
    item.addEventListener('click', () => {
      window.PlaylistsView.openExternalCard(
        { title: rel.title, cover: rel.cover },
        openReleaseScript(index),
        () => { /* назад из релиза — снова на страницу артиста */ reshow(); }
      );
    });
    return item;
  }

  function reshow() {
    document.querySelectorAll('.app-view').forEach(v => v.classList.toggle('hidden', v.id !== 'artist-view'));
  }

  // Открыть артиста по ссылке (href вида "/artist/kino"), взятой из текущих
  // результатов поиска. onBack — колбэк вызывающей стороны, показывает её
  // экран обратно (страница артиста своего пункта навигации не имеет).
  async function openArtist(item, onBack) {
    isOpen = true;
    onBackHandler = onBack;
    document.querySelectorAll('.nav-item[data-view]').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.app-view').forEach(v => v.classList.toggle('hidden', v.id !== 'artist-view'));
    heroBgEl.style.backgroundImage = item.photo ? `url("${item.photo}")` : '';
    heroNameEl.textContent = item.name;
    statusEl.textContent = 'Загружаю…';
    popularSectionEl.classList.add('hidden');
    releasesSectionEl.classList.add('hidden');
    popularListEl.innerHTML = '';
    releasesListEl.innerHTML = '';
    try {
      const raw = await webview.executeJavaScript(openArtistScript(item.href));
      const res = JSON.parse(raw);
      if (!isOpen) return;
      if (!res.ok) { statusEl.textContent = 'Не удалось открыть: ' + res.reason; return; }
      statusEl.textContent = '';
      heroNameEl.textContent = res.name || item.name;
      if (res.cover) heroBgEl.style.backgroundImage = `url("${res.cover}")`;
      popularTracks = res.popular || [];
      popularListEl.innerHTML = '';
      popularTracks.forEach(t => popularListEl.appendChild(formatPopularRow(t)));
      popularSectionEl.classList.toggle('hidden', !popularTracks.length);
      releasesListEl.innerHTML = '';
      (res.releases || []).forEach((rel, i) => releasesListEl.appendChild(formatRelease(rel, i)));
      releasesSectionEl.classList.toggle('hidden', !(res.releases || []).length);
    } catch (err) {
      if (isOpen) statusEl.textContent = 'Ошибка: ' + err.message;
    }
  }

  async function close() {
    if (!isOpen) return;
    isOpen = false;
    const backFn = onBackHandler;
    onBackHandler = null;
    try { await ensureBasePage(); } catch (e) { /* тихо: попробуем в следующий раз */ }
    if (backFn) backFn();
  }

  // Если пользователь ушёл в другой раздел навигацией, пока была открыта
  // страница артиста — просто забываем состояние (видимость сама уже
  // переключилась общим переключателем разделов), но всё равно возвращаем
  // VK на базовую страницу в фоне, без колбэка "назад".
  function closeIfOpenSilently() {
    if (!isOpen) return;
    isOpen = false;
    onBackHandler = null;
    ensureBasePage().catch(() => {});
  }

  document.getElementById('artist-back').addEventListener('click', close);

  // Подсветка играющего трека в "Популярном"
  window.addEventListener('vk-player-state', (e) => {
    if (!isOpen) return;
    const state = e.detail;
    const key = (state.title || '') + '|' + (state.artist || '');
    popularListEl.querySelectorAll('.mymusic-row').forEach((row, i) => {
      const track = popularTracks[i];
      row.classList.toggle('playing', !!track && !!state.title && (track.title + '|' + track.artist) === key);
    });
  });

  return { openArtist, closeIfOpenSilently };
})();
