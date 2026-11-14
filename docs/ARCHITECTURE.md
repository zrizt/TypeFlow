# TypeFlow — Technical Architecture

This document describes how TypeFlow is put together, why the main technical decisions were
made, and where to extend it.

## 1. Goals and constraints

**Goals**

- Insert or type text into real web forms, including framework-controlled fields.
- Keep the extension small, dependency-free at runtime, and entirely local.
- Preserve user control: visible progress, pause/resume/stop, no stealth behavior.
- Request the minimum browser permissions that still deliver a reliable workflow.

**Constraints**

- Manifest V3 (service worker, no persistent background page).
- Script-generated keyboard/DOM events are untrusted (`event.isTrusted === false`).
- Extension popups close when they lose focus, but work must continue after they close.
- A content script cannot be assumed to exist on a page unless it was injected.

## 2. Runtime components

| Component | File | Responsibility |
| --- | --- | --- |
| Popup | `src/popup/popup.ts` + HTML/CSS | editor, settings, controls, progress, history, connection bootstrap |
| Service worker | `src/background/service-worker.ts` | first-install defaults, per-tab action badge |
| Content script | `src/content/content.ts` | target discovery, command handling, progress emission |
| Insertion layer | `src/content/insertion.ts` | field detection, `FieldAdapter` strategies |
| Typing engine | `src/content/typing-engine.ts` | countdown, per-grapheme loop, pause/stop, ETA |
| Storage | `src/storage/storage.ts` | `chrome.storage.local` persistence + sanitization |
| Shared | `src/shared/*`, `src/utils/*` | types, message guards, text/timer/DOM helpers |

The popup and content script share **no runtime objects**. They communicate only through
`chrome.tabs.sendMessage`, with plain structured-clone-safe objects.

### Permission model

```json
"permissions": ["storage", "activeTab", "scripting"],
"optional_host_permissions": ["http://*/*", "https://*/*"]
```

- `activeTab` is granted when the user opens the popup on a tab.
- `scripting.executeScript` injects `content/content.js` into that tab on demand.
- There are **no** granted `host_permissions` and no declared `content_scripts`. TypeFlow
  cannot see a page until the user opens it there. This is intentional privacy hardening.
- If the focused editor sits inside a **cross-origin iframe**, the popup offers an explicit
  “Allow editor site” action that calls `chrome.permissions.request` for that frame’s origin
  only. Nothing is granted unless the user approves the browser prompt.
- The service worker never receives page content.

## 3. Popup ↔ page connection

### Discovery

`refreshConnection()` in the popup:

1. Injects `content/content.js` into the main frame, then attempts all-frame injection.
   The content script installs once per frame, so repeated opens are safe. This also reaches
   editor iframes that were created **after** a previous popup open.
2. Runs a serializable probe function via `chrome.scripting.executeScript`:

   ```js
   const api = window.__typeflow;
   return api ? api.getFocusInfo() : null;
   ```

3. Probes all frames (cross-origin frames fail until the user grants that origin).
4. Merges reports into a `Map<frameId, FrameReport>` and picks the best frame.

### Frame scoring

| Condition | Score |
| --- | --- |
| Engine actively typing/paused/countdown in that frame | 100,000+ |
| Focused editable element | 50,000 |
| Remembered editable element | 30,000 |
| Visible fallback editable element | 10,000 |
| No editable, but focused cross-origin frame detected (grants hint) | 500 |
| No editable | 0 |

Ties prefer the lower `frameId` (usually the main frame). The chosen `frameId` is stored and
all commands use `chrome.tabs.sendMessage(tabId, message, { frameId })`.

### Focus capture caveat

The popup can steal window focus, but Chromium usually keeps `document.activeElement`
pointing at the last focused field. If not, the content script remembers the last focused
editable element during its lifetime and, as a last resort, chooses the largest visible
editable field. Fallback insertion appends at the end and the popup shows a warning.

## 4. Target resolution and insertion

### Editable detection

