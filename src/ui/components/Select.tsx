// TORU's own dropdowns, replacing the browser's native <select> lists.
// The list is rendered in a portal with fixed positioning, so it's never
// clipped by a scrolling dialog, and flips upward when there's no room below.
// Keyboard: ↑/↓, Home/End, Enter/Space to pick, Esc to close, letters jump.
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { IconCheck } from '../icons';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  /** Colour dot shown before the label (e.g. a project colour). */
  dot?: string;
}

const MAX_LIST_HEIGHT = 320;
const GAP = 6;

function ChevronDown() {
  return (
    <svg className="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** A floating list anchored to an element. Closes on outside click, Esc (handled by the owner) or outside scroll. */
function Popover(props: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  id: string;
  role: string;
  minWidth?: number;
  label?: string;
  children: ReactNode;
}) {
  const { anchor, open, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  // Fixed from the very first render, so it never joins the page flow (which
  // would let scrollIntoView scroll the whole page).
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: 0, left: 0, visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      if (!a) return;
      const content = ref.current?.scrollHeight ?? MAX_LIST_HEIGHT;
      const below = window.innerHeight - a.bottom - GAP - 8;
      const above = a.top - GAP - 8;
      const openBelow = below >= Math.min(content, 220) || below >= above;
      const width = Math.max(a.width, props.minWidth ?? 0);
      const left = Math.max(8, Math.min(a.left, window.innerWidth - width - 8));
      setStyle({
        position: 'fixed',
        left,
        width,
        maxHeight: Math.max(120, Math.min(MAX_LIST_HEIGHT, openBelow ? below : above)),
        ...(openBelow ? { top: a.bottom + GAP } : { bottom: window.innerHeight - a.top + GAP }),
      });
    };
    // Follow the anchor when the page (or a dialog) scrolls; scrolling the list itself is ignored.
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) place();
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, anchor, props.minWidth]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, onClose, anchor]);

  if (!open) return null;
  return createPortal(
    <div ref={ref} id={props.id} role={props.role} aria-label={props.label} className="popover" style={style}>
      {props.children}
    </div>,
    document.body,
  );
}

function OptionRow(props: {
  id: string;
  label: string;
  description?: string;
  dot?: string;
  icon?: ReactNode;
  selected?: boolean;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
  className?: string;
}) {
  return (
    <div
      id={props.id}
      role="option"
      aria-selected={!!props.selected}
      data-active={props.active}
      className={`option ${props.className ?? ''}`}
      onMouseMove={props.onHover}
      onMouseDown={(e) => e.preventDefault()} // keep focus on the trigger
      onClick={props.onPick}
    >
      {props.dot && <span className="dot" style={{ background: props.dot }} />}
      {props.icon}
      <span className="option-text">
        <span className="option-label">{props.label}</span>
        {props.description && <span className="option-desc">{props.description}</span>}
      </span>
      {props.selected && <IconCheck size={14} className="option-check" />}
    </div>
  );
}

function useListKeys(count: number, open: boolean) {
  const [active, setActive] = useState(0);
  const move = useCallback(
    (delta: number) => setActive((i) => (count ? (i + delta + count) % count : 0)),
    [count],
  );
  useEffect(() => {
    if (!open) return;
    setActive((i) => Math.min(i, Math.max(0, count - 1)));
  }, [count, open]);
  return { active, setActive, move };
}

