// The "Ask" tab: a conversation about one lecture, grounded in its transcript,
// with a context meter, warnings when the conversation outgrows what's sent,
// and compaction of older messages.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildLecture, planAsk, SUGGESTED_QUESTIONS, tokensPerChar, type AskPlan } from '../../lib/chat';
import { errorMessage } from '../../lib/format';
import { formatTokens } from '../../lib/models';
import * as store from '../../lib/store';
import type { ChatMessage, Note, Project, Segment } from '../../lib/types';
import { startAsk, startCompact, stopAsk, useAskJob } from '../askJobs';
import { useLive, useSettings } from '../hooks';
import { IconCopy, IconRefresh, IconSparkle, IconStop } from '../icons';
import { Markdown } from '../Markdown';
import { toast } from '../toast';
import { useConfirm } from './Modal';
import { Select } from './Select';

const WARN_SHARE = 0.7;
const FULL_SHARE = 0.9;

function IconSend({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

/** Keeps the newest message in view while it's being written, unless the user scrolled up. */
function useStickToBottom(trigger: unknown) {
  const nearBottom = useRef(true);
  useEffect(() => {
    const onScroll = () => {
      const el = document.scrollingElement;
      if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useLayoutEffect(() => {
    const el = document.scrollingElement;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [trigger]);
}

const lastCompactionAt = (messages: ChatMessage[]) => messages.findLastIndex((m) => m.kind === 'compaction');

export function ChatPanel(props: { note: Note; project?: Project; segments: Segment[] }) {
  const { note, project, segments } = props;
  const hasTranscript = segments.length > 0;
  const messages = useLive(
    () => store.getMessages(note.id),
    [note.id],
    (e) => e.type === 'messages' && e.noteId === note.id,
  );
  const job = useAskJob(note.id);
  const settings = useSettings();
  const [draft, setDraft] = useState('');
  const [showSummary, setShowSummary] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const { confirm, element: confirmEl } = useConfirm();
  const model = settings?.summaryModel ?? 'gpt-5-mini';

  useStickToBottom(`${messages?.length ?? 0}|${job?.text.length ?? -1}|${job?.status}`);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, [draft]);

  // The lecture text is the big part; build it once per change, not per keystroke.
  const ratio = useMemo(() => tokensPerChar(messages ?? [], segments), [messages, segments]);
  const lecture = useMemo(() => buildLecture(note, project, segments, model, ratio), [note, project, segments, model, ratio]);
  const plan = useMemo(
    () => (messages ? planAsk({ note, project, segments, messages, model, draft, lecture }) : undefined),
    [note, project, segments, messages, model, draft, lecture],
  );

  const busy = !!job;
  const send = (text: string) => {
    const q = text.trim();
    if (!q || busy || !hasTranscript) return;
    if (!settings?.apiKey) {
      toast('Add your OpenAI API key in Settings to ask questions.', 'error');
      return;
    }
    setDraft('');
    startAsk(note.id, q);
  };

  const compact = () => {
    if (!settings?.apiKey) {
      toast('Add your OpenAI API key in Settings first.', 'error');
      return;
    }
    startCompact(note.id, (message) => toast(`Couldn’t compact: ${message}`, 'error'));
  };

  const setNotesOnly = (on: boolean) => void store.updateNote(note.id, { askContext: on ? 'notes' : 'transcript' });

  const clear = async () => {
    const ok = await confirm({
      title: 'Clear this conversation?',
      message: 'All questions and answers for this lecture are deleted. The transcript and notes are kept.',
      confirmLabel: 'Clear chat',
      danger: true,
    });
    if (ok) await store.deleteMessages(note.id);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Answer copied');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  if (!messages || !plan) return null;
  const last = messages.at(-1);
  const unanswered = !busy && last?.role === 'user';
  const empty = messages.length === 0 && !busy;
  const ci = lastCompactionAt(messages);
  const compaction = ci >= 0 ? messages[ci] : undefined;
  const earlier = ci >= 0 ? messages.slice(0, ci).filter((m) => m.kind !== 'compaction') : [];
  const recent = messages.slice(ci + 1);
  const canCompact = plan.compactable >= 2 && !busy;
  const canUseNotes = !!note.summary?.trim() && !plan.notesOnly;

  return (
    <div className="chat">
      {empty ? (
        <div className="chat-empty">
          <span className="chat-empty-icon">
            <IconSparkle size={18} />
          </span>
          <h3>Ask about this lecture</h3>
          <p>
            {hasTranscript
              ? 'Answers come from the transcript and your notes, with times like [4:20] so you can find the moment. Follow-up questions remember the conversation.'
              : 'Questions open up once the transcript has a few lines.'}
          </p>
          {hasTranscript && (
            <div className="chat-suggestions">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button key={q} className="chip chat-suggestion" onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="chat-log" aria-live="polite">
          {showEarlier &&
            earlier.map((m) => (
              <div key={m.index} className="msg-earlier">
                <Message message={m} onCopy={copy} onRetry={() => {}} canRetry={false} />
              </div>
            ))}
          {compaction && (
            <div className="compaction">
              <div className="compaction-line">
                <span>
                  {compaction.covers ?? earlier.length} earlier message{(compaction.covers ?? earlier.length) === 1 ? '' : 's'} compacted
                </span>
              </div>
              <div className="compaction-actions">
                <button className="link-quiet" onClick={() => setShowSummary((s) => !s)}>
                  {showSummary ? 'Hide summary' : 'Show summary'}
                </button>
                {earlier.length > 0 && (
                  <button className="link-quiet" onClick={() => setShowEarlier((s) => !s)}>
                    {showEarlier ? 'Hide messages' : 'Show messages'}
                  </button>
                )}
              </div>
              {showSummary && (
                <div className="compaction-summary">
                  <Markdown text={compaction.content} />
                </div>
              )}
            </div>
          )}
          {recent.map((m) => (
            <Message key={m.index} message={m} onCopy={copy} onRetry={() => startAsk(note.id)} canRetry={!busy && m === last} />
          ))}
          {job?.status === 'compacting' && (
            <div className="row faint" style={{ fontSize: 13 }}>
              <span className="spinner" /> Compacting the conversation…
            </div>
          )}
          {job?.status === 'answering' && (
            <div className="msg msg-ai">{job.text ? <Markdown text={job.text} /> : <Thinking />}</div>
          )}
          {unanswered && (
            <div className="callout">
              <div className="callout-body">
                <span>This question hasn’t been answered yet.</span>
                <div className="callout-actions">
                  <button className="btn btn-sm" onClick={() => startAsk(note.id)}>
                    <IconRefresh size={13} /> Ask again
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <ContextWarning
        plan={plan}
        model={model}
        autoCompact={!!settings?.autoCompact}
        onCompact={canCompact ? compact : undefined}
        onNotesOnly={canUseNotes ? () => setNotesOnly(true) : undefined}
      />

      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <textarea
          ref={input}
          rows={1}
          aria-label="Ask a question about this lecture"
          placeholder={hasTranscript ? 'Ask a question about this lecture…' : 'Waiting for the transcript…'}
          disabled={!hasTranscript}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(draft);
            }
          }}
        />
        {busy ? (
          <button type="button" className="chat-send stop" onClick={() => stopAsk(note.id)} aria-label="Stop" title="Stop">
            <IconStop size={13} />
          </button>
        ) : (
          <button type="submit" className="chat-send" disabled={!draft.trim() || !hasTranscript} aria-label="Send" title="Send (Enter) · Shift+Enter for a new line">
            <IconSend />
          </button>
        )}
      </form>
      <div className="chat-foot">
        <ContextMeter plan={plan} model={model} messages={messages} />
        <div className="chat-foot-actions">
          {note.summary?.trim() && (
            <Select
              variant="chip"
              ariaLabel="What the AI reads"
              title="What the AI reads for each question"
              value={plan.notesOnly ? 'notes' : 'transcript'}
              options={[
                { value: 'transcript', label: 'Full transcript', description: 'Best answers, can cite times' },
                { value: 'notes', label: 'Study notes only', description: 'Much cheaper for long lectures' },
              ]}
              onChange={(v) => setNotesOnly(v === 'notes')}
              listMinWidth={240}
            />
          )}
          {canCompact && (
            <button className="link-quiet" onClick={compact} title={`Summarise the ${plan.compactable} older messages so later questions send less`}>
              Compact
            </button>
          )}
          {messages.length > 0 && !busy && (
            <button className="link-quiet" onClick={clear}>
              Clear chat
            </button>
          )}
        </div>
      </div>
      {confirmEl}
    </div>
  );
}

function ContextMeter({ plan, model, messages }: { plan: AskPlan; model: string; messages: ChatMessage[] }) {
  const pct = Math.round(plan.share * 100);
  const level = plan.share >= FULL_SHARE ? 'full' : plan.share >= WARN_SHARE ? 'warn' : 'ok';
  const lastUsage = [...messages].reverse().find((m) => m.usage)?.usage;
  const details = [
    `Each question sends about ${formatTokens(plan.estimatedTokens)} tokens to ${model}:`,
    `• the lecture: ${formatTokens(plan.lectureTokens)} (${plan.notesOnly ? 'study notes only' : 'with the full transcript'})`,
    `• the conversation: ${formatTokens(plan.historyTokens)}`,
    `A request to ${model} can hold ${formatTokens(plan.limit)} tokens${plan.limitKnown ? '' : ' (unknown model, so a cautious limit is assumed)'}.`,
    lastUsage
      ? `Last answer: ${lastUsage.prompt.toLocaleString()} tokens in (${lastUsage.cached.toLocaleString()} cached, billed at a discount), ${lastUsage.completion.toLocaleString()} out.`
      : '',
    'Uses your OpenAI credits.',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <div className={`ask-meter ${level}`} title={details} aria-label={details}>
      <span className="meter-bar" aria-hidden="true">
        <span style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
      </span>
      <span>
        ≈{formatTokens(plan.estimatedTokens)} tokens per question · {pct < 1 ? '<1' : pct}% of {model}
      </span>
      {lastUsage && (
        <span className="faint">
          · last {formatTokens(lastUsage.prompt)} in{lastUsage.cached ? ` (${formatTokens(lastUsage.cached)} cached)` : ''}
        </span>
      )}
    </div>
  );
}

/** One warning at a time, most serious first, each with the action that fixes it. */
function ContextWarning(props: {
  plan: AskPlan;
  model: string;
  autoCompact: boolean;
  onCompact?: () => void;
  onNotesOnly?: () => void;
}) {
  const { plan, model } = props;
  const pct = Math.round(plan.share * 100);
  let tone: 'error' | 'warn' = 'warn';
  let text = '';
  if (plan.share >= FULL_SHARE) {
    tone = 'error';
    text = `This question would use ${pct}% of what ${model} can take in one request. Older messages are left out to make it fit.`;
  } else if (plan.transcriptTrimmed) {
    text = `This lecture is too long to send in full, so the middle of the transcript is left out. Use the study notes only, or pick a model with a bigger context in Settings.`;
  } else if (plan.share >= WARN_SHARE) {
    text = `This conversation uses ${pct}% of what ${model} can take in one request.`;
  } else if (plan.droppedMessages > 0) {
    const n = plan.droppedMessages;
    text = props.autoCompact
      ? `${n} older message${n === 1 ? '' : 's'} no longer fit${n === 1 ? 's' : ''}. They’ll be compacted automatically with your next question.`
      : `${n} older message${n === 1 ? '' : 's'} no longer fit${n === 1 ? 's' : ''} and ${n === 1 ? 'isn’t' : 'aren’t'} sent, so TORU won’t remember ${n === 1 ? 'it' : 'them'}. Compact the conversation to keep the gist.`;
  }
  if (!text) return null;
  const showCompact = props.onCompact && !(plan.droppedMessages > 0 && props.autoCompact && plan.share < WARN_SHARE);
  return (
    <div className={`callout callout-${tone}`} role="status">
      <div className="callout-body">
        <span>{text}</span>
        {(showCompact || props.onNotesOnly) && (
          <div className="callout-actions">
            {showCompact && (
              <button className="btn btn-sm btn-light" onClick={props.onCompact}>
                Compact conversation
              </button>
            )}
            {props.onNotesOnly && (plan.transcriptTrimmed || plan.share >= WARN_SHARE) && (
              <button className="btn btn-sm" onClick={props.onNotesOnly}>
                Use study notes only
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Message(props: { message: ChatMessage; onCopy: (t: string) => void; onRetry: () => void; canRetry: boolean }) {
  const m = props.message;
  if (m.role === 'user') return <div className="msg msg-user">{m.content}</div>;
  if (m.error) {
    return (
      <div className="callout callout-error">
        <div className="callout-body">
          <span>Couldn’t answer: {m.error}</span>
          {props.canRetry && (
            <div className="callout-actions">
              <button className="btn btn-sm btn-light" onClick={props.onRetry}>
                <IconRefresh size={13} /> Try again
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="msg msg-ai">
      <Markdown text={m.content} />
      <div className="msg-tools">
        {m.stopped && <span className="faint">Stopped</span>}
        {m.trimmed && (
          <span className="faint" title="The answer started copying the lecture transcript, so TORU cut that part off.">
            Stopped repeating the transcript
          </span>
        )}
        <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => props.onCopy(m.content)} aria-label="Copy answer" title="Copy">
          <IconCopy size={13} />
        </button>
        {m.stopped && props.canRetry && (
          <button className="link-quiet" onClick={props.onRetry}>
            Answer again
          </button>
        )}
      </div>
    </div>
  );
}

function Thinking() {
  return (
    <div className="thinking" aria-label="Thinking">
      <span />
      <span />
      <span />
    </div>
  );
}
