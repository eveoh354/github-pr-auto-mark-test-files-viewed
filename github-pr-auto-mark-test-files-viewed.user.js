// ==UserScript==
// @name         GitHub PR - Auto Mark .test.ts Files as Viewed
// @namespace    https://github.com/eveoh354/github-pr-auto-mark-test-files-viewed
// @version      1.1.1
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
  const VIRTUALIZED_LIST_SELECTOR = '[data-testid="virtualized-diffs-list"]';
  const TEST_FILE_TREE_ITEM_SELECTOR =
    '[role="treeitem"][id$=".test.ts"][aria-label$=".test.ts"]';
  const TEST_FILE_FILTER = '.test.ts';
  const DEBUG_PREFIX = '[GitHub PR test-files Viewed]';
  const debugEvents = [];
  const pendingFiles = new WeakSet();
  const pendingPaths = new Map();
  const viewedTestPaths = new Set();
  const clickedTestPaths = new Set();
  let scheduled = false;
  let activePage;
  let filterAttempted = false;
  let traversal;
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
      scriptVersion: '1.1.1',
      url: location.href,
      userAgent: navigator.userAgent,
      interfaceLanguage: getCompletionLocale(),
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

  const getExpectedTestFilePaths = () =>
    new Set(
      [...document.querySelectorAll(TEST_FILE_TREE_ITEM_SELECTOR)]
        .map((item) => normalizeFilePath(item.id))
        .filter(Boolean),
    );

  const completionMessages = {
    en: {
      completed: ({ expected, newlyViewed, confirmed }) =>
        `Completed: found ${expected} .test.ts files; newly marked Viewed ${newlyViewed}; confirmed Viewed ${confirmed}.`,
      stopped: ({ passes, expected, newlyViewed, confirmed }) =>
        `Stopped after ${passes} verification passes: found ${expected} .test.ts files; newly marked Viewed ${newlyViewed}; confirmed Viewed ${confirmed}.`,
    },
    'zh-cn': {
      completed: ({ expected, newlyViewed, confirmed }) =>
        `处理完成：共找到 ${expected} 个 .test.ts，本次新增 Viewed ${newlyViewed} 个，已确认 Viewed ${confirmed} 个。`,
      stopped: ({ passes, expected, newlyViewed, confirmed }) =>
        `处理停止：已完成 ${passes} 次校验；共找到 ${expected} 个 .test.ts，本次新增 Viewed ${newlyViewed} 个，已确认 Viewed ${confirmed} 个。`,
    },
    'zh-tw': {
      completed: ({ expected, newlyViewed, confirmed }) =>
        `處理完成：共找到 ${expected} 個 .test.ts，本次新增 Viewed ${newlyViewed} 個，已確認 Viewed ${confirmed} 個。`,
      stopped: ({ passes, expected, newlyViewed, confirmed }) =>
        `處理停止：已完成 ${passes} 次檢查；共找到 ${expected} 個 .test.ts，本次新增 Viewed ${newlyViewed} 個，已確認 Viewed ${confirmed} 個。`,
    },
    ja: {
      completed: ({ expected, newlyViewed, confirmed }) =>
        `処理完了：.test.ts ファイルを ${expected} 件検出し、${newlyViewed} 件を新たに Viewed に設定、${confirmed} 件を確認しました。`,
      stopped: ({ passes, expected, newlyViewed, confirmed }) =>
        `${passes} 回の確認後に停止：.test.ts ファイルを ${expected} 件検出し、${newlyViewed} 件を新たに Viewed に設定、${confirmed} 件を確認しました。`,
    },
    ko: {
      completed: ({ expected, newlyViewed, confirmed }) =>
        `처리 완료: .test.ts 파일 ${expected}개를 찾았고, ${newlyViewed}개를 새로 Viewed로 표시했으며, ${confirmed}개를 확인했습니다.`,
      stopped: ({ passes, expected, newlyViewed, confirmed }) =>
        `${passes}회 확인 후 중지: .test.ts 파일 ${expected}개를 찾았고, ${newlyViewed}개를 새로 Viewed로 표시했으며, ${confirmed}개를 확인했습니다.`,
    },
    fr: {
      completed: ({ expected, newlyViewed, confirmed }) =>
        `Terminé : ${expected} fichiers .test.ts trouvés, ${newlyViewed} nouvellement marqués Viewed, ${confirmed} confirmés Viewed.`,
      stopped: ({ passes, expected, newlyViewed, confirmed }) =>
        `Arrêt après ${passes} vérifications : ${expected} fichiers .test.ts trouvés, ${newlyViewed} nouvellement marqués Viewed, ${confirmed} confirmés Viewed.`,
    },
    de: {
      completed: ({ expected, newlyViewed, confirmed }) =>
        `Abgeschlossen: ${expected} .test.ts-Dateien gefunden, ${newlyViewed} neu als Viewed markiert, ${confirmed} als Viewed bestätigt.`,
      stopped: ({ passes, expected, newlyViewed, confirmed }) =>
        `Nach ${passes} Prüfungen beendet: ${expected} .test.ts-Dateien gefunden, ${newlyViewed} neu als Viewed markiert, ${confirmed} als Viewed bestätigt.`,
    },
    es: {
      completed: ({ expected, newlyViewed, confirmed }) =>
        `Completado: ${expected} archivos .test.ts encontrados, ${newlyViewed} marcados ahora como Viewed y ${confirmed} confirmados como Viewed.`,
      stopped: ({ passes, expected, newlyViewed, confirmed }) =>
        `Detenido tras ${passes} verificaciones: ${expected} archivos .test.ts encontrados, ${newlyViewed} marcados ahora como Viewed y ${confirmed} confirmados como Viewed.`,
    },
    pt: {
      completed: ({ expected, newlyViewed, confirmed }) =>
        `Concluído: ${expected} arquivos .test.ts encontrados, ${newlyViewed} marcados agora como Viewed e ${confirmed} confirmados como Viewed.`,
      stopped: ({ passes, expected, newlyViewed, confirmed }) =>
        `Interrompido após ${passes} verificações: ${expected} arquivos .test.ts encontrados, ${newlyViewed} marcados agora como Viewed e ${confirmed} confirmados como Viewed.`,
    },
    ru: {
      completed: ({ expected, newlyViewed, confirmed }) =>
        `Готово: найдено файлов .test.ts — ${expected}, впервые отмечено Viewed — ${newlyViewed}, подтверждено Viewed — ${confirmed}.`,
      stopped: ({ passes, expected, newlyViewed, confirmed }) =>
        `Остановлено после ${passes} проверок: найдено файлов .test.ts — ${expected}, впервые отмечено Viewed — ${newlyViewed}, подтверждено Viewed — ${confirmed}.`,
    },
  };

  const getCompletionLocale = () => {
    const locale = (document.documentElement.lang || navigator.language || 'en')
      .replace('_', '-')
      .toLowerCase();
    if (locale.startsWith('zh')) {
      return /(?:hant|tw|hk|mo)/u.test(locale) ? 'zh-tw' : 'zh-cn';
    }

    const language = locale.split('-')[0];
    return completionMessages[language] ? language : 'en';
  };

  const formatCompletionMessage = (completed, values) => {
    const locale = getCompletionLocale();
    return {
      locale,
      text: completionMessages[locale][completed ? 'completed' : 'stopped'](values),
    };
  };

  const findScrollContainer = (element) => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const { overflowY } = getComputedStyle(parent);
      if (/(auto|scroll)/u.test(overflowY) && parent.scrollHeight > parent.clientHeight + 1) {
        return parent;
      }
    }

    return document.scrollingElement ?? document.documentElement;
  };

  const getTraversalBounds = (list, scroller) => {
    const isDocumentScroller =
      scroller === document.scrollingElement ||
      scroller === document.documentElement ||
      scroller === document.body;
    const viewportHeight = isDocumentScroller ? window.innerHeight : scroller.clientHeight;
    const scrollerTop = isDocumentScroller ? 0 : scroller.getBoundingClientRect().top;
    const listTop = scroller.scrollTop + list.getBoundingClientRect().top - scrollerTop;

    return {
      start: Math.max(0, listTop),
      end: Math.max(listTop, listTop + list.scrollHeight - viewportHeight),
      step: Math.max(320, Math.floor(viewportHeight * 0.75)),
    };
  };

  const finishTraversal = (state, reason) => {
    if (traversal !== state || state.cancelled) return;

    state.cancelled = true;
    traversal = undefined;
    const expectedPaths = getExpectedTestFilePaths();
    const confirmedExpected = [...expectedPaths].filter((path) => viewedTestPaths.has(path)).length;
    const completed = reason === 'all-test-files-confirmed-viewed';
    const completion = formatCompletionMessage(completed, {
      passes: state.pass,
      expected: expectedPaths.size,
      newlyViewed: clickedTestPaths.size,
      confirmed: confirmedExpected,
    });
    recordDebugEvent(completion.text, {
      reason,
      locale: completion.locale,
      passes: state.pass,
      expectedTestFiles: expectedPaths.size,
      newlyViewed: clickedTestPaths.size,
      confirmedViewed: confirmedExpected,
    });

    if (state.filter.value === TEST_FILE_FILTER) {
      setFilterValue(state.filter, '');
      recordDebugEvent('Restored the empty file filter.');
    }

    // Clearing the filter changes the virtual list height, so restore the
    // reader's original position only after GitHub has rendered the full list.
    setTimeout(() => {
      state.scroller.scrollTop = state.originalScrollTop;
    }, 500);
  };

  const advanceTraversal = (state) => {
    if (traversal !== state || state.cancelled) return;
    if (state.filter.value !== TEST_FILE_FILTER) {
      state.cancelled = true;
      traversal = undefined;
      recordDebugEvent('Stopped automatic traversal because the file filter changed.');
      return;
    }

    scheduleMarking();

    const expectedPaths = getExpectedTestFilePaths();
    const confirmedExpected = [...expectedPaths].filter((path) => viewedTestPaths.has(path)).length;
    if (
      expectedPaths.size > 0 &&
      confirmedExpected >= expectedPaths.size &&
      pendingPaths.size === 0
    ) {
      finishTraversal(state, 'all-test-files-confirmed-viewed');
      return;
    }

    const bounds = getTraversalBounds(state.list, state.scroller);
    const current = state.scroller.scrollTop;
    if (current < bounds.end - 2 && state.stepsInPass < 200) {
      state.stepsInPass += 1;
      state.scroller.scrollTop = Math.min(bounds.end, current + bounds.step);
      setTimeout(() => advanceTraversal(state), 350);
      return;
    }

    if (pendingPaths.size > 0) {
      setTimeout(() => advanceTraversal(state), 1700);
      return;
    }

    if (state.pass < 3) {
      state.pass += 1;
      state.stepsInPass = 0;
      state.scroller.scrollTop = bounds.start;
      recordDebugEvent('Starting another verification pass.', {
        pass: state.pass,
        expectedTestFiles: expectedPaths.size,
        confirmedViewed: confirmedExpected,
      });
      setTimeout(() => advanceTraversal(state), 500);
      return;
    }

    finishTraversal(state, 'reached-pass-limit');
  };

  const startTraversal = (filter) => {
    if (traversal) return;

    const list = document.querySelector(VIRTUALIZED_LIST_SELECTOR);
    if (!(list instanceof HTMLElement)) {
      recordDebugEvent('Virtualized file list was not found; restoring the filter.');
      if (filter.value === TEST_FILE_FILTER) setFilterValue(filter, '');
      return;
    }

    const scroller = findScrollContainer(list);
    const bounds = getTraversalBounds(list, scroller);
    const state = {
      cancelled: false,
      filter,
      list,
      scroller,
      originalScrollTop: scroller.scrollTop,
      pass: 1,
      stepsInPass: 0,
    };
    traversal = state;
    scroller.scrollTop = bounds.start;
    recordDebugEvent('Started automatic test-file traversal.', {
      expectedTestFiles: getExpectedTestFilePaths().size,
    });
    setTimeout(() => advanceTraversal(state), 500);
  };

  const temporarilyShowAllTestFiles = () => {
    if (filterAttempted) return 'already-attempted';

    const filter = document.querySelector(FILTER_SELECTOR);
    if (!(filter instanceof HTMLInputElement)) return 'filter-not-found';

    filterAttempted = true;
    if (filter.value) return `preserved-existing-filter:${filter.value}`;

    setFilterValue(filter, TEST_FILE_FILTER);
    recordDebugEvent('Temporarily applied the file filter.', { value: TEST_FILE_FILTER });

    // Filtering narrows the virtual list, then the traversal scrolls through
    // every virtualized row so GitHub renders each matching file at least once.
    setTimeout(() => startTraversal(filter), 500);

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
      const pathPending = Boolean(filePath && pendingPaths.has(filePath));
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
        pending: pendingFiles.has(file) || pathPending,
        action: 'none',
      };

      if (isTestFile) testFileCount += 1;
      if (isTestFile && toggle) {
        if (isViewed(toggle)) viewedTestPaths.add(filePath);
        else viewedTestPaths.delete(filePath);
      }

      if (pendingFiles.has(file) || pathPending) state.action = 'skipped-pending';
      else if (file.hasAttribute('hidden')) state.action = 'skipped-hidden';
      else if (!isTestFile) state.action = 'skipped-not-test-file';
      else if (!toggle) state.action = 'skipped-toggle-not-found';
      else if (!isVisible(toggle)) state.action = 'skipped-toggle-not-visible';
      else if (isViewed(toggle)) state.action = 'skipped-already-viewed';
      else if (toggle.disabled) state.action = 'skipped-toggle-disabled';
      else {
        state.action = 'clicked';
        clickedCount += 1;
        const pendingToken = Symbol(filePath);
        pendingFiles.add(file);
        pendingPaths.set(filePath, pendingToken);
        clickedTestPaths.add(filePath);
        toggle.click();

        // GitHub updates the button asynchronously. Recheck after it settles so a
        // temporary request failure can recover without rapidly double-clicking.
        setTimeout(() => {
          pendingFiles.delete(file);
          if (pendingPaths.get(filePath) === pendingToken) pendingPaths.delete(filePath);
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
      traversal: traversal
        ? {
            pass: traversal.pass,
            stepsInPass: traversal.stepsInPass,
            pendingPaths: pendingPaths.size,
            confirmedViewed: viewedTestPaths.size,
          }
        : null,
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
      if (traversal) traversal.cancelled = true;
      traversal = undefined;
      activePage = page;
      filterAttempted = false;
      pendingPaths.clear();
      viewedTestPaths.clear();
      clickedTestPaths.clear();
    }

    observer.disconnect();
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    recordDebugEvent('Script started.', {
      version: '1.1.1',
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
