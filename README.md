# Earmark — lecture notes from any browser tab

A Chrome side-panel extension. Play a video in a tab, press **Start recording**, and Earmark:

1. captures **only that tab's audio** (you keep hearing it),
2. transcribes it live with OpenAI (new lines every 15–30 seconds),
3. writes **study notes** when you stop: TL;DR, key concepts, how it works, things worth remembering and self-test questions,
4. files everything under a **project** (e.g. "Entra ID"), with your own notes alongside.

When the recorded tab moves to the next lecture (e.g. "Complete and Continue"), Earmark finishes the current note and starts a new one automatically.

Everything runs locally in your browser. Nothing is published, and the only server it talks to is `api.openai.com`, using your own key.

---

## Install (one time)

Requires Node 20+ and Chrome 116+.

```bash
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this project's **`dist`** folder.
4. Pin Earmark from the puzzle-piece menu so its icon is always in the toolbar.

You don't need the Chrome Web Store. An unpacked extension stays installed across restarts.

## First run

1. Click the Earmark icon to open the side panel, then the **settings** icon (top right).
2. Paste your OpenAI API key and press **Test**, then **Save settings**.
3. Click **+** next to "Save to" and create a project, e.g. **Entra ID**. Fill in
   - **What is it about?**: "AZ-104 Azure Administrator — identity section" (gives the AI context)
   - **Vocabulary**: "Entra ID, tenant, RBAC, Conditional Access, PIM, B2B" (helps the transcriber spell jargon)

## Recording a lecture

1. Go to the tab with the video and **click the Earmark toolbar icon on that tab**. Chrome only lets an extension capture a tab after you invoke it there.
2. Pick the project and press **Start recording**, then play the video.
3. Watch the transcript fill in. Jot anything in **My notes**; the AI makes sure your points are covered.
4. Press **Stop**. The study notes appear in **Summary** a few seconds later.

Other ways to start or stop:

- **Alt+Shift+R** on the tab. You can change this at `chrome://extensions/shortcuts`.
- **Right-click the page → "Earmark: start or stop recording this tab"**.

If you see *"Chrome needs your OK for this tab first"*, use one of these two. They always grant permission for the tab.

The toolbar icon shows **REC** while recording and **II** while paused. Closing the side panel doesn't stop the recording.

## The library

The book icon in the panel opens the full-page library:

- **Projects**: browse each project, edit its context and vocabulary, and **Export study notes** (all summaries in one Markdown file).
- **Notes**: summary, timestamped transcript and your own notes. You can rename, move to another project, copy or download as Markdown, regenerate the summary, or delete.
- **Search**: searches titles, summaries, your notes and full transcripts.

## Costs (your OpenAI account)

| Part | Default model | Roughly |
|---|---|---|
| Transcription | `gpt-4o-mini-transcribe` | ~$0.003 per minute → about 3–4¢ for an 11-minute lecture |
| Study notes | `gpt-5-mini` | well under 1¢ per lecture |

These are the prices I last saw; check OpenAI's pricing page. Silent stretches aren't sent, so they cost nothing. You can switch to `gpt-4o-transcribe` (more accurate, about twice the price) or any chat model in Settings.

## Your data

- Notes, transcripts, projects and your API key live in the extension's own storage (IndexedDB) in this Chrome profile.
- **Removing the extension deletes that data.** Reloading or rebuilding it is safe. Use **Settings → Export backup** now and then; **Import backup** restores it. The backup leaves out your API key.
- The manifest pins the extension ID, so moving or re-loading the `dist` folder keeps your data.
- Audio is kept only until its chunk is transcribed, then deleted.

## If something goes wrong

| Symptom | Fix |
|---|---|
| "Chrome needs your OK for this tab first" | Press Alt+Shift+R on the tab, or right-click the page → Earmark |
| A note says "Needs attention" | Read the message. **Retry transcription** resends audio that failed; **Try again** rewrites the summary |
| Bad or expired API key mid-recording | Recording continues and the audio is kept. Fix the key in Settings and it's sent automatically |
| "Interrupted" | The browser closed or the extension reloaded mid-recording. Use Retry to finish what was captured |
| Can't record a page | Chrome blocks its own pages (`chrome://`, Web Store). Normal web pages work |

## Development

```bash
npm run dev        # rebuilds dist/ on every change; then click ↻ on the extension card
npm run typecheck
npm run test:e2e   # builds, loads dist/ into your Chrome (throwaway profile) and runs the end-to-end suite
```

The end-to-end test seeds data, screenshots every view into `.e2e-out/`, then runs a full recording: live chunks, pause/resume, auto-split on navigation, summaries, stop and clean-up. It uses a synthetic audio stream and a mocked OpenAI API, so it costs nothing. Set `CHROME_PATH` if Chrome is installed somewhere else.

### How it fits together

```
side panel / library (React)
        │  START ─────────────►  service worker (background.js)
        │                         • tabCapture.getMediaStreamId (needs the tab permission)
        │                         • creates/closes the offscreen recorder
        │                         • auto-split on navigation, REC badge, shortcut, context menu
        │                                   │
        │  STOP / PAUSE ───────►  offscreen document (recorder)
        │                         • plays the tab audio back so you still hear it
        │                         • AudioWorklet → 16 kHz mono WAV chunks, cut at pauses (15–30 s)
        │                         • queue → OpenAI transcription → segments
        │                         • on stop: OpenAI chat → study notes
        ▼
   IndexedDB  ◄── shared by every context; changes broadcast over a BroadcastChannel
```

| Path | What's there |
|---|---|
| `src/background/` | Service worker |
| `src/offscreen/` | Recorder: capture, chunking, transcription queue |
| `src/lib/` | Data store, OpenAI client, pipeline, audio encoding, prompts, export |
| `src/ui/` | Design system (`styles.css`), shared components, Markdown renderer |
| `src/sidepanel/`, `src/library/` | The two pages |
| `public/` | `manifest.json`, icons, the audio worklet |
| `tests/e2e.cjs` | End-to-end suite |

The default study-notes prompt is in `src/lib/prompts.ts`. You can also override it in Settings, or per project.
