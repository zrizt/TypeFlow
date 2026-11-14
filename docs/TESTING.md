# TypeFlow — Testing

## 1. Commands

```bash
npm run typecheck   # strict TypeScript (no emit)
npm test            # unit tests: Node test runner + jsdom
npm run e2e         # browser E2E: Playwright + Chrome for Testing
npm run build       # production build
npm run package     # production build + release/typeflow-<version>.zip
npm run verify      # typecheck + unit tests + production build
```

## 2. Unit tests (`tests/`)

Run with `npm test`. Each file executes in its own Node process.

### `text-utils.test.ts`

- CRLF / CR normalization.
- Grapheme counting for Indonesian text, accents, emoji ZWJ sequences and skin tones.
- Word counting with Indonesian punctuation and hyphenated words.
- Paragraph counting, duration formatting, grouped numbers, truncation/preview.

### `insertion.test.ts` (jsdom)

- Textarea caret insertion, selection replacement, dispatch of a single `input` event.
- CRLF normalization for text controls.
- Email input append fallback (types without selection APIs).
- `beforeinput` cancellation → `InsertionError("BLOCKED")`.
- Paste-blocking handlers do not affect insertion.
- Instance-level value-setter bypass (controlled framework simulation).
- `contenteditable` DOM fallback with `<br>` paragraph breaks and input event.
- Read-only/disabled targets rejected; detached targets detected (`TARGET_GONE`).

### `typing-engine.test.ts`

- Full Unicode text typed grapheme-by-grapheme, completion state, 100% progress, ETA 0.
- Pause freezes insertion; resume completes.
- Stop halts immediately and preserves partial progress.
- Target loss reports `TARGET_GONE`.
- Countdown can be paused and stopped before any character is typed.
- Empty text is rejected.

### `storage.test.ts`

- Defaults for invalid settings.
- Clamping of delays, `min <= max`, start countdown, paragraph pause.
- Non-finite number handling.
- Draft validation.
- History deduplication/filtering/capping; newest-first insertion.

**Current result:** 30 unit tests, 30 passing.

## 3. Browser E2E (`scripts/e2e.mjs`)

### Prerequisites

- Chrome for Testing managed by Playwright:

  ```bash
  npx playwright-core install chromium
  ```

- Optional environment variables:
  - `HEADFUL=1` — run with a visible browser window.
  - `CHROME_PATH=<path>` — use a specific Chrome/Chromium executable. Chrome 137+ branded
    builds may refuse `--load-extension`; prefer Chrome for Testing.

### What it does

The script:

1. Builds the extension with `npm run build`.
2. Copies `dist/` to a temporary directory.
3. Adds a **test-only** `host_permissions: ["http://127.0.0.1/*"]` entry so a normal page can
   be scripted without clicking the toolbar action. The shipped manifest does not contain
   this permission; production uses `activeTab`.
4. Serves a local test page with a textarea, text input, plain `contenteditable`, a
   paragraph-based rich-text editor, a paste-only editor that cancels `beforeinput`, a
   dynamically added textarea, an open shadow-root editor, and an iframe editor created after
   the content script is already installed.
5. Launches Chromium with the extension loaded and drives the real popup page.

### Scenarios

| # | Scenario | Assertion |
| --- | --- | --- |
| 1 | Direct insert into an empty textarea | Value set; `input` event dispatched; popup shows Completed |
| 2 | Direct insert with existing text and caret in the middle | Surrounding text preserved, text inserted at caret |
| 3 | Direct insert into a single-line text input | Input value matches |
| 4 | Direct insert into a paragraph-based rich-text editor | Paragraphs preserved; editor receives `input` events |
| 5 | Direct insert into a paste-only editor that cancels `beforeinput` | Synthetic paste fallback inserts the text; popup shows Completed |
| 6 | Direct insert into a dynamically added field | Focused dynamic textarea discovered and filled |
| 7 | Direct insert into an open shadow-root editor | Shadow editor discovered and filled |
| 8 | Direct insert into a late-created same-origin iframe editor | Frame is injected on the next popup open and filled |
| 9 | Cross-origin iframe editor | Embedded origin detected; **Allow editor site** action offered |
| 10 | Typing into `contenteditable` with emoji/newline | Text present, paragraph break markup, progress 100% |
| 11 | Pause then resume | Value frozen while paused; resumes to completion |
| 12 | Immediate stop | Value frozen after stop; partial progress retained; < 100% |
| 13 | Tab switch + popup close mid-run | Engine completes in the background; reopened popup shows 100% |
| 14 | Popup progress recovery | Reopened popup reads `Completed`, chars == total |
| 15 | 10,660-character direct insert | Full value matches; length > 10,000 |

Cross-origin iframe permission prompts are browser UI and cannot be automated reliably; they
are covered by the manual checklist below.

**Current result:** all E2E checks pass on Chrome for Testing
(158.0.8127.18, Playwright chromium 1254), 2026-11.

### Why the test manifest differs

Extension action popups cannot be opened by Playwright because the browser toolbar is not
part of the page automation surface. `activeTab` is granted only by that user gesture. The
E2E therefore grants host access to the local test origin to exercise the same content
script, insertion, engine, messaging, and popup code paths. The `activeTab` + `scripting`
flow is exercised by the production build and by manual testing.

## 4. Manual test checklist

Use a page you control and repeat for each supported field type.

- [ ] Focus the field, open the popup, confirm the target label.
- [ ] Direct insert with multiple paragraphs, Indonesian punctuation, emoji.
- [ ] Confirm the site’s own state updates (character counter, preview, submit enablement).
- [ ] Typing simulation: each speed preset and a custom range.
- [ ] Paragraph pause visibly pauses at blank lines.
- [ ] Start countdown, including Pause during the countdown.
- [ ] Pause / Resume / Stop from the popup.
- [ ] Close the popup mid-run; reopen and confirm progress recovery.
- [ ] Switch tabs mid-run; confirm typing continues.
- [ ] Insert into a field with existing content; caret position is respected.
- [ ] Trigger a read-only field and a field removed from the DOM; verify clear errors.
- [ ] Disabled paste handler site; confirm insertion works.
- [ ] React-controlled input if available; confirm the framework state updates.
- [ ] Editor in a same-origin iframe that loads after the first popup open; reopen and insert.
- [ ] Editor in a cross-origin iframe; click **Allow editor site**, approve Chrome’s prompt,
  and confirm the target is found. Decline once and confirm the permission is not granted.
- [ ] Draft autosave: close and reopen the popup; draft restored.
- [ ] History: start twice, load and delete entries, clear all.
- [ ] Theme toggle and settings persistence after reopening.
- [ ] Restricted pages (`chrome://extensions`, Web Store) show a friendly error.
- [ ] 10,000+ character direct insert.
