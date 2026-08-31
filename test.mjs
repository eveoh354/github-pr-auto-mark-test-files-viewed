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
  constructor(path, viewed, { legacy = false, hidden = false } = {}) {
    super({
      ...(legacy ? { 'data-file-path': path } : {}),
      ...(hidden ? { hidden: '' } : {}),
    });
    this.path = path;
    this.toggle = legacy ? new Input(viewed) : new Button(viewed);
  }

  querySelector(selector) {
    if (selector.includes('MarkAsViewedButton')) return this.toggle;
    if (selector === '[data-file-path]' || selector === '[data-path]') return null;
    if (selector === 'a[href^="#diff-"]') {
      return Object.assign(new Element(), { textContent: this.path });
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

const queuedTimers = [];
const context = {
  document: {
    body: {},
    addEventListener() {},
    querySelectorAll() {
      return files;
    },
  },
  location: { pathname: '/owner/repository/pull/1/files' },
  window: { addEventListener() {} },
  HTMLElement: Element,
  HTMLInputElement: Input,
  MutationObserver: class {
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

assert.equal(unviewedTest.toggle.clickCount, 1, 'marks an unviewed .test.ts file');
assert.equal(viewedTest.toggle.clickCount, 0, 'does not touch an already viewed test file');
assert.equal(normalFile.toggle.clickCount, 0, 'does not touch a regular TypeScript file');
assert.equal(similarName.toggle.clickCount, 0, 'does not treat .test.tsx as .test.ts');
assert.equal(legacyTest.toggle.clickCount, 1, 'supports the legacy GitHub checkbox');
assert.equal(hiddenTest.toggle.clickCount, 0, 'does not touch a filtered-out file');

for (const callback of queuedTimers) callback();
assert.equal(unviewedTest.toggle.clickCount, 1, 'does not toggle a viewed file back off');
assert.equal(viewedTest.toggle.clickCount, 0, 'preserves pre-existing viewed state');

console.log('auto-mark viewed behavior tests passed');
