// Background service worker for the Chrome extension
chrome.action.onClicked.addListener((tab) => {
  // Al hacer click en el icono abrimos `game.html` en una nueva pestaña en lugar del popup.
  console.log('Icon clicked — opening game.html in new tab');
  chrome.tabs.create({ url: chrome.runtime.getURL('game.html') });
});
