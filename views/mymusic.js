// ---------- Раздел "Моя музыка": собственный список треков ----------
window.MyMusicView = (function () {
  const { webview, contentEl, SELECTORS, pickHelper, sendTrustedClick, sendTrustedHover, wait, ensureBasePage, playViaTrustedClick, showCurtain, hideCurtain, beginAutomation, endAutomation } = window.Shared;

  // Клик по конкретной строке "Моя музыка" из нашего собственного списка (не
  // шафл) — находим ту же строку по индексу внутри AudioCatalog_SectionTracks
  // (порядок в DOM стабилен между построением списка и кликом по нему) и отдаём
  // хосту координаты для доверенного клика.
  function selectTrackByIndexScript(index) {
    return `
      (async function() {
        ${pickHelper()}
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
          const rows = await waitFor(() => {
            const list = document.querySelectorAll('[data-testid="AudioCatalog_SectionTracks"] [data-testid="MusicTrackRow"]');
            return list.length ? list : null;
          }, 3000);
          if (!rows) return JSON.stringify({ ok: false, reason: 'no-tracks-found' });
          const row = rows[${index}];
          if (!row) return JSON.stringify({ ok: false, reason: 'row-not-found' });
          const controls = row.querySelector('[data-testid="MusicTrackRow_PlaybackControls"]');
          if (!controls) return JSON.stringify({ ok: false, reason: 'row-controls-not-found' });
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

  // Кнопки дизлайк/убрать-из-библиотеки у строки "Моей музыки" VK не просто
  // прячет через CSS на ховере — React вообще не монтирует их в DOM без
  // настоящего наведения курсора. Поэтому действие в два шага: 1) находим
  // строку и отдаём хосту точку для доверенного mouseMove (наведение),
  // 2) после паузы на монтирование ищем уже появившуюся кнопку и кликаем по
  // ней (тоже доверенным кликом — раз уж кнопка требует hover, вероятно, того
  // же трастового окружения ждёт и клик).
  function rowHoverPointScript(index) {
    return `
      (function() {
        try {
          const rows = document.querySelectorAll('[data-testid="AudioCatalog_SectionTracks"] [data-testid="MusicTrackRow"]');
          const row = rows[${index}];
          if (!row) return JSON.stringify({ ok: false, reason: 'row-not-found' });
          row.scrollIntoView({ block: 'center' });
          const r = row.getBoundingClientRect();
          return JSON.stringify({ ok: true, x: r.left + r.width - 20, y: r.top + r.height / 2 });
        } catch (e) {
          return JSON.stringify({ ok: false, reason: String(e) });
        }
      })();
    `;
  }

  function rowActionButtonScript(index, action) {
    const testid = action === 'dislike' ? 'MusicAudio_ToggleDislike' : 'MusicAudio_ToggleOwning';
    return `
      (function() {
        try {
          const rows = document.querySelectorAll('[data-testid="AudioCatalog_SectionTracks"] [data-testid="MusicTrackRow"]');
          const row = rows[${index}];
          if (!row) return JSON.stringify({ ok: false, reason: 'row-not-found' });
          const btn = row.querySelector('[data-testid="${testid}"]');
          if (!btn) return JSON.stringify({ ok: false, reason: 'action-button-not-found' });
          const r = btn.getBoundingClientRect();
          return JSON.stringify({ ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 });
        } catch (e) {
          return JSON.stringify({ ok: false, reason: String(e) });
        }
      })();
    `;
  }

  // Собираем плоский список треков "Моей музыки" из уже загруженного в DOM
  // (без докрутки/пагинации — просто то, что VK успел отрендерить к моменту
  // открытия вкладки). Индекс каждой строки нужен, чтобы потом кликнуть именно
  // по ней через selectTrackByIndexScript.
  function scrapeMyMusicScript() {
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
        const tab = pick(sel.catalogTabAllMusic);
        if (tab) tab.click();
        const rows = await waitFor(() => {
          const list = document.querySelectorAll('[data-testid="AudioCatalog_SectionTracks"] [data-testid="MusicTrackRow"]');
          return list.length ? list : null;
        }, 3000);
        if (!rows) return JSON.stringify({ ok: false, reason: 'no-tracks-found' });
        const tracks = Array.from(rows).map((row, index) => {
          const titleEl = row.querySelector('[data-testid="MusicTrackRow_Title"]');
          const authorsEl = row.querySelector('[data-testid="MusicTrackRow_Authors"]');
          const durationEl = row.querySelector('[data-testid="MusicTrackRow_Duration"]');
          const img = row.querySelector('[data-testid="MusicTrackRow_PlaybackControls"] img');
          return {
            index,
            title: titleEl ? titleEl.textContent.trim() : '',
            artist: authorsEl ? authorsEl.textContent.trim() : '',
            duration: durationEl ? durationEl.textContent.trim() : '',
            cover: img ? img.src : ''
          };
        });
        return JSON.stringify({ ok: true, tracks });
      })();
    `;
  }

  // Дизлайк / убрать-из-библиотеки для конкретной строки "Моей музыки": сперва
  // доверенно "наводим курсор" на строку (иначе кнопки не смонтированы в DOM,
  // см. комментарий у rowHoverPointScript), затем ищем появившуюся кнопку и
  // доверенно кликаем по ней. Тоже требует кратковременной видимости VK.
  async function runRowAction(index, action) {
    showCurtain('Секунду…');
    const manual = beginAutomation();
    await wait(80);
    try {
      if (!(await ensureBasePage())) return { ok: false, reason: 'vk-page-not-ready' };
      const hoverRaw = await webview.executeJavaScript(rowHoverPointScript(index));
      const hover = JSON.parse(hoverRaw);
      if (!hover.ok) return { ok: false, reason: hover.reason };
      sendTrustedHover(Math.round(hover.x), Math.round(hover.y));
      await wait(250); // дать React время смонтировать кнопки после наведения
      const btnRaw = await webview.executeJavaScript(rowActionButtonScript(index, action));
      const btnInfo = JSON.parse(btnRaw);
      if (!btnInfo.ok) return { ok: false, reason: btnInfo.reason };
      sendTrustedClick(Math.round(btnInfo.x), Math.round(btnInfo.y));
      await wait(300);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err.message };
    } finally {
      endAutomation(manual);
      hideCurtain();
    }
  }

  // Догрузка следующей пачки треков: VK лениво подгружает список при скролле
  // до низа СВОЕЙ страницы, но — как и play/pause — только пока webview видим
  // (скрытому не приходят кадры композитора и IntersectionObserver молчит).
  // Поэтому кратко показываем VK, скроллим его страницу в самый низ, ждём
  // роста списка и собираем полный набор строк заново (индексы стабильны —
  // VK только дописывает в конец).
  function loadMoreScript() {
    return `
      (async function() {
        const q = () => document.querySelectorAll('[data-testid="AudioCatalog_SectionTracks"] [data-testid="MusicTrackRow"]');
        const before = q().length;
        const el = document.scrollingElement;
        // "Подёргивание" вместо простого прыжка в низ: если страница уже стоит
        // на дне, повторный scrollTop=scrollHeight — no-op (события скролла нет,
        // загрузчик VK не просыпается). Уходим вверх, даём кадру отрисоваться,
        // затем вниз — переход "не низ → низ" гарантированно случается.
        el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight * 3);
        await new Promise(r => setTimeout(r, 300));
        el.scrollTop = el.scrollHeight;
        const start = Date.now();
        while (Date.now() - start < 4000) {
          await new Promise(r => setTimeout(r, 200));
          if (q().length > before) break;
        }
        await new Promise(r => setTimeout(r, 300)); // дать пачке дорендериться
        const tracks = Array.from(q()).map((row, index) => {
          const titleEl = row.querySelector('[data-testid="MusicTrackRow_Title"]');
          const authorsEl = row.querySelector('[data-testid="MusicTrackRow_Authors"]');
          const durationEl = row.querySelector('[data-testid="MusicTrackRow_Duration"]');
          const img = row.querySelector('[data-testid="MusicTrackRow_PlaybackControls"] img');
          return {
            index,
            title: titleEl ? titleEl.textContent.trim() : '',
            artist: authorsEl ? authorsEl.textContent.trim() : '',
            duration: durationEl ? durationEl.textContent.trim() : '',
            cover: img ? img.src : ''
          };
        });
        return JSON.stringify({ ok: true, tracks });
      })();
    `;
  }

  const mymusicStatusEl = document.getElementById('mymusic-status');
  const mymusicListEl = document.getElementById('mymusic-track-list');
  const mymusicSearchEl = document.getElementById('mymusic-search');
  const mymusicCountEl = document.getElementById('mymusic-count');

  // Счётчик в заголовке — честный: показывает, сколько уже ЗАГРУЖЕНО (VK отдаёт
  // список порциями при скролле; полного числа мы не знаем, пока не долистали)
  function trackWord(n) {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'трек';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'трека';
    return 'треков';
  }
  function updateCount() {
    const n = myMusicTracks.length;
    const text = n ? `${n} ${trackWord(n)}${noMoreTracks ? '' : ' +'}` : '';
    mymusicCountEl.textContent = text;
    // Подпись на баннере "Моя музыка" Главной — то же число
    const bannerSub = document.getElementById('home-library-sub');
    if (bannerSub && text) bannerSub.textContent = text;
  }
  // Заполняем мозаику обложек на хиро-баннере реальными треками библиотеки
  // вместо декоративной текстуры-плейсхолдера; лёгкие цветные оттенки поверх
  // части плиток — как в макете (там варианты акцентного/синего/белого тона)
  const HERO_TILE_TINTS = [
    null,
    'linear-gradient(135deg, rgba(var(--accent-rgb),0.4), transparent 70%)',
    'linear-gradient(135deg, rgba(120,150,255,0.32), transparent 70%)',
    'linear-gradient(135deg, rgba(255,255,255,0.14), transparent 70%)',
    'linear-gradient(135deg, rgba(255,100,110,0.3), transparent 70%)',
    'linear-gradient(135deg, rgba(110,255,170,0.24), transparent 70%)',
  ];
  function fillHeroTiles(tracks) {
    const tiles = document.querySelectorAll('#mymusic-hero .hero-tiles div');
    const covers = tracks.map(t => t.cover).filter(Boolean);
    if (!covers.length) return;
    tiles.forEach((tile, i) => {
      const tint = HERO_TILE_TINTS[i % HERO_TILE_TINTS.length];
      tile.style.backgroundImage = (tint ? tint + ', ' : '') + `url("${covers[i % covers.length]}")`;
      tile.style.backgroundSize = 'cover';
      tile.style.backgroundPosition = 'center';
    });
  }

  let myMusicTracks = [];
  let myMusicLoaded = false;
  let loadingMore = false;
  let noMoreTracks = false;

  const MYMUSIC_DISLIKE_D = 'M3 16q-.8 0-1.4-.6T1 14v-2q0-.175.05-.375t.1-.375l3-7.05q.225-.5.75-.85T6 3h11v13l-6 5.95q-.375.375-.888.438t-.987-.188t-.7-.7t-.1-.925L9.45 16zm12-.85V5H6l-3 7v2h9l-1.35 5.5zM20 3q.825 0 1.413.588T22 5v9q0 .825-.587 1.413T20 16h-3v-2h3V5h-3V3zm-5 2v10.15z';
  const MYMUSIC_REMOVE_D = 'm12 13.4l-4.9 4.9q-.275.275-.7.275t-.7-.275t-.275-.7t.275-.7l4.9-4.9l-4.9-4.9q-.275-.275-.275-.7t.275-.7t.7-.275t.7.275l4.9 4.9l4.9-4.9q.275-.275.7-.275t.7.275t.275.7t-.275.7L13.4 12l4.9 4.9q.275.275.275.7t-.275.7t-.7.275t-.7-.275z';

  // Кнопки при наведении у VK на строке трека (data-testid="audiorow-actions"):
  // "Открыть сниппет" (пропускаем по просьбе), "Не нравится", "Удалить из моей
  // музыки", "Открыть меню". Меню пока не делаем — оно открывает выпадающий
  // список внутри скрытого VK, которым нельзя реально пользоваться, пока VK не
  // показан целиком (в отличие от play, это не разовое действие, а список,
  // который надо разглядывать и кликать по конкретному пункту).
  function formatMyMusicRow(track) {
    const row = document.createElement('div');
    row.className = 'mymusic-row';
    row.dataset.index = track.index;
    row.innerHTML = `
      <img class="mymusic-row-cover" src="${track.cover}" alt="">
      <div class="mymusic-row-info">
        <div class="mymusic-row-title"></div>
        <div class="mymusic-row-artist"></div>
      </div>
      <div class="mymusic-row-actions">
        <button class="mymusic-row-action" data-row-action="dislike" title="Не нравится"><svg viewBox="0 0 24 24"><path d="${MYMUSIC_DISLIKE_D}"/></svg></button>
        <button class="mymusic-row-action" data-row-action="owning" title="Убрать из моей музыки"><svg viewBox="0 0 24 24"><path d="${MYMUSIC_REMOVE_D}"/></svg></button>
      </div>
      <div class="mymusic-row-duration"></div>
    `;
    row.querySelector('.mymusic-row-title').textContent = track.title || 'Без названия';
    row.querySelector('.mymusic-row-artist').textContent = track.artist;
    row.querySelector('.mymusic-row-duration').textContent = track.duration;
    row.querySelectorAll('[data-row-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (btn.classList.contains('loading')) return;
        btn.classList.add('loading');
        const result = await runRowAction(track.index, btn.dataset.rowAction);
        btn.classList.remove('loading');
        if (!result.ok) { mymusicStatusEl.textContent = 'Не удалось: ' + result.reason; return; }
        // VK после дизлайка/удаления сереет строку, но оставляет её на месте
        // (обе кнопки — тогглы, повторный клик отменяет). Зеркалим: приглушаем
        // строку у себя, не убирая из списка — индексы строк VK не сдвигаются.
        row.classList.toggle('mymusic-row-dimmed');
      });
    });
    row.addEventListener('click', async () => {
      if (row.classList.contains('loading')) return;
      row.classList.add('loading');
      await ensureBasePage();
      const result = await playViaTrustedClick(selectTrackByIndexScript(track.index));
      row.classList.remove('loading');
      if (!result.ok) mymusicStatusEl.textContent = 'Не удалось запустить: ' + result.reason;
    });
    return row;
  }

  async function loadMyMusic() {
    if (myMusicLoaded) return;
    mymusicStatusEl.textContent = 'Загружаю список…';
    try {
      // VK мог остаться на подстранице (плейлисты, поиск) — там нет секции
      // треков, и скрейп падал с no-tracks-found
      if (!(await ensureBasePage())) { mymusicStatusEl.textContent = 'Не удалось загрузить: vk-page-not-ready'; return; }
      const raw = await webview.executeJavaScript(scrapeMyMusicScript());
      const res = JSON.parse(raw);
      if (!res.ok) { mymusicStatusEl.textContent = 'Не удалось загрузить: ' + res.reason; return; }
      myMusicTracks = res.tracks;
      myMusicLoaded = true;
      mymusicListEl.innerHTML = '';
      myMusicTracks.forEach(track => mymusicListEl.appendChild(formatMyMusicRow(track)));
      mymusicStatusEl.textContent = '';
      updateCount();
      fillHeroTiles(myMusicTracks);
    } catch (err) {
      mymusicStatusEl.textContent = 'Ошибка: ' + err.message;
    }
  }

  // Подсветка играющего трека: сверяем название+исполнителя из состояния
  // плеера с нашими строками. Сравнение по тексту, не по индексу — трек мог
  // быть запущен и не из нашего списка (VK Микс, шафл с Главной).
  window.addEventListener('vk-player-state', (e) => {
    const state = e.detail;
    const key = (state.title || '') + '|' + (state.artist || '');
    mymusicListEl.querySelectorAll('.mymusic-row').forEach(row => {
      const track = myMusicTracks[Number(row.dataset.index)];
      row.classList.toggle('playing', !!state.title && (track.title + '|' + track.artist) === key);
    });
  });

  function rowMatchesQuery(track) {
    const q = mymusicSearchEl.value.trim().toLowerCase();
    return !q || track.title.toLowerCase().includes(q) || track.artist.toLowerCase().includes(q);
  }

  mymusicSearchEl.addEventListener('input', () => {
    mymusicListEl.querySelectorAll('.mymusic-row').forEach(row => {
      const track = myMusicTracks[Number(row.dataset.index)];
      row.classList.toggle('mymusic-row-hidden', !rowMatchesQuery(track));
    });
  });

  async function loadMoreTracks() {
    if (loadingMore || noMoreTracks || !myMusicLoaded) return;
    loadingMore = true;
    // Индикатор в конце списка (виден до/после шторки и на случай долгой догрузки)
    const moreEl = document.createElement('div');
    moreEl.className = 'list-loadmore';
    moreEl.innerHTML = '<div class="spinner"></div> Загружаю ещё…';
    mymusicListEl.appendChild(moreEl);
    showCurtain('Загружаю ещё треки…');
    const manual = beginAutomation();
    await wait(100);
    try {
      const raw = await webview.executeJavaScript(loadMoreScript());
      const res = JSON.parse(raw);
      if (res.ok && res.tracks.length > myMusicTracks.length) {
        const newTracks = res.tracks.slice(myMusicTracks.length);
        myMusicTracks = res.tracks;
        newTracks.forEach(track => {
          const row = formatMyMusicRow(track);
          row.classList.toggle('mymusic-row-hidden', !rowMatchesQuery(track));
          mymusicListEl.insertBefore(row, moreEl);
        });
      } else {
        noMoreTracks = true; // конец библиотеки — больше не дёргаем VK
      }
    } catch (err) {
      mymusicStatusEl.textContent = 'Ошибка догрузки: ' + err.message;
    } finally {
      moreEl.remove();
      endAutomation(manual);
      hideCurtain();
      loadingMore = false;
      updateCount();
    }
  }

  const mymusicShuffleBtn = document.getElementById('mymusic-shuffle');
  mymusicShuffleBtn.addEventListener('click', async () => {
    if (mymusicShuffleBtn.classList.contains('loading')) return;
    if (!myMusicTracks.length) return;
    mymusicShuffleBtn.classList.add('loading');
    const index = Math.floor(Math.random() * myMusicTracks.length);
    await ensureBasePage();
    const result = await playViaTrustedClick(selectTrackByIndexScript(index));
    mymusicShuffleBtn.classList.remove('loading');
    mymusicStatusEl.textContent = result.ok ? '' : 'Не удалось: ' + result.reason;
  });

  const mymusicScrollTopBtn = document.getElementById('mymusic-scroll-top');
  mymusicScrollTopBtn.classList.add('hidden');
  mymusicListEl.addEventListener('scroll', () => {
    mymusicScrollTopBtn.classList.toggle('hidden', mymusicListEl.scrollTop < 200);
    // Почти доскроллили до конца — догружаем следующую пачку из VK
    if (mymusicListEl.scrollTop + mymusicListEl.clientHeight >= mymusicListEl.scrollHeight - 300) {
      loadMoreTracks();
    }
  });
  mymusicScrollTopBtn.addEventListener('click', () => {
    mymusicListEl.scrollTo({ top: 0, behavior: 'smooth' });
  });

  return { loadMyMusic };
})();
