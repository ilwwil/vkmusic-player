const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, session } = require('electron');
const path = require('path');

let mainWindow = null;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 860,
    minHeight: 560,
    frame: false, // своя рамка окна
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // разрешаем тег <webview> для встраивания vk.com/music
      sandbox: false
    }
  });

  mainWindow.loadFile('index.html');
  // Иначе таймеры (наш тикер прогресса, поллинг VK) замедляются, когда окно
  // свёрнуто/не в фокусе — как у фоновой вкладки браузера — и данные о треке
  // обновляются рывками.
  mainWindow.webContents.setBackgroundThrottling(false);

  mainWindow.on('close', (e) => {
    // сворачиваем в трей вместо закрытия, чтобы плеер не прерывался
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'tray.png'));
  const menu = Menu.buildFromTemplate([
    { label: 'Открыть', click: () => mainWindow.show() },
    { label: 'Пауза/Play', click: () => mainWindow.webContents.send('media-key', 'playpause') },
    { label: 'Следующий трек', click: () => mainWindow.webContents.send('media-key', 'next') },
    { label: 'Предыдущий трек', click: () => mainWindow.webContents.send('media-key', 'prev') },
    { type: 'separator' },
    { label: 'Выход', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('VK Music Player (unofficial)');
  tray.setContextMenu(menu);
  tray.on('click', () => mainWindow.show());
}

// Гостевая страница <webview> с VK тоже троттлится, когда визуально скрыта
// (наша оболочка поверх неё) — из-за этого "сходят с ума" прогресс и название
// трека, когда VK не показан. Отключаем троттлинг и для неё.
app.on('web-contents-created', (event, contents) => {
  if (contents.getType() === 'webview') {
    contents.setBackgroundThrottling(false);
  }
});

// Скрытой странице VK не нужны её трекеры/аналитика/реклама — блокируем на
// уровне сессии webview: меньше сети, памяти и фонового CPU. Список
// консервативный (только счётчики и рекламные сети), чтобы ничего не сломать.
function setupRequestBlocking() {
  const vkSession = session.fromPartition('persist:vkmusic');
  const blockedUrls = [
    '*://mc.yandex.ru/*', '*://*.mc.yandex.ru/*', '*://an.yandex.ru/*',
    '*://top-fwz1.mail.ru/*', '*://ad.mail.ru/*', '*://ads.mail.ru/*', '*://rs.mail.ru/*',
    '*://*.adfox.ru/*',
    '*://*.doubleclick.net/*', '*://*.google-analytics.com/*', '*://*.googletagmanager.com/*'
  ];
  vkSession.webRequest.onBeforeRequest({ urls: blockedUrls }, (details, callback) => {
    callback({ cancel: true });
  });
}

app.whenReady().then(() => {
  setupRequestBlocking();
  createWindow();
  createTray();

  // Глобальные медиа-клавиши клавиатуры
  globalShortcut.register('MediaPlayPause', () => mainWindow.webContents.send('media-key', 'playpause'));
  globalShortcut.register('MediaNextTrack', () => mainWindow.webContents.send('media-key', 'next'));
  globalShortcut.register('MediaPreviousTrack', () => mainWindow.webContents.send('media-key', 'prev'));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Версия — читается из package.json, показывается в титулбаре (чтобы было
// видно, какая сборка установлена, при сравнении с релизами на GitHub).
ipcMain.handle('get-app-version', () => app.getVersion());

// IPC для кастомной рамки окна (свернуть/развернуть/закрыть)
ipcMain.on('open-app-devtools', () => {
  if (mainWindow) mainWindow.webContents.openDevTools({ mode: 'detach' });
});

// Текущий трек в тултипе иконки трея
ipcMain.on('track-info', (event, text) => {
  if (tray) tray.setToolTip(text ? `${text} — VK Music Player` : 'VK Music Player');
});

ipcMain.on('window-control', (event, action) => {
  if (!mainWindow) return;
  if (action === 'minimize') mainWindow.minimize();
  if (action === 'maximize') {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
  if (action === 'close') mainWindow.hide();
  if (action === 'quit') { app.isQuitting = true; app.quit(); }
});
