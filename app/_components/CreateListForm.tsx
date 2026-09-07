'use client';

import { Button, useCommitOnEnterOrBlur } from '@sovereignfs/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { createList } from '../_lib/actions';
import styles from './CreateListForm.module.css';

interface Props {
  /** 'inline' defaults to open when uncontrolled (unused now that Sidebar
   *  always controls it — kept for a hypothetical uncontrolled consumer).
   *  'cta' renders a single button that reveals the input on click, for use
   *  as an EmptyState action. */
  variant?: 'inline' | 'cta';
  className?: string;
  /** Controlled open state — omit to let the component manage its own.
   *  Sidebar's header "+" button controls this externally (sovereign-tasks'
   *  ListSidebar pattern: click "+", a plain input appears above the list,
   *  Enter or losing focus with a non-empty name creates and collapses it
   *  again (useCommitOnEnterOrBlur — see below), Escape/blur-while-empty
   *  cancels) so nothing here renders its own trigger button when
   *  controlled — the caller owns that. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function CreateListForm({
  variant = 'inline',
  className,
  open: openProp,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const isControlled = openProp !== undefined;
  const [openState, setOpenState] = useState(variant === 'inline');
  const open = isControlled ? openProp : openState;
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function setOpen(next: boolean) {
    if (isControlled) onOpenChange?.(next);
    else setOpenState(next);
  }

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      try {
        const id = await createList(trimmed);
        setName('');
        setOpen(false);
        router.push(`/shopper/lists/${id}`);
        router.refresh();
      } catch (err) {
        // Stays open with the typed name intact — the usual reason to land
        // here is a name already in use, which the user can just amend.
        setError(err instanceof Error ? err.message : 'Could not create this list.');
      }
    });
  }

  // Losing focus for any reason (including iOS's native keyboard-accessory
  // Done/checkmark, which fires a blur but no keydown, unlike the form's
  // own Enter-triggered onSubmit) commits the same as Enter — see the
  // hook's own doc comment. submit() already no-ops on an empty name, so
  // this is always safe to call.
  const commitHandlers = useCommitOnEnterOrBlur(() => submit());

  if (!open) {
    // A controlled instance never renders its own trigger — the caller
    // (Sidebar's header "+" button) owns that.
    if (isControlled) return null;
    return (
      <Button type="button" onClick={() => setOpen(true)} className={className}>
        Create list
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className={`${styles.form} ${className ?? ''}`}>
      <input
        ref={inputRef}
        className={styles.input}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          commitHandlers.onKeyDown(e);
          if (e.key === 'Escape') {
            setName('');
            setError(null);
            setOpen(false);
          }
        }}
        onBlur={() => {
          commitHandlers.onBlur();
          if (!name.trim()) setOpen(false);
        }}
        placeholder="List name"
        aria-label="List name"
        disabled={pending}
      />
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
