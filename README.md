# GitHub PR Auto-Mark `.test.ts` Files as Viewed

A focused userscript that automatically marks unviewed `.test.ts` files as **Viewed** while reviewing a GitHub pull request.

It never unchecks a file and never changes the review state of non-`.test.ts` files.

## Features

- Marks only file paths ending exactly in `.test.ts`
- Skips `.test.ts` files already marked as Viewed
- Leaves every other file and all existing Viewed states untouched
- Supports GitHub's current `/changes` React view and the classic `/files` view
- Handles GitHub's optimized large-PR file containers and dynamically loaded files
- Temporarily filters `.test.ts`, automatically traverses the virtualized file list, then restores the empty filter and scroll position
- Preserves an existing file filter instead of replacing it
- No dependencies, API tokens, tracking, or extra network requests

## Install

### 1. Install a userscript manager

- [Tampermonkey for Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- [Tampermonkey for Microsoft Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
- [Tampermonkey for Firefox](https://addons.mozilla.org/firefox/addon/tampermonkey/)
- [Tampermonkey for Safari](https://apps.apple.com/app/tampermonkey/id6738342400) (paid)
- [Violentmonkey](https://violentmonkey.github.io/)

### 2. Install this script

**[Install GitHub PR Auto-Mark `.test.ts` Files as Viewed](https://raw.githubusercontent.com/eveoh354/github-pr-auto-mark-test-files-viewed/main/github-pr-auto-mark-test-files-viewed.user.js)**

Confirm the installation, then refresh a pull request's **Files changed** page.

## Diagnostics

Version 1.1.1 writes diagnostic messages beginning with
`[GitHub PR test-files Viewed]` to the browser console. It does not make extra
network requests or change which files the script clicks.

To copy a diagnostic snapshot:

1. Open the pull request's **Files changed** page and refresh it.
2. Open Chrome DevTools with <kbd>⌥</kbd>+<kbd>⌘</kbd>+<kbd>I</kbd> and select **Console**.
3. Run:

   ```js
   copy(JSON.stringify(window.__ghPrTestViewedDebug?.snapshot(), null, 2))
   ```

4. Paste the copied output into the issue or conversation.

If the result is `undefined`, Tampermonkey did not inject this script into the
current page; check that the script is enabled and that its installed version is
1.1.1.

## Behavior

Given this file list:

| File | Before | Result |
| --- | --- | --- |
| `src/account.test.ts` | Not viewed | Marked Viewed |
| `src/already.test.ts` | Viewed | Unchanged |
| `src/account.ts` | Not viewed | Unchanged |
| `src/account.test.tsx` | Not viewed | Unchanged |

The script runs only on GitHub pull request Files changed pages. It supports both the current `/pull/<number>/changes` route and the classic `/pull/<number>/files` route.

On GitHub's optimized large-PR view, off-screen files may not exist in the page until filtered and scrolled into view. When the file filter is empty, the script filters for `.test.ts`, automatically traverses the filtered virtual list, verifies the matching files, restores the empty filter, and returns to the original scroll position. It never replaces a filter you entered yourself.

When traversal finishes, the browser console prints a summary with the number
of matching test files, files newly marked Viewed, and files confirmed Viewed.
The summary follows GitHub's `<html lang>` interface language for English,
Simplified Chinese, Traditional Chinese, Japanese, Korean, French, German,
Spanish, Portuguese, and Russian, with English as the fallback.

## Privacy and security

The script only clicks GitHub's existing **Viewed** control for matching files. It does not read repository contents through an API, collect data, or send additional network requests.

## 中文说明

这个用户脚本会在 GitHub Pull Request 的 **Files changed** 页面中，自动把尚未勾选的 `.test.ts` 文件标记为 **Viewed**。

- 已经勾选的 `.test.ts` 文件保持不变。
- 其他文件不会被勾选或取消勾选。
- 只有完整路径以 `.test.ts` 结尾的文件会被处理，`.test.tsx` 不会匹配。

## Development

Run the dependency-free behavior tests with:

```sh
node test.mjs
```

## License

[MIT](LICENSE)
