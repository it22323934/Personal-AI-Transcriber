// The offscreen document owns the captured tab audio. It keeps the audio
// audible, slices it into chunks at natural pauses, and feeds those chunks
// through the transcription queue. It outlives the side panel, so recording
// keeps going when the panel is closed.
import { concat, downsample, encodeWav, normalize, rms } from '../lib/audio';
import { emit, subscribe } from '../lib/events';
import { cleanTitle, errorMessage, pageKey } from '../lib/format';
import { MINI_PORT, type MiniCommand, type MiniMessage, type MiniSnapshot, type OffscreenRequest } from '../lib/messages';
import { finalizeNote, transcribeWithRetry } from '../lib/pipeline';
import * as store from '../lib/store';
import type { PendingChunk, RecordingState } from '../lib/types';

const TARGET_RATE = 16_000;
const MIN_CHUNK_SEC = 15; // start looking for a pause after this long
const MAX_CHUNK_SEC = 30; // cut regardless after this long
const MIN_CHUNK_MS = 500; // shorter tails are dropped
const SPEECH_LEVEL = 0.004; // block RMS above this counts as sound

/** Collects audio for one note and transcribes it chunk by chunk, in order. */
class NoteSession {
  private blocks: Float32Array[] = [];
  private levels: number[] = [];
  private levelSum = 0;
  private length = 0;
  private cursorMs = 0;
  private nextIndex = 0;
  private queue: Promise<void> = Promise.resolve();
  private previousText = '';
  private processed = new Set<number>();
  /** Set after a non-retryable error (e.g. bad API key): audio is kept, not sent. */
  private blocked = false;

  constructor(
    readonly noteId: string,
    readonly pageKey: string,
    private readonly sampleRate: number,
  ) {}

  push(block: Float32Array, level: number): void {
    this.blocks.push(block);
    this.levels.push(level);
    this.levelSum += level;
    this.length += block.length;
    const seconds = this.length / this.sampleRate;
    if (seconds >= MAX_CHUNK_SEC || (seconds >= MIN_CHUNK_SEC && this.atPause())) this.cut();
  }

  /** True when the last ~85 ms are clearly quieter than this chunk's average. */
  private atPause(): boolean {
    const n = this.levels.length;
    if (n < 4) return false;
    const threshold = Math.max(SPEECH_LEVEL, (this.levelSum / n) * 0.35);
    return this.levels[n - 1] < threshold && this.levels[n - 2] < threshold;
  }

  /** Closes the current chunk and queues it for transcription. */
  cut(): void {
    if (!this.length) return;
    const samples = concat(this.blocks, this.length);
    const levels = this.levels;
    this.blocks = [];
    this.levels = [];
    this.levelSum = 0;
    this.length = 0;

    const startMs = this.cursorMs;
    this.cursorMs += (samples.length / this.sampleRate) * 1000;
    const endMs = this.cursorMs;
    const index = this.nextIndex++;
    store.updateNote(this.noteId, { durationMs: Math.round(endMs) }).catch(console.error);

    // Skip silence: it costs money and transcribers tend to hallucinate on it.
    const sounding = levels.filter((l) => l >= SPEECH_LEVEL).length;
    if (endMs - startMs < MIN_CHUNK_MS || sounding < Math.max(3, levels.length * 0.05)) return;

    const chunk: PendingChunk = {
      noteId: this.noteId,
      index,
      startMs: Math.round(startMs),
      endMs: Math.round(endMs),
      audio: encodeWav(normalize(downsample(samples, this.sampleRate, TARGET_RATE)), TARGET_RATE),
      attempts: 0,
    };
    const saved = store.addChunk(chunk); // persisted first, so nothing is lost if transcription fails
    this.enqueue(async () => {
      await saved;
      if (!this.blocked) await this.process(chunk);
    });
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((e) => console.error('[toru] chunk task failed', e));
  }

  private async process(chunk: PendingChunk): Promise<void> {
    if (this.processed.has(chunk.index)) return;
    const result = await transcribeWithRetry(chunk, this.previousText);
    if (result.ok) {
      this.processed.add(chunk.index);
      if (result.text) this.previousText = `${this.previousText} ${result.text}`.slice(-2000);
      return;
    }
    if (result.fatal) this.blocked = true;
    await store.updateNote(this.noteId, { error: result.error });
  }

  /** After the settings change (e.g. a fixed API key), send the audio that was held back. */
  retryHeldBack(): void {
    if (!this.blocked) return;
    this.blocked = false;
    this.enqueue(async () => {
      await store.updateNote(this.noteId, { error: undefined });
      for (const chunk of await store.getChunks(this.noteId)) {
        if (this.blocked) break;
        await this.process(chunk);
      }
    });
  }