export function Select<T extends string>(props: {
  value: T | undefined;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  variant?: 'pill' | 'field' | 'chip';
  placeholder?: string;
  title?: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Extra action at the bottom of the list, e.g. "New project…". */
  action?: { label: string; icon?: ReactNode; onSelect: () => void };
  listMinWidth?: number;
  id?: string;
}) {
  const { options, value, action } = props;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const count = options.length + (action ? 1 : 0);
  const { active, setActive, move } = useListKeys(count, open);
  const selected = options.find((o) => o.value === value);
  const optionId = (i: number) => `${listId}-o${i}`;

  const close = useCallback(() => setOpen(false), []);
  const openList = () => {
    if (props.disabled) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const pick = (i: number) => {
    setOpen(false);
    trigger.current?.focus();
    if (i < options.length) {
      if (options[i].value !== value) props.onChange(options[i].value);
    } else {
      action?.onSelect();
    }
  };

  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const k = e.key;
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (k === 'Escape' || k === 'Tab') {
      if (k === 'Escape') e.stopPropagation(); // don't also close a surrounding dialog
      close();
    } else if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      move(k === 'ArrowDown' ? 1 : -1);
    } else if (k === 'Home' || k === 'End') {
      e.preventDefault();
      setActive(k === 'Home' ? 0 : count - 1);
    } else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      pick(active);
    } else if (k.length === 1 && /\S/.test(k)) {
      const start = (active + 1) % Math.max(1, options.length);
      const order = [...options.slice(start), ...options.slice(0, start)];
      const hit = order.find((o) => o.label.toLowerCase().startsWith(k.toLowerCase()));
      if (hit) setActive(options.indexOf(hit));
    }
  };

  const variant = props.variant ?? 'field';
  return (
    <>
      <button
        ref={trigger}
        id={props.id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-label={props.ariaLabel}
        title={props.title}
        disabled={props.disabled}
        className={`select-trigger select-${variant} ${props.className ?? ''}`}
        style={props.style}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">
          {selected?.dot && <span className="dot" style={{ background: selected.dot, width: 7, height: 7 }} />}
          <span className="truncate">{selected?.label ?? props.placeholder ?? 'Choose…'}</span>
        </span>
        <ChevronDown />
      </button>
      <Popover anchor={trigger} open={open} onClose={close} id={listId} role="listbox" label={props.ariaLabel} minWidth={props.listMinWidth ?? (variant === 'chip' ? 200 : 0)}>
        {options.map((o, i) => (
          <OptionRow
            key={o.value}
            id={optionId(i)}
            label={o.label}
            description={o.description}
            dot={o.dot}
            selected={o.value === value}
            active={active === i}
            onHover={() => setActive(i)}
            onPick={() => pick(i)}
          />
        ))}
        {action && (
          <>
            <div className="popover-sep" role="separator" />
            <OptionRow
              id={optionId(options.length)}
              label={action.label}
              icon={action.icon}
              active={active === options.length}
              onHover={() => setActive(options.length)}
              onPick={() => pick(options.length)}
              className="option-action"
            />
          </>
        )}
      </Popover>
    </>
  );
}

/** A text field with a suggestion list (free text is allowed), e.g. model names. */
export function ComboInput(props: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: { value: string; description?: string }[];
  ariaLabel?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const typed = props.value.trim().toLowerCase();
  const exact = props.suggestions.some((s) => s.value.toLowerCase() === typed);
  const shown = exact || !typed ? props.suggestions : props.suggestions.filter((s) => s.value.toLowerCase().includes(typed));
  const { active, setActive, move } = useListKeys(shown.length, open);
  const optionId = (i: number) => `${listId}-o${i}`;
  const close = useCallback(() => setOpen(false), []);
  const visible = open && shown.length > 0;

  const pick = (i: number) => {
    props.onChange(shown[i].value);
    setOpen(false);
    input.current?.focus();
  };

  return (
    <div className="combo" ref={wrap}>
      <input
        ref={input}
        id={props.id}
        className="input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={listId}
        aria-activedescendant={visible ? optionId(active) : undefined}
        aria-label={props.ariaLabel}
        placeholder={props.placeholder}
        autoComplete="off"
        spellCheck={false}
        value={props.value}
        onChange={(e) => {
          props.onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              setActive(Math.max(0, shown.findIndex((s) => s.value === props.value)));
            } else move(e.key === 'ArrowDown' ? 1 : -1);
          } else if (e.key === 'Enter' && visible) {
            e.preventDefault();
            pick(active);
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation();
            close();
          }
        }}
        onBlur={close}
      />
      <button
        type="button"
        className="combo-toggle"
        tabIndex={-1}
        aria-label="Show suggestions"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setOpen((o) => !o);
          input.current?.focus();
        }}
      >
        <ChevronDown />
      </button>
      <Popover anchor={wrap} open={visible} onClose={close} id={listId} role="listbox" label={props.ariaLabel}>
        {shown.map((s, i) => (
          <OptionRow
            key={s.value}
            id={optionId(i)}
            label={s.value}
            description={s.description}
            selected={s.value === props.value}
            active={active === i}
            onHover={() => setActive(i)}
            onPick={() => pick(i)}
          />
        ))}
      </Popover>
    </div>
  );
}
