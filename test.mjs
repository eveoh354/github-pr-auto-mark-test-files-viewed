import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(
  new URL('./github-pr-auto-mark-test-files-viewed.user.js', import.meta.url),
  'utf8',
);

class Element {
  constructor(attributes = {}) {
    this.attributes = new Map(Object.entries(attributes));
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.tagName = 'DIV';
    this.id = '';
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  getClientRects() {
    return [{}];
  }
}

class Input extends Element {
  constructor(checked) {
    super();
    this.checked = checked;
    this.clickCount = 0;
  }

  click() {
    this.clickCount += 1;
    this.checked = !this.checked;
  }
}

class FilterInput extends Input {
  constructor() {
    super(false);
    this.value = '';
    this.events = [];
  }

  dispatchEvent(event) {
    this.events.push(event.type);
  }
}

class Button extends Element {
  constructor(viewed) {
    super({ 'aria-pressed': String(viewed) });
    this.clickCount = 0;
  }

  click() {
    this.clickCount += 1;
    this.attributes.set('aria-pressed', 'true');
  }
}

class File extends Element {
  constructor(path, viewed, { legacy = false, hidden = false, react = true } = {}) {
    super({
      ...(legacy ? { 'data-file-path': path } : {}),
      ...(hidden ? { hidden: '' } : {}),
    });
    this.path = path;
    this.react = react;
    this.toggle = legacy ? new Input(viewed) : new Button(viewed);
    this.id = `diff-${path}`;
  }

  querySelector(selector) {
    if (selector.includes('aria-label="Viewed"')) return this.toggle;
    if (selector === '[data-file-path]' || selector === '[data-path]') return null;
    if (selector.includes('h3 code') || selector.includes('a[href^="#diff-"]')) {
      return Object.assign(new Element(), {
        textContent: this.react ? `\u200e${this.path}\u200e` : this.path,
      });
    }
    return null;
  }
}

const unviewedTest = new File('src/example.test.ts', false);
const viewedTest = new File('src/already.test.ts', true);
const normalFile = new File('src/example.ts', false);
const similarName = new File('src/example.test.tsx', false);
const legacyTest = new File('src/legacy.test.ts', false, { legacy: true });
const hiddenTest = new File('src/hidden.test.ts', false, { hidden: true });
const files = [unviewedTest, viewedTest, normalFile, similarName, legacyTest, hiddenTest];
const filterInput = new FilterInput();

const queuedTimers = [];
let mutationCallback;
const context = {
  document: {
    body: {},
    addEventListener() {},
    querySelector(selector) {
      return selector.includes('Filter files') ? filterInput : null;
    },
    querySelectorAll(selector) {
      assert.match(
        selector,
        /Diff-module__diffTargetable/,
        'scans GitHub React file containers',
      );
      assert.doesNotMatch(
        selector,
        /(?:^|,\s*)\[id\^="diff-"\](?:,|$)/,
        'does not treat every diff-prefixed descendant as a file container',
      );
      return files;
    },
  },
  // GitHub's current Files changed experience uses /changes instead of /files.
  location: {
    href: 'https://github.com/owner/repository/pull/1/changes',
    pathname: '/owner/repository/pull/1/changes',
    search: '',
  },
  navigator: { userAgent: 'userscript-test' },
  window: { addEventListener() {} },
  HTMLElement: Element,
  HTMLInputElement: Input,
  Event: class {
    constructor(type) {
      this.type = type;
    }
  },
  MutationObserver: class {
    constructor(callback) {
      mutationCallback = callback;
    }
    disconnect() {}
    observe() {}
  },
  requestAnimationFrame(callback) {
    callback();
  },
  setTimeout(callback) {
    queuedTimers.push(callback);
  },
};

vm.runInNewContext(script, context);

const debugSnapshot = context.window.__ghPrTestViewedDebug.snapshot();
assert.equal(debugSnapshot.scriptVersion, '1.0.4', 'exposes the diagnostic version');
assert.equal(debugSnapshot.lastReport.routeMatched, true, 'reports a matching PR route');
assert.equal(debugSnapshot.lastReport.testFileCount, 4, 'reports detected test files');

assert.equal(unviewedTest.toggle.clickCount, 1, 'marks an unviewed .test.ts file');
assert.equal(viewedTest.toggle.clickCount, 0, 'does not touch an already viewed test file');
assert.equal(normalFile.toggle.clickCount, 0, 'does not touch a regular TypeScript file');
assert.equal(similarName.toggle.clickCount, 0, 'does not treat .test.tsx as .test.ts');
assert.equal(legacyTest.toggle.clickCount, 1, 'supports the legacy GitHub checkbox');
assert.equal(hiddenTest.toggle.clickCount, 0, 'does not touch a filtered-out file');
assert.equal(filterInput.value, '.test.ts', 'temporarily filters a virtualized large PR');

const lazyLoadedTest = new File('src/lazy-loaded.test.ts', false);
files.push(lazyLoadedTest);
mutationCallback();
assert.equal(lazyLoadedTest.toggle.clickCount, 1, 'marks a test file loaded later in a large PR');

for (const callback of queuedTimers) callback();
assert.equal(unviewedTest.toggle.clickCount, 1, 'does not toggle a viewed file back off');
assert.equal(viewedTest.toggle.clickCount, 0, 'preserves pre-existing viewed state');
assert.equal(filterInput.value, '', 'restores the original empty file filter');
assert.deepEqual(filterInput.events, ['input', 'input'], 'notifies GitHub when filtering and restoring');

console.log('auto-mark viewed behavior tests passed');
