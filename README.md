# Glass: saved interview context, audio and screen assistance

Glass is a local Electron app for asking questions with a reviewed resume, job description, technical references, conversation transcripts and requested screenshots. This fork adds saved interview profiles, Live Insights from chat, optional audio and screen context, keyboard controls and an installable Mac app. The current release is **0.2.9**; see the [changelog](CHANGELOG.md) for release details.

## Open the Mac app

Once installed, open **Glass** from Spotlight or Finder → Applications, or run:

```sh
open -a /Applications/Glass.app
```

The app starts without developer tools. **Settings → Interview Context** opens the personalization website in your browser. Its usual address is [localhost:64980](http://localhost:64980/personalize?tab=interview). If that port is busy, Glass chooses another one; the Settings link always opens the current address. Keep Glass running while using the website. Older tabs from a previous dynamic-port build should be reopened through Settings once.

## Build and install locally

The local installer targets Apple Silicon Macs. Use Node.js 20, Python and Xcode command-line tools for native dependencies. Run these commands from the repository root for the first installation:

```sh
npm install
npm --prefix pickleglass_web install
npm run install:mac && open -a /Applications/Glass.app
```

After code changes, quit Glass, then rebuild, install and open the updated app from the repository root:

```sh
npm run install:mac && open -a /Applications/Glass.app
```

`install:mac` builds the desktop renderer and website, prepares self-contained dependencies, packages and locally signs the app, then installs `/Applications/Glass.app`. The app opens only after installation succeeds. Run the dependency installation commands again when dependencies change. A replaced app is retained under `dist/Glass-previous-*.app`; saved profiles, settings and history remain in `~/Library/Application Support/Glass`.

This custom build disables upstream automatic updates so a downloaded release cannot replace your changes. Audio/screen features require the corresponding macOS permissions and a configured provider.

If setup stays open after enabling Glass, use **Check again**, then **Restart Glass**. If it still reports **Screen recording: denied**, remove the old Glass entry in **System Settings → Privacy & Security → Screen & System Audio Recording**, add `/Applications/Glass.app`, enable it, and quit/reopen Glass. Microphone access has a separate permission pane. Setup advances once macOS reports the required access as granted.

If the switch remains enabled but Glass still reports denied after those steps, quit Glass and reset only its screen permission before granting it again:

```sh
tccutil reset ScreenCapture com.pickle.glass
open -a /Applications/Glass.app
```

Use **Open screen recording settings** in Glass, enable the new entry, then **Restart Glass**. This resets Glass’s screen permission only; it does not delete profiles or session history.

If microphone permission also stays stale after enabling it and restarting, quit Glass, run `tccutil reset Microphone com.pickle.glass`, then reopen `/Applications/Glass.app` and allow microphone access when prompted. Reset only the permission that is blocked.

Local builds use ad-hoc signing by default. Rebuilding changes their code signature and can require granting screen or microphone access again. If you already have a signing identity, build with `GLASS_SIGNING_IDENTITY="Your signing identity" npm run install:mac` to use it; the installer does not create certificates or change Keychain trust.

For development:

```sh
npm start             # quiet source launch
npm run start:debug   # explicitly open developer tools
```

## Set up an interview

1. Open **Settings → Interview Context**, or **Personalize → Interview Context** on the website.
2. Create a named profile with the company, role, level and timebox.
3. Import a DOCX, Markdown or UTF-8 text resume, or paste its text. Review and confirm that exact version. Paste a PDF's readable text; direct PDF extraction is not supported.
4. Paste the job description, or fetch a public HTTPS job URL and review the extracted text. Add up to six named reference excerpts if useful.
5. **Save profile**, **Preview saved context**, then **Select for next session**.
6. Click **Start selected interview** to prepare fresh interview context immediately. This stops the previous session, pins the saved profile revision and makes it available to Ask. It does not start audio capture or require a speech provider. Use **Listen** in Glass when ready to record.

A selected profile is also applied automatically to a fresh normal Ask/Listen session. Selecting or editing a profile does not replace the context of a conversation already in progress. Use **Start selected interview** to switch deliberately. The website shows the active profile and revision; Ask responses and Live Insights identify the pinned context they use.

Resume evidence, employer requirements and study material remain separate source types. Both Ask and Insights receive the same pinned packet. Gemini chat and streaming preserve the full supplied conversation and context. Model output can still be inaccurate; the preview shows exactly which excerpts are supplied.

**Stop interview / use generic mode** ends the interview and clears the selection. Profiles remain saved for later use. [Detailed workflow, source limits and persistence behavior](docs/interview-context.md).

## Live Insights

Live Insights works with saved Ask questions and answers, optional audio transcripts, the pinned interview profile and recent screen snapshots. Audio capture is optional. Click the header's **Insights** button or press **⌘⇧I** to open the panel and analyze the entire current session, including a chat-only session. These actions prepare the current session if needed and never start Listen.

- **Recent conversation → Analyze now** reviews the latest 30 saved chat messages and audio segments in chronological order.
- **Entire session → Analyze now** reviews all saved chat and transcript text, processing long sessions in parts before synthesizing the result. The status reports coverage and sources. Latest user questions guide the analysis; AI answers are treated as unverified drafts.
- **Include screen**, enabled by default, sends up to five recent Ask screenshots and a fresh current screenshot with each manual analysis. Automatic updates reuse cached snapshots without taking a new screenshot. Disable this option for text-only Insights.
- **Auto-update** runs after each saved AI answer, even with Listen off, and every five finalized audio segments while recording. It reviews recent context. Turn it off to analyze only when requested.
- **×** hides the panel without stopping capture. The header's **Insights** button and **⌘⇧I** always open and refresh entire-session analysis.
- **Stop** flushes pending transcript writes and preserves the session for analysis and follow-up questions. **Done** hides the panel; Insights can reopen it.
- Starting another Listen session, switching accounts, deleting the profile or choosing generic mode clears the previous review.

Clicking an insight opens Ask associated with that reviewed session. Closing Ask clears that review selection. Insights keeps at most five Ask screenshots and the latest manual capture per cached session, for at most three sessions, only in memory. Entire-session coverage applies to saved text; it does not recover earlier screenshots or continuously record the screen.

Insights keeps source/status metadata in a compact footer below the response. Chat and Insights support wheel/trackpad scrolling; **Cmd+Shift+Up/Down** scrolls the focused panel, or the last active visible panel when another app has focus. Chat follows streamed output while you are at the bottom and keeps your place when you scroll up.

The Ask input stays visible while answers load and stream. Click **Ask** or press **Cmd+Enter** from another window to focus it; press **Cmd+Enter** again in Ask to submit your draft. An empty submission asks about the current context. Returning to Ask restores typing focus and keeps any unsent draft.

Ask and Insights have **A− / A+** response-size controls, from 75–150%. Click the percentage to reset. The choice is remembered across response windows.

## Keyboard shortcuts

All bindings can be changed or disabled in **Settings → Shortcuts**. Use Ctrl instead of Cmd on Windows/Linux.

| Action | Default on Mac |
| --- | --- |
| Open / focus Ask; submit draft when Ask is focused | Cmd+Enter |
| Listen / Stop / Done | Cmd+Shift+L |
| Open Insights / analyze entire session | Cmd+Shift+I |
| Show / hide Glass | Cmd+Backslash |
| Capture a screenshot | Cmd+Shift+S |
| Previous / next response | Cmd+[ / Cmd+] |
| Scroll response | Cmd+Shift+Up / Down |
| Move Glass | Cmd+Arrow |

## Saved records

Local records are stored in `~/Library/Application Support/Glass/pickleglass.db`. Interview profiles, pinned snapshots and interview sessions remain local, including for signed-in users. Signed-in generic session history uses Firebase. Starting an AI request sends its selected context to the configured provider.

Saved text includes finalized transcripts, submitted questions, completed AI answers and the latest summary. Records survive restart and have no application age limit. Raw audio/video, screenshots, canceled responses and earlier summary revisions are not a complete recording archive. Explicit deletion or clearing app data removes records.

There is no built-in backup/export/restore workflow. Signed-in cloud records also depend on encryption keys retained in the OS keychain; its memory-only fallback cannot guarantee decryption after restart. See the [persistence limits](docs/interview-context.md#long-term-records).

## Verification

Use Electron's Node runtime so SQLite and other native modules use the matching ABI:

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron --test tests/*.test.cjs
npm run build:renderer
node_modules/.bin/electron tests/panel-interaction.electron.cjs
npm run build:web
```

The native panel check loads the production HTML and renderer with synthetic provider APIs. It checks wheel and shortcut scrolling, streaming updates, window resizing, input focus, draft submission and switching between windows without accessing saved profiles or starting recording.

Regression coverage includes selected-profile activation through real session adapters and outgoing model requests, immutable snapshots, owner isolation, website origin checks, start without speech, stable website ports, same-origin API requests, Gemini context, shortcuts, chat/audio/screen Insights, bounded screenshot retention and durable transcript writes.

For development background, see the [contributing guide](CONTRIBUTING.md), [architecture and repository routing](docs/DESIGN_PATTERNS.md), [refactor notes](docs/refactor-plan.md) and [web asset notes](pickleglass_web/public/README.md). Release changes are listed in the [changelog](CHANGELOG.md).

## Attribution and license

Glass is based on [Pickle Glass](https://github.com/pickle-com/glass), which credits [Cheating Daddy](https://github.com/sohzm/cheating-daddy). This fork retains the [GPL-3.0 license](LICENSE).
