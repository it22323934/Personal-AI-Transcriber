// Loads dist/ into your installed Chrome (throwaway profile), seeds data, screenshots
// every view and runs a full recording with a synthetic audio stream and a mocked
// OpenAI API. usage: npm run test:e2e   (CHROME_PATH overrides the browser path)
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const EXT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
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
      page.on('console', (m) => (m.type() === 'error' || m.type() === 'warn') && errors.push(`[${file}] ${m.text()}`));
      page.on('pageerror', (e) => errors.push(`[${file}] pageerror: ${e.message}`));
      await page.goto(`chrome-extension://${extId}/${file}`, { waitUntil: 'networkidle0' });
      await page.evaluate(() => document.fonts.ready);
      await sleep(400);
      return page;
    }
    const shot = async (page, name, full = false) => {
      await sleep(350);
      await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
    };

    // ---------------------------------------------------------------- UI
    const lib = await openPage('library.html', 1440, 960);
    await shot(lib, '01-library-first-run');
    const inbox = await lib.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('toru', 1);
      r.onsuccess = () => { const q = r.result.transaction('projects').objectStore('projects').get('inbox'); q.onsuccess = () => res(q.result); };
    }));
    check(inbox && inbox.name === 'Inbox', 'Inbox project created on first run');

    await lib.evaluate(async (seed) => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('toru', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
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
      const r = indexedDB.open('toru', 1);
      r.onsuccess = () => { const q = r.result.transaction('notes').objectStore('notes').get('n2'); q.onsuccess = () => res(q.result); };
    }));
    check(renamed.title === 'Exploring the Entra admin centre' && renamed.titleEdited === true, 'renaming a note persists and marks titleEdited');

    const panel = await openPage('sidepanel.html', 400, 900);
    await shot(panel, '10-sidepanel-idle');

    // ----------------------------------------------------- recording flow
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

    const send = (msg) => sw.evaluate((m) => chrome.runtime.sendMessage(m), msg);
    const readDb = (store, key) => panel.evaluate((store, key) => new Promise((res) => {
      const r = indexedDB.open('toru', 1);
      r.onsuccess = () => { const q = r.result.transaction(store).objectStore(store).get(key); q.onsuccess = () => res(q.result); };
    }), store, key);
    const segmentsOf = (noteId) => panel.evaluate((noteId) => new Promise((res) => {
      const r = indexedDB.open('toru', 1);
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
      const r = indexedDB.open('toru', 1);
      r.onsuccess = () => { const tx = r.result.transaction(['meta', 'notes'], 'readwrite'); tx.objectStore('meta').put({ key: 'recording', value: { noteId: 'n4', projectId: 'p-net', tabId: 1, pageKey: 'x', paused: false, elapsedMs: 0, runningSince: Date.now() } }); tx.oncomplete = res; };
    }));
    await panel.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'GET_STATE' }));
    check((await readDb('meta', 'recording')) === undefined, 'stale recording state cleared by GET_STATE');

    // Starting without tab permission gives a friendly error.
    const tab = await browser.newPage();
    const htmlPath = path.join(OUT, 'video.html');
    fs.writeFileSync(htmlPath, '<title>Some video</title><h1>hi</h1>');
    await tab.goto('file:///' + htmlPath.replace(/\\/g, '/'));
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0]?.id);
    const denied = await panel.evaluate((tabId) => chrome.runtime.sendMessage({ target: 'background', type: 'START', tabId, projectId: 'p-entra' }), tabId);
    check(denied && denied.ok === false, `START without permission fails cleanly: “${denied && denied.error}”`);
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
