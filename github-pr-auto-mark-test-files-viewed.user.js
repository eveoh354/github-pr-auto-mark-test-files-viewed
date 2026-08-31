// ==UserScript==
// @name         GitHub PR - Auto Mark .test.ts Files as Viewed
// @namespace    https://github.com/eveoh354/github-pr-auto-mark-test-files-viewed
// @version      1.0.1
// @description  Automatically marks unviewed .test.ts files as Viewed on GitHub pull requests.
// @author       eveoh354
// @homepageURL  https://github.com/eveoh354/github-pr-auto-mark-test-files-viewed
// @supportURL   https://github.com/eveoh354/github-pr-auto-mark-test-files-viewed/issues
// @downloadURL  https://raw.githubusercontent.com/eveoh354/github-pr-auto-mark-test-files-viewed/main/github-pr-auto-mark-test-files-viewed.user.js
// @updateURL    https://raw.githubusercontent.com/eveoh354/github-pr-auto-mark-test-files-viewed/main/github-pr-auto-mark-test-files-viewed.user.js
// @match        https://github.com/*/*/pull/*/files*
// @match        https://github.com/*/*/pull/*/changes*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  const FILE_SELECTOR = '[id^="diff-"], .js-file';
  const VIEWED_TOGGLE_SELECTOR =
    'button[class*="MarkAsViewedButton"], input.js-reviewed-checkbox[name="viewed"]';
  const pendingFiles = new WeakSet();
  let scheduled = false;

  const isPullRequestFilesPage = () =>
    /^\/[^/]+\/[^/]+\/pull\/\d+\/(?:files|changes)(?:\/|$)/.test(location.pathname);

  const getFilePath = (file) => {
    const pathFromData =
      file.getAttribute('data-file-path') ??
      file.querySelector('[data-file-path]')?.getAttribute('data-file-path') ??
      file.querySelector('[data-path]')?.getAttribute('data-path');
    if (pathFromData) return pathFromData.trim();

    // GitHub's current React Files changed view puts the full path in this link.
    return file.querySelector('a[href^="#diff-"]')?.textContent?.trim();
  };

  const isViewed = (toggle) => {
    if (toggle instanceof HTMLInputElement) return toggle.checked;

    const pressed = toggle.getAttribute('aria-pressed');
    if (pressed !== null) return pressed === 'true';

    return Boolean(toggle.querySelector('.octicon-checkbox-fill'));
  };

  const isVisible = (element) =>
    element instanceof HTMLElement && !element.hidden && element.getClientRects().length > 0;

  const markTestFilesViewed = () => {
    scheduled = false;
    if (!isPullRequestFilesPage()) return;

    for (const file of document.querySelectorAll(FILE_SELECTOR)) {
      if (pendingFiles.has(file) || file.hasAttribute('hidden')) continue;

      const filePath = getFilePath(file);
      if (!filePath?.endsWith('.test.ts')) continue;

      const toggle = file.querySelector(VIEWED_TOGGLE_SELECTOR);
      if (!toggle || !isVisible(toggle) || isViewed(toggle) || toggle.disabled) continue;

      pendingFiles.add(file);
      toggle.click();

      // GitHub updates the button asynchronously. Recheck after it settles so a
      // temporary request failure can recover without rapidly double-clicking.
      setTimeout(() => {
        pendingFiles.delete(file);
        scheduleMarking();
      }, 1500);
    }
  };

  const scheduleMarking = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(markTestFilesViewed);
  };

  const observer = new MutationObserver(scheduleMarking);

  const start = () => {
    observer.disconnect();
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    scheduleMarking();
  };

  // GitHub loads PR pages and large file lists without a full page refresh.
  document.addEventListener('turbo:load', start);
  document.addEventListener('pjax:end', start);
  window.addEventListener('popstate', start);
  start();
})();
