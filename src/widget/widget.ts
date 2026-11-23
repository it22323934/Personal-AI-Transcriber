// TORU mini player: a small floating bar on the recorded page so you can keep
// the side panel closed and focus on the lecture. Click it to show the live
// transcript. Injected by the service worker with chrome.scripting.
//
// Self-contained on purpose (type-only imports): content scripts are classic
// scripts, so this file must build to a single chunk with no `import`s.
import type { MiniCommand, MiniMessage, MiniSnapshot } from '../lib/messages';

(() => {
  type Api = { show: () => void };
  const scope = window as unknown as { __toruMini?: Api };
  if (scope.__toruMini) {
    scope.__toruMini.show(); // injected again (e.g. view switched back): just reappear
    return;
  }

  const PORT_NAME = 'toru-mini'; // keep in sync with MINI_PORT in lib/messages.ts
  const STORE_KEY = 'toruMini';
  const LEVEL_BARS = 9;

  // ------------------------------------------------------------------ DOM
  const host = document.createElement('toru-mini');
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:20px;bottom:20px;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; }
  .mini {
    --bg: #161613; --surface: #1f1f1b; --hover: #2a2a25; --line: rgba(236,234,222,.1); --line2: rgba(236,234,222,.18);
    --text: #ecebe3; --text2: #b3b1a5; --text3: #7c7a70; --lime: #cfe05b; --olive: #5d7113; --olive-text: #f5f8e6; --red: #f2555a;
    display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
    font: 400 13px/1.5 'Inter Variable', Inter, 'Segoe UI', system-ui, sans-serif; color: var(--text);
    -webkit-font-smoothing: antialiased;
  }
  .mini.below { flex-direction: column-reverse; }
  button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; padding: 0; }
  button:focus-visible { outline: 2px solid var(--lime); outline-offset: 2px; }
  svg { display: block; flex: none; }

  .bar {
    display: flex; align-items: center; gap: 4px; height: 46px; padding: 0 6px 0 4px;
    background: rgba(22,22,19,.96); border: 1px solid var(--line2); border-radius: 999px;
    box-shadow: 0 12px 36px rgba(0,0,0,.45); backdrop-filter: blur(10px);
  }
  .grip { width: 18px; height: 30px; display: grid; place-items: center; color: var(--text3); cursor: grab; touch-action: none; }
  .grip:active { cursor: grabbing; }
  .main { display: flex; align-items: center; gap: 9px; height: 34px; padding: 0 12px 0 10px; border-radius: 999px; }
  .main:hover { background: var(--hover); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--red); animation: pulse 1.6s ease-out infinite; }
  .paused .dot { background: var(--text3); animation: none; }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(242,85,90,.55); } 70% { box-shadow: 0 0 0 7px rgba(242,85,90,0); } 100% { box-shadow: 0 0 0 0 rgba(242,85,90,0); } }
  .time { font: 500 13px/1 ui-monospace, 'SF Mono', Consolas, monospace; font-variant-numeric: tabular-nums; min-width: 38px; }
  .levels { display: flex; align-items: center; gap: 2px; height: 16px; }
  .levels span { width: 3px; min-height: 3px; border-radius: 2px; background: var(--lime); transition: height 90ms linear; }
  .paused .levels { opacity: .3; }
  .label { color: var(--text2); font-size: 12.5px; display: flex; align-items: center; gap: 4px; }
  .chev { transition: transform .15s; }
  .expanded .chev { transform: rotate(180deg); }
  .below .chev { transform: rotate(180deg); }
  .below.expanded .chev { transform: none; }
  .icon { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%; color: var(--text2); }
  .icon:hover { background: var(--hover); color: var(--text); }
  .stop { display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 13px; border-radius: 999px; background: var(--text); color: var(--bg); font-weight: 600; font-size: 12.5px; }
  .stop:hover { background: #fff; }
  .primary { display: flex; align-items: center; height: 32px; padding: 0 13px; border-radius: 999px; background: var(--olive); color: var(--olive-text); font-weight: 600; font-size: 12.5px; }
  .primary:hover { background: #6b8217; }
  .done-text { display: grid; gap: 1px; padding: 0 8px 0 6px; line-height: 1.25; }
  .done-text strong { font-weight: 600; font-size: 12.5px; }
  .done-text span { color: var(--text3); font-size: 11.5px; }
  .check { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: rgba(207,224,91,.14); color: var(--lime); margin-left: 4px; }

  .sheet {
    width: 340px; max-width: calc(100vw - 40px); display: none; flex-direction: column;
    max-height: min(440px, calc(100vh - 110px));
    background: rgba(22,22,19,.97); border: 1px solid var(--line2); border-radius: 18px;
    box-shadow: 0 18px 48px rgba(0,0,0,.5); backdrop-filter: blur(10px); overflow: hidden;
  }
  .expanded .sheet { display: flex; }
  .sheet-head { display: flex; align-items: flex-start; gap: 8px; padding: 14px 10px 10px 16px; border-bottom: 1px solid var(--line); }
  .sheet-head .grow { flex: 1; min-width: 0; }
  .eyebrow { font-size: 10.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text3); }
  .title { margin: 3px 0 0; font: 400 19px/1.2 'Newsreader Variable', Georgia, 'Times New Roman', serif; letter-spacing: -.01em; color: var(--text); }
  .transcript { flex: 1; overflow-y: auto; padding: 8px 16px 10px; scrollbar-width: thin; scrollbar-color: rgba(236,234,222,.15) transparent; }
  .row { display: grid; grid-template-columns: 38px 1fr; gap: 8px; padding: 6px 0; }
  .ts { font: 11px/1.9 ui-monospace, Consolas, monospace; color: var(--text3); }
  .txt { line-height: 1.6; }
  .hint { color: var(--text3); font-size: 12px; padding: 10px 0 4px; display: flex; align-items: center; gap: 8px; }
  .sheet-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px 12px 16px; border-top: 1px solid var(--line); }
  .switch { display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 12.5px; color: var(--text2); }
  .switch input { appearance: none; position: relative; width: 30px; height: 18px; margin: 0; border-radius: 999px; background: var(--hover); border: 1px solid var(--line2); cursor: pointer; flex: none; }
  .switch input::before { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--text2); transition: transform .15s; }
  .switch input:checked { background: var(--olive); border-color: transparent; }
  .switch input:checked::before { transform: translateX(12px); background: var(--olive-text); }
  .link { color: var(--lime); font-size: 12px; text-decoration: underline; text-underline-offset: 2px; }
  .tip { max-width: 300px; padding: 8px 12px; border-radius: 12px; background: #2a2a25; color: var(--text); font-size: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.4); }
  .spinner { width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid currentColor; border-right-color: transparent; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  [hidden] { display: none !important; }
</style>
<div class="mini" part="mini">
  <section class="sheet" aria-label="Live transcript">
    <div class="sheet-head">
      <div class="grow">
        <div class="eyebrow" data-el="project"></div>
        <h2 class="title" data-el="title"></h2>
      </div>
      <button class="icon" data-act="panel" title="Open in the side panel" aria-label="Open in the side panel">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>
      </button>
      <button class="icon" data-act="collapse" title="Hide transcript" aria-label="Hide transcript">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </button>
    </div>
    <div class="transcript" data-el="transcript"></div>
    <div class="sheet-foot">
      <label class="switch" title="Uses your OpenAI credits. Off = transcript only; you can still write notes later.">
        <input type="checkbox" data-el="summary" />
        <span>AI study notes when I stop</span>
      </label>
    </div>
  </section>
  <div class="tip" data-el="tip" hidden></div>
  <div class="bar" data-el="bar">
    <span class="grip" data-el="grip" title="Drag to move">
      <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/><circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/><circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/></svg>
    </span>
    <div data-el="live" style="display:flex;align-items:center;gap:4px">
      <button class="main" data-act="toggle" aria-label="Show or hide the transcript">
        <span class="dot"></span>
        <span class="time" data-el="time">0:00</span>
        <span class="levels" data-el="levels"></span>
        <span class="label">Transcript
          <svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
        </span>
      </button>
      <button class="icon" data-act="pause" data-el="pause" aria-label="Pause"></button>
      <button class="stop" data-act="stop">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>Stop
      </button>
    </div>
    <div data-el="done" style="display:flex;align-items:center;gap:4px" hidden>
      <span class="check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
      <button class="done-text" data-act="toggle" style="text-align:left">
        <strong data-el="done-title">Saved</strong>
        <span data-el="done-sub"></span>
      </button>
      <button class="primary" data-act="open">Open notes</button>
      <button class="icon" data-act="close" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
  </div>
</div>`;

  const $ = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector(`[data-el="${name}"]`) as T;
  const mini = root.querySelector('.mini') as HTMLDivElement;
  const els = {
    project: $('project'),
    title: $('title'),
    transcript: $('transcript'),
    summary: $<HTMLInputElement>('summary'),
    tip: $('tip'),
    grip: $('grip'),
    live: $('live'),
    done: $('done'),
    time: $('time'),
    levels: $('levels'),
    pause: $<HTMLButtonElement>('pause'),
    doneTitle: $('done-title'),
    doneSub: $('done-sub'),
  };

  const PAUSE_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>';
  const PLAY_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';

  const levels: number[] = Array(LEVEL_BARS).fill(0);
  const bars = levels.map(() => els.levels.appendChild(document.createElement('span')));

  // ---------------------------------------------------------------- state
  let snap: MiniSnapshot | null = null;
  let port: chrome.runtime.Port | null = null;
  let expanded = false;
  /** Transcript rows by segment index; lines arrive as deltas and are appended in place. */
  const rows = new Map<number, { row: HTMLDivElement; txt: HTMLDivElement }>();
  let rowsNoteId: string | null = null;
  const hint = document.createElement('div');
  hint.className = 'hint';
  /** Page-level listeners, removed together when the player is closed. */
  const life = new AbortController();
  let tipTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  const clock = (ms: number) => {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = String(t % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  };

  function showTip(text: string) {
    els.tip.textContent = text;
    els.tip.hidden = false;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => (els.tip.hidden = true), 6000);
  }

  function setExpanded(next: boolean) {
    expanded = next;
    if (next) {
      // Open the sheet towards whichever side of the screen has room.
      const rect = host.getBoundingClientRect();
      mini.classList.toggle('below', rect.top + rect.height / 2 < window.innerHeight / 2);
    }
    mini.classList.toggle('expanded', next);
    if (next) els.transcript.scrollTop = els.transcript.scrollHeight;
    void savePrefs();
  }

  function makeRow(seg: MiniSnapshot['segments'][number]) {
    const row = document.createElement('div');
    row.className = 'row';
    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = clock(seg.startMs);
    const txt = document.createElement('div');
    txt.className = 'txt';
    row.append(ts, txt);
    return { row, txt };
  }

  /** Applies new or changed lines; only a reset (or another note) clears the list. */
  function applySegments(msg: MiniSnapshot) {
    const box = els.transcript;
    const follow = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    const noteId = msg.note?.id ?? null;
    if (msg.reset || noteId !== rowsNoteId) {
      rows.clear();
      box.replaceChildren();
      rowsNoteId = noteId;
    }
    for (const seg of msg.segments) {
      let entry = rows.get(seg.index);
      if (!entry) {
        entry = makeRow(seg);
        rows.set(seg.index, entry);
        // Lines normally arrive in order; a retried earlier line is slotted into place.
        let before: Element | null = null;
        for (const [index, other] of rows) {
          if (index > seg.index && (!before || index < Number((before as HTMLElement).dataset.index))) before = other.row;
        }
        entry.row.dataset.index = String(seg.index);
        box.insertBefore(entry.row, before);
      }
      entry.txt.textContent = seg.text;
    }
    renderHint(msg);
    if (follow) box.scrollTop = box.scrollHeight;
  }

  function renderHint(s: MiniSnapshot) {
    let text = '';
    let spinning = false;
    if (s.recording) {
      text = s.recording.paused
        ? 'Paused.'
        : rows.size
          ? 'Listening… new lines every 15–30 seconds'
          : 'Listening… the first lines appear after about 20 seconds';
    } else if (s.pending > 0) {
      text = 'Transcribing the last part…';
      spinning = true;
    } else if (!rows.size) {
      text = 'No speech was picked up.';
    }
    hint.replaceChildren();
    if (spinning) {
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      hint.append(spinner);
    }
    hint.append(text);
    if (text) els.transcript.append(hint); // keeps it last
    else hint.remove();
  }

  function render() {
    if (!snap) return;
    const s = snap;
    const live = !!s.recording;
    els.project.textContent = s.note?.projectName ?? '';
    els.title.textContent = s.note?.title ?? 'TORU';
    els.summary.checked = !!s.note?.autoSummary;
    els.summary.disabled = !live;
    els.live.hidden = !live;
    els.done.hidden = live;
    mini.classList.toggle('paused', !!s.recording?.paused);
    if (live) {
      els.pause.innerHTML = s.recording!.paused ? PLAY_ICON : PAUSE_ICON;
      els.pause.setAttribute('aria-label', s.recording!.paused ? 'Resume' : 'Pause');
      els.pause.title = s.recording!.paused ? 'Resume' : 'Pause';
      tick();
    } else {
      renderDone(s.note?.status ?? 'done', !!s.note?.hasSummary, s.note?.projectName ?? '', s.note?.autoSummary ?? false);
    }
    renderHint(s);
  }

  function renderDone(status: string, hasSummary: boolean, projectName: string, autoSummary: boolean, error?: string) {
    els.doneTitle.textContent = projectName ? `Saved to ${projectName}` : 'Saved';
    els.doneSub.textContent =
      status === 'summarizing'
        ? 'Writing study notes…'
        : status === 'processing'
          ? 'Finishing the transcript…'
          : status === 'error' || status === 'interrupted'
            ? error
              ? 'Needs attention: open the note'
              : 'Needs attention'
            : hasSummary
              ? 'Study notes ready'
              : autoSummary
                ? 'Transcript saved'
                : 'Transcript saved · no AI notes';
  }

  function tick() {
    const r = snap?.recording;
    if (!r) return;
    els.time.textContent = clock(r.elapsedMs + (r.runningSince ? Date.now() - r.runningSince : 0));
  }
  const ticker = setInterval(tick, 500);

  function onLevel(level: number) {
    levels.shift();
    levels.push(level);
    levels.forEach((l, i) => (bars[i].style.height = `${Math.max(3, Math.min(1, Math.pow(l * 9, 0.7)) * 16)}px`));
  }

  // ------------------------------------------------------------ messaging
  function send(cmd: MiniCommand) {
    try {
      port?.postMessage(cmd);
    } catch {
      port = null;
    }
  }

  async function ask<T>(msg: object): Promise<T | null> {
    try {
      return (await chrome.runtime.sendMessage({ target: 'background', ...msg })) as T;
    } catch {
      return null; // extension reloaded or removed
    }
  }

  function connect() {
    if (port) return;
    try {
      port = chrome.runtime.connect({ name: PORT_NAME });
    } catch {
      destroy(); // the extension was reloaded: this copy of the script is orphaned
      return;
    }
    port.onMessage.addListener((msg: MiniMessage) => {
      if (msg.type === 'level') onLevel(msg.level);
      else {
        snap = msg;
        applySegments(msg);
        render();
      }
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // expected when the recorder closes
      port = null;
      void recorderGone();
    });
  }

  /** The recorder has finished (or never existed). Show how the note ended up. */
  async function recorderGone() {
    const noteId = snap?.note?.id;
    if (!noteId) return destroy();
    const reply = await ask<{
      ok: boolean;
      note: { status: string; hasSummary: boolean; projectName: string; error?: string } | null;
    }>({ type: 'NOTE_STATUS', noteId });
    if (!reply?.ok || !reply.note) return destroy(); // deleted (e.g. nothing was said) or extension gone
    snap = { ...snap!, recording: null, pending: 0, segments: [] };
    render();
    renderDone(reply.note.status, reply.note.hasSummary, reply.note.projectName, !!snap.note?.autoSummary, reply.note.error);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(destroy, 45_000);
  }

  // -------------------------------------------------------------- actions
  root.addEventListener('click', async (e) => {
    const target = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!target) return;
    switch (target.dataset.act) {
      case 'toggle':
        setExpanded(!expanded);
        break;
      case 'collapse':
        setExpanded(false);
        break;
      case 'pause':
        send({ type: snap?.recording?.paused ? 'RESUME' : 'PAUSE' });
        break;
      case 'stop':
        send({ type: 'STOP' });
        break;
      case 'open':
        if (snap?.note) await ask({ type: 'OPEN_LIBRARY', route: `/note/${snap.note.id}` });
        break;
      case 'close':
        destroy();
        break;
      case 'panel': {
        const reply = await ask<{ ok: boolean; error?: string }>({ type: 'OPEN_PANEL' });
        if (reply?.ok) destroy();
        else showTip(reply?.error ?? 'Click the TORU icon in the toolbar to open the side panel.');
        break;
      }
    }
  });

  els.summary.addEventListener('change', () => send({ type: 'SUMMARY', on: els.summary.checked }));

  // ------------------------------------------------------------- dragging
  let drag: { dx: number; dy: number } | null = null;

  function place(left: number, top: number) {
    const r = host.getBoundingClientRect();
    const x = Math.min(Math.max(8, left), window.innerWidth - r.width - 8);
    const y = Math.min(Math.max(8, top), window.innerHeight - r.height - 8);
    host.style.left = `${x}px`;
    host.style.top = `${y}px`;
    host.style.right = 'auto';
    host.style.bottom = 'auto';
  }

  els.grip.addEventListener('pointerdown', (e) => {
    const r = host.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    els.grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  els.grip.addEventListener('pointermove', (e) => {
    if (drag) place(e.clientX - drag.dx, e.clientY - drag.dy);
  });
  els.grip.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    void savePrefs();
  });

  // Keep the bar anchored where it was dropped, measured from its bottom so
  // opening the sheet doesn't push it off screen.
  async function savePrefs() {
    const r = host.getBoundingClientRect();
    const moved = host.style.left !== '';
    try {
      await chrome.storage.local.set({
        [STORE_KEY]: { expanded, pos: moved ? { right: window.innerWidth - r.right, bottom: window.innerHeight - r.bottom } : null },
      });
    } catch {
      // storage unavailable (extension reloaded) — position just isn't remembered
    }
  }

  async function loadPrefs() {
    try {
      const saved = (await chrome.storage.local.get(STORE_KEY))[STORE_KEY] as
        | { expanded?: boolean; pos?: { right: number; bottom: number } | null }
        | undefined;
      if (saved?.pos) {
        host.style.right = `${Math.max(8, saved.pos.right)}px`;
        host.style.bottom = `${Math.max(8, saved.pos.bottom)}px`;
      }
      if (saved?.expanded) setExpanded(true);
    } catch {
      // ignore
    }
  }

  // Dragging switches to left/top; convert back to right/bottom anchoring.
  function reanchor() {
    if (host.style.left === '') return;
    const r = host.getBoundingClientRect();
    host.style.left = '';
    host.style.top = '';
    host.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    host.style.bottom = `${Math.max(8, window.innerHeight - r.bottom)}px`;
  }
  els.grip.addEventListener('pointerup', reanchor);
  window.addEventListener(
    'resize',
    () => {
      const r = host.getBoundingClientRect();
      if (r.right > window.innerWidth || r.bottom > window.innerHeight) {
        host.style.right = '20px';
        host.style.bottom = '20px';
      }
    },
    { signal: life.signal },
  );

  // ------------------------------------------------------------ lifecycle
  function destroy() {
    life.abort();
    clearInterval(ticker);
    clearTimeout(tipTimer);
    clearTimeout(closeTimer);
    try {
      port?.disconnect();
    } catch {
      // already gone
    }
    port = null;
    host.remove();
    delete scope.__toruMini;
  }

  scope.__toruMini = {
    show() {
      clearTimeout(closeTimer);
      if (!host.isConnected) document.documentElement.append(host);
      connect();
    },
  };

  // Coming back with the Back button restores this page from the back/forward
  // cache with its port closed, so reconnect to pick up the live state again.
  window.addEventListener(
    'pageshow',
    (e) => {
      if (e.persisted && scope.__toruMini) scope.__toruMini.show();
    },
    { signal: life.signal },
  );

  document.documentElement.append(host);
  void loadPrefs();
  connect();
})();
