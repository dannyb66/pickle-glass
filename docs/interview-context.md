# Saved interview profiles

Open **Settings → Interview Profiles** in the desktop app. This feature starts with the system-design round.

1. Create a named configuration for the company and role. Set the level and timebox if useful.
2. Import a DOCX, Markdown or UTF-8 text resume, or paste its contents. Review the extracted text and confirm that exact version. Editing the resume clears confirmation. For a PDF or scanned document, export/paste readable text; direct PDF extraction is not included in this version.
3. Paste the job description, or fetch a public HTTPS URL and review the extracted text. Dynamic job sites, authentication, oversized pages and unsupported documents can require pasting the JD. Failed fetching leaves the previous text intact.
4. Add up to six named system-design reference excerpts. Importing documents and saving profiles do not call an AI provider.
5. Save, then preview the exact context packet. Select the profile and click **Start selected interview**. This ends the previous Listen session and starts a fresh local interview session with the chosen version. Configure a working audio and language model in Settings first.
6. Use the existing Ask and Summary controls. Listen supplies audio; Ask takes a screen screenshot when requested. This feature does not stream continuous screen video. Both paths include the same pinned resume, JD, round and reference context. The Ask text-only fallback retains the context if the selected model rejects images.
7. Stop the interview / use generic mode to clear the selection. Merely selecting another profile does not change an already active interview or generic meeting. Use Start selected interview to switch deliberately.

You can save separate profiles for different interviews and return to them after restarting the app. A saved edit increments its revision; it does not silently change an active session. Restart the selected interview to use the new revision.

## Source handling and context

The adapter adds trusted system-design guidance: clarify constraints, label estimates, define APIs/data models, explain architecture and relevant reliability, consistency, security, cost and failure tradeoffs. Candidate history, employer requirements and technical study material remain separate source types. They are sent as quoted user data, not application instructions. Source IDs and hashes are visible in the packet preview.

Each imported file is limited to 2 MiB; each source to 100,000 extracted characters. The packet currently includes up to 12,000 resume characters, 12,000 JD characters and 7,000 characters per reference, with a 36,000 source-character total. The preview shows truncation and an approximate token count; it is not an exact tokenizer measurement. Use concise reviewed excerpts and a model with sufficient context capacity. There is no embedding store or semantic retrieval in this version, and no measured general answer-quality improvement is claimed from the small end-to-end fixture.

JD fetching accepts public HTTPS, rejects credentials/custom ports/private network addresses, validates every redirect, pins resolved public addresses, and applies a shared 12-second DNS/request/redirect deadline plus a 2 MiB response limit. It does not execute page scripts or use browser login cookies.

## Local data and deletion

Profiles, selection, immutable session snapshots, and interview transcripts/answers are stored in the app's local SQLite database. Interview sessions use local repositories even when signed in; they are excluded from the existing Firebase session migration. Existing generic meetings retain their previous behavior. The existing signed-in web history view does not list these local interview sessions; their local records remain in SQLite. This feature does not add at-rest encryption or a new cloud backup.

Starting a session permits the configured audio provider to receive captured audio, and Ask/Summary permit the configured language provider to receive the pinned sources and current observations. Ask additionally sends its captured screenshot when supported. Preview and save alone do not upload the documents. Use preparation or otherwise permitted sessions and source material you intend to share with the chosen provider.

Deleting a profile removes its stored text and snapshots and stops an active session using it. An invalidation marker prevents deleted context from falling through to generic/cloud routing. Previous generated answers may still contain source facts and are not automatically erased. Deletion cannot retract content already sent to a provider. Account transitions cancel active source-bearing requests, stop capture and clear the profile editor; foreign-owner session IDs are rejected.

## Validation

With the repository's compatible Node runtime:

```sh
node --test tests/*.test.cjs
npm run build:renderer
```

The native SQLite test requires Electron's matching ABI. On macOS:

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --test tests/*.test.cjs
```

The regression suite covers confirmation, source limits, private-DNS/redirect/deadline rejection, snapshots and deletion, owner isolation, Ask image fallback and Summary context delivery, late STT callbacks, cancelled socket creation, and transcript/session changes during asynchronous persistence. Real native UI and provider/audio/screen acceptance use separate synthetic fixtures and ephemeral credentials; they are not replaced by these unit tests.
