# TypeFlow — Compatibility and Limitations

TypeFlow inserts text through standard DOM APIs. That works on most forms, but no extension
can produce **trusted native keyboard events**. This page documents exactly what is supported,
what is not, and how to work around common cases.

## 1. Supported fields

| Field | Direct insert | Typing simulation | Notes |
| --- | --- | --- | --- |
| `<textarea>` | ✅ | ✅ | Selection, replacement, paragraphs, `maxlength` |
| `<input type="text/search/url/tel/email">` | ✅ | ✅ | Types without selection support append at the end |
| `contenteditable` (`""`, `"true"`, `"plaintext-only"`) | ✅ | ✅ | `execCommand` first, DOM fallback |
| Common rich-text editors | ✅* | ✅* | Compatible when they accept `insertText`/DOM mutations |
| Shadow DOM fields | ✅ | ✅ | Deep active-element traversal |
| Fields inside same-origin iframes | ✅ | ✅ | Frame discovery reports each accessible frame |
| Fields with existing text | ✅ | ✅ | Inserts at the caret; preserves surrounding content |
| Sites that block **paste** | ✅ | ✅ | No `paste` event is used; `insertText` is used instead |
| React / Vue / controlled inputs | ✅* | ✅* | Native prototype value setter + `input` event |
| `<input type="password">` | ❌ | ❌ | Intentionally excluded for privacy |
| Non-text inputs (`number`, `date`, `file`, `checkbox`…) | ❌ | ❌ | Not text-editable the same way |
| Canvas / custom model editors | ❌ | ❌ | No real DOM text surface |
| Cross-origin iframe editors | ✅* | ✅* | Click **Allow editor site** and approve that origin in Chrome |
| `chrome://`, Web Store, PDF viewer, browser pages | ❌ | ❌ | Browser blocks extension scripting |

`*` Compatibility depends on the site. See limitations below.

## 2. Fundamental limitation: untrusted events

JavaScript cannot create trusted (`event.isTrusted === true`) keyboard or input events. Some
sites check trust, require native IME composition, or validate input through proprietary
client-side logic. On those sites TypeFlow may:

- Insert nothing and report `BLOCKED`.
- Insert text visually, but the site’s internal state does not notice.
- Insert text that is later reverted by a controlled component.

TypeFlow explicitly **does not** attempt to bypass these checks, disguise automation, solve
CAPTCHAs, or evade anti-bot systems.

## 3. Known limitations by area

### Rich-text editors

The content script first restores the tracked selection and calls
`document.execCommand("insertText")`, then verifies that the editor’s content changed. If
that fails, it dispatches a synthetic `paste` event carrying the text; editors that reject
DOM input frequently accept paste through their own model. If paste also fails, it mutates
the DOM at the saved range and dispatches an `input` event. A periodic integrity check
recovers the last 20 characters through the paste path if an editor silently reverts them.

- Editors that listen to native input events (ProseMirror/tiptap-style, Quill-style) usually
  work.
- Editors that accept only their own paste handling are supported by the synthetic paste
  fallback.
- Editors that fully re-render from an internal model and cancel or ignore paste, input, and
  DOM mutations may revert the text. If all strategies are rejected, TypeFlow reports
  `BLOCKED` instead of pretending to type.
- Paragraph breaks inside `contenteditable` may be represented as `<br>`, `<div>`, or `<p>`
  depending on the editor. The text is preserved, but exact markup is editor-specific.
- Undo/redo history may contain one entry per typed character (typing simulation) or one
  entry (direct insert).

### Framework-controlled inputs

The adapter writes through the prototype’s native `value` setter and then dispatches a
bubbling `input` event. This is the standard technique for React-controlled fields.

- Some sites override or intercept `beforeinput` and cancel all programmatic input. TypeFlow
  treats a cancelled `beforeinput` as `BLOCKED` and does not force the value.
- Input masks and formatters may modify or reject inserted characters. A value mismatch is
  reported as `BLOCKED`.
- Fields with `maxlength` stop accepting text when full; TypeFlow reports this instead of
  silently truncating.

### Focus and target detection

TypeFlow resolves the target in this order:

1. The deeply active element (following shadow roots).
2. The last editable element focused since the content script loaded.
3. The largest visible editable element (with a warning in the popup).

Because the content script is injected only after the popup opens, focus that changed before
injection may be remembered only through `document.activeElement`. Click the field and reopen
the popup if detection is wrong.

### Frames

- TypeFlow injects into all frames each time the popup opens, so same-origin editor iframes
  created **after** a previous popup open are still discovered.