  /** Flushes the last audio, waits for the queue, then writes the summary. */
  async finish(): Promise<void> {
    this.cut();
    await store.updateNote(this.noteId, { status: 'processing' });
    await this.queue;
    await finalizeNote(this.noteId, { deleteIfEmpty: true });
  }
}

interface Capture {
  stream: MediaStream;
  ctx: AudioContext;
  worklet: AudioWorkletNode;
}

let capture: Capture | null = null;
let session: NoteSession | null = null;
let state: RecordingState | null = null;
const finishing = new Set<Promise<void>>();
let levelTick = 0;

async function publishState(next: RecordingState | null): Promise<void> {
  state = next;
  await store.setRecording(next);
  chrome.runtime.sendMessage({ target: 'background', type: 'RECORDING_CHANGED' }).catch(() => {});
}

function onBlock(block: Float32Array): void {
  const level = rms(block);
  if (++levelTick % 2 === 0) emit({ type: 'level', level: state?.paused ? 0 : level });
  if (session && state && !state.paused) session.push(block, level);
}

async function start(msg: Extract<OffscreenRequest, { type: 'START' }>) {
  if (capture) throw new Error('Already recording. Stop the current recording first.');

  const stream = await navigator.mediaDevices.getUserMedia({
    // Chrome's legacy constraint syntax is the only way to consume a tab-capture stream id.
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: msg.streamId } } as MediaTrackConstraints,
    video: false,
  });

  let ctx: AudioContext | undefined;
  try {
    ctx = new AudioContext();
    await ctx.audioWorklet.addModule(chrome.runtime.getURL('pcm-worklet.js'));
    const source = ctx.createMediaStreamSource(stream);
    // Capturing a tab silences it, so route the audio back to the speakers.
    source.connect(ctx.destination);
    const worklet = new AudioWorkletNode(ctx, 'pcm-capture');
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(worklet);
    worklet.connect(mute).connect(ctx.destination); // keeps the worklet pulled by the graph
    worklet.port.onmessage = (e: MessageEvent<Float32Array>) => onBlock(e.data);
    await ctx.resume();
    capture = { stream, ctx, worklet };
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    await ctx?.close().catch(() => {});
    throw e;
  }

  // The track ends when the captured tab is closed.
  stream.getAudioTracks()[0]?.addEventListener('ended', () => {
    void serial(stop);
  });

  const note = await store.createNote({
    projectId: msg.projectId,
    title: cleanTitle(msg.title),
    sourceUrl: msg.url,
    status: 'recording',
    autoSummary: (await store.getSettings()).autoSummarize,
  });
  const key = pageKey(msg.url);
  session = new NoteSession(note.id, key, capture.ctx.sampleRate);
  focusNoteId = note.id;
  await publishState({
    noteId: note.id,
    projectId: msg.projectId,
    tabId: msg.tabId,
    pageKey: key,
    paused: false,
    elapsedMs: 0,
    runningSince: Date.now(),
  });
  return { noteId: note.id };
}

async function stop() {
  if (!capture) return {};
  const { stream, ctx, worklet } = capture;
  capture = null;
  worklet.port.onmessage = null;
  stream.getTracks().forEach((t) => t.stop());
  await ctx.close().catch(() => {});
  const ended = session;
  session = null;
  await publishState(null);
  emit({ type: 'level', level: 0 });
  if (ended) track(ended.finish());
  notifyIfIdle();
  return {};
}

async function pause() {
  if (!state || state.paused) return {};
  session?.cut(); // transcribe what we have so far
  await publishState({
    ...state,
    paused: true,
    elapsedMs: state.elapsedMs + (state.runningSince ? Date.now() - state.runningSince : 0),
    runningSince: null,
  });
  return {};
}

async function resume() {
  if (!state || !state.paused) return {};
  await publishState({ ...state, paused: false, runningSince: Date.now() });
  return {};
}

/** The recorded tab moved to a new page: close this note and start the next one. */
async function rollover(title: string, url: string) {
  if (!capture || !session || !state) return {};
  const key = pageKey(url);
  if (!key || key === session.pageKey) return {};
  const previous = session;
  // Follow the live note: the user may have moved it to another project or
  // switched its AI summary on/off mid-recording; the next lecture inherits that.
  const prevNote = await store.getNote(previous.noteId);
  const projectId = prevNote?.projectId ?? state.projectId;
  const note = await store.createNote({
    projectId,
    title: cleanTitle(title),
    sourceUrl: url,
    status: 'recording',
    autoSummary: prevNote?.autoSummary ?? (await store.getSettings()).autoSummarize,
  });
  session = new NoteSession(note.id, key, capture.ctx.sampleRate);
  focusNoteId = note.id;
  await publishState({
    ...state,
    noteId: note.id,
    projectId,
    pageKey: key,
    elapsedMs: 0,
    runningSince: state.paused ? null : Date.now(),
  });
  track(previous.finish());
  return { noteId: note.id };
}

