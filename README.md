# GitHub PR Auto-Mark `.test.ts` Files as Viewed

A focused userscript that automatically marks unviewed `.test.ts` files as **Viewed** while reviewing a GitHub pull request.

It never unchecks a file and never changes the review state of non-`.test.ts` files.

## Features

- Marks only file paths ending exactly in `.test.ts`
- Skips `.test.ts` files already marked as Viewed
- Leaves every other file and all existing Viewed states untouched
- Supports GitHub's current React Files changed view and the classic view
- Handles dynamically loaded files in large pull requests
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

## Behavior

Given this file list:

| File | Before | Result |
| --- | --- | --- |
| `src/account.test.ts` | Not viewed | Marked Viewed |
| `src/already.test.ts` | Viewed | Unchanged |
| `src/account.ts` | Not viewed | Unchanged |
| `src/account.test.tsx` | Not viewed | Unchanged |

The script runs only on URLs matching GitHub pull request Files changed pages.

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