- Cross-origin frames cannot be accessed under `activeTab`. When the focused editor is inside
  one, the popup shows its origin and an **Allow editor site** button. Approving the Chrome
  prompt grants TypeFlow access to that editor origin only; declining leaves it ungranted.
- If a page contains many inaccessible or sandboxed subframes, frame injection errors are
  ignored so the main frame still works.
- Fully sandboxed frames without `allow-scripts` cannot be scripted even after a grant.

### Dynamic pages

- If the target is removed, disabled, or made read-only during typing, the engine stops with
  `TARGET_GONE`.
- Single-page apps that replace the field after navigation require reopening the popup so a
  new target/frame can be discovered.
- Fields that move in the DOM are fine as long as the element stays connected and editable.

### Popup and tab lifecycle

- Typing runs in the content script, not the popup.
- Closing the popup or switching tabs does **not** stop typing.
- Reopening the popup rediscovers the active engine and restores progress.
- Navigating or reloading the page destroys the content script and stops the operation.
- Chromium throttles timers in fully backgrounded tabs; long typing jobs can slow down.
  Direct insertion is unaffected.

### Large text

- Direct insertion of 10,000+ characters is tested and handled in one operation.
- Typing simulation of very large texts is bounded by the configured delay. At the default
  55 ms/character, 10,000 characters takes roughly nine minutes.
- Crafted text with thousands of newlines adds the paragraph pause after each newline.
- `Intl.Segmenter` (when available) keeps emoji and combining characters intact.

### Other

- Browser extension CSP prevents remote scripts; TypeFlow has none.
- The popup is fixed at 400 × 600 px; the scrollable main area handles smaller screens.
- Right-to-left, IME composition, and bidirectional text are inserted as text but cannot
  reproduce native IME behavior.
- TypeFlow never transmits field contents. It reads lengths and short
  `textContent`/`innerHTML` snapshots locally only to verify insertion success.

## 4. Automated verification

Unit tests use Node’s test runner + jsdom. Browser E2E uses Playwright with Chrome for
Testing. See [TESTING.md](TESTING.md) for commands and setup.

Covered automatically:

- Textarea insertion at a caret, selection replacement, CRLF normalization.
- Email input append fallback.
- Cancelled `beforeinput` → `BLOCKED`.
- Paste-blocking event handlers do not interfere.
- Controlled-framework value setter bypass.
- `contenteditable` DOM fallback with paragraph break.
- Read-only/disabled/detached target detection.
- Unicode graphemes, Indonesian punctuation, emoji, word/character counts.
- Pause, resume, stop, countdown pause/cancel, target loss, empty text.
- Settings/history sanitization and deduplication.
- Real-browser direct insertion (textarea, text input, paragraph-based rich-text editor,
  paste-only editor, dynamically added field, open shadow-root editor, late same-origin
  iframe editor), contenteditable typing, pause/resume, immediate stop, tab switching, popup
  close, progress recovery, and a 10,660-character direct insert.

## 5. Manual checklist for a new site

1. Focus the target field on the page.
2. Reopen TypeFlow and confirm the target label looks right.
3. Try **Direct Insert** with a short Unicode paragraph.
4. Confirm the site’s own character counter / preview updated.
5. Try **Typing Simulation** with a short text and press Pause/Resume.
6. Reload the page and confirm drafts survive.
7. If the site rejects input, note whether `beforeinput` was cancelled (status shows
   `BLOCKED`) — TypeFlow will not circumvent it.

## 6. Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| “No editable field detected” | Field not focused, in a closed shadow root, or in an inaccessible frame | Click the field, reopen the popup; for a cross-origin iframe click **Allow editor site** |
| Editor is in an iframe but still “No editable field” | Same-origin iframe was added after the last scan, or frame is sandboxed | Reopen the popup; if the popup names an origin, approve **Allow editor site**; otherwise the frame cannot be scripted |
| “TypeFlow cannot run on this page” | `chrome://`, Web Store, PDF viewer, or restricted URL | Use a normal website tab |
| “The page prevented programmatic text input” | `beforeinput` cancelled by site | Site rejects scripted input; use manual typing |
| “Stopped accepting programmatic input” | Editor reverts `execCommand`, DOM, and paste insertions | Editor requires its own API; try Direct Insert once, otherwise it is incompatible |
| “The field rejected the text” | Input mask, formatter, or `maxlength` | Shorten text or use a compatible field |
| Text appears but site state does not update | Editor ignores DOM input | Try another editor or paste manually |
| Start button disabled | No text, no target, or operation already running | Add text, focus a field, reopen popup |
| Progress stops when tab is backgrounded | Chromium timer throttling | Keep the tab visible or use Direct Insert |
| Popup shows an old target | Page changed after discovery | Reopen the popup to rediscover |
