// ---------- Панель "Текст песни" ----------
// У VK есть готовый текст (MusicAudio_OpenLyrics открывает панель со
// строками в [class*="MusicLyricsLayout__content"]) — но, в отличие от
// плеера/настроек Микса, эта кнопка реагирует ТОЛЬКО на доверенный клик
// (обычный el.click() не открывает панель, проверено вживую). Поэтому
// открываем/закрываем её так же, как playViaTrustedClick — координаты из
// executeJavaScript, сам клик через webview.sendInputEvent.
// Подсветки текущей строки под время трека у VK нет (проверено: все строки
// визуально одинаковы независимо от прогресса воспроизведения) — поэтому
// у нас тоже просто статичный список строк, без синхронизации.
window.LyricsView = (function () {
  const { webview, ensureBasePage, beginAutomation, endAutomation, sendTrustedClick, wait } = window.Shared;

  const panelEl = document.getElementById('lyrics-panel');
  const coverEl = document.getElementById('lyrics-cover');
  const titleEl = document.getElementById('lyrics-track-title');
  const artistEl = document.getElementById('lyrics-track-artist');
  const statusEl = document.getElementById('lyrics-status');
  const linesEl = document.getElementById('lyrics-lines');
  const closeBtn = document.getElementById('lyrics-close');

  let isOpen = false;
  let currentState = null;

  function applyTrackInfo(state) {
    currentState = state;
    if (!isOpen) return;
    titleEl.textContent = state.title || '';
    artistEl.textContent = state.artist || '';
    if (state.cover) coverEl.src = state.cover;
  }
  window.addEventListener('vk-player-state', (e) => applyTrackInfo(e.detail));

  function findLyricsButtonScript() {
    return `
      (() => {
        const b = document.querySelector('[data-testid="MusicAudio_OpenLyrics"]');
        if (!b) return JSON.stringify({ found: false });
        // Кнопка живёт в верхнем плеере VK — если список треков прокручен,
        // getBoundingClientRect отдаёт координаты далеко за пределами окна
        // (проверено: y уходил в -2000+), клик по ним промахивался мимо.
        b.scrollIntoView({ block: 'center' });
        const r = b.getBoundingClientRect();
        return JSON.stringify({ found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 });
      })();
    `;
  }

  // Кнопка — переключатель: один и тот же доверенный клик открывает и
  // закрывает панель в VK.
  async function clickLyricsToggle() {
    const raw = await webview.executeJavaScript(findLyricsButtonScript());
    const coords = JSON.parse(raw);
    if (!coords.found) return false;
    sendTrustedClick(Math.round(coords.x), Math.round(coords.y));
    return true;
  }

  function scrapeLyricsScript() {
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
        const content = await waitFor(() => document.querySelector('[class*="MusicLyricsLayout__content"]'), 4000);
        if (!content) return JSON.stringify({ ok: false, reason: 'no-lyrics' });
        const lines = Array.from(content.children).map(c => c.textContent.trim()).filter(Boolean);
        return JSON.stringify({ ok: true, lines });
      })();
    `;
  }

  async function open() {
    if (isOpen) return;
    if (!currentState || !currentState.title) return; // нечего показывать
    isOpen = true;
    panelEl.classList.remove('hidden');
    applyTrackInfo(currentState);
    statusEl.textContent = 'Загружаю текст…';
    linesEl.innerHTML = '';

    const manual = beginAutomation();
    await wait(100);
    try {
      await ensureBasePage();
      const opened = await clickLyricsToggle();
      if (!opened) { statusEl.textContent = 'Кнопка текста песни не найдена'; return; }
      await wait(300);
      const raw = await webview.executeJavaScript(scrapeLyricsScript());
      const res = JSON.parse(raw);
      // Панель в VK нам больше не нужна — текст уже собран, закрываем её же
      // доверенным кликом, чтобы не оставлять открытой в фоне.
      await clickLyricsToggle();
      if (!isOpen) return; // пользователь уже закрыл нашу панель, пока грузили
      if (!res.ok) { statusEl.textContent = 'Текст не найден для этого трека'; return; }
      statusEl.textContent = '';
      res.lines.forEach((line) => {
        const el = document.createElement('div');
        el.className = 'lyrics-line';
        el.textContent = line;
        linesEl.appendChild(el);
      });
    } catch (err) {
      if (isOpen) statusEl.textContent = 'Ошибка: ' + err.message;
    } finally {
      endAutomation(manual);
    }
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    panelEl.classList.add('hidden');
  }

  function toggle() {
    if (isOpen) close(); else open();
  }

  closeBtn.addEventListener('click', close);

  return { open, close, toggle };
})();