- `HTMLTextAreaElement` — enabled and not read-only.
- `HTMLInputElement` — enabled, not read-only, and a text-like type:
  `text`, `search`, `url`, `tel`, `email`. Password and non-text types are excluded.
- `contenteditable` — `isContentEditable` or a `contenteditable` attribute of `""`,
  `"true"`, or `"plaintext-only"` (honoring nested `contenteditable="false"`).
- Shadow DOM is traversed via `getRootNode().host` when walking ancestors and when resolving
  `document.activeElement` → `shadowRoot.activeElement`. The fallback scan also recurses into
  every open shadow root and recognizes `role="textbox"` plus common rich-text editor classes.
- If no editable is found but focus is inside a cross-origin iframe, the top frame reports the
  iframe’s origin so the popup can offer an explicit per-origin permission action.

### `FieldAdapter` strategies

**Text controls** (`textarea`, `input`)

1. Capture `selectionStart` / `selectionEnd` (append for types without selection support).
2. Dispatch `beforeinput` (`insertText`, cancelable). If the page cancels it, throw
   `BLOCKED` instead of fighting the site.
3. Write with the **prototype native value setter**
   (`Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set`) so
   instance-level setters added by controlled frameworks are bypassed.
4. Restore the caret, dispatch a bubbling `input` event (`insertText`, `data`).
5. Verify the value; a mismatch (site script or `maxlength`) raises `BLOCKED`.

**`contenteditable` / rich text**

1. Restore the tracked `Range` into the document selection.
2. Try `document.execCommand("insertText", false, text)` and verify the editor content
   changed. This path produces native input events and is the most compatible with editor
   models.
3. If `execCommand` is unavailable, refused, or does nothing, try a synthetic, cancelable
   `paste` event carrying `text/plain` and escaped `text/html`. Editors that ignore direct
   DOM input frequently accept paste through their own model. A paste handler that calls
   `preventDefault()` but inserts text counts as success.
4. If both fail, fall back to direct DOM mutation: delete the selected range, insert text
   nodes with `<br>` for newlines, restore the caret, and dispatch a bubbling `input` event.
5. The successful strategy is cached. Every 20 characters the adapter verifies the field is
   still changing. If it froze, it retries the pending characters through the paste path;
   only when that also fails does it report `BLOCKED`.

Newlines are normalized (`\r\n` / `\r` → `\n`) before insertion.

### Rich-text compatibility

`execCommand` is deprecated but still widely implemented and remains the most reliable way to
let an editor update its internal model. ProseMirror- and Quill-style editors generally
accept `execCommand`; editors that reject it often accept the synthetic paste fallback or the
DOM fallback because they observe mutations or paste events. Canvas-based editors and editors
that cancel both paste and input cannot be supported. The synthetic paste is user-triggered
and transparent; it is not stealth or anti-detection behavior.

## 5. Typing engine

`TypingEngine` is UI-framework-agnostic and only depends on a `TextSink`:

```ts
interface TextSink {
  insertText(text: string): number;
  isAlive(): boolean;
}
```

`FieldAdapter` implements this interface, which keeps the timing logic unit-testable without
a DOM or Chrome APIs.

### State machine

```
idle → countdown → typing → completed
         │            │
         ├─ paused ───┤
         └─ stopped / error
```

- **Countdown** decrements in 200 ms chunks, honoring pause and stop.
- **Typing** iterates over graphemes from `Intl.Segmenter` (fallback `Array.from`), so emoji,
  combining marks, and surrogate pairs are preserved.
- Delay per character: fixed preset (140 / 55 / 12 ms) or random in `[min, max]` for Custom.
- Paragraph pause is added after a newline character.
- Pause freezes the delay loop without losing remaining delay; resume continues.
- Stop cancels the current run id immediately; the async loop exits on its next check.
- Before every character the adapter's `isAlive()` is checked; a removed or read-only target
  produces `TARGET_GONE`.
- Progress events are throttled to ~80 ms, with forced emissions on phase changes.
- ETA = remaining characters × average delay + remaining newlines × paragraph pause +
  remaining countdown.

