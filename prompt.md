# PROJECT: TYPEFLOW
## Browser Extension — Smart Text Input & Typing Assistant

ROLE:
You are a senior browser extension engineer specializing in Chromium
extensions, JavaScript/TypeScript, browser APIs, DOM manipulation,
and modern UI/UX engineering.

Your task is to independently design and develop a production-ready
browser extension called "TypeFlow".

Do not build a complicated desktop application.
The entire functionality must be accessible through a browser extension.

==================================================
1. PROJECT OBJECTIVE
==================================================

Build a lightweight browser extension that helps users insert
prewritten text into web forms.

The extension is particularly useful for websites that:
- Disable clipboard paste functionality.
- Have textarea or contenteditable input fields.
- Require text to be entered manually.
- Have long discussion or response forms.

The extension must provide two primary input methods:

A. DIRECT INSERTION
B. CHARACTER-BY-CHARACTER TYPING SIMULATION

The user must be able to configure both methods from the extension UI.

IMPORTANT:
This extension is a user-controlled text input utility.
Do not implement CAPTCHA bypass, security restriction bypass,
anti-bot evasion, or mechanisms intended to disguise automation.

==================================================
2. CORE FEATURES
==================================================

FEATURE A — TEXT EDITOR

Create a text input area directly inside the extension popup.

Requirements:
- Large multiline textarea.
- Support Indonesian and international characters.
- Preserve paragraphs and line breaks.
- Display character count.
- Display word count.
- Clear text button.
- Copy text button.
- Optional local text history.
- Automatically save the current draft using chrome.storage.local.

The user should not need to import a .txt file.

FEATURE B — DIRECT INSERTION

Implement a direct insertion mechanism.

Workflow:

1. User opens the target website.
2. User focuses the desired textarea or editable field.
3. User opens TypeFlow.
4. User enters or loads their text.
5. User selects Direct Insert.
6. Extension inserts the text into the focused field.

Technical requirements:

Support:
- HTML textarea.
- HTML input (text).
- Contenteditable elements.
- Common rich-text editors where compatible.

Implementation considerations:

- Use content scripts.
- Preserve existing input content when appropriate.
- Support insertion at the current cursor position.
- Dispatch appropriate input events.
- Respect framework-controlled input fields.
- Avoid destroying existing content.
- Handle unsupported fields gracefully.

Do not assume that assigning element.value alone
will work for every modern web application.

FEATURE C — TYPING SIMULATION

Implement character-by-character text insertion.

Settings:

1. Typing Speed
   - Slow
   - Normal
   - Fast
   - Custom

2. Custom Delay
   - Minimum delay per character.
   - Maximum delay per character.

3. Paragraph Delay
   - Optional pause between paragraphs.

4. Start Delay
   - Configurable countdown before typing begins.

5. Pause / Resume
   - Allow the user to pause and continue.

6. Stop
   - Immediately stop the current operation.

7. Progress Indicator
   - Characters completed.
   - Total characters.
   - Progress percentage.
   - Estimated remaining time.

Technical requirements:

- Insert text incrementally.
- Preserve Unicode characters.
- Preserve whitespace and newlines.
- Handle punctuation correctly.
- Avoid blocking the browser UI.
- Allow cancellation at any time.
- Detect when the target element is no longer available.

Typing simulation must be transparent and user-controlled.
Do not add randomized mistakes, stealth behavior, or
anti-detection mechanisms.

IMPORTANT TECHNICAL LIMITATION:

JavaScript-generated keyboard events are not trusted native
keyboard events.

Therefore, do not claim that the extension can perfectly
simulate physical keyboard input.

Use appropriate DOM insertion and input events.
Provide compatibility warnings for websites that reject
programmatic input.

==================================================
3. EXTENSION INTERFACE
==================================================

Design a modern, minimal, premium-looking popup interface.

Design direction:

- Minimalist.
- Clean typography.
- Dark/light theme.
- Rounded components.
- Subtle animations.
- Compact layout.
- Responsive popup dimensions.

Suggested interface:

HEADER:
TypeFlow
Smart Text Input Assistant

MAIN SECTION:

