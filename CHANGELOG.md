# Changelog

## Unreleased

### Added

- Capture the display under the pointer into removable Ask screenshot attachments with Cmd/Ctrl+Shift+S.
- Keep Ask answers and timestamped Insights in persistent, paginated feeds with session history and preserved reading position.
- Configure insight refresh thresholds, defaulting to five new turns or 30 seconds of pending content, with serialized requests and a final update on Stop.


## [0.2.9] - 2026-10-23

### Fixed

- Bound Chat and Insights to the actual window height so long responses scroll instead of extending below the screen.
- Keep the Ask input visible during loading and streaming, preserve unsent drafts, and restore typing focus when returning to Ask.
- Make Ask and Cmd+Enter activate Glass on macOS; Cmd+Enter in focused Ask submits the actual draft.
- Prevent a cancelled older question from resetting a newer request.

## [0.2.8] - 2026-10-20

### Fixed

- Honor the latest header resize during animations so the settings dots stay inside the main bar after setup.
- Move Insights source/status metadata below the response in a compact footer.
- Keep Chat and Insights responses scrollable within their panels, route scroll shortcuts to the focused or last active visible panel, and preserve Chat reading position while an answer streams.

## [0.2.7] - 2026-10-20

### Added

- Analyze saved chat, optional audio, pinned interview sources and recent screen snapshots together in Live Insights, without starting Listen.
- Include screen context by default, using up to five recent Ask screenshots and a fresh manual capture; turn off **Include screen** to omit images. Screenshot retention is bounded and in memory only.
- Refresh recent insights after each saved AI answer, even with audio off; automatic updates reuse cached screenshots without taking new captures.

### Changed

- Use the header’s **Insights** button or **Cmd+Shift+I** to open the panel and analyze the entire current session. Hide the panel with **×** without stopping capture.
- Analyze the latest 30 chronological chat/audio items or all saved session text. User questions guide the analysis, while AI answers are treated as unverified drafts.

## [0.2.6] - 2026-10-20

### Fixed

- Show the actual macOS permission blocker, recheck after returning from Settings, and offer Check again and Restart Glass with visible recovery errors.
- Open Screen & System Audio Recording settings correctly and guide recovery when a rebuilt local app has an outdated permission entry.
- Unregister generated app copies during installation; support an existing signing identity through `GLASS_SIGNING_IDENTITY`.

## [0.2.5] - 2026-10-20

### Added

- Install Glass as an Apple Silicon Mac app and launch it from Spotlight or `open -a Glass`.
- Manage reviewed interview profiles in the local personalization website, alongside prompt presets.
- Analyze recent or entire saved transcripts on demand, pause automatic insights, and reopen a stopped session for review.
- Control Listen/Stop/Done and Insights with configurable shortcuts, and adjust AI response text size.

### Fixed

- Apply the selected resume, job description and references to fresh Ask/Listen sessions while preserving each session's pinned revision.
- Prepare a selected interview without requiring speech-provider startup; show the active profile and revision.
- Keep website requests on one origin and prefer a stable website port across restarts, with useful connection errors.
- Preserve interview context and conversation history in Gemini streaming requests, including screenshot MIME types.
- Focus follow-up input when using Cmd+Enter and keep the header's settings menu visible.
- Flush final speech and pending transcript writes before ending sessions, preserve completed review context, and include local interview history for signed-in users.
- Start quietly with developer tools opt-in, and keep custom local installs from downloading upstream updates.
