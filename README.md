# TORU — lecture notes from any browser tab

A Chrome side-panel extension. Play a video in a tab, press **Start recording**, and TORU:

1. captures **only that tab's audio** (you keep hearing it),
2. transcribes it live with OpenAI (new lines every 15–30 seconds),
3. writes AI **study notes** when you stop, if you want them: TL;DR, key concepts, how it works, things worth remembering and self-test questions,
4. files everything under a **project** (e.g. "Entra ID"), with your own notes alongside.

When the recorded tab moves to the next lecture (e.g. "Complete and Continue"), TORU finishes the current note and starts a new one automatically.

To focus on the lecture, close the side panel and follow along in the **mini player**: a small bar on the lecture page. Click it to see the live transcript.

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
4. Pin TORU from the puzzle-piece menu so its icon is always in the toolbar.

You don't need the Chrome Web Store. An unpacked extension stays installed across restarts.

## First run

1. Click the TORU icon to open the side panel, then the **settings** icon (top right).
2. Paste your OpenAI API key and press **Test**, then **Save settings**.
3. Click **+** next to "Save to" and create a project, e.g. **Entra ID**. Fill in
   - **What is it about?**: "AZ-104 Azure Administrator — identity section" (gives the AI context)
   - **Vocabulary**: "Entra ID, tenant, RBAC, Conditional Access, PIM, B2B" (helps the transcriber spell jargon)

## Recording a lecture

1. Go to the tab with the video and **click the TORU toolbar icon on that tab**. Chrome only lets an extension capture a tab after you invoke it there.
2. Pick the project, choose whether you want **AI study notes when I stop**, and press **Start recording**. Then play the video.
3. Watch the transcript fill in. Jot anything in **My notes**; the AI makes sure your points are covered.
4. Press **Stop**. If AI notes are on, the study notes appear in **Summary** a few seconds later.

### AI study notes: on or off

Each summary is a request to OpenAI on your account, so it's your choice:

- The **AI study notes when I stop** switch on the recorder sets the default. TORU remembers it, and it's also in Settings.
- **While recording**, the same switch (in the side panel or the mini player) changes it for the current lecture only. When TORU moves on to the next lecture, the new note keeps your choice.
- With it off you still get the full transcript. You can write notes for any lecture later with **Write study notes** on its Summary tab.

### Side panel or mini player

You don't need to keep TORU open. Closing the side panel never stops a recording; the toolbar icon shows **REC** (or **II** when paused).

To keep an eye on it without the panel, press **Mini player** in the panel while recording. The panel closes and a small bar appears at the bottom right of the lecture page:

- **Click the bar** to show or hide the live transcript, and the AI-notes switch.
- **Pause** and **Stop** work right there.
- **Drag** it by the dotted handle; it remembers where you put it.
- The **panel icon** in the expanded view switches back to the side panel.
- It follows you to the next lecture, and when you stop it shows "Saved to Entra ID · Study notes ready" with an **Open notes** button.

TORU remembers the view you used last, so the next recording starts in it. You can also set it in **Settings → While recording**. The mini player lives on the page, so it's hidden while the video is in full screen. The recording and transcript carry on regardless.

Other ways to start or stop:

- **Alt+Shift+R** on the tab. You can change this at `chrome://extensions/shortcuts`.
- **Right-click the page → "TORU: start or stop recording this tab"**.

If you see *"Chrome needs your OK for this tab first"*, use one of these two. They always grant permission for the tab. With the mini player view selected, the shortcut starts recording straight into the mini player without opening the panel.

## The library

The book icon in the panel opens the full-page library:

- **Projects**: browse each project, edit its context and vocabulary, and **Export study notes** (all summaries in one Markdown file).
- **Notes**: summary, timestamped transcript and your own notes. You can rename, move to another project, copy or download as Markdown, regenerate the summary, or delete.
- **Search**: searches titles, summaries, your notes and full transcripts.

## Costs (your OpenAI account)