[ Large Textarea ]

Placeholder:
"Write or paste your text here..."

[ Character Count ] [ Word Count ]

INPUT METHOD:

[ Direct Insert ] [ Typing Simulation ]

SETTINGS:

Typing Speed:
[ Slow | Normal | Fast | Custom ]

Custom Delay:
[ Min: 10ms ] [ Max: 30ms ]

Paragraph Pause:
[ 500ms ]

Start Countdown:
[ 3 seconds ]

CONTROLS:

[ START ]
[ PAUSE ]
[ STOP ]
[ CLEAR ]

PROGRESS:

Progress bar
Characters: 0 / 1000
Estimated remaining time: --

FOOTER:

Status: Ready
Version 1.0.0

==================================================
4. TECHNICAL ARCHITECTURE
==================================================

Use:

- Chromium Extension Manifest V3.
- TypeScript.
- HTML.
- CSS.
- Vanilla JavaScript or lightweight UI framework.
- Chrome Storage API.
- Chrome Scripting API.
- Content Scripts.

Suggested structure:

typeflow/
│
├── manifest.json
│
├── src/
│   ├── background/
│   │   └── service-worker.ts
│   │
│   ├── popup/
│   │   ├── index.html
│   │   ├── popup.ts
│   │   └── popup.css
│   │
│   ├── content/
│   │   ├── content.ts
│   │   ├── insertion.ts
│   │   └── typing-engine.ts
│   │
│   ├── storage/
│   │   └── storage.ts
│   │
│   └── utils/
│       ├── text-utils.ts
│       └── timer.ts
│
├── assets/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
├── package.json
├── tsconfig.json
└── README.md

Architecture requirements:

- Keep popup logic separate from content scripts.
- Use message passing between popup and content scripts.
- Use chrome.storage.local for persistence.
- Avoid unnecessary permissions.
- Implement proper error handling.
- Keep the extension lightweight.
- Use strict TypeScript typing.

==================================================
5. USER EXPERIENCE
==================================================

The workflow must be extremely simple.

Expected workflow:

1. Open the discussion website.
2. Focus the discussion form.
3. Click TypeFlow extension.
4. Enter the response.
5. Select insertion method.
6. Configure typing speed if necessary.
7. Press START.
8. Observe progress.
9. Finish.

The user should not need to interact with the
browser developer console.

==================================================
6. SECURITY & PRIVACY
==================================================

- All text processing must happen locally.
- Do not transmit user text to external servers.
- Do not collect browsing history.
- Do not implement analytics or telemetry.
- Store drafts locally.
- Request only necessary browser permissions.

==================================================
7. TESTING REQUIREMENTS
==================================================

Test the extension on:

1. Standard HTML textarea.
2. HTML input fields.
3. Contenteditable elements.
4. Rich-text editors.
5. Forms with existing text.
6. Forms with disabled paste events.
7. Forms with dynamic DOM updates.

Test:

- Unicode characters.
- Indonesian punctuation.
- Multiple paragraphs.
- Long text (10,000+ characters).
- Pause and resume.
- Immediate cancellation.
- Tab switching.
- Popup closing during execution.

Document known compatibility limitations.

==================================================
8. DEVELOPMENT EXECUTION
==================================================

Work autonomously.

Phase 1:
Analyze requirements and establish architecture.

Phase 2:
Create extension scaffolding and manifest.

Phase 3:
Implement text editor and local persistence.

Phase 4:
Implement direct insertion.

Phase 5:
Implement typing simulation engine.

Phase 6:
Implement popup UI and configuration.

Phase 7:
Implement messaging and progress tracking.

Phase 8:
Test compatibility and fix bugs.

Phase 9:
Prepare production build.

Phase 10:
Write README with installation and usage instructions.

Do not stop after generating scaffolding.

Implement the complete working extension.

Do not leave TODO placeholders for core functionality.

If a technical limitation is encountered, implement
the most reliable alternative and document the limitation.

FINAL DELIVERABLES:

1. Complete source code.
2. Production-ready extension build.
3. Installation instructions.
4. README.md.
5. Technical architecture documentation.
6. Compatibility and limitation documentation.