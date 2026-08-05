// ---------- Модалка "Настроить VK Микс" ----------
// Наша пилюльная форма поверх настоящих настроек VK Микса
// ([data-testid="MusicMixSettings_*"] — открывается кнопкой
// AudioStreamMix_OpenSettingsAction на хиро "Слушать VK Микс", живёт на
// вкладке "Главная" каталога). В отличие от плеера, эти элементы реагируют
// на обычный el.click() без доверенного клика и без необходимости
// показывать webview — проверено вживую. При открытии читаем текущий выбор
// VK (data-testactive), при "Применить" — доводим выбор VK до нашего и
// жмём настоящую кнопку "Применить" в модалке VK.
window.MixSettings = (function () {
  const { webview, ensureBasePage, pickHelper, SELECTORS } = window.Shared;
  const modalEl = document.getElementById('mix-settings-modal');
  const statusEl = document.getElementById('mix-settings-status');
  const groups = ['mood', 'familiarity', 'language'];
  // Русское название категории у VK -> наш ключ группы
  const CATEGORY_TITLE_TO_GROUP = { 'Настроение': 'mood', 'Узнаваемость': 'familiarity', 'Язык': 'language' };

  let state = { mood: null, familiarity: null, language: null };

  function render() {
    groups.forEach((group) => {
      const container = document.querySelector(`.mix-settings-chips[data-chip-group="${group}"]`);
      container.querySelectorAll('.mix-chip').forEach((chip) => {
        chip.classList.toggle('active', chip.dataset.chipValue === state[group]);
      });
    });
  }

  groups.forEach((group) => {
    const container = document.querySelector(`.mix-settings-chips[data-chip-group="${group}"]`);
    container.querySelectorAll('.mix-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const value = chip.dataset.chipValue;
        state[group] = state[group] === value ? null : value;
        render();
      });
    });
  });

  document.getElementById('mix-settings-reset').addEventListener('click', () => {
    state = { mood: null, familiarity: null, language: null };
    render();
  });

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

  // Блок VK Микса (AudioStreamMix) живёт на вкладке "Главная" каталога —
  // если VK сейчас на "Моей музыке"/в поиске/т.п., его просто нет в DOM.
  function ensureGeneralTabScript() {
    return `
      (async function() {
        ${pickHelper()}
        ${waitForHelper()}
        const sel = ${JSON.stringify(SELECTORS)};
        const tab = pick(sel.catalogTabGeneral);
        if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
        await waitFor(() => document.querySelector('[data-testid="AudioStreamMix_OpenSettingsAction"]'), 3000);
        return 'ok';
      })();
    `;
  }
  async function ensureGeneralTab() {
    await ensureBasePage();
    await webview.executeJavaScript(ensureGeneralTabScript());
  }

  // Читает текущий выбор VK по всем трём категориям (по data-testactive).
  // Открывает и закрывает настоящую модалку VK — на экране это не видно,
  // т.к. webview всё это время остаётся скрытым.
  function readMixStateScript() {
    return `
      (async function() {
        ${waitForHelper()}
        try {
          const openBtn = document.querySelector('[data-testid="AudioStreamMix_OpenSettingsAction"]');
          if (!openBtn) return JSON.stringify({ ok: false, reason: 'mix-not-found' });
          openBtn.click();
          const title = await waitFor(() => document.querySelector('[data-testid="MusicMixSettings_Title"]'), 3000);
          if (!title) return JSON.stringify({ ok: false, reason: 'settings-not-opened' });
          const result = {};
          document.querySelectorAll('[data-testid="MusicMixSettings_Category"]').forEach(cat => {
            const groupTitle = (cat.querySelector('[data-testid="MusicMixSettings_CategoryTitle"]') || {}).textContent || '';
            const active = cat.querySelector('[data-testid="MusicMixSettings_Option"][data-testactive="true"]');
            result[groupTitle] = active ? active.textContent.trim() : null;
          });
          const dismiss = document.querySelector('[data-testid="MusicMixSettings_DismissButton"]');
          if (dismiss) dismiss.click();
          return JSON.stringify({ ok: true, result });
        } catch (e) {
          return JSON.stringify({ ok: false, reason: String(e) });
        }
      })();
    `;
  }

  // Приводит выбор VK к желаемому (по каждой категории кликает нужную опцию,
  // если она сейчас не активна; desired[group] === null снимает выбор
  // повторным кликом по уже активной), затем жмёт "Применить" в самой
  // модалке VK и закрывает её.
  function applyMixStateScript(desired) {
    return `
      (async function() {
        ${waitForHelper()}
        try {
          const openBtn = document.querySelector('[data-testid="AudioStreamMix_OpenSettingsAction"]');
          if (!openBtn) return JSON.stringify({ ok: false, reason: 'mix-not-found' });
          openBtn.click();
          const title = await waitFor(() => document.querySelector('[data-testid="MusicMixSettings_Title"]'), 3000);
          if (!title) return JSON.stringify({ ok: false, reason: 'settings-not-opened' });

          const desired = ${JSON.stringify(desired)};
          document.querySelectorAll('[data-testid="MusicMixSettings_Category"]').forEach(cat => {
            const groupTitle = (cat.querySelector('[data-testid="MusicMixSettings_CategoryTitle"]') || {}).textContent || '';
            const wantValue = desired[groupTitle];
            const options = Array.from(cat.querySelectorAll('[data-testid="MusicMixSettings_Option"]'));
            const active = options.find(o => o.getAttribute('data-testactive') === 'true');
            const activeValue = active ? active.textContent.trim() : null;
            if (activeValue === (wantValue || null)) return; // уже как надо
            if (wantValue) {
              const target = options.find(o => o.textContent.trim() === wantValue);
              if (target) target.click();
            } else if (active) {
              active.click(); // снять текущий выбор
            }
          });
          await new Promise(r => setTimeout(r, 200));

          const save = document.querySelector('[data-testid="MusicMixSettings_SaveOptionsAction"]');
          if (save) save.click();
          await new Promise(r => setTimeout(r, 400));
          const dismiss = document.querySelector('[data-testid="MusicMixSettings_DismissButton"]');
          if (dismiss) dismiss.click();
          return JSON.stringify({ ok: true });
        } catch (e) {
          return JSON.stringify({ ok: false, reason: String(e) });
        }
      })();
    `;
  }

  document.getElementById('mix-settings-apply').addEventListener('click', async () => {
    statusEl.textContent = 'Применяю…';
    const desiredByTitle = {};
    groups.forEach((group) => {
      const title = Object.keys(CATEGORY_TITLE_TO_GROUP).find((t) => CATEGORY_TITLE_TO_GROUP[t] === group);
      desiredByTitle[title] = state[group];
    });
    try {
      await ensureGeneralTab();
      const raw = await webview.executeJavaScript(applyMixStateScript(desiredByTitle));
      const res = JSON.parse(raw);
      if (!res.ok) { statusEl.textContent = 'Не удалось: ' + res.reason; return; }
      statusEl.textContent = '';
      close();
    } catch (err) {
      statusEl.textContent = 'Ошибка: ' + err.message;
    }
  });

  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) close();
  });

  async function open() {
    modalEl.classList.remove('hidden');
    statusEl.textContent = 'Читаю текущие настройки…';
    render();
    try {
      await ensureGeneralTab();
      const raw = await webview.executeJavaScript(readMixStateScript());
      const res = JSON.parse(raw);
      if (modalEl.classList.contains('hidden')) return; // закрыли, пока читали
      if (!res.ok) { statusEl.textContent = 'Не удалось прочитать текущие настройки: ' + res.reason; return; }
      groups.forEach((group) => {
        const title = Object.keys(CATEGORY_TITLE_TO_GROUP).find((t) => CATEGORY_TITLE_TO_GROUP[t] === group);
        state[group] = res.result[title] || null;
      });
      render();
      statusEl.textContent = '';
    } catch (err) {
      statusEl.textContent = 'Ошибка: ' + err.message;
    }
  }
  function close() {
    modalEl.classList.add('hidden');
  }

  return { open, close };
})();
