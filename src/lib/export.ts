import { formatClock, formatDate, formatDuration } from './format';
import type { ChatMessage, Note, Project, Segment } from './types';

function header(note: Note, project?: Project): string {
  const meta = [project?.name, formatDate(note.createdAt), note.durationMs ? formatDuration(note.durationMs) : '']
    .filter(Boolean)
    .join(' · ');
  const lines = [`# ${note.title}`, '', `_${meta}_`];
  if (note.sourceUrl) lines.push('', `Source: ${note.sourceUrl}`);
  return lines.join('\n');
}

export function noteToMarkdown(
  note: Note,
  project: Project | undefined,
  segments: Segment[],
  chat: ChatMessage[] = [],
): string {
  const parts = [header(note, project)];
  if (note.summary) parts.push(note.summary.trim());
  if (note.myNotes.trim()) parts.push(`## My notes\n\n${note.myNotes.trim()}`);
  const qa = chat.filter((m) => !m.error && m.content.trim() && m.kind !== 'compaction');
  if (qa.length) {
    const turns = qa.map((m) => (m.role === 'user' ? `**Q:** ${m.content.trim()}` : m.content.trim()));
    parts.push(`## Questions and answers\n\n${turns.join('\n\n')}`);
  }
  if (segments.length) {
    parts.push(`## Transcript\n\n${segments.map((s) => `**[${formatClock(s.startMs)}]** ${s.text}`).join('\n\n')}`);
  }
  return parts.join('\n\n') + '\n';
}

/** A study pack: every note's summary and own notes, oldest first. */
export function projectToMarkdown(project: Project, notes: Note[]): string {
  const ordered = [...notes].sort((a, b) => a.createdAt - b.createdAt);
  const parts = [`# ${project.name}`];
  if (project.description) parts.push(project.description);
  for (const note of ordered) {
    const body = [header(note).replace(/^# /, '## ')];
    // Demote the summary's headings one level so they nest under the note.
    if (note.summary) body.push(note.summary.trim().replace(/^(#{1,5}) /gm, '#$1 '));
    if (note.myNotes.trim()) body.push(`### My notes\n\n${note.myNotes.trim()}`);
    if (!note.summary && !note.myNotes.trim()) body.push('_No summary yet._');
    parts.push(body.join('\n\n'));
  }
  return parts.join('\n\n---\n\n') + '\n';
}

export function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'toru';
}

export function downloadFile(filename: string, content: string, type = 'text/markdown'): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
