'use client';

import { DndContext, closestCenter } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { EmptyState, PageHeader, useToast } from '@sovereignfs/ui';
import { useRouter } from 'next/navigation';
import { useOptimistic, useTransition } from 'react';
import { reorderItems } from '../../../_lib/actions';
import { useReorderSensors } from '../../../_lib/dndSensors';
import { groupItemsByCategory } from '../../../_lib/group';
import AddItemBar from '../../../_components/AddItemBar';
import BoughtSection from '../../../_components/BoughtSection';
import ItemEditDialog from '../../../_components/ItemEditDialog';
import ItemRow from '../../../_components/ItemRow';
import ListHeaderActions from '../../../_components/ListHeaderActions';
import type { ListItemDetail, ListItemRow, ListRow } from '../../../_lib/types';
import styles from './page.module.css';

interface Props {
  listId: string;
  list: ListRow;
  items: ListItemRow[];
  editingItem: ListItemDetail | null;
}

type ItemAction = { type: 'reorder'; ids: string[] };

/** Substitutes a reordered subset (one category group's ids, in their new
 *  order) back into the full item array, leaving every item outside that
 *  subset (other categories, bought items) untouched — same splice-back
 *  technique sovereign-tasks' `tasksReducer` uses for its own optimistic
 *  reorder. */
function itemsReducer(state: ListItemRow[], action: ItemAction): ListItemRow[] {
  const byId = new Map(state.map((item) => [item.id, item]));
  const reordered = action.ids.map((id) => byId.get(id)).filter((i): i is ListItemRow => !!i);
  const idSet = new Set(action.ids);
  let i = 0;
  return state.map((item) => (idSet.has(item.id) ? (reordered[i++] ?? item) : item));
}

/**
 * List detail render, shared by the desktop route (`page.tsx`, server-fetched
 * props) and `MobileShopperCarousel` (client-fetched, decoupled per slide) —
 * same split as sovereign-tasks' `TasksPane`. All data-fetching/access-
 * checking stays in the caller; this component is pure presentation over
 * already-resolved props.
 *
 * Drag-reorder (SHP-08): each category group mounts its own independent
 * `DndContext`/`SortableContext`, scoped to just that group's item ids —
 * items can't be dragged across a category boundary since dnd-kit's
 * collision detection only sees ids registered to the `SortableContext` a
 * drag started in. `useOptimistic` over the full `items` prop mirrors
 * `TasksPane`'s pattern: it resets to the fresh server baseline whenever
 * `items` changes (e.g. after `router.refresh()`) while showing the dragged
 * order immediately in the meantime.
 */
export default function ListPane({ listId, list, items, editingItem }: Props) {
  const router = useRouter();
  // Safe under `shell: "default"` — the platform's ClientShell wraps every
  // plugin page in a ToastProvider. A move to `shell: "minimal"` would mean
  // mounting one in this plugin's own layout first.
  const toast = useToast();
  const sensors = useReorderSensors();
  const [, startTransition] = useTransition();
  const [optimisticItems, dispatch] = useOptimistic(items, itemsReducer);

  const canEdit = list.role !== 'viewer';
  const activeItems = optimisticItems.filter((item) => item.checkedAt === null);
  const boughtItems = optimisticItems.filter((item) => item.checkedAt !== null);
  const groups = groupItemsByCategory(activeItems);

  function handleDragEnd(categoryItems: ListItemRow[], event: DragEndEvent) {
    const { active, over } = event;
    if (!(event.activatorEvent instanceof KeyboardEvent)) {
      (document.activeElement as HTMLElement | null)?.blur();
    }
    if (!over || active.id === over.id) return;
    const oldIndex = categoryItems.findIndex((item) => item.id === active.id);
    const newIndex = categoryItems.findIndex((item) => item.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const ids = arrayMove(categoryItems, oldIndex, newIndex).map((item) => item.id);
    startTransition(async () => {
      dispatch({ type: 'reorder', ids });
      try {
        await reorderItems(listId, ids);
      } catch (err) {
        // The refresh below reverts the optimistic order on its own; without
        // this the row would just snap back with nothing explaining why.
        toast.show({
          title: 'Order not saved',
          message: err instanceof Error ? err.message : 'Could not reorder these items.',
          category: 'error',
        });
      }
      router.refresh();
    });
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={list.name}
        action={list.role === 'owner' ? <ListHeaderActions list={list} /> : undefined}
      />

      {canEdit && (
        <div className={styles.addBar}>
          <AddItemBar listId={listId} />
        </div>
      )}

      {optimisticItems.length === 0 ? (
        <EmptyState
          heading="No items yet"
          description={
            list.role === 'viewer'
              ? "This list doesn't have any items yet."
              : 'Add an item above to get started.'
          }
        />
      ) : (
        <>
          {groups.map((group) => (
            <section key={group.category} className={styles.group}>
              <h2 className={styles.groupLabel}>{group.category}</h2>
              <DndContext
                id={`shopper-items-${group.category}`}
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(event) => handleDragEnd(group.items, event)}
              >
                <SortableContext
                  items={group.items.map((item) => item.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className={styles.items}>
                    {group.items.map((item) => (
                      <ItemRow key={item.id} listId={listId} item={item} canEdit={canEdit} />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            </section>
          ))}

          <BoughtSection listId={listId} items={boughtItems} canEdit={canEdit} />
        </>
      )}

      {editingItem && (
        <ItemEditDialog listId={listId} item={editingItem} closeHref={`/shopper/lists/${listId}`} />
      )}
    </div>
  );
}
