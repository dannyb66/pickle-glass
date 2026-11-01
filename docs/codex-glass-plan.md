# Codex Glass: CLI-launched Codex overlay

Status: proposed implementation plan, saved for future reference. No implementation has started.

## Summary

Create a separate local Git repository at `/Users/deepakbasavaraju/Documents/GitHub/codex-glass`. Build a macOS Electron app using Pickle-glass’s floating UI, capture, and window behavior, backed by the installed Codex CLI.

The app supports native chat, microphone and system-audio transcription, screenshots on every question, editable session context, full Codex tools, and later continuation through `codex resume`.

## Implementation

### Repository and launch

- Extract the relevant overlay, shortcuts, capture, and transcription code. Retain GPL-3.0 licensing and upstream attribution.
- Exclude Pickle accounts, Firebase, cloud sync, meeting summaries, and alternative answer providers.
- Provide these commands through an npm CLI executable:

  ```sh
  codex-glass
  codex-glass "Explain what is on my screen"
  codex-glass --cwd /path/to/project
  codex-glass --context-file /path/to/context.txt
  codex-glass --resume SESSION_ID
  ```

- Default the session working directory to the terminal’s launch directory. Show actionable errors for missing Codex, missing authentication, or unsupported versions.

### Codex session and chat

- Start `codex app-server` as a child process using stdio. Implement initialization, request correlation, streaming events, cancellation, errors, approvals, and user-input requests.
- Create persistent threads using the existing Codex home and authentication. Inherit Codex’s configured model, sandbox, and approval policies.
- Display assistant responses verbatim with Markdown rendering. Keep tool activity, approvals, and errors visually separate.
- Offer model selection, New Session, Stop, and Resume controls. Use a native chat interface; terminal slash-command parity is outside v1.
- Allow one active turn per session. Keep further typing as an editable draft until that turn finishes or is stopped.
- Store the returned session ID and working directory. Show and copy a correctly quoted `codex resume SESSION_ID` command.
- Provide “Continue in terminal”: finish or interrupt the active turn, release the app’s session, and display the resume command. Reload history when reopening that session in the overlay.

The integration uses Codex’s documented [app-server protocol](https://learn.chatgpt.com/docs/app-server) and [session-resume command](https://learn.chatgpt.com/docs/developer-commands). Verify protocol compatibility with the installed CLI during implementation; the CLI inspected during planning was `codex-cli 0.166.0`.

### Screen, audio, and Ask

- Capture a fresh screenshot of the selected display immediately before every submitted question, including an initial CLI prompt.
- Support screenshot-only Ask, pasted images, and image-file attachments. Explicit attachments supplement the automatic screenshot.
- If automatic capture fails, preserve the draft and show Retry and Send Without Screenshot choices.
- Reuse microphone and macOS system-audio capture. Provide source selection, permission guidance, listening status, and pause controls.
- Use OpenAI streaming transcription with a separate API key stored in macOS Keychain. Keep this credential separate from Codex authentication.
- Listening transcribes continuously after the user enables it. Speech alone never triggers a Codex answer.
- Each Ask includes newly finalized transcript text since the previous accepted submission, labeled by source and time. Retain the full local transcript for the session and expose it in the UI.
- Preserve unsent audio context when submission fails. Bound audio buffering and transcript payload size, with visible notice when older context is omitted.

### Overlay and customizable context

- Preserve Pickle’s translucent, movable, always-on-top overlay, show/hide shortcut, and content-protection behavior. Hide the Dock icon during normal use.
- Apply protection to chat, settings, attachment previews, and approval windows.
- Add an in-app Settings panel for default context, current-session context, transcription credentials, audio sources, display selection, and shortcuts.
- Load saved default context at session creation; `--context-file` overrides it for that launch.
- Persist initial context as an explicit conversation message before the first question so it remains available during terminal resume.
- Apply current-session context edits as an explicit update before the next question. Saving a default affects future sessions.
- Keep settings, session mappings, transcripts, and attachments local. Retain submitted images in session storage so resumed history remains usable.

## Validation

- Test protocol framing, streamed text integrity, request correlation, approvals, cancellation, child-process failure, and reconnect behavior.
- Test context initialization and edits, transcript inclusion without duplication, failed submissions, image attachment handling, and capture failures.
- Verify typed Ask, audio-context Ask, and screenshot-only Ask against a real Codex session.
- Verify that `codex resume SESSION_ID` continues the same conversation with its context and prior answers; then reopen it in the overlay.
- Exercise microphone and system-audio permissions, transcription disconnects, invalid API keys, and Stop/Start listening.
- Verify overlay protection with macOS screenshots, screen recording, and the intended screen-sharing application. Document observed limitations rather than promising universal invisibility.
- Run automated tests and renderer/package builds, then perform a CLI-launched macOS smoke test.

## Defaults and boundaries

- macOS first; local repository only.
- Native overlay chat with full Codex capabilities and configured approvals.
- Manual Ask; listening starts only when enabled.
- Every question captures the selected display; no continuous screenshot recording.
- No GitHub publication, Windows release, automatic spoken-question answering, or terminal emulation in v1.