function track(work: Promise<void>): void {
  const tracked: Promise<void> = work
    .catch((e) => console.error('[toru] finishing a note failed', e))
    .finally(() => {
      finishing.delete(tracked);
      notifyIfIdle();
    });
  finishing.add(tracked);
}

/** Lets the service worker close this document once nothing is left to do. */
function notifyIfIdle(): void {
  if (capture || finishing.size) return;
  chrome.runtime.sendMessage({ target: 'background', type: 'OFFSCREEN_IDLE' }).catch(() => {});
}

// Commands run one at a time so START/STOP/ROLLOVER can't interleave.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}

function handle(msg: OffscreenRequest): Promise<object> {
  switch (msg.type) {
    case 'PING':
      return Promise.resolve({ recording: !!capture, busy: !!capture || finishing.size > 0 });
    case 'START':
      return serial(() => start(msg));
    case 'STOP':
      return serial(stop);
    case 'PAUSE':
      return serial(pause);
    case 'RESUME':
      return serial(resume);
    case 'ROLLOVER':
      return serial(() => rollover(msg.title, msg.url));
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  handle(msg as OffscreenRequest).then(
    (result) => sendResponse({ ok: true, ...result }),
    (e) => sendResponse({ ok: false, error: errorMessage(e) }),
  );
  return true;
});

// ------------------------------------------------------------ mini player
// The on-page mini player connects over a port and gets pushed snapshots of
// the live (or just-finished) note plus input levels.

const miniPorts = new Set<chrome.runtime.Port>();
/** The note the mini player follows: the live one, or the one that just ended. */
let focusNoteId: string | null = null;
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

function post(port: chrome.runtime.Port, msg: MiniMessage): void {
  try {
    port.postMessage(msg);
  } catch {
    miniPorts.delete(port);
  }
}

async function snapshot(): Promise<MiniSnapshot> {
  const note = focusNoteId ? await store.getNote(focusNoteId) : undefined;
  const [segments, pending, project, settings] = await Promise.all([
    note ? store.getSegments(note.id) : Promise.resolve([]),
    note ? store.countChunks(note.id) : Promise.resolve(0),
    note ? store.getProject(note.projectId) : Promise.resolve(undefined),
    store.getSettings(),
  ]);
  return {
    type: 'snapshot',
    recording: state ? { paused: state.paused, elapsedMs: state.elapsedMs, runningSince: state.runningSince } : null,
    note: note
      ? {
          id: note.id,
          title: note.title,
          projectName: project?.name ?? '',
          autoSummary: note.autoSummary ?? settings.autoSummarize,
          status: note.status,
          hasSummary: !!note.summary,
        }
      : null,
    segments: segments.map((s) => ({ index: s.index, startMs: s.startMs, text: s.text })),
    pending,
  };
}

/** Coalesces bursts of change events into one snapshot push. */
function pushSnapshot(): void {
  if (!miniPorts.size || snapshotTimer) return;
  snapshotTimer = setTimeout(async () => {
    snapshotTimer = null;
    const snap = await snapshot().catch(() => null);
    if (snap) for (const port of miniPorts) post(port, snap);
  }, 120);
}

async function handleMini(cmd: MiniCommand): Promise<void> {
  switch (cmd.type) {
    case 'PAUSE':
      await serial(pause);
      break;
    case 'RESUME':
      await serial(resume);
      break;
    case 'STOP':
      await serial(stop);
      break;
    case 'SUMMARY':
      if (focusNoteId) await store.updateNote(focusNoteId, { autoSummary: cmd.on });
      break;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== MINI_PORT) return;
  miniPorts.add(port);
  port.onDisconnect.addListener(() => miniPorts.delete(port));
  port.onMessage.addListener((cmd: MiniCommand) => {
    handleMini(cmd).catch((e) => console.error('[toru] mini player command failed', e));
  });
  snapshot().then((snap) => post(port, snap), console.error);
});

subscribe((e) => {
  if (e.type === 'settings') session?.retryHeldBack();
  if (!miniPorts.size) return;
  if (e.type === 'level') {
    for (const port of miniPorts) post(port, e);
  } else if (e.type === 'recording' || e.type === 'settings' || e.type === 'projects') {
    pushSnapshot();
  } else if ((e.type === 'notes' || e.type === 'segments' || e.type === 'chunks') && (!e.noteId || e.noteId === focusNoteId)) {
    pushSnapshot();
  }
});
