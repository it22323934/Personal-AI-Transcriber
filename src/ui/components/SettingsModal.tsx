import { useEffect, useRef, useState } from 'react';
import { downloadFile } from '../../lib/export';
import { errorMessage, formatBytes } from '../../lib/format';
import { listModels } from '../../lib/openai';
import { discardAudio } from '../../lib/pipeline';
import { DEFAULT_SUMMARY_PROMPT } from '../../lib/prompts';
import * as store from '../../lib/store';
import type { Settings, ThemePreference } from '../../lib/types';
import { IconCheck, IconDownload, IconEye, IconEyeOff, IconUpload } from '../icons';
import { toast } from '../toast';
import { applyTheme } from '../theme';
import { LANGUAGES } from './languages';
import { Modal, useConfirm } from './Modal';
import { ComboInput, Select } from './Select';

const TRANSCRIBE_MODELS = [
  { value: 'gpt-4o-mini-transcribe', description: 'Fast and low cost (default)' },
  { value: 'gpt-4o-transcribe', description: 'Most accurate, about twice the cost' },
  { value: 'whisper-1', description: 'The original Whisper model' },
];
const SUMMARY_MODELS = [
  { value: 'gpt-5-mini', description: 'Balanced quality and cost (default)' },
  { value: 'gpt-5', description: 'Best answers, slower and pricier' },
  { value: 'gpt-5-nano', description: 'Cheapest, fine for short lectures' },
  { value: 'gpt-4.1-mini', description: 'Fast, no reasoning step' },
  { value: 'gpt-4.1', description: 'Strong, no reasoning step' },
  { value: 'gpt-4o-mini', description: 'Older and cheap' },
];
const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function SettingsModal({ initial, onClose }: { initial: Settings; onClose: () => void }) {
  const [draft, setDraft] = useState<Settings>(initial);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<{ state: 'idle' | 'testing' | 'ok' | 'fail'; message?: string }>({ state: 'idle' });
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const usage = useStorageUsage();
  const { confirm, element: confirmEl } = useConfirm();

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function testKey() {
    setTest({ state: 'testing' });
    try {
      const models = await listModels(draft.apiKey.trim());
      const missing = [draft.transcribeModel, draft.summaryModel].filter((m) => !models.includes(m));
      setTest({
        state: 'ok',
        message: missing.length
          ? `Key works, but this account can’t see: ${missing.join(', ')}.`
          : 'Key works. Both models are available.',
      });
    } catch (e) {
      setTest({ state: 'fail', message: errorMessage(e) });
    }
  }

  async function save() {
    setSaving(true);
    try {
      await store.saveSettings({
        ...draft,
        apiKey: draft.apiKey.trim(),
        transcribeModel: draft.transcribeModel.trim() || store.DEFAULT_SETTINGS.transcribeModel,
        summaryModel: draft.summaryModel.trim() || store.DEFAULT_SETTINGS.summaryModel,
      });
      toast('Settings saved');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function exportData() {
    const backup = await store.exportBackup();
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(`toru-backup-${date}.json`, JSON.stringify(backup, null, 2), 'application/json');
  }

  async function importData(file: File) {
    try {
      const result = await store.importBackup(JSON.parse(await file.text()));
      toast(`Imported ${result.notes} notes in ${result.projects} projects`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function discardWaiting() {
    if (!usage) return;
    const ok = await confirm({
      title: 'Discard all waiting audio?',
      message: `${formatBytes(usage.backlog.bytes)} of audio from ${usage.backlog.noteIds.length} lecture(s) couldn’t be transcribed yet. Their existing transcripts are kept; the audio can’t be retried afterwards. A recording in progress isn’t touched.`,
      confirmLabel: 'Discard audio',
      danger: true,
    });
    if (!ok) return;
    try {
      const n = await discardAudio();
      toast(`Discarded waiting audio from ${n} lecture${n === 1 ? '' : 's'}`);
      usage.refresh();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <>
    <Modal
      title="Settings"
      subtitle="Everything is stored locally in this Chrome profile."
      onClose={onClose}
      width={600}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </>
      }
    >
      <section className="modal-section">
        <h3>Appearance</h3>
        <div className="field">
          <div className="seg" role="radiogroup" aria-label="Theme" style={{ justifySelf: 'start' }}>
            {THEMES.map((t) => (
              <button
                key={t.value}
                role="radio"
                aria-selected={draft.theme === t.value}
                aria-checked={draft.theme === t.value}
                onClick={() => {
                  // Applies straight away, so you can see it before saving the rest.
                  set('theme', t.value);
                  applyTheme(t.value);
                  void store.saveSettings({ theme: t.value });
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="field-hint">System follows your Windows light or dark setting.</div>
        </div>
      </section>

      <section className="modal-section">
        <h3>OpenAI</h3>
        <div className="field">
          <label htmlFor="apiKey">API key</label>
          <div className="row">
            <div className="grow" style={{ position: 'relative' }}>
              <input
                id="apiKey"
                className="input mono"
                type={showKey ? 'text' : 'password'}
                placeholder="sk-…"
                autoComplete="off"
                spellCheck={false}
                value={draft.apiKey}
                onChange={(e) => {
                  set('apiKey', e.target.value);
                  setTest({ state: 'idle' });
                }}
                style={{ paddingRight: 40 }}
              />
              <button
                className="icon-btn"
                style={{ position: 'absolute', right: 3, top: 3 }}
                onClick={() => setShowKey((s) => !s)}
                aria-label={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
            <button className="btn" onClick={testKey} disabled={!draft.apiKey.trim() || test.state === 'testing'}>
              {test.state === 'testing' ? 'Testing…' : 'Test'}
            </button>
          </div>
          {test.message && (
            <div className={`callout ${test.state === 'ok' ? 'callout-lime' : 'callout-error'}`}>
              {test.state === 'ok' && <IconCheck />}
              <div className="callout-body">{test.message}</div>
            </div>
          )}
          <div className="field-hint">
            Create one at{' '}
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
              platform.openai.com/api-keys
            </a>
            . It’s only sent to api.openai.com.
          </div>
        </div>
      </section>

      <section className="modal-section">
        <h3>Transcription</h3>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="tmodel">Model</label>
            <ComboInput
              id="tmodel"
              value={draft.transcribeModel}
              onChange={(v) => set('transcribeModel', v)}
              suggestions={TRANSCRIBE_MODELS}
            />
          </div>
          <div className="field">
            <label htmlFor="lang">Default language</label>
            <Select
              id="lang"
              ariaLabel="Default language"
              value={draft.language}
              options={LANGUAGES.map(([code, label]) => ({ value: code, label }))}
              onChange={(v) => set('language', v)}
            />
          </div>
        </div>
        <div className="field-hint">
          gpt-4o-mini-transcribe is cheap and accurate. gpt-4o-transcribe is a little more accurate and costs about
          twice as much. Setting the language helps with short or noisy clips.
        </div>
        <label className="switch">
          <input type="checkbox" checked={draft.autoSplit} onChange={(e) => set('autoSplit', e.target.checked)} />
          <span className="switch-text">
            <strong>New note per page</strong>
            <span className="field-hint">
              When the recorded tab moves to another page (e.g. “Complete and Continue”), finish the current note and
              start a new one automatically.
            </span>
          </span>
        </label>
      </section>

      <section className="modal-section">
        <h3>While recording</h3>
        <div className="field">
          <span className="field-label">Follow along in</span>
          <div className="seg" role="radiogroup" aria-label="Recording view" style={{ justifySelf: 'start' }}>
            <button
              role="radio"
              aria-selected={draft.recordingView === 'panel'}
              aria-checked={draft.recordingView === 'panel'}
              onClick={() => set('recordingView', 'panel')}
            >
              Side panel
            </button>
            <button
              role="radio"
              aria-selected={draft.recordingView === 'mini'}
              aria-checked={draft.recordingView === 'mini'}
              onClick={() => set('recordingView', 'mini')}
            >
              Mini player on the page
            </button>
          </div>
          <div className="field-hint">
            The mini player is a small bar on the lecture page with the timer, pause and stop. Click it to see the live
            transcript. You can switch views any time while recording; TORU remembers the one you used last.
          </div>
        </div>
      </section>

      <section className="modal-section">
        <h3>Study notes and questions</h3>
        <div className="field">
          <label htmlFor="smodel">Model</label>
          <ComboInput
            id="smodel"
            value={draft.summaryModel}
            onChange={(v) => set('summaryModel', v)}
            suggestions={SUMMARY_MODELS}
          />
          <div className="field-hint">Used for the study notes and for answering your questions in the Ask tab.</div>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={draft.autoSummarize}
            onChange={(e) => set('autoSummarize', e.target.checked)}
          />
          <span className="switch-text">
            <strong>AI study notes when a recording stops</strong>
            <span className="field-hint">
              The default for new recordings. Each summary uses your OpenAI credits; turn this off to keep just the
              transcript. You can switch it per recording, and write notes for any lecture later.
            </span>
          </span>
        </label>
        <div className="field">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label htmlFor="prompt" className="field-label">
              Default instructions
            </label>
            {draft.summaryPrompt !== DEFAULT_SUMMARY_PROMPT && (
              <button className="btn btn-ghost btn-sm" onClick={() => set('summaryPrompt', DEFAULT_SUMMARY_PROMPT)}>
                Reset to default
              </button>
            )}
          </div>
          <textarea
            id="prompt"
            className="input mono"
            rows={9}
            style={{ fontSize: 12 }}
            value={draft.summaryPrompt}
            onChange={(e) => set('summaryPrompt', e.target.value)}
          />
          <div className="field-hint">Projects can override this with their own instructions.</div>
        </div>
      </section>

      <section className="modal-section">
        <h3>Your data</h3>
        <div className="field-hint" style={{ marginTop: -6 }}>
          Notes live inside this extension’s storage. <strong>Removing the extension deletes them</strong>, so export a
          backup first. (Reloading or updating it is safe.)
        </div>
        {usage && (
          <div className="callout">
            <div className="callout-body">
              <span>
                TORU is using <strong>{formatBytes(usage.bytes)}</strong> in this browser.{' '}
                {usage.backlog.chunks
                  ? `${formatBytes(usage.backlog.bytes)} of that is audio from ${usage.backlog.noteIds.length} lecture${usage.backlog.noteIds.length === 1 ? '' : 's'} still waiting to be transcribed.`
                  : 'No audio is waiting to be transcribed. Audio is deleted as soon as it has been transcribed.'}
              </span>
              {usage.backlog.chunks > 0 && (
                <div className="callout-actions">
                  <button className="btn btn-sm btn-danger" onClick={discardWaiting}>
                    Discard waiting audio
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        <div className="row">
          <button className="btn btn-sm" onClick={exportData}>
            <IconDownload size={14} /> Export backup
          </button>
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
            <IconUpload size={14} /> Import backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importData(file);
              e.target.value = '';
            }}
          />
        </div>
      </section>
    </Modal>
    {confirmEl}
    </>
  );
}

function useStorageUsage() {
  const [usage, setUsage] = useState<{ bytes: number; backlog: Awaited<ReturnType<typeof store.audioBacklog>> }>();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    Promise.all([navigator.storage.estimate(), store.audioBacklog()]).then(
      ([estimate, backlog]) => alive && setUsage({ bytes: estimate.usage ?? 0, backlog }),
      console.error,
    );
    return () => {
      alive = false;
    };
  }, [version]);
  return usage && { ...usage, refresh: () => setVersion((v) => v + 1) };
}
