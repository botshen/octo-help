import { browser, defineBackground } from '#imports';

export default defineBackground(() => {
  // Clicking the extension action opens the global Chrome side panel.
  if (browser.sidePanel?.setPanelBehavior) {
    void browser.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => console.warn('Unable to enable side panel action click', error));
  }
});
