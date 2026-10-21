# Saved interview profiles

Open **Personalize → Interview Context** on the existing local website. Desktop **Settings → Interview Context** opens this tab in your browser using the app’s current website address, normally `http://localhost:64980`. Keep Glass running. The website and API share an origin, and runtime configuration belongs to that server instance. If an older tab reports a lost connection, reopen it through Glass Settings. **Prompt Presets** remains available as a separate tab. Saved profiles use the same local database and desktop account, so no profile migration is needed. This feature starts with the system-design round.

1. Create a named configuration for the company and role. Set the level and timebox if useful.
2. Import a DOCX, Markdown or UTF-8 text resume, or paste its contents. Review the extracted text and confirm that exact version. Editing the resume clears confirmation. For a PDF or scanned document, export/paste readable text; direct PDF extraction is not included in this version.
3. Paste the job description, or fetch a public HTTPS URL and review the extracted text. Dynamic job sites, authentication, oversized pages and unsupported documents can require pasting the JD. Failed fetching leaves the previous text intact.
4. Add up to six named system-design reference excerpts. Importing documents and saving profiles do not call an AI provider.
5. Save, then preview the exact context packet. Select the profile and click **Start selected interview**. This ends the previous Listen session and starts a fresh local interview session with the chosen version. This prepares context without opening audio or requiring a speech provider; use Listen in Glass when ready to record. A selected profile is also applied automatically to fresh normal Ask/Listen sessions. An existing generic or interview conversation keeps its original context until ended. Ask and Insights show the pinned profile name and revision.
6. Use the existing Ask and Summary controls. Listen supplies audio; Ask takes a screen screenshot when requested. This feature does not stream continuous screen video. Both paths include the same pinned resume, JD, round and reference context. The Ask text-only fallback retains the context if the selected model rejects images.
7. Stop the interview / use generic mode to clear the selection. Merely selecting another profile does not change an already active interview or generic meeting. Use Start selected interview to switch deliberately.

You can save separate profiles for different interviews and return to them after restarting the app. A saved edit increments its revision; it does not silently change an active session. Restart the selected interview to use the new revision.

## Live Insights and review

Listen opens Live Insights. Auto-update analyzes every five finalized transcript segments using the latest 30 segments and the pinned interview profile. Turn off **Auto-update** to use analysis only when requested. Hiding the panel with × and reopening it with the header’s **Insights** button does not stop recording or clear its context.

Choose **Recent conversation** or **Entire session**, then **Analyze now**. Entire-session mode loads all saved transcript segments from that session. Long transcripts are split into bounded parts, condensed, and synthesized; the status shows coverage and whether notes were condensed. All selected segments are processed, but the final AI summary is necessarily condensed. Screen observations are added through Ask; Insights does not continuously archive the screen. Queued analyses run serially, and older or invalidated work cannot replace the latest requested result. Provider and storage errors are shown with the previous successful analysis retained.

Normal **Stop** flushes buffered finalized speech and waits for accepted transcript writes before ending the session. It retains the reviewed session for manual analysis and follow-up questions. **Done** hides the panel; reopen it with **Insights**. Starting another Listen session, switching accounts, deleting its profile, or explicitly using generic mode clears that review. Clicking an insight opens Ask tied to the reviewed session, including after Stop. Closing Ask or starting another Listen session clears that Ask review selection.

## Source handling and context

The adapter adds trusted system-design guidance: clarify constraints, label estimates, define APIs/data models, explain architecture and relevant reliability, consistency, security, cost and failure tradeoffs. Candidate history, employer requirements and technical study material remain separate source types. They are sent as quoted user data, not application instructions. Source IDs and hashes are visible in the packet preview.

