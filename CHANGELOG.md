# Changelog

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
