import { useRef, useState } from 'react';
import { downloadFile } from '../../lib/export';
import { errorMessage } from '../../lib/format';
import { listModels } from '../../lib/openai';
import { DEFAULT_SUMMARY_PROMPT } from '../../lib/prompts';
import * as store from '../../lib/store';
import type { Settings } from '../../lib/types';
import { IconCheck, IconDownload, IconEye, IconEyeOff, IconUpload } from '../icons';
import { toast } from '../toast';
import { LANGUAGES } from './languages';
import { Modal } from './Modal';

const TRANSCRIBE_MODELS = ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'];
const SUMMARY_MODELS = ['gpt-5-mini', 'gpt-5', 'gpt-5-nano', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini'];

export function SettingsModal({ initial, onClose }: { initial: Settings; onClose: () => void }) {
  const [draft, setDraft] = useState<Settings>(initial);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<{ state: 'idle' | 'testing' | 'ok' | 'fail'; message?: string }>({ state: 'idle' });
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
    downloadFile(`earmark-backup-${date}.json`, JSON.stringify(backup, null, 2), 'application/json');
  }

  async function importData(file: File) {
    try {
      const result = await store.importBackup(JSON.parse(await file.text()));
      toast(`Imported ${result.notes} notes in ${result.projects} projects`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
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
            <input
              id="tmodel"
              className="input"
              list="transcribe-models"
              value={draft.transcribeModel}
              onChange={(e) => set('transcribeModel', e.target.value)}
            />
            <datalist id="transcribe-models">
              {TRANSCRIBE_MODELS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="lang">Default language</label>
            <select id="lang" className="input" value={draft.language} onChange={(e) => set('language', e.target.value)}>
              {LANGUAGES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
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
        <h3>Study notes</h3>
        <div className="field">
          <label htmlFor="smodel">Model</label>
          <input
            id="smodel"
            className="input"
            list="summary-models"
            value={draft.summaryModel}
            onChange={(e) => set('summaryModel', e.target.value)}
          />
          <datalist id="summary-models">
            {SUMMARY_MODELS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={draft.autoSummarize}
            onChange={(e) => set('autoSummarize', e.target.checked)}
          />
          <span className="switch-text">
            <strong>Write notes automatically</strong>
            <span className="field-hint">Generate the summary as soon as a recording stops.</span>
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
  );
}
