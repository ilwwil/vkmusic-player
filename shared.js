// Общие низкоуровневые утилиты для общения со скрытым webview VK.
// Используются и оболочкой (renderer.js), и разделами (views/*.js).
window.Shared = (function () {
  const webview = document.getElementById('vkview');
  const contentEl = document.getElementById('content');
  const SELECTORS = window.VK_SELECTORS;

  function pickHelper() {
    return `
      function pick(list) {
        for (const sel of list) {
          try {
            const el = document.querySelector(sel);
            if (el) return el;
          } catch (e) {}
        }
        return null;
      }
    `;
  }

  // Строчный <img> в списке треков — это подписанный URL на 68x68 (реже
  // 34x34), апскейл которого в крупные плитки (баннеры, "Недавно
  // прослушанные") выглядит размыто. Подписи по размеру сгенерированы VK
  // заранее и не подделываются на клиенте (смена size= в URL без валидной
  // подписи отдаёт 403) — но полный набор готовых подписанных вариантов
  // (34..1200px) лежит в пропсах React-компонента строки (track.entity.cover.sizes),
  // рядом с тем же <img>. Проходим по дереву fiber вверх от элемента и берём
  // из него ближайший подходящий по размеру вариант.
  function coverHelper() {
    return `
      function hiResCover(startEl, minSize) {
        try {
          const key = Object.keys(startEl).find(k => k.startsWith('__reactFiber'));
          if (!key) return null;
          let fiber = startEl[key];
          let depth = 0;
          while (fiber && depth < 30) {
            const props = fiber.memoizedProps;
            const cover = props && props.track && props.track.entity && props.track.entity.cover;
            if (cover && Array.isArray(cover.sizes) && cover.sizes.length) {
              const sorted = cover.sizes.slice().sort((a, b) => a.width - b.width);
              const fit = sorted.find(s => s.width >= minSize);
              return (fit || sorted[sorted.length - 1]).src;
            }
            fiber = fiber.return;
            depth++;
          }
        } catch (e) {}
        return null;
      }
    `;
  }

  function sendTrustedClick(x, y) {
    webview.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    webview.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  }

  // У строк "Моей музыки" кнопки при наведении (дизлайк, убрать из библиотеки)
  // не просто скрыты через CSS — React вообще не монтирует их в DOM, пока не
  // произойдёт настоящее наведение курсора. Поэтому перед кликом по ним нужно
  // сначала отправить доверенное движение мыши и дать время на монтирование.
  function sendTrustedHover(x, y) {
    webview.sendInputEvent({ type: 'mouseMove', x, y });
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Тост на время автоматизации (см. #vk-curtain в index.html — маленькая
  // плашка снизу-по-центру, не блок на весь экран). Счётчик — на случай
  // перекрывающихся операций: прячем, только когда закончили все.
  const curtainEl = document.getElementById('vk-curtain');
  const curtainLabelEl = document.getElementById('vk-curtain-label');
  let curtainCount = 0;
  function showCurtain(label) {
    curtainCount++;
    if (label) curtainLabelEl.textContent = label;
    curtainEl.classList.add('visible');
  }
  function hideCurtain() {
    curtainCount = Math.max(0, curtainCount - 1);
    if (curtainCount === 0) curtainEl.classList.remove('visible');
  }

  // Доверенным кликам/hover/скроллу нужно, чтобы гость был "visible" для
  // компоновщика (см. память project_custom_shell — visibility:hidden рвёт
  // клики), но НЕ обязательно на экране: сдвигаем его за левый край окна —
  // компоновка идёт как обычно, но пользователь ничего не видит (проверено:
  // play/pause, hover-реveal дизлайка и лови-скролл догрузки списка — всё
  // работает с webview, целиком выведенным за пределы окна).
  // Если пользователь сам держит открытым debug-режим "Показать VK"
  // (contentEl.vk-visible), не трогаем его — оставляем видимым на экране.
  function beginAutomation() {
    const manual = contentEl.classList.contains('vk-visible');
    if (!manual) contentEl.classList.add('vk-automating');
    return manual;
  }
  function endAutomation(manual) {
    if (!manual) contentEl.classList.remove('vk-automating');
  }

  // Разделы "Моя музыка" и "Поиск" рассчитывают, что VK стоит на базовой
  // странице каталога (vk.com/audio, вкладки Главная/Моя музыка/...). После
  // работы с плейлистами VK остаётся на подстранице ?block=my_playlists, а
  // после поиска — с ?q= в URL; на них нужных секций нет, и скрипты падали с
  // no-tracks-found / search-failed / modal-not-opened. Перед такими
  // операциями проверяем URL и при необходимости возвращаем VK на базовую
  // страницу, дожидаясь, пока каталог отрендерит вкладки (не только load —
  // React рисует их позже). Во время перезагрузки executeJavaScript может
  // бросать — глотаем и продолжаем ждать.
  // Проверка "каталог готов": чистый URL + отрисованные вкладки
  function basePageReadyScript() {
    return `
      !/[?&](block|q)=/.test(location.href) &&
      !!document.querySelector('[data-testid="AudioCatalog_Tabs_Tab_all"]')
    `;
  }
  // Сначала пробуем SPA-пути — они НЕ прерывают текущее воспроизведение:
  // q= снимается кнопкой очистки поиска, block=my_playlists — кликом по
  // хлебной крошке "Моя музыка" (a[data-testid=breadcrumb]). Полная
  // перезагрузка (loadURL) — только крайний случай: она убивает плеер VK.
  function spaCleanupScript() {
    return `
      (function() {
        if (/[?&]q=/.test(location.href)) {
          const clear = document.querySelector('[data-testid="search_audio_clear"]');
          if (clear) { clear.click(); return 'clear'; }
        }
        if (/[?&]block=/.test(location.href)) {
          const crumb = document.querySelector('a[data-testid="breadcrumb"]');
          if (crumb) { crumb.click(); return 'crumb'; }
        }
        return 'none';
      })();
    `;
  }
  async function currentHref() {
    try { return await webview.executeJavaScript('location.href'); } catch (e) { return ''; }
  }
  async function ensureBasePage() {
    // Стартовый случай: webview ещё грузит vk.com — дождёмся настоящего URL,
    // иначе пустой href принимался за "грязный" и запускал лишнюю перезагрузку
    let href = await currentHref();
    const bootDeadline = Date.now() + 15000;
    while ((!href || href === 'about:blank') && Date.now() < bootDeadline) {
      await wait(400);
      href = await currentHref();
    }
    const isDirty = !href || /[?&](block|q)=/.test(href) || !/vk\.com\/audio/.test(href);
    if (!isDirty) return true;
    // Этап 1: SPA-очистка
    let deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      try {
        await webview.executeJavaScript(spaCleanupScript());
        await wait(400);
        if (await webview.executeJavaScript(basePageReadyScript())) return true;
      } catch (e) { await wait(400); }
    }
    // Этап 2: полная перезагрузка
    webview.loadURL('https://vk.com/audio');
    deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      await wait(300);
      try {
        if (await webview.executeJavaScript(basePageReadyScript())) return true;
      } catch (e) { /* страница ещё грузится */ }
    }
    return false;
  }

  // VK не обрабатывает клик по кнопке play/pause, пока webview визуально скрыт
  // (visibility:hidden) — сам клик по треку в списке (выбор) при этом проходит,
  // а вот команда "начать воспроизведение" — нет. Проверено: тот же доверенный
  // клик по TopAudioPlayer_TogglePlayAction не работал, пока #content не был
  // временно переключён в vk-visible, и сработал сразу после переключения.
  function checkPlayNeededScript() {
    return `
      (function() {
        const btn = document.querySelector('[data-testid="TopAudioPlayer_TogglePlayAction"]');
        if (!btn) return JSON.stringify({ found: false });
        const svg = btn.querySelector('svg');
        const isPaused = svg ? /vkuiIcon--play_/.test(svg.getAttribute('class') || '') : false;
        const r = btn.getBoundingClientRect();
        return JSON.stringify({ found: true, isPaused, x: r.left + r.width / 2, y: r.top + r.height / 2 });
      })();
    `;
  }

  // Общий сценарий "выбрать трек и реально запустить воспроизведение":
  // 1) кратко показываем VK (иначе play/pause не реагирует, см. checkPlayNeededScript),
  // 2) выполняем переданный скрипт выбора трека и доверенно кликаем по
  // возвращённым координатам, 3) проверяем, не осталась ли кнопка play/pause на
  // паузе, и если да — доверенно кликаем и по ней, 4) прячем VK обратно.
  // Возвращает { ok, reason? }.
  async function playViaTrustedClick(selectScript) {
    showCurtain('Запускаю…');
    const manual = beginAutomation();
    await wait(80); // дать компоновщику отрисовать кадр перед доверенным кликом
    try {
      const raw = await webview.executeJavaScript(selectScript);
      const res = JSON.parse(raw);
      if (!res.ok) return { ok: false, reason: res.reason };
      if (res.needsTrustedClick) {
        sendTrustedClick(Math.round(res.x), Math.round(res.y));
        await wait(600); // дать треку загрузиться перед проверкой play/pause
        const stateRaw = await webview.executeJavaScript(checkPlayNeededScript());
        const state = JSON.parse(stateRaw);
        if (state.found && state.isPaused) {
          sendTrustedClick(Math.round(state.x), Math.round(state.y));
          await wait(300);
        }
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err.message };
    } finally {
      endAutomation(manual);
      hideCurtain();
    }
  }

  return {
    webview, contentEl, SELECTORS,
    pickHelper, coverHelper, sendTrustedClick, sendTrustedHover, wait,
    ensureBasePage,
    checkPlayNeededScript, playViaTrustedClick,
    showCurtain, hideCurtain,
    beginAutomation, endAutomation
  };
})();
