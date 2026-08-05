// ---------- Модалка "Настроить VK Микс" ----------
// ВАЖНО: у VK нет известного нам селектора для реального применения этих
// настроек (настроение/узнаваемость/язык) к самому Миксу — сейчас модалка
// только хранит выбор локально (localStorage), реального эффекта на VK
// Микс это пока не даёт. См. обсуждение в чате: нужен HTML-снимок
// настоящей формы настроек VK Микс, чтобы довести до конца.
window.MixSettings = (function () {
  const STORAGE_KEY = 'vkmusic-mix-settings';
  const modalEl = document.getElementById('mix-settings-modal');
  const statusEl = document.getElementById('mix-settings-status');
  const groups = ['mood', 'familiarity', 'language'];

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  let state = loadState();

  function render() {
    groups.forEach((group) => {
      const container = document.querySelector(`.mix-settings-chips[data-chip-group="${group}"]`);
      container.querySelectorAll('.mix-chip').forEach((chip) => {
        chip.classList.toggle('active', chip.dataset.chipValue === state[group]);
      });
    });
    statusEl.textContent = '';
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
    state = {};
    render();
  });

  document.getElementById('mix-settings-apply').addEventListener('click', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    close();
  });

  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) close();
  });

  function open() {
    state = loadState();
    render();
    modalEl.classList.remove('hidden');
  }
  function close() {
    modalEl.classList.add('hidden');
  }

  return { open, close };
})();
