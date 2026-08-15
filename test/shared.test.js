const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { installDomStubs } = require('./dom-stub');

installDomStubs();
require(path.join('..', 'selectors.js'));
require(path.join('..', 'shared.js'));
const Shared = global.window.Shared;

test('Shared exposes the functions views/*.js and renderer.js depend on', () => {
  for (const name of [
    'ensureBasePage', 'basePageReadyScript', 'spaCleanupScript',
    'playViaTrustedClick', 'checkPlayNeededScript',
    'modalScrapeScript', 'closeModalScript',
    'pickHelper', 'coverHelper', 'sendTrustedClick', 'sendTrustedHover', 'wait',
    'showCurtain', 'hideCurtain', 'beginAutomation', 'endAutomation'
  ]) {
    assert.equal(typeof Shared[name], 'function', `Shared.${name} should be a function`);
  }
});

test('basePageReadyScript checks for a clean URL and the rendered catalog tab', () => {
  const script = Shared.basePageReadyScript();
  // Это единственный сигнал, по которому ensureBasePage() и вход в аккаунт
  // (waitForVkAttention) понимают, что каталог VK реально открыт — если этот
  // селектор разойдётся с разметкой VK, ожидание входа зависнет навсегда.
  assert.match(script, /AudioCatalog_Tabs_Tab_all/);
  assert.match(script, /location\.href/);
});

test('basePageReadyScript rejects the /audios<id> route VK sometimes redirects to', () => {
  // Регресс на баг: этот роут проходил старую проверку (нет block=/q= в URL,
  // вкладки каталога тоже есть), из-за чего ensureBasePage() считал страницу
  // готовой, хотя AudioCatalog_SectionAllTracks/поиск там не работают.
  const script = Shared.basePageReadyScript();
  assert.match(script, /\/\^\\\/audios\\d\+\//, 'must reject /audios<id> pathnames');
});

test('spaCleanupScript targets the search-clear and breadcrumb controls', () => {
  const script = Shared.spaCleanupScript();
  assert.match(script, /search_audio_clear/);
  assert.match(script, /data-testid="breadcrumb"/);
});

test('spaCleanupScript falls back to the "Все" tab on the /audios<id> route', () => {
  // На /audios<id> нет хлебной крошки (проверено вживую) — без этого фолбэка
  // ensureBasePage тупо гонял 6с SPA-очистку и уходил на полную перезагрузку.
  const script = Shared.spaCleanupScript();
  assert.match(script, /\/\^\\\/audios\\d\+\//);
  assert.match(script, /AudioCatalog_Tabs_Tab_all/);
});

test('modalScrapeScript / closeModalScript reference the playlist modal', () => {
  assert.match(Shared.closeModalScript(), /MusicPlaylistModal_Close/);
  assert.match(Shared.modalScrapeScript(), /MusicPlaylistModal/);
});

test('beginAutomation/endAutomation toggle vk-automating unless the user already has VK open manually', () => {
  const cl = Shared.contentEl.classList;

  // Обычный случай: VK скрыт, автоматизация сама ставит и снимает класс.
  assert.equal(cl.contains('vk-visible'), false);
  const manual1 = Shared.beginAutomation();
  assert.equal(manual1, false);
  assert.equal(cl.contains('vk-automating'), true);
  Shared.endAutomation(manual1);
  assert.equal(cl.contains('vk-automating'), false);

  // Пересекающиеся вызовы (например, громкость крутят, пока ещё не
  // закончилось добавление в плейлист) — снятие класса первой завершившейся
  // операцией не должно рвать видимость для второй, всё ещё активной.
  const outerManual = Shared.beginAutomation();
  const innerManual = Shared.beginAutomation();
  assert.equal(cl.contains('vk-automating'), true);
  Shared.endAutomation(innerManual); // внутренняя операция закончилась первой
  assert.equal(cl.contains('vk-automating'), true, 'class must stay while the outer automation is still active');
  Shared.endAutomation(outerManual);
  assert.equal(cl.contains('vk-automating'), false);

  // Debug-режим "Показать VK": beginAutomation не должен трогать класс, а
  // endAutomation(true) не должен его снимать (не он его ставил).
  cl.add('vk-visible');
  const manual2 = Shared.beginAutomation();
  assert.equal(manual2, true);
  assert.equal(cl.contains('vk-automating'), false);
  Shared.endAutomation(manual2);
  assert.equal(cl.contains('vk-automating'), false);
});
