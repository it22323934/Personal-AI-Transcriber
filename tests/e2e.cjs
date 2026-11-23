// Loads dist/ into your installed Chrome (throwaway profile), seeds data, screenshots
// every view and runs a full recording with a synthetic audio stream and a mocked
// OpenAI API. usage: npm run test:e2e   (CHROME_PATH overrides the browser path)
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const http = require('http');
const path = require('path');

const EXT_SRC = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
const OUT = path.resolve(process.argv[3] || path.join(__dirname, '..', '.e2e-out'));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

const DAY = 86_400_000;
const now = Date.now();
const seed = {
  projects: [
    { id: 'p-entra', name: 'Entra ID', description: 'AZ-104 Azure Administrator — identity & governance', vocabulary: 'Entra ID, tenant, RBAC, Conditional Access, PIM, B2B, managed identity', language: 'en', summaryPrompt: '', color: '#c9dc4c', createdAt: now - 3 * DAY, updatedAt: now - 3 * DAY },
    { id: 'p-net', name: 'Azure Networking', description: 'VNets, NSGs, peering and DNS', vocabulary: 'VNet, NSG, peering', language: '', summaryPrompt: '', color: '#7cc4e8', createdAt: now - 2 * DAY, updatedAt: now - 2 * DAY },
  ],
  notes: [
    {
      id: 'n1', projectId: 'p-entra', title: 'Entra ID Overview', sourceUrl: 'https://learn.cantrill.io/courses/az-104-microsoft-azure-administrator/lectures/50184181',
      createdAt: now - DAY - 3600_000, updatedAt: now - DAY, durationMs: 682_000, status: 'done', summaryModel: 'gpt-5-mini', summaryAt: now - DAY,
      myNotes: '- tenant vs subscription — make sure this is clear\n- which licence tier unlocks Conditional Access?',
      summary: `## TL;DR
Microsoft Entra ID (formerly Azure Active Directory) is Azure’s cloud identity platform. It stores identities — users, groups and applications — and controls how they sign in and what they can reach across Azure, Microsoft 365 and thousands of SaaS apps.

## Key concepts
- **Tenant** — a dedicated, isolated instance of Entra ID that represents one organisation.
- **Identity** — anything that can authenticate: users, groups, service principals and managed identities.
- **Subscription** — a billing and management boundary for Azure resources. It is *not* the same thing as a tenant.
- **Licence tiers** — Free, P1 and P2. P1 adds Conditional Access; P2 adds PIM and Identity Protection.

## How it works
1. A user signs in against the tenant and receives a token.
2. Azure Resource Manager and applications validate that token.
3. Authorisation is decided separately — Azure RBAC for resources, app roles for applications.

## Worth remembering
- Entra ID is **not** Windows Server AD in the cloud: no OUs, no Group Policy, no Kerberos/LDAP by default.
- A tenant can be trusted by many subscriptions; each subscription trusts exactly one tenant.
- Every tenant gets a default \`*.onmicrosoft.com\` domain; custom domains are verified through DNS.

## Test yourself
- How do tenants and subscriptions relate? *Many subscriptions can trust one tenant; each subscription trusts only one.*
- Which tier do you need for Conditional Access? *Entra ID P1.*`,
    },
    { id: 'n2', projectId: 'p-entra', title: 'Demo - Exploring your Entra ID Tenant', sourceUrl: 'https://learn.cantrill.io/courses/az-104/lectures/2', createdAt: now - DAY + 600_000, updatedAt: now - DAY, durationMs: 312_000, status: 'done', myNotes: '', summary: '## TL;DR\nA tour of the Entra admin centre: tenant overview, users, groups, licences and the default domain.\n\n## Key concepts\n- **Tenant ID** — the GUID that uniquely identifies the directory.' },
    { id: 'n3', projectId: 'p-entra', title: 'Demo - About the Free Azure Subscription', sourceUrl: 'https://learn.cantrill.io/courses/az-104/lectures/3', createdAt: now - DAY + 1200_000, updatedAt: now - DAY, durationMs: 290_000, status: 'error', error: 'Summary failed: OpenAI rate limit or quota reached. You exceeded your current quota.', myNotes: '' },
    { id: 'n4', projectId: 'p-net', title: 'Virtual Networks and Subnets', sourceUrl: 'https://learn.cantrill.io/courses/az-104/lectures/9', createdAt: now - 2 * DAY, updatedAt: now - 2 * DAY, durationMs: 745_000, status: 'done', myNotes: '', summary: '## TL;DR\nA VNet is a private, isolated network in one region, split into subnets that each take a slice of the address space.' },
  ],
  segments: [
    [0, 'Hello everyone, great to have you joining me for this lesson on Entra ID. Entra ID is Microsoft’s cloud-based identity and access management service, and it was previously known as Azure Active Directory.'],
    [21_000, 'Every organisation that uses Azure gets a tenant. A tenant is a dedicated instance of Entra ID, and it’s where all of your users, groups and application identities live.'],
    [44_000, 'Now, a really common point of confusion is the difference between a tenant and a subscription. A subscription is a billing and management boundary, and every subscription trusts exactly one tenant.'],
    [68_000, 'Entra ID comes in a few licence tiers: Free, P1 and P2. If you want features like Conditional Access you need P1, and things like Privileged Identity Management need P2.'],
    [93_000, 'It’s important to understand that Entra ID is not just Active Directory Domain Services running in the cloud. There are no organisational units and no group policy.'],
  ].map(([startMs, text], index) => ({ noteId: 'n1', index, startMs, endMs: startMs + 21_000, text })),
};

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  // Test-only copy of the extension with host access, so the mini player can be
  // injected without the toolbar click a real user makes (automation can't click it).
  const EXT = path.join(OUT, 'ext');
  fs.cpSync(EXT_SRC, EXT, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  manifest.host_permissions = [...(manifest.host_permissions ?? []), '<all_urls>'];
  fs.writeFileSync(path.join(EXT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const userDataDir = fs.mkdtempSync(path.join(OUT, 'profile-'));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    pipe: true,
    enableExtensions: [EXT],
    userDataDir,
    args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check'],
  });

  try {
    const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 20000 });
    const extId = new URL(swTarget.url()).host;
    check(extId === 'dkjnpakphioflpjbjhhnmhglddpplndb', `extension loaded with pinned id (${extId})`);
    const sw = await swTarget.worker();

    async function openPage(file, width, height) {
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      // Headless Chrome reports a light system theme; the main flow is shot in dark mode.
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
      page.on('console', (m) => (m.type() === 'error' || m.type() === 'warn') && errors.push(`[${file}] ${m.text()}`));
      page.on('pageerror', (e) => errors.push(`[${file}] pageerror: ${e.message}`));
      await page.goto(`chrome-extension://${extId}/${file}`, { waitUntil: 'networkidle0' });
      await page.evaluate(() => document.fonts.ready);
      await sleep(400);
      return page;
    }
    const shot = async (page, name, full = false) => {
      // Background tabs pause CSS transitions; bring the page forward so the shot shows settled styles.
      await page.bringToFront();
      await sleep(350);
      await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
    };

    // ---------------------------------------------------------------- UI
    const lib = await openPage('library.html', 1440, 960);
    await shot(lib, '01-library-first-run');
    const inbox = await lib.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('toru');
      r.onsuccess = () => { const q = r.result.transaction('projects').objectStore('projects').get('inbox'); q.onsuccess = () => res(q.result); };
    }));
    check(inbox && inbox.name === 'Inbox', 'Inbox project created on first run');

    await lib.evaluate(async (seed) => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('toru'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const put = (store, values) => new Promise((res, rej) => { const tx = db.transaction(store, 'readwrite'); for (const v of values) tx.objectStore(store).put(v); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      await put('projects', seed.projects);
      await put('notes', seed.notes);
      await put('segments', seed.segments);
      await put('meta', [{ key: 'settings', value: { apiKey: 'sk-test-1234567890', lastProjectId: 'p-entra' } }]);
      db.close();
    }, seed);

    await lib.reload({ waitUntil: 'networkidle0' });
    await shot(lib, '02-library-home');
    await lib.goto(`chrome-extension://${extId}/library.html#/project/p-entra`, { waitUntil: 'networkidle0' });
    await shot(lib, '03-library-project');
    await lib.goto(`chrome-extension://${extId}/library.html#/note/n1`, { waitUntil: 'networkidle0' });
    await shot(lib, '04-library-note-summary', true);
    await lib.evaluate(() => [...document.querySelectorAll('[role=tab]')].find((b) => b.textContent.startsWith('Transcript')).click());
    await shot(lib, '05-library-note-transcript');
    await lib.evaluate(() => [...document.querySelectorAll('[role=tab]')].find((b) => b.textContent.startsWith('My notes')).click());
    await shot(lib, '06-library-note-mynotes');
    await lib.type('input[type=search]', 'conditional access');
    await sleep(700); // search runs once typing pauses
    const found = await lib.evaluate(() => [...document.querySelectorAll('.note-row .note-row-title')].map((e) => e.textContent));
    check(found.length === 1 && found[0] === 'Entra ID Overview', `search finds the lecture (${JSON.stringify(found)})`);
    await shot(lib, '07-library-search');
    await lib.evaluate(() => [...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes('Settings')).click());
    await shot(lib, '08-settings');
    await lib.keyboard.press('Escape');
    await lib.goto(`chrome-extension://${extId}/library.html#/note/n3`, { waitUntil: 'networkidle0' });
    await shot(lib, '09-library-note-error');

    // Markdown export / title edit round-trip through the UI.
    await lib.goto(`chrome-extension://${extId}/library.html#/note/n2`, { waitUntil: 'networkidle0' });
    await lib.$eval('.note-title-input', (el) => { el.focus(); el.select(); });
    await lib.keyboard.type('Exploring the Entra admin centre');
    await lib.keyboard.press('Enter');
    await sleep(400);
    const renamed = await lib.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('toru');
      r.onsuccess = () => { const q = r.result.transaction('notes').objectStore('notes').get('n2'); q.onsuccess = () => res(q.result); };
    }));
    check(renamed.title === 'Exploring the Entra admin centre' && renamed.titleEdited === true, 'renaming a note persists and marks titleEdited');

    const panel = await openPage('sidepanel.html', 400, 900);
    await shot(panel, '10-sidepanel-idle');

    // ------------------------------------------------ custom dropdowns
    const projectTrigger = 'button[role="combobox"][aria-label="Project"]';
    await panel.click(projectTrigger);
    await sleep(250);
    const listed = await panel.evaluate(() => [...document.querySelectorAll('[role="listbox"] [role="option"]')].map((o) => o.textContent.trim()));
    check(listed.includes('Azure Networking') && listed.includes('New project…'), `project dropdown lists projects and “New project…” (${listed.join(' | ')})`);
    await shot(panel, '10b-sidepanel-dropdown');
    await panel.evaluate(() => [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes('Azure Networking')).click());
    await sleep(500);
    check((await panel.$eval('.list-title', (e) => e.textContent)) === 'Azure Networking', 'choosing a project with the mouse switches the list');
    await panel.focus(projectTrigger);
    await panel.keyboard.press('ArrowDown'); // opens on the current choice
    await sleep(150);
    await panel.keyboard.press('ArrowDown'); // Azure Networking → Entra ID
    await panel.keyboard.press('Enter');
    await sleep(500);
    check((await panel.$eval('.list-title', (e) => e.textContent)) === 'Entra ID', 'the dropdown works from the keyboard');
    check((await panel.$('[role="listbox"]')) === null, 'the list closes after choosing');

    // ----------------------------------------------------- recording flow
    // Creates the offscreen recorder and swaps in a synthetic audio stream and a mocked OpenAI.
    async function prepareRecorder() {
    await sw.evaluate(() => chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA'], justification: 'e2e test' }));
    const offTarget = await browser.waitForTarget((t) => t.url().endsWith('/offscreen.html'), { timeout: 10000 });
    const off = await offTarget.asPage();
    off.on('console', (m) => (m.type() === 'error' || m.type() === 'warn') && errors.push(`[offscreen] ${m.text()}`));
    off.on('pageerror', (e) => errors.push(`[offscreen] pageerror: ${e.message}`));

    await off.evaluate(() => {
      window.__calls = [];
      const lines = [
        'In this lesson we look at user identities in Entra ID: cloud-only users, synchronised users and guest users.',
        'Cloud identities are created and managed directly in Entra ID, while synchronised identities come from on-premises Active Directory through Entra Connect.',
        'Guest users are invited through B2B collaboration and authenticate with their home organisation.',
        'Each user has a user principal name, which looks like an email address and must use a verified domain.',
      ];
      let n = 0;
      const realFetch = window.fetch.bind(window);
      window.fetch = async (url, init) => {
        url = String(url);
        if (url.endsWith('/audio/transcriptions')) {
          const f = init.body;
          const file = f.get('file');
          const header = new TextDecoder().decode(await file.slice(0, 4).arrayBuffer());
          window.__calls.push({ kind: 'transcribe', size: file.size, header, model: f.get('model'), prompt: f.get('prompt'), language: f.get('language'), auth: init.headers.Authorization });
          await new Promise((r) => setTimeout(r, 300));
          return new Response(JSON.stringify({ text: lines[n++ % lines.length] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.endsWith('/chat/completions')) {
          const body = JSON.parse(init.body);
          window.__calls.push({ kind: 'chat', model: body.model, keys: Object.keys(body), user: body.messages[1].content });
          await new Promise((r) => setTimeout(r, 600));
          return new Response(JSON.stringify({ choices: [{ message: { content: '## TL;DR\nUser identities in Entra ID come in three flavours: cloud-only, synchronised and guest.\n\n## Key concepts\n- **Cloud identity** — created directly in Entra ID.\n- **Synchronised identity** — comes from on-prem AD via Entra Connect.\n- **Guest** — invited through *B2B collaboration*.' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return realFetch(url, init);
      };
      // Stand-in for the tab-capture stream: 1.6 s "speech" bursts with 0.5 s pauses.
      navigator.mediaDevices.getUserMedia = async () => {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        osc.frequency.value = 220;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const t0 = ctx.currentTime + 0.05;
        for (let i = 0; i < 400; i++) {
          gain.gain.setValueAtTime(0.3, t0 + i * 2.1);
          gain.gain.setValueAtTime(0, t0 + i * 2.1 + 1.6);
        }
        const dest = ctx.createMediaStreamDestination();
        osc.connect(gain).connect(dest);
        osc.start();
        return dest.stream;
      };
    });
    return off;
    }
    const off = await prepareRecorder();

    const send = (msg) => sw.evaluate((m) => chrome.runtime.sendMessage(m), msg);
    const readDb = (store, key) => panel.evaluate((store, key) => new Promise((res) => {
      const r = indexedDB.open('toru');
      r.onsuccess = () => { const q = r.result.transaction(store).objectStore(store).get(key); q.onsuccess = () => res(q.result); };
    }), store, key);
    const segmentsOf = (noteId) => panel.evaluate((noteId) => new Promise((res) => {
      const r = indexedDB.open('toru');
      r.onsuccess = () => { const q = r.result.transaction('segments').objectStore('segments').index('noteId').getAll(noteId); q.onsuccess = () => res(q.result); };
    }), noteId);

    const started = await send({ target: 'offscreen', type: 'START', streamId: 'fake', tabId: 424242, projectId: 'p-entra', title: '(2) [SHARED] Entra ID User Identities | learn.cantrill.io', url: 'https://learn.cantrill.io/courses/az-104/lectures/50184190' });
    check(started && started.ok && started.noteId, `START accepted (${JSON.stringify(started)})`);
    const note1 = started.noteId;
    const n1 = await readDb('notes', note1);
    check(n1.title === 'Entra ID User Identities', `tab title cleaned → “${n1.title}”`);
    check(n1.status === 'recording', 'note status is recording');
    await sleep(1500);
    const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
    check(badge === 'REC', `toolbar badge shows REC (“${badge}”)`);

    console.log('… recording 36 s of synthetic audio');
    await sleep(36000);
    await shot(panel, '11-sidepanel-recording');
    let segs = await segmentsOf(note1);
    check(segs.length >= 2, `live transcript segments arrived while recording (${segs.length})`);
    const calls = await off.evaluate(() => window.__calls);
    const tcalls = calls.filter((c) => c.kind === 'transcribe');
    check(tcalls.every((c) => c.header === 'RIFF' && c.size > 400_000 && c.size < 1_100_000), `chunks are WAV, 15–30 s long (${tcalls.map((c) => Math.round(c.size / 32000) + 's').join(', ')})`);
    check(tcalls.every((c) => c.model === 'gpt-4o-mini-transcribe' && c.language === 'en' && c.auth === 'Bearer sk-test-1234567890'), 'transcription uses model, project language and API key');
    check(tcalls[0].prompt.includes('Glossary: Entra ID'), 'project vocabulary sent as transcription prompt');
    check(!tcalls[1] || tcalls[1].prompt.includes('user identities'), 'previous text carried into next chunk prompt');
    const durMs = (await readDb('notes', note1)).durationMs;
    check(durMs > 14000, `note duration tracked (${Math.round(durMs / 1000)} s)`);

    // Pause / resume
    await send({ target: 'offscreen', type: 'PAUSE' });
    let rec = await readDb('meta', 'recording');
    check(rec.value.paused === true && rec.value.runningSince === null, 'pause recorded in state');
    await sleep(800);
    check((await sw.evaluate(() => chrome.action.getBadgeText({}))) === 'II', 'badge shows II while paused');
    await send({ target: 'offscreen', type: 'RESUME' });
    rec = await readDb('meta', 'recording');
    check(rec.value.paused === false && rec.value.runningSince > 0, 'resume recorded in state');

    // Navigating to the next lecture starts a new note.
    const rolled = await send({ target: 'offscreen', type: 'ROLLOVER', title: '[SHARED] Demo - Create and Manage User Identities | learn.cantrill.io', url: 'https://learn.cantrill.io/courses/az-104/lectures/50184191' });
    check(rolled.ok && rolled.noteId && rolled.noteId !== note1, 'ROLLOVER created a new note for the new page');
    const same = await send({ target: 'offscreen', type: 'ROLLOVER', title: 'x', url: 'https://learn.cantrill.io/courses/az-104/lectures/50184191#comments' });
    check(same.ok && !same.noteId, 'ROLLOVER to the same page (hash change) is ignored');
    const note2 = rolled.noteId;
    await sleep(4000);
    const finished1 = await readDb('notes', note1);
    check(finished1.status === 'done' && finished1.summary && finished1.summary.includes('TL;DR'), `first note finalised with summary (status ${finished1.status})`);
    const chat = (await off.evaluate(() => window.__calls)).find((c) => c.kind === 'chat');
    check(chat && Object.keys(chat).length && chat.keys.join() === 'model,messages' && chat.model === 'gpt-5-mini', 'summary request sends only model + messages');
    check(chat && chat.user.includes('Lecture title: Entra ID User Identities') && chat.user.includes('Project: Entra ID') && chat.user.includes('Transcript:'), 'summary request includes title, project and transcript');

    console.log('… recording 18 s into the second note');
    await sleep(18000);
    const stopped = await send({ target: 'offscreen', type: 'STOP' });
    check(stopped.ok, 'STOP accepted');
    check((await readDb('meta', 'recording')) === undefined, 'recording state cleared');
    await sleep(5000);
    const finished2 = await readDb('notes', note2);
    check(finished2 && finished2.status === 'done' && !!finished2.summary, `second note finalised (status ${finished2 && finished2.status})`);
    const contexts = await sw.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }));
    check(contexts.length === 0, 'offscreen recorder closed itself when idle');
    check((await sw.evaluate(() => chrome.action.getBadgeText({}))) === '', 'badge cleared');
    segs = await segmentsOf(note2);
    check(segs.length >= 1, `second note has transcript (${segs.length} segments)`);

    await panel.evaluate((id) => {
      const row = [...document.querySelectorAll('.note-row')].find((r) => r.textContent.includes('Entra ID User Identities'));
      row && row.click();
    }, note1);
    await shot(panel, '12-sidepanel-note-summary');
    await panel.setViewport({ width: 330, height: 760, deviceScaleFactor: 1 });
    await shot(panel, '13-sidepanel-narrow');
    const overflow = await panel.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const wide = [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > vw + 0.5)
        .slice(0, 6)
        .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(el.getBoundingClientRect().right)} w=${Math.round(el.getBoundingClientRect().width)}`);
      return { vw, scrollWidth: document.documentElement.scrollWidth, wide };
    });
    check(overflow.scrollWidth <= overflow.vw, `no horizontal overflow at 330px (${JSON.stringify(overflow)})`);

    // Stale state is reconciled when the recorder is gone.
    await panel.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('toru');
      r.onsuccess = () => { const tx = r.result.transaction(['meta', 'notes'], 'readwrite'); tx.objectStore('meta').put({ key: 'recording', value: { noteId: 'n4', projectId: 'p-net', tabId: 1, pageKey: 'x', paused: false, elapsedMs: 0, runningSince: Date.now() } }); tx.oncomplete = res; };
    }));
    await panel.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'GET_STATE' }));
    check((await readDb('meta', 'recording')) === undefined, 'stale recording state cleared by GET_STATE');

    // Leftover audio/lines of deleted notes are swept when the recorder is idle.
    await panel.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('toru');
      r.onsuccess = () => {
        const tx = r.result.transaction(['chunks', 'segments'], 'readwrite');
        tx.objectStore('chunks').put({ noteId: 'ghost', index: 0, startMs: 0, endMs: 1000, audio: new Blob([new Uint8Array(2048)]), attempts: 1 });
        tx.objectStore('segments').put({ noteId: 'ghost', index: 0, startMs: 0, endMs: 1000, text: 'orphan' });
        tx.oncomplete = res;
      };
    }));
    await panel.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'GET_STATE' }));
    check(!(await readDb('chunks', ['ghost', 0])) && !(await readDb('segments', ['ghost', 0])), 'orphaned audio and lines are swept');

    // Audio that couldn't be transcribed can be discarded from the note.
    await panel.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('toru');
      r.onsuccess = () => {
        const tx = r.result.transaction('chunks', 'readwrite');
        tx.objectStore('chunks').put({ noteId: 'n3', index: 0, startMs: 0, endMs: 20000, audio: new Blob([new Uint8Array(640000)]), attempts: 3, lastError: 'quota' });
        tx.oncomplete = res;
      };
    }));
    await lib.goto(`chrome-extension://${extId}/library.html#/note/n3`, { waitUntil: 'networkidle0' });
    await sleep(500);
    const discardBtn = await lib.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Discard audio'));
    check(!!(await discardBtn.evaluate((b) => !!b)), 'note with failed audio offers “Discard audio”');
    await discardBtn.evaluate((b) => b.click());
    await sleep(300);
    await lib.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'Discard audio').click());
    await sleep(600);
    const n3 = await readDb('notes', 'n3');
    check(!(await readDb('chunks', ['n3', 0])) && n3.status === 'done' && !n3.error, 'discarding removes the audio and clears the error');

    // Settings shows storage use.
    await lib.evaluate(() => [...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes('Settings')).click());
    await sleep(600);
    const usageText = await lib.evaluate(() => [...document.querySelectorAll('.modal .callout')].map((c) => c.textContent).find((t) => t.includes('TORU is using')) || '');
    check(/TORU is using [0-9.]+ (B|KB|MB)/.test(usageText), `settings shows storage use (“${usageText.slice(0, 60)}…”)`);
    await lib.keyboard.press('Escape');

    // Starting without tab permission gives a friendly error.
    const tab = await browser.newPage();
    const htmlPath = path.join(OUT, 'video.html');
    fs.writeFileSync(htmlPath, '<title>Some video</title><h1>hi</h1>');
    await tab.goto('file:///' + htmlPath.replace(/\\/g, '/'));
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0]?.id);
    const denied = await panel.evaluate((tabId) => chrome.runtime.sendMessage({ target: 'background', type: 'START', tabId, projectId: 'p-entra' }), tabId);
    check(denied && denied.ok === false, `START without permission fails cleanly: “${denied && denied.error}”`);

    // ------------------------------------- mini player + "AI study notes" switch
    const titles = {
      1: '[SHARED] Entra ID Groups | learn.cantrill.io',
      2: '[SHARED] Demo - Create and Manage Groups | learn.cantrill.io',
    };
    const server = http.createServer((req, res) => {
      const n = (req.url.match(/lecture\/(\d+)/) || [])[1] || '1';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><title>${titles[n]}</title>
        <body style="margin:0;background:#101012;color:#ddd;font:15px system-ui">
          <div style="height:620px;margin:20px;border-radius:8px;background:#23253a;display:grid;place-items:center;font-size:20px">▶ Lecture ${n}</div>
          <a id="next" href="/lecture/2" style="margin:20px;color:#9cf">Complete and Continue</a>
        </body>`);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const lecture = await browser.newPage();
    await lecture.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1 });
    await lecture.goto(`${base}/lecture/1`);
    const lectureTabId = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url && t.url.startsWith(u))?.id, base);

    // This run's default: AI study notes off.
    await panel.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('toru');
      r.onsuccess = () => {
        const os = r.result.transaction('meta', 'readwrite').objectStore('meta');
        const g = os.get('settings');
        g.onsuccess = () => os.put({ key: 'settings', value: { ...g.result.value, autoSummarize: false } });
        os.transaction.oncomplete = res;
      };
    }));

    const inMini = (fn, arg) => lecture.evaluate((fnSrc, arg) => {
      const host = document.querySelector('toru-mini');
      if (!host) return null;
      return new Function('root', 'arg', fnSrc)(host.shadowRoot, arg);
    }, fn, arg);
    const miniClick = (act) => inMini('root.querySelector(\'[data-act="\' + arg + \'"]\').click(); return true;', act);

    const off2 = await prepareRecorder();
    const s2 = await send({ target: 'offscreen', type: 'START', streamId: 'fake', tabId: lectureTabId, projectId: 'p-entra', title: titles[1], url: `${base}/lecture/1` });
    check(s2 && s2.ok, 'recording started on a real web page');
    const g1 = s2.noteId;
    check((await readDb('notes', g1)).autoSummary === false, 'new recording takes the “AI study notes” default (off)');
    const shown = await panel.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'SHOW_MINI' }));
    check(shown && shown.ok, `mini player injected (${JSON.stringify(shown)})`);
    check((await readDb('meta', 'settings')).value.recordingView === 'mini', 'mini player view is remembered');
    await sleep(1500);
    check((await inMini('return root.querySelector(\'[data-el="title"]\').textContent;')) === 'Entra ID Groups', 'mini player is on the page, showing the lecture');
    await shot(lecture, '14-mini-collapsed');

    console.log('… recording 18 s with the mini player');
    await sleep(18000);
    await miniClick('toggle');
    await sleep(600);
    const rows = await inMini('return root.querySelectorAll(".row").length;');
    check(rows >= 1, `clicking the mini player shows the live transcript (${rows} lines)`);
    check((await inMini('return root.querySelector(\'[data-el="summary"]\').checked;')) === false, 'mini player shows the AI notes switch (off)');
    await shot(lecture, '15-mini-expanded');
    await lecture.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await sleep(300);
    check((await inMini('return root.querySelector(".mini").classList.contains("light");')) === true, 'mini player follows a light system theme live');
    await shot(lecture, '15b-mini-light');
    await lecture.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await sleep(300);
    check((await inMini('return root.querySelector(".mini").classList.contains("light");')) === false, 'and switches back to dark');
    await panel.setViewport({ width: 400, height: 900, deviceScaleFactor: 1 });
    await shot(panel, '16-sidepanel-recording-controls');

    await miniClick('pause');
    await sleep(700);
    check((await readDb('meta', 'recording')).value.paused === true, 'pause from the mini player');
    await miniClick('pause');
    await sleep(700);
    check((await readDb('meta', 'recording')).value.paused === false, 'resume from the mini player');

    // "Complete and Continue": new note, and the mini player comes back on the new page.
    await Promise.all([lecture.waitForNavigation(), lecture.click('#next')]);
    await sleep(4500);
    const nextTitle = await inMini('return root.querySelector(\'[data-el="title"]\').textContent;');
    check(nextTitle === 'Demo - Create and Manage Groups', `mini player re-appears on the next lecture (“${nextTitle}”)`);
    const doneG1 = await readDb('notes', g1);
    const chatsSoFar = (await off2.evaluate(() => window.__calls)).filter((c) => c.kind === 'chat').length;
    check(doneG1.status === 'done' && !doneG1.summary && chatsSoFar === 0, `AI notes off: lecture saved with no summary request (status ${doneG1.status}, ${chatsSoFar} summary calls)`);
    const g2 = (await readDb('meta', 'recording')).value.noteId;
    check(g2 !== g1 && (await readDb('notes', g2)).autoSummary === false, 'the next lecture inherits the AI notes choice');
    await inMini('root.querySelector(\'[data-el="summary"]\').click(); return true;');
    await sleep(700);
    check((await readDb('notes', g2)).autoSummary === true, 'AI notes switched on for this lecture from the mini player');

    console.log('… recording 17 s into the next lecture');
    await sleep(17000);
    await miniClick('stop');
    await sleep(6500);
    const doneG2 = await readDb('notes', g2);
    check(doneG2.status === 'done' && !!doneG2.summary, 'AI notes on: summary written after stopping from the mini player');
    const result = await inMini('return root.querySelector(\'[data-el="done-title"]\').textContent + " · " + root.querySelector(\'[data-el="done-sub"]\').textContent;');
    check(result === 'Saved to Entra ID · Study notes ready', `mini player shows how the lecture was saved (“${result}”)`);
    await shot(lecture, '17-mini-done');
    const miniRows = await inMini('return [...root.querySelectorAll(".row")].map((r) => r.dataset.index).join(",");');
    const dbRows = (await segmentsOf(g2)).map((s) => s.index).sort((a, b) => a - b).join(',');
    check(miniRows === dbRows, `mini player shows every line exactly once, in order (${miniRows} vs ${dbRows})`);
    await miniClick('open');
    await sleep(1500);
    const libUrls = await sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.url).filter((u) => u && u.includes('library.html')));
    check(libUrls.some((u) => u.endsWith(`#/note/${g2}`)), 'Open notes opens that lecture in the library');
    server.close();

    // ------------------------------------------------------- Ask (chat)
    // OpenAI is mocked inside the library page; each test sets the next reply mode.
    await lib.goto(`chrome-extension://${extId}/library.html#/note/n1`, { waitUntil: 'networkidle0' });
    await lib.evaluate(() => {
      window.__chat = { requests: [], mode: 'stream' };
      const enc = new TextEncoder();
      // Like a real fetch body, the stream errors with AbortError when the request is aborted.
      const sse = (pieces, delay, signal) =>
        new ReadableStream({
          async start(c) {
            let aborted = false;
            signal?.addEventListener('abort', () => {
              aborted = true;
              c.error(new DOMException('The operation was aborted.', 'AbortError'));
            });
            for (const p of pieces) {
              if (delay) await new Promise((r) => setTimeout(r, delay));
              if (aborted) return;
              c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`));
            }
            c.enqueue(enc.encode('data: [DONE]\n\n'));
            c.close();
          },
        });
      const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      window.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        window.__chat.requests.push(body);
        const mode = window.__chat.mode;
        if (mode === 'error') return json(401, { error: { message: 'Incorrect API key provided.' } });
        if (mode === 'no-stream') {
          if (body.stream) return json(400, { error: { message: 'Your organization must be verified to stream this model.' } });
          return json(200, { choices: [{ message: { content: 'Answered without streaming: a **tenant** holds identities.' } }] });
        }
        if (mode === 'slow') return new Response(sse(['First part. ', 'Second part. ', 'Third part. ', 'Fourth part.'], 400, init.signal), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        return new Response(sse(['A **tenant** is ', 'a dedicated instance ', 'of Entra ID [0:21]. ', 'Each subscription trusts one tenant [0:44].'], 0, init.signal), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      };
    });
    const messagesOf = (noteId) => panel.evaluate((noteId) => new Promise((res) => {
      const r = indexedDB.open('toru');
      r.onsuccess = () => { const q = r.result.transaction('messages').objectStore('messages').index('noteId').getAll(noteId); q.onsuccess = () => res(q.result.sort((a, b) => a.index - b.index)); };
    }), noteId);
    const clickTab = (name) => lib.evaluate((name) => [...document.querySelectorAll('[role=tab]')].find((b) => b.textContent.trim().startsWith(name)).click(), name);
    const askRequests = () => lib.evaluate(() => window.__chat.requests);
    const setMode = (mode) => lib.evaluate((mode) => (window.__chat.mode = mode), mode);

    await clickTab('Ask');
    await sleep(300);
    const suggestions = await lib.evaluate(() => [...document.querySelectorAll('.chat-suggestion')].map((b) => b.textContent));
    check(suggestions.length === 4, `Ask tab offers starter questions (${suggestions.join(' | ')})`);
    await shot(lib, '18-ask-empty');
    await lib.evaluate(() => [...document.querySelectorAll('.chat-suggestion')].find((b) => b.textContent.startsWith('Explain')).click());
    await lib.waitForFunction(() => [...document.querySelectorAll('.msg-ai .md')].at(-1)?.textContent.includes('trusts one tenant'), { timeout: 10000 });
    let req = (await askRequests()).at(-1);
    check(req.stream === true && req.model === 'gpt-5-mini', 'question is streamed with the chosen model');
    check(req.messages[0].role === 'system' && req.messages[0].content.includes('## Transcript') && req.messages[0].content.includes('[0:21] Every organisation') && req.messages[0].content.includes('## Study notes'), 'the lecture (study notes + timestamped transcript) is sent as context');
    check(req.messages.at(-1).role === 'user' && req.messages.at(-1).content === 'Explain the main idea simply', 'the question is the last message');
    await sleep(400);
    let saved = await messagesOf('n1');
    check(saved.length === 2 && saved[1].role === 'assistant' && saved[1].content.includes('dedicated instance'), 'question and streamed answer are saved');

    await lib.type('.chat-composer textarea', 'And how many tenants can a subscription trust?');
    await lib.keyboard.press('Enter');
    await lib.waitForFunction(() => document.querySelectorAll('.msg-ai .md').length >= 2, { timeout: 10000 });
    await sleep(400);
    req = (await askRequests()).at(-1);
    check(req.messages.length === 4 && req.messages[2].role === 'assistant' && req.messages[3].content.startsWith('And how many'), 'follow-up questions carry the conversation');
    await shot(lib, '19-ask-conversation');

    await setMode('no-stream');
    await lib.type('.chat-composer textarea', 'Summarise that in one line');
    await lib.keyboard.press('Enter');
    await lib.waitForFunction(() => [...document.querySelectorAll('.msg-ai .md')].at(-1)?.textContent.includes('without streaming'), { timeout: 10000 });
    const reqs = await askRequests();
    check(reqs.at(-2).stream === true && !reqs.at(-1).stream, 'falls back to a normal request when streaming isn’t allowed');

    await setMode('error');
    await lib.type('.chat-composer textarea', 'One more?');
    await lib.keyboard.press('Enter');
    await lib.waitForFunction(() => document.querySelector('.chat .callout-error'), { timeout: 10000 });
    check((await lib.$eval('.chat .callout-error', (e) => e.textContent)).includes('Incorrect API key'), 'errors are shown in the conversation');
    await setMode('stream');
    await lib.evaluate(() => [...document.querySelectorAll('.chat .callout-error button')].find((b) => b.textContent.includes('Try again')).click());
    await lib.waitForFunction(() => !document.querySelector('.chat .callout-error') && [...document.querySelectorAll('.msg-ai .md')].at(-1)?.textContent.includes('trusts one tenant'), { timeout: 10000 });
    saved = await messagesOf('n1');
    check(saved.filter((m) => m.error).length === 0 && saved.at(-2).content === 'One more?' && saved.length === 8, `Try again replaces the failed answer (${saved.length} messages)`);

    await setMode('slow');
    await lib.type('.chat-composer textarea', 'Tell me everything');
    await lib.keyboard.press('Enter');
    await lib.waitForFunction(() => [...document.querySelectorAll('.msg-ai .md')].at(-1)?.textContent.includes('Second part'), { timeout: 10000 });
    await lib.click('.chat-send.stop');
    await sleep(800);
    saved = await messagesOf('n1');
    check(saved.at(-1).stopped === true && saved.at(-1).content.includes('Second part') && !saved.at(-1).content.includes('Fourth'), 'Stop keeps the partial answer, marked as stopped');

    await lib.evaluate(() => [...document.querySelectorAll('.chat-foot button')].find((b) => b.textContent.includes('Clear chat')).click());
    await sleep(300);
    await lib.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'Clear chat').click());
    await sleep(500);
    check((await messagesOf('n1')).length === 0, 'Clear chat removes the conversation');

    // ------------------------------------------------------ light / dark
    const bgOf = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await lib.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await sleep(300);
    check((await bgOf(lib)) === 'rgb(252, 252, 250)', `System theme: a light system gives the light theme (${await bgOf(lib)})`);
    await lib.goto(`chrome-extension://${extId}/library.html`, { waitUntil: 'networkidle0' });
    await shot(lib, '20-light-library-home');
    await lib.goto(`chrome-extension://${extId}/library.html#/note/n1`, { waitUntil: 'networkidle0' });
    await shot(lib, '21-light-note-summary');
    await panel.setViewport({ width: 400, height: 900, deviceScaleFactor: 1 });
    await shot(panel, '22-light-sidepanel');

    await lib.evaluate(() => [...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes('Settings')).click());
    await sleep(400);
    await lib.evaluate(() => [...document.querySelectorAll('.modal [role=radio]')].find((b) => b.textContent === 'Dark').click());
    await sleep(500);
    check((await lib.evaluate(() => document.documentElement.dataset.theme)) === 'dark' && (await bgOf(lib)) === 'rgb(17, 17, 15)', 'choosing Dark overrides a light system theme');
    await sleep(300);
    check((await panel.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'the theme change reaches other open TORU pages');
    await lib.evaluate(() => [...document.querySelectorAll('.modal [role=radio]')].find((b) => b.textContent === 'Light').click());
    await sleep(400);

    // Model field suggestions (custom list, not the browser's).
    await lib.click('#tmodel', { count: 3 });
    await lib.keyboard.type('whis');
    await sleep(250);
    const modelOptions = await lib.evaluate(() => [...document.querySelectorAll('[role="listbox"] [role="option"]')].map((o) => o.querySelector('.option-label').textContent));
    check(modelOptions.length === 1 && modelOptions[0] === 'whisper-1', `model suggestions filter as you type (${modelOptions.join(', ')})`);
    await shot(lib, '23-light-settings');
    await lib.keyboard.press('Enter');
    check((await lib.$eval('#tmodel', (e) => e.value)) === 'whisper-1', 'Enter picks the suggestion');
    await lib.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'Cancel').click());
    await sleep(300);
    const savedTheme = (await readDb('meta', 'settings')).value;
    check(savedTheme.theme === 'light' && savedTheme.transcribeModel !== 'whisper-1', 'theme saves straight away; other fields only on Save');
  } catch (e) {
    failures++;
    console.error('ERROR', e);
  } finally {
    console.log('\nconsole errors/warnings:', errors.length ? '\n  ' + errors.join('\n  ') : 'none');
    console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
    await browser.close();
    process.exitCode = failures ? 1 : 0;
  }
})();
