// ВАЖНО: VK регулярно меняет разметку своей страницы.
// Если после запуска приложение не видит "сейчас играет" — открой встроенный
// DevTools для страницы VK (кнопка с иконкой "</>" в верхней панели приложения),
// найди нужный элемент через инспектор и поправь селектор ниже.
//
// Как это делать: правой кнопкой по названию трека на сайте VK -> "Просмотреть код" ->
// скопировать что-то стабильное (aria-label, data-атрибут) и вставить сюда.

window.VK_SELECTORS = {
  // текст с названием трека
  trackTitle: [
    '[data-testid="AudioPlayerBlock_AudioTitle"]',
    '[data-testid="audio_player_title"]',
    '.AudioPlayerBar__title',
    '.audio_page_player_title'
  ],
  // текст с исполнителем
  trackArtist: [
    '[data-testid="AudioPlayerBlock_Authors"]',
    '[data-testid="audio_player_artist"]',
    '.AudioPlayerBar__artist',
    '.audio_page_player_artist'
  ],
  // картинка обложки
  cover: [
    '[data-testid="AudioPlayerBlock_AudioCover"] img',
    '[data-testid="audio_player_cover"] img',
    '.AudioPlayerBar__cover img',
    '.audio_page_player_cover img'
  ],
  // кнопка play/pause (для клика и для определения состояния через data-testactive)
  playPauseButton: [
    '[data-testid="audio-player-controls-state-button"]',
    '[aria-label="Пауза"], [aria-label="Play"], [aria-label="Играть"]',
    '.AudioPlayerBar__playBtn',
    '.audio_page_player_play'
  ],
  nextButton: [
    '[data-testid="audio-player-controls-forward-button"]',
    '[aria-label="Следующий трек"], [aria-label="Next"]',
    '.AudioPlayerBar__nextBtn'
  ],
  prevButton: [
    '[data-testid="audio-player-controls-backward-button"]',
    '[aria-label="Предыдущий трек"], [aria-label="Previous"]',
    '.AudioPlayerBar__prevBtn'
  ],
  // текст "прошло/всего" времени трека
  progressTime: [
    '[data-testid="AudioPlayerBlock_ProgressTimer"] span'
  ],
  // слайдер воспроизведения (aria-valuenow — процент от 0 до 100)
  progressSlider: [
    '[aria-label="Прогресс воспроизведения"]'
  ],
  // контейнер прогресс-бара целиком — используется для вычисления координат перемотки (seek)
  progressTrack: [
    '[data-testid="AudioPlayerBlock_ProgressBar"]'
  ],
  // сколько трека уже загружено (буферизация), aria-valuenow — процент 0-100
  bufferedSlider: [
    '[aria-label="Прогресс буфферизации"]'
  ],
  shuffleButton: [
    '[data-testid="ToggleShuffled"]'
  ],
  repeatButton: [
    '[data-testid="AudioPlayerBlock_RepeatSwitcher"]'
  ],
  likeButton: [
    '[data-testid="MusicAudio_ToggleOwning"]'
  ],
  dislikeButton: [
    '[data-testid="MusicAudio_ToggleDislike"]'
  ],
  openSimilarButton: [
    '[data-testid="MusicAudio_OpenSimilar"]'
  ],
  openLyricsButton: [
    '[data-testid="MusicAudio_OpenLyrics"]'
  ],
  broadcastButton: [
    '[data-testid="ToggleCurrentTargets"]'
  ],
  shareButton: [
    '[data-testid="MusicAudio_Share"]'
  ],
  // кнопка "выключить/включить звук" рядом с ползунком громкости
  muteButton: [
    '[aria-label="Выключить звук"], [aria-label="Включить звук"]'
  ],
  // сам ползунок громкости (контейнер для клика/драга) и его внутренний role=slider
  volumeTrack: [
    '[data-testid="audioplayervolumeslider-bar"]'
  ],
  volumeSlider: [
    '[data-testid="audioplayervolumeslider-bar-slider"]'
  ],
  // Вкладки каталога аудио (переключаются без перезагрузки страницы, не сбивают плеер)
  catalogTabGeneral: [
    '[data-testid="AudioCatalog_Tabs_Tab_general"]'
  ],
  catalogTabAllMusic: [
    '[data-testid="AudioCatalog_Tabs_Tab_all"]'
  ],
  // Кнопка "Слушать VK Микс" на вкладке "Главная"
  mixToggleButton: [
    '[data-testid="AudioStreamMix_TogglePlayingAction"]'
  ]
};
