'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CheckableListRow, GripIcon, Icon } from '@sovereignfs/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toggleItemBought } from '../_lib/actions';
import { resolveIcon } from '../_lib/icons';
import type { ListItemRow } from '../_lib/types';
import styles from './ItemRow.module.css';

interface Props {
  listId: string;
  item: ListItemRow;
  /** Viewers see the row read-only — no checkbox toggle, edit link, or drag
   *  handle. */
  canEdit: boolean;
}

/** One item row (SHP-04–08): a leading drag handle, tap-to-buy via
 *  CheckableListRow, quantity, and an edit entry point in the trailing
 *  slot. The handle sits outside CheckableListRow entirely — its own
 *  leading slot is already the grocery item icon — at the row's leading
 *  edge, the conventional spot (matches sovereign-tasks' `GripIcon`
 *  placement) and more thumb-reachable on mobile than being sandwiched
 *  between the trailing controls.
 *
 *  This component owns its own `<li>` — it has to be the actual sortable
 *  DOM node dnd-kit's `useSortable` attaches `ref`/transform-style to,
 *  which the parent's `.map()` can't do on its behalf. The drag handle
 *  (not the whole row) carries `listeners`/`attributes`: unlike
 *  sovereign-tasks' `TaskItem` (which forwards drag listeners onto the
 *  whole row because its `Checkbox` is a small target), CheckableListRow's
 *  entire row IS this plugin's primary tap-to-buy target — a whole-row drag
 *  listener would compete with that, so dragging is opt-in via the handle
 *  only. That also means no `data-no-dnd` markers are needed anywhere in
 *  the row; nothing else here carries drag listeners. */
export default function ItemRow({ listId, item, canEdit }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: item.id,
    disabled: !canEdit,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  function handleToggle() {
    startTransition(async () => {
      await toggleItemBought(listId, item.id);
      router.refresh();
    });
  }

  return (
    <li ref={setNodeRef} style={style} className={styles.item}>
      {canEdit && (
        <button
          type="button"
          className={styles.dragHandle}
          aria-label={`Reorder ${item.name}`}
          {...attributes}
          {...listeners}
        >
          <GripIcon size={12} />
        </button>
      )}
      <CheckableListRow
        className={styles.row}
        checked={item.checkedAt !== null}
        onCheckedChange={handleToggle}
        label={item.name}
        icon={<Icon name={resolveIcon(item.icon, item.category)} size="md" aria-hidden />}
        disabled={!canEdit || pending}
        trailing={
          <div className={styles.trailing}>
            <span className={styles.quantity}>
              {item.quantity}
              {item.unit ? ` ${item.unit}` : ''}
            </span>
            {canEdit && (
              <Link
                href={`?item=${item.id}`}
                className={styles.editLink}
                aria-label={`Edit ${item.name}`}
              >
                <Icon name="pencil" size="sm" aria-hidden />
              </Link>
            )}
          </div>
        }
      />
    </li>
  );
}
