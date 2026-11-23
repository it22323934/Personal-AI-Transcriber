// The "Ask" tab: a conversation about one lecture, grounded in its transcript.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SUGGESTED_QUESTIONS } from '../../lib/chat';
import { errorMessage } from '../../lib/format';
import * as store from '../../lib/store';
import type { ChatMessage, Note } from '../../lib/types';
import { startAsk, stopAsk, useAskJob } from '../askJobs';
import { useLive, useSettings } from '../hooks';
import { IconCopy, IconRefresh, IconSparkle, IconStop } from '../icons';
import { Markdown } from '../Markdown';
import { toast } from '../toast';
import { useConfirm } from './Modal';

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

export function ChatPanel({ note, hasTranscript }: { note: Note; hasTranscript: boolean }) {
  const messages = useLive(
    () => store.getMessages(note.id),
    [note.id],
    (e) => e.type === 'messages' && e.noteId === note.id,
  );
  const job = useAskJob(note.id);
  const settings = useSettings();
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const { confirm, element: confirmEl } = useConfirm();

  useStickToBottom(`${messages?.length ?? 0}|${job?.text.length ?? -1}`);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, [draft]);

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

  if (!messages) return null;
  const last = messages.at(-1);
  const unanswered = !busy && last?.role === 'user';
  const empty = messages.length === 0 && !busy;

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
          {messages.map((m) => (
            <Message key={m.index} message={m} onCopy={copy} onRetry={() => startAsk(note.id)} canRetry={!busy && m === last} />
          ))}
          {job && (
            <div className="msg msg-ai">
              {job.text ? <Markdown text={job.text} /> : <Thinking />}
            </div>
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
          <button type="button" className="chat-send stop" onClick={() => stopAsk(note.id)} aria-label="Stop answering" title="Stop">
            <IconStop size={13} />
          </button>
        ) : (
          <button type="submit" className="chat-send" disabled={!draft.trim() || !hasTranscript} aria-label="Send" title="Send (Enter)">
            <IconSend />
          </button>
        )}
      </form>
      <div className="chat-foot">
        <span>
          Uses your OpenAI credits{settings ? ` · ${settings.summaryModel}` : ''}. Shift+Enter for a new line.
        </span>
        {messages.length > 0 && !busy && (
          <button className="link-quiet" onClick={clear}>
            Clear chat
          </button>
        )}
      </div>
      {confirmEl}
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