The engine runs inside the content script, so closing the popup or switching tabs does not
stop it. Reopening the popup reads the current snapshot during discovery.

## 6. Messaging protocol

```ts
type PopupToContentMessage =
  | { type: "TYPEFLOW_START"; text: string; settings: TypingSettings }
  | { type: "TYPEFLOW_PAUSE" }
  | { type: "TYPEFLOW_RESUME" }
  | { type: "TYPEFLOW_STOP" }
  | { type: "TYPEFLOW_INSERT"; text: string }
  | { type: "TYPEFLOW_GET_STATE" };
```

Every command returns a `CommandResponse`:

```ts
interface CommandResponse {
  ok: boolean;
  code?: ErrorCode;
  error?: string;
  state?: EngineProgress;
  target?: FocusInfo;
  insertedChars?: number;
}
```

Content → popup/background progress:

```ts
{ type: "TYPEFLOW_ENGINE_STATE", state: EngineProgress }
```

- The popup filters by `sender.tab.id` and `sender.frameId`.
- The service worker uses the same event to maintain an action badge:
  `…` (countdown), percentage (typing), `II` (paused), `✓` (completed), `!` (error).
- Unknown or malformed messages are rejected by shared type guards.

### Error codes

| Code | Meaning |
| --- | --- |
| `NO_TARGET` | No editable field could be resolved |
| `TARGET_GONE` | Field removed, disabled, or read-only during typing |
| `BLOCKED` | Site cancelled `beforeinput`, rejected the value, or froze the editor |
| `RESTRICTED_PAGE` | Injected page cannot be scripted (`chrome://`, Web Store, PDF viewer…) |
| `BAD_STATE` | Command conflicts with current engine state |
| `EMPTY_TEXT` | Nothing to insert |
| `INTERNAL` | Unexpected failure |

## 7. Storage schema

All entries live in `chrome.storage.local`:

| Key | Value |
| --- | --- |
| `typeflow.draft` | `{ text: string, updatedAt: number }` |
| `typeflow.settings` | `{ method, theme, typing: TypingSettings }` |
| `typeflow.history` | `HistoryEntry[]` (max 25, deduplicated by text) |
| `typeflow.installedVersion` | string |

All data from storage is passed through sanitizers before use. Numbers are clamped to
documented limits, invalid enums fall back to defaults, and min delay can never exceed max
delay. Drafts are autosaved with a 300 ms debounce; history is saved when Start is pressed.

## 8. Security and privacy

- No network calls, remote code, analytics, or telemetry.
- No `eval`, `innerHTML` with user text, or dynamic script injection.
- User text is inserted as DOM text nodes / native input values, never parsed as HTML.
- History and draft are rendered with `textContent`.
- Minimal permissions; on-demand injection with `activeTab`.
- Content script validates sender extension id and message shape.
- The extension does not implement CAPTCHA bypass, paste-block circumvention, anti-bot
  evasion, or automation concealment. If a site refuses input, TypeFlow reports it.

## 9. Build pipeline

`scripts/build.mjs`:

1. Clears `dist/`.
2. Generates PNG icons if missing (`scripts/generate-icons.mjs`, zlib-based PNG encoder).
3. Copies popup HTML/CSS and icons.
4. Injects `package.json` version/description into `manifest.json`.
5. Bundles three entry points with esbuild:
   - service worker → ESM
   - content script → IIFE
   - popup → IIFE
6. Minifies and disables source maps in production; inline source maps in watch mode.

`scripts/package.mjs` writes a ZIP with deflate compression using only Node built-ins.

## 10. Why these trade-offs

- **On-demand injection instead of `<all_urls>`** keeps permissions minimal but loses
  content-script state before the first popup open. The active-element + last-focused +
  largest-field fallback chain covers normal workflows.
- **No framework dependency** keeps the bundle small and avoids CSP complications.
- **`execCommand` + DOM fallback for contenteditable** maximizes compatibility even though
  `execCommand` is deprecated.
- **No keyboard event spoofing** is deliberate: it would be untrustworthy, fragile, and could
  imply stealth. Standard DOM events are honest and predictable.