| Part | Default model | Roughly |
|---|---|---|
| Transcription | `gpt-4o-mini-transcribe` | ~$0.003 per minute → about 3–4¢ for an 11-minute lecture |
| Study notes (optional) | `gpt-5-mini` | well under 1¢ per lecture, and nothing when AI notes are off |

These are the prices I last saw; check OpenAI's pricing page. Silent stretches aren't sent, so they cost nothing. You can switch to `gpt-4o-transcribe` (more accurate, about twice the price) or any chat model in Settings.

## Your data

- Notes, transcripts, projects and your API key live in the extension's own storage (IndexedDB) in this Chrome profile.
- **Removing the extension deletes that data.** Reloading or rebuilding it is safe. Use **Settings → Export backup** now and then; **Import backup** restores it. The backup leaves out your API key.
- The manifest pins the extension ID, so moving or re-loading the `dist` folder keeps your data.
- Audio is kept only until its chunk is transcribed, then deleted. Audio that fails (e.g. a bad API key) waits for **Retry**. That's about 1 MB per 30 s, so **Settings → Your data** shows how much space TORU uses and can **discard waiting audio**. Each affected note also has its own **Discard audio** button. Leftovers from deleted notes are cleaned up automatically.

## If something goes wrong

| Symptom | Fix |
|---|---|
| "Chrome needs your OK for this tab first" | Press Alt+Shift+R on the tab, or right-click the page → TORU |
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

The end-to-end test seeds data, screenshots every view into `.e2e-out/`, then runs full recordings: live chunks, pause/resume, auto-split on navigation, summaries on and off, the mini player on a real web page (expand, pause, AI-notes switch, re-appearing on the next lecture, stop), and clean-up. It uses a synthetic audio stream and a mocked OpenAI API, so it costs nothing. Set `CHROME_PATH` if Chrome is installed somewhere else.

### Memory and performance

- **Recording:** the audio worklet downmixes and resamples to 16 kHz 16-bit on the audio thread, so the recorder only ever holds the small format and encodes each WAV with a single allocation. Measured over a recording: peak audio memory 2.6 MB (was 15.9 MB).
- **Search:** it runs once typing pauses (250 ms). While the search view is open, each lecture's transcript is kept as one string, built with `join`, since a global regex `replace` leaves word-sized string pieces costing ~3× the memory. The cache is released when search closes. With 300 lectures: about 0.4 s of CPU per typed query (was 1.8–3.5 s) and a 20 MB peak (was 33–42 MB).
- **Live updates:** each audio chunk emits several change events; open views reload once per burst. The mini player receives only new transcript lines. Level meters only stream while one is on screen.
- **Measuring:** every TORU page (side panel, library, offscreen recorder) runs in **one renderer process and shares one JS heap**. Measure one page at a time, or the numbers include the others. ArrayBuffers (audio) sit outside the JS heap; read them with CDP `Runtime.getHeapUsage` → `backingStorageSize`.

### How it fits together

```
side panel / library (React)
        │  START ─────────────►  service worker (background.js)
        │                         • tabCapture.getMediaStreamId (needs the tab permission)
        │                         • creates/closes the offscreen recorder
        │                         • auto-split on navigation, REC badge, shortcut, context menu
        │                         • injects the mini player (widget.js) into the recorded page
        │                                   │
        │  STOP / PAUSE ───────►  offscreen document (recorder)
        │                         • plays the tab audio back so you still hear it
        │                         • AudioWorklet → 16 kHz mono WAV chunks, cut at pauses (15–30 s)
        │                         • queue → OpenAI transcription → segments
        │                         • on stop: OpenAI chat → study notes (if switched on)
        │                         • pushes live state to the mini player over a port
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
| `src/widget/` | The on-page mini player (content script, no framework) |
| `public/` | `manifest.json`, icons, the audio worklet |
| `tests/e2e.cjs` | End-to-end suite |

The default study-notes prompt is in `src/lib/prompts.ts`. You can also override it in Settings, or per project.
