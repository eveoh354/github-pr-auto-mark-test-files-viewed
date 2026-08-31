// ==UserScript==
// @name         GitHub PR - Auto Mark .test.ts Files as Viewed
// @namespace    https://github.com/eveoh354/github-pr-auto-mark-test-files-viewed
// @version      1.0.4
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

  const FILE_SELECTOR =
    '[data-testid="virtualized-diffs-list"] [role="region"][id^="diff-"], ' +
    '[role="region"][id^="diff-"][class*="Diff-module__diffTargetable"], .js-file';
  const VIEWED_TOGGLE_SELECTOR =
    'button[aria-label="Viewed"], button[aria-label="Not Viewed"], ' +
    'button[class*="MarkAsViewedButton"], input.js-reviewed-checkbox[name="viewed"]';
  const FILTER_SELECTOR =
    'input[placeholder="Filter files..."], input[aria-label*="Filter files" i]';
  const TEST_FILE_FILTER = '.test.ts';
  const DEBUG_PREFIX = '[GitHub PR test-files Viewed]';
  const debugEvents = [];
  const pendingFiles = new WeakSet();
  let scheduled = false;
  let activePage;
  let filterAttempted = false;
  let runCount = 0;
  let lastReport;
  let lastReportFingerprint;

  const recordDebugEvent = (message, details) => {
    const event = {
      time: new Date().toISOString(),
      message,
      ...(details === undefined ? {} : { details }),
    };
    debugEvents.push(event);
    if (debugEvents.length > 100) debugEvents.shift();
    console.info(DEBUG_PREFIX, message, details ?? '');
  };

  const debugApi = {
    snapshot: () => ({
      scriptVersion: '1.0.4',
      url: location.href,
      userAgent: navigator.userAgent,
      lastReport,
      events: [...debugEvents],
    }),
    print: () => {
      console.info(DEBUG_PREFIX, 'Copy the object below and send it for diagnosis.');
      console.info(debugApi.snapshot());
      return debugApi.snapshot();
    },
  };

  Object.defineProperty(window, '__ghPrTestViewedDebug', {
    configurable: true,
    value: debugApi,
  });

  const isPullRequestFilesPage = () =>
    /^\/[^/]+\/[^/]+\/pull\/\d+\/(?:files|changes)(?:\/|$)/.test(location.pathname);

  const normalizeFilePath = (path) =>
    path?.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '').trim();

  const getFilePath = (file) => {
    const pathFromData =
      file.getAttribute('data-file-path') ??
      file.querySelector('[data-file-path]')?.getAttribute('data-file-path') ??
      file.querySelector('[data-path]')?.getAttribute('data-path');
    if (pathFromData) return normalizeFilePath(pathFromData);

    // GitHub's React view wraps the full path in h3 > a > code and surrounds
    // it with invisible bidirectional formatting characters.
    const pathFromHeader = file.querySelector(
      '[data-diff-header-wrapper] h3 code, h3 a[href^="#diff-"] code, ' +
        'a[href^="#diff-"] code, a[href^="#diff-"]',
    )?.textContent;
    return normalizeFilePath(pathFromHeader);
  };

  const isViewed = (toggle) => {
    if (toggle instanceof HTMLInputElement) return toggle.checked;

    const pressed = toggle.getAttribute('aria-pressed');
    if (pressed !== null) return pressed === 'true';

    return Boolean(toggle.querySelector('.octicon-checkbox-fill'));
  };

  const isVisible = (element) =>
    element instanceof HTMLElement && !element.hidden && element.getClientRects().length > 0;

  const setFilterValue = (input, value) => {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const temporarilyShowAllTestFiles = () => {
    if (filterAttempted) return 'already-attempted';

    const filter = document.querySelector(FILTER_SELECTOR);
    if (!(filter instanceof HTMLInputElement)) return 'filter-not-found';

    filterAttempted = true;
    if (filter.value) return `preserved-existing-filter:${filter.value}`;

    setFilterValue(filter, TEST_FILE_FILTER);
    recordDebugEvent('Temporarily applied the file filter.', { value: TEST_FILE_FILTER });

    // Large PRs virtualize files that are outside the viewport. Filtering makes
    // every matching test file available to the observer without scrolling.
    setTimeout(() => {
      if (filter.value === TEST_FILE_FILTER) {
        setFilterValue(filter, '');
        recordDebugEvent('Restored the empty file filter.');
      }
    }, 3500);

    return 'applied';
  };

  const markTestFilesViewed = () => {
    scheduled = false;
    runCount += 1;
    if (!isPullRequestFilesPage()) {
      const report = {
        runCount,
        routeMatched: false,
        pathname: location.pathname,
      };
      const fingerprint = JSON.stringify(report);
      if (fingerprint !== lastReportFingerprint) {
        lastReport = report;
        lastReportFingerprint = fingerprint;
        recordDebugEvent('The current URL is not recognized as a PR files page.', report);
      }
      return;
    }

    const files = [...document.querySelectorAll(FILE_SELECTOR)];
    const inspectedFiles = [];
    let testFileCount = 0;
    let clickedCount = 0;

    for (const file of files) {
      const filePath = getFilePath(file);
      const isTestFile = Boolean(filePath?.endsWith('.test.ts'));
      const toggle = file.querySelector(VIEWED_TOGGLE_SELECTOR);
      const state = {
        filePath: filePath ?? null,
        containerTag: file.tagName,
        containerId: file.id || null,
        isTestFile,
        hidden: file.hasAttribute('hidden'),
        toggleFound: Boolean(toggle),
        toggleVisible: Boolean(toggle && isVisible(toggle)),
        viewed: toggle ? isViewed(toggle) : null,
        disabled: Boolean(toggle?.disabled),
        pending: pendingFiles.has(file),
        action: 'none',
      };

      if (isTestFile) testFileCount += 1;

      if (pendingFiles.has(file)) state.action = 'skipped-pending';
      else if (file.hasAttribute('hidden')) state.action = 'skipped-hidden';
      else if (!isTestFile) state.action = 'skipped-not-test-file';
      else if (!toggle) state.action = 'skipped-toggle-not-found';
      else if (!isVisible(toggle)) state.action = 'skipped-toggle-not-visible';
      else if (isViewed(toggle)) state.action = 'skipped-already-viewed';
      else if (toggle.disabled) state.action = 'skipped-toggle-disabled';
      else {
        state.action = 'clicked';
        clickedCount += 1;
        pendingFiles.add(file);
        toggle.click();

        // GitHub updates the button asynchronously. Recheck after it settles so a
        // temporary request failure can recover without rapidly double-clicking.
        setTimeout(() => {
          pendingFiles.delete(file);
          scheduleMarking();
        }, 1500);
      }

      if (isTestFile || !filePath) inspectedFiles.push(state);
    }

    const filterResult = temporarilyShowAllTestFiles();
    const report = {
      runCount,
      routeMatched: true,
      pathname: location.pathname,
      fileContainerCount: files.length,
      testFileCount,
      clickedCount,
      filterResult,
      inspectedFiles: inspectedFiles.slice(0, 100),
    };
    const fingerprint = JSON.stringify({
      ...report,
      runCount: undefined,
      inspectedFiles: report.inspectedFiles.map(({ pending, ...file }) => file),
    });

    lastReport = report;
    if (fingerprint !== lastReportFingerprint || clickedCount > 0) {
      lastReportFingerprint = fingerprint;
      recordDebugEvent('Scan report', report);
    }
  };

  const scheduleMarking = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(markTestFilesViewed);
  };

  const observer = new MutationObserver(scheduleMarking);

  const start = () => {
    const page = `${location.pathname}${location.search}`;
    if (page !== activePage) {
      activePage = page;
      filterAttempted = false;
    }

    observer.disconnect();
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    recordDebugEvent('Script started.', {
      version: '1.0.4',
      page,
      routeMatched: isPullRequestFilesPage(),
    });
    scheduleMarking();
  };

  // GitHub loads PR pages and large file lists without a full page refresh.
  document.addEventListener('turbo:load', start);
  document.addEventListener('pjax:end', start);
  window.addEventListener('popstate', start);
  start();
})();
