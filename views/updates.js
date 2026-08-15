// ---------- Раздел "Обновления": новые релизы от подписок ----------
// Отдельная вкладка каталога VK (AudioCatalog_Tabs_Tab_updates), лента из
// карточек-треков вперемешку с промо-плашками ("Найдите кураторов" и т.п.).
// Карточки переиспользуют разметку MusicPlaylistItem_* (тот же компонент,
// что и в "Плейлистах"), хотя это одиночные треки, а не плейлисты — плашки
// без play-кнопки просто не проходят фильтр при скрейпе.
window.UpdatesView = (function () {
  const {
    webview, SELECTORS, pickHelper, coverHelper, sendTrustedClick, wait,
    ensureBasePage, playViaTrustedClick, beginAutomation, endAutomation
  } = window.Shared;

  function scrapeUpdatesScript() {
    return `
      (async function() {
        ${pickHelper()}
        ${coverHelper()}
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
        const tab = pick(sel.updatesTab);
        if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
        const cells = await waitFor(() => {
          const list = document.querySelectorAll('[data-testid="MusicPlaylistItem_Cell"]');
          return list.length ? list : null;
        }, 4000);
        if (!cells) return JSON.stringify({ ok: false, reason: 'no-updates-found' });
        function coverOf(cell) {
          const pv = cell.querySelector('[data-testid="MusicPlaylistItem_PreviewImage"]');
          if (!pv) return null;
          let bg = getComputedStyle(pv).backgroundImage;
          if (bg === 'none') {
            const inner = Array.from(pv.querySelectorAll('*')).find(e => getComputedStyle(e).backgroundImage !== 'none');
            bg = inner ? getComputedStyle(inner).backgroundImage : 'none';
          }
          if (bg === 'none') return null;
          return bg.replace(/^url\\(["']?/, '').replace(/["']?\\)$/, '');
        }
        // Плашки-промо ("Найти людей"/"Найти кураторов") рендерятся тем же
        // MusicPlaylistItem_Cell без кнопки play — отсеиваем по её наличию
        const tracks = Array.from(cells)
          .filter(cell => cell.querySelector('[data-testid="MusicPlaylistItem_TogglePlaying"]'))
          .map((cell, index) => {
            const titleEl = cell.querySelector('[data-testid="MusicPlaylistItem_Title"]');
            const authorEl = cell.querySelector('[data-testid="MusicPlaylistItem_AuthorLink"]');
            const yearEl = cell.querySelector('[data-testid="MusicPlaylistItem_ReleaseYear"]');
            return {
              index,
              title: titleEl ? titleEl.textContent.trim() : '',
              artist: authorEl ? authorEl.textContent.trim() : '',
              year: yearEl ? yearEl.textContent.trim() : '',
              cover: hiResCover(cell, 300) || coverOf(cell)
            };
          });
        return JSON.stringify({ ok: true, tracks });
      })();
    `;
  }

  // Общее: найти i-ю карточку из того же (отфильтрованного) списка и вернуть
  // координаты нужной кнопки внутри неё для доверенного клика. VK сам уводит
  // со страницы "Обновления" на "Моя музыка" после запуска трека из ленты
  // (проверено вживую) — переселекчиваем вкладку "Обновления", если это
  // случилось, прежде чем искать карточку по индексу.
  function updateButtonScript(index, testid) {
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
        const q = () => Array.from(document.querySelectorAll('[data-testid="MusicPlaylistItem_Cell"]'))
          .filter(cell => cell.querySelector('[data-testid="MusicPlaylistItem_TogglePlaying"]'));
        if (!q().length) {
          const tab = pick(sel.updatesTab);
          if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
          await waitFor(() => q().length ? true : null, 3000);
        }
        const cells = q();
        const cell = cells[${index}];
        if (!cell) return JSON.stringify({ ok: false, reason: 'row-not-found' });
        const btn = cell.querySelector('[data-testid="${testid}"]');
        if (!btn) return JSON.stringify({ ok: false, reason: 'action-button-not-found' });
        cell.scrollIntoView({ block: 'center' });
        const r = btn.getBoundingClientRect();
        return JSON.stringify({ ok: true, needsTrustedClick: true, x: r.left + r.width / 2, y: r.top + r.height / 2 });
      })();
    `;
  }

  function readShareLinkScript() {
    return `
      (function() {
        ${pickHelper()}
        const sel = ${JSON.stringify(SELECTORS)};
        const wrap = pick(sel.shareLinkInput);
        const input = wrap ? wrap.querySelector('input') : null;
        return JSON.stringify({ link: input ? input.value : null });
      })();
    `;
  }

  function closeShareModalScript() {
    return `
      (function() {
        ${pickHelper()}
        const sel = ${JSON.stringify(SELECTORS)};
        const btn = pick(sel.shareModalClose);
        if (btn) btn.click();
        return JSON.stringify({ ok: !!btn });
      })();
    `;
  }

  const statusEl = document.getElementById('updates-status');
  const listEl = document.getElementById('updates-track-list');
  let updates = [];
  let loaded = false;

  const PLAYLIST_ADD_D = 'M15 19v-2h4v-4h2v4h4v2h-4v4h-2v-4zm-14 2v-2h10v2zm0-6v-2h14v2zm0-6V7h14v2z';
  const SHARE_D = 'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L7.04 9.81C6.5 9.31 5.79 9 5 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92';

  async function copyToClipboard(text) {
    window.focus();
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  async function shareUpdate(index, btn) {
    if (btn.classList.contains('loading')) return;
    btn.classList.add('loading');
    const manual = beginAutomation();
    try {
      const clickRaw = await webview.executeJavaScript(updateButtonScript(index, 'MusicPlaylistItem_ShareAction'));
      const clickRes = JSON.parse(clickRaw);
      if (!clickRes.ok) { statusEl.textContent = 'Не удалось: ' + clickRes.reason; return; }
      sendTrustedClick(Math.round(clickRes.x), Math.round(clickRes.y));
      let link = null;
      const deadline = Date.now() + 3000;
      while (!link && Date.now() < deadline) {
        await wait(200);
        const linkRaw = await webview.executeJavaScript(readShareLinkScript());
        link = JSON.parse(linkRaw).link || null;
      }
      await webview.executeJavaScript(closeShareModalScript()).catch(() => {});
      const copied = !!link && await copyToClipboard(link);
      statusEl.textContent = copied ? 'Ссылка скопирована' : 'Не удалось получить ссылку';
      setTimeout(() => { if (statusEl.textContent.startsWith('Ссылка') || statusEl.textContent.startsWith('Не удалось получить')) statusEl.textContent = ''; }, 2000);
    } catch (err) {
      statusEl.textContent = 'Ошибка: ' + err.message;
    } finally {
      endAutomation(manual);
      btn.classList.remove('loading');
    }
  }

  async function addToLibrary(index, btn) {
    if (btn.classList.contains('loading')) return;
    btn.classList.add('loading');
    const manual = beginAutomation();
    try {
      const raw = await webview.executeJavaScript(updateButtonScript(index, 'MusicPlaylist_ToggleFollowing'));
      const res = JSON.parse(raw);
      if (!res.ok) { statusEl.textContent = 'Не удалось: ' + res.reason; return; }
      sendTrustedClick(Math.round(res.x), Math.round(res.y));
      await wait(300);
      btn.classList.add('done');
    } catch (err) {
      statusEl.textContent = 'Ошибка: ' + err.message;
    } finally {
      endAutomation(manual);
      btn.classList.remove('loading');
    }
  }

  function formatUpdateRow(track) {
    const row = document.createElement('div');
    row.className = 'mymusic-row';
    row.dataset.index = track.index;
    row.innerHTML = `
      <img class="mymusic-row-cover" src="${track.cover || ''}" alt="">
      <div class="mymusic-row-info">
        <div class="mymusic-row-title"></div>
        <div class="mymusic-row-artist"></div>
      </div>
      <div class="mymusic-row-actions">
        <button class="mymusic-row-action" data-row-action="playlist" title="Добавить в мою музыку"><svg viewBox="0 0 24 24"><path d="${PLAYLIST_ADD_D}"/></svg></button>
        <button class="mymusic-row-action" data-row-action="share" title="Поделиться"><svg viewBox="0 0 24 24"><path d="${SHARE_D}"/></svg></button>
      </div>
      <div class="mymusic-row-duration"></div>
    `;
    row.querySelector('.mymusic-row-title').textContent = track.title || 'Без названия';
    row.querySelector('.mymusic-row-artist').textContent = track.artist;
    row.querySelector('.mymusic-row-duration').textContent = track.year;
    row.querySelector('[data-row-action="playlist"]').addEventListener('click', (e) => {
      e.stopPropagation();
      addToLibrary(track.index, e.currentTarget);
    });
    row.querySelector('[data-row-action="share"]').addEventListener('click', (e) => {
      e.stopPropagation();
      shareUpdate(track.index, e.currentTarget);
    });
    row.addEventListener('click', async () => {
      if (row.classList.contains('loading')) return;
      row.classList.add('loading');
      await ensureBasePage();
      const result = await playViaTrustedClick(updateButtonScript(track.index, 'MusicPlaylistItem_TogglePlaying'));
      row.classList.remove('loading');
      if (!result.ok) statusEl.textContent = 'Не удалось запустить: ' + result.reason;
    });
    return row;
  }

  async function loadUpdates() {
    if (loaded) return;
    statusEl.textContent = 'Загружаю…';
    try {
      if (!(await ensureBasePage())) { statusEl.textContent = 'Не удалось: vk-page-not-ready'; return; }
      const raw = await webview.executeJavaScript(scrapeUpdatesScript());
      const res = JSON.parse(raw);
      if (!res.ok) { statusEl.textContent = 'Не удалось: ' + res.reason; return; }
      updates = res.tracks;
      loaded = true;
      listEl.innerHTML = '';
      if (!updates.length) { statusEl.textContent = 'Пока нет новых обновлений'; return; }
      updates.forEach(track => listEl.appendChild(formatUpdateRow(track)));
      statusEl.textContent = '';
    } catch (err) {
      statusEl.textContent = 'Ошибка: ' + err.message;
    }
  }

  window.addEventListener('vk-player-state', (e) => {
    const state = e.detail;
    const key = (state.title || '') + '|' + (state.artist || '');
    listEl.querySelectorAll('.mymusic-row').forEach(row => {
      const track = updates[Number(row.dataset.index)];
      row.classList.toggle('playing', !!track && !!state.title && (track.title + '|' + track.artist) === key);
    });
  });

  return { loadUpdates };
})();