Each imported file is limited to 2 MiB; each source to 100,000 extracted characters. The packet currently includes up to 12,000 resume characters, 12,000 JD characters and 7,000 characters per reference, with a 36,000 source-character total. The preview shows truncation and an approximate token count; it is not an exact tokenizer measurement. Use concise reviewed excerpts and a model with sufficient context capacity. There is no embedding store or semantic retrieval in this version, and no measured general answer-quality improvement is claimed from the small end-to-end fixture.

JD fetching accepts public HTTPS, rejects credentials/custom ports/private network addresses, validates every redirect, pins resolved public addresses, and applies a shared 12-second DNS/request/redirect deadline plus a 2 MiB response limit. It does not execute page scripts or use browser login cookies.

## Local data and deletion

Profiles, selection, immutable session snapshots, and interview transcripts/answers are stored in the app's local SQLite database. Interview sessions use local repositories even when signed in; they are excluded from the existing Firebase session migration. Existing generic meetings retain their previous behavior. The signed-in My Activity view includes the current account’s local interview sessions alongside cloud sessions; interview details continue to read from SQLite. Anonymous history stays separate. This feature does not add at-rest encryption or a new cloud backup. The [repository routing overview](DESIGN_PATTERNS.md#2-data-persistence-the-dual-repository-factory) explains the local-only exception.

Starting a session permits the configured audio provider to receive captured audio, and Ask/Summary permit the configured language provider to receive the pinned sources and current observations. Ask additionally sends its captured screenshot when supported. Browser imports transfer document bytes only to the app’s loopback API; preview and save do not send the documents to an AI provider or cloud storage. Use preparation or otherwise permitted sessions and source material you intend to share with the chosen provider.

Deleting a profile removes its stored text and snapshots and stops an active session using it. An invalidation marker prevents deleted context from falling through to generic/cloud routing. Previous generated answers may still contain source facts and are not automatically erased. Deletion cannot retract content already sent to a provider. Account transitions stop capture and reject stale-owner requests immediately. The website refreshes its profile list when focused and every ten seconds, clearing the editor when the desktop account changes; requests already sent to a provider may still complete there. Foreign-owner session IDs are rejected.

## Long-term records

Completed session text survives database close/reopen and startup cleanup. Local history is in the app’s `userData/pickleglass.db`; signed-in generic sessions use Firebase. The saved records contain transcripts, submitted questions, completed AI answers, and the latest summary. Earlier insight revisions are overwritten; canceled AI output, continuous raw audio/video, and screenshots are not an archive. There is no age-based expiry in the application; explicit deletion and clearing app data remove records. Anonymous and signed-in accounts remain separate.

Signed-in cloud content also depends on the account’s encryption key in the OS keychain. The existing memory-only fallback when keychain access fails does not guarantee decryption after restart. There is no application backup/export/restore workflow. These are limits to a guarantee of permanent, complete recording, even though durable session text is verified.

## Validation

With the repository's compatible Node runtime:

```sh
node --test tests/*.test.cjs
npm run build:renderer
npm run build:web
```

The native SQLite test requires Electron's matching ABI. On macOS:

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --test tests/*.test.cjs
```

The web regression suite covers the local-origin boundary, desktop ownership, browser upload parsing, starting context without speech, same-origin API routing, stable website ports and opening the existing website. SQLite integration tests trace saved selection through the real session adapter into outgoing Ask and Insights requests; Gemini tests verify streaming and chat preserve source packets, prior turns and screenshot MIME types. The regression suite also covers confirmation, source limits, private-DNS/redirect/deadline rejection, snapshots and deletion, owner isolation, Ask image fallback and Summary context delivery, late STT callbacks, cancelled socket creation, and transcript/session changes during asynchronous persistence. Real native UI and provider/audio/screen acceptance use separate synthetic fixtures and ephemeral credentials; they are not replaced by these unit tests.

Controlled native validation used synthetic profiles, macOS system audio, screenshots and GPT-4.1. Physical microphone hardware, echo cancellation and other providers remain unverified by that fixture; it is not a general system-design answer-quality benchmark.
