import { useState } from 'react';
import { errorMessage } from '../../lib/format';
import * as store from '../../lib/store';
import type { Project } from '../../lib/types';
import { toast } from '../toast';
import { LANGUAGES } from './languages';
import { Modal, useConfirm } from './Modal';
import { Select } from './Select';

/** Create a project (no `project`) or edit an existing one. */
export function ProjectModal(props: {
  project?: Project;
  onClose: () => void;
  onSaved?: (project: Project) => void;
  onDeleted?: () => void;
}) {
  const editing = props.project;
  const isInbox = editing?.id === store.INBOX_ID;
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [vocabulary, setVocabulary] = useState(editing?.vocabulary ?? '');
  const [language, setLanguage] = useState(editing?.language ?? '');
  const [summaryPrompt, setSummaryPrompt] = useState(editing?.summaryPrompt ?? '');
  const [color, setColor] = useState(editing?.color ?? '');
  const [advanced, setAdvanced] = useState(!!editing?.summaryPrompt);
  const [saving, setSaving] = useState(false);
  const { confirm, element: confirmEl } = useConfirm();

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const fields = {
        name: name.trim(),
        description: description.trim(),
        vocabulary: vocabulary.trim(),
        language,
        summaryPrompt: summaryPrompt.trim(),
        ...(color ? { color } : {}),
      };
      if (editing) {
        await store.updateProject(editing.id, fields);
        props.onSaved?.({ ...editing, ...fields });
      } else {
        props.onSaved?.(await store.createProject(fields));
      }
      props.onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing) return;
    const ok = await confirm({
      title: `Delete “${editing.name}”?`,
      message: 'The project is removed and its notes move to the Inbox. Nothing else is deleted.',
      confirmLabel: 'Delete project',
      danger: true,
    });
    if (!ok) return;
    await store.deleteProject(editing.id);
    props.onDeleted?.();
    props.onClose();
  }

  return (
    <>
      <Modal
        title={editing ? 'Edit project' : 'New project'}
        subtitle={editing ? undefined : 'Group the lectures of one course or topic, e.g. “Entra ID”.'}
        onClose={props.onClose}
        footer={
          <>
            {editing && !isInbox && (
              <button className="btn btn-danger btn-sm" onClick={remove}>
                Delete
              </button>
            )}
            <span className="spacer" />
            <button className="btn btn-ghost" onClick={props.onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!name.trim() || saving}>
              {editing ? 'Save' : 'Create project'}
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="pname">Name</label>
          <input
            id="pname"
            className="input"
            placeholder="Entra ID"
            value={name}
            disabled={isInbox}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </div>
        <div className="field">
          <label htmlFor="pdesc">What is it about?</label>
          <input
            id="pdesc"
            className="input"
            placeholder="AZ-104 Azure Administrator exam prep — identity section"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="field-hint">Given to the AI as context when it writes your notes.</div>
        </div>
        <div className="field">
          <label htmlFor="pvocab">Vocabulary</label>
          <textarea
            id="pvocab"
            className="input"
            rows={2}
            placeholder="Entra ID, RBAC, Conditional Access, tenant, PIM, B2B, managed identity"
            value={vocabulary}
            onChange={(e) => setVocabulary(e.target.value)}
          />
          <div className="field-hint">Names and jargon the transcriber should spell correctly, separated by commas.</div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="plang">Spoken language</label>
            <Select
              id="plang"
              ariaLabel="Spoken language"
              value={language}
              options={LANGUAGES.map(([code, label]) => ({ value: code, label: code ? label : 'Use default' }))}
              onChange={setLanguage}
            />
          </div>
          {!isInbox && (
            <div className="field">
              <span className="field-label">Colour</span>
              <div className="swatches" style={{ height: 38, alignItems: 'center' }}>
                {store.PROJECT_COLORS.map((c) => (
                  <button
                    key={c}
                    className="swatch"
                    style={{ background: c }}
                    aria-label={`Colour ${c}`}
                    aria-pressed={(color || editing?.color) === c}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
        {advanced ? (
          <div className="field">
            <label htmlFor="pprompt">Custom summary instructions</label>
            <textarea
              id="pprompt"
              className="input mono"
              rows={7}
              style={{ fontSize: 12 }}
              placeholder="Leave empty to use the default instructions from Settings."
              value={summaryPrompt}
              onChange={(e) => setSummaryPrompt(e.target.value)}
            />
          </div>
        ) : (
          <button className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={() => setAdvanced(true)}>
            Customise summary instructions…
          </button>
        )}
      </Modal>
      {confirmEl}
    </>
  );
}
