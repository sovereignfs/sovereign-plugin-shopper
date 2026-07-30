import type { ListItemRow } from './types';
import type {
  AddItemPayload,
  DeleteItemPayload,
  OfflineSnapshot,
  SetBoughtPayload,
  UpdateItemPayload,
} from './offline-types';

export interface PendingMutation {
  op: 'addItem' | 'updateItem' | 'deleteItem' | 'setBought';
  payload: AddItemPayload | UpdateItemPayload | DeleteItemPayload | SetBoughtPayload;
}

/** Applies one queued mutation's effect to a snapshot — pure, no I/O. Used
 *  both to project the durable pending queue over a freshly-loaded baseline
 *  at mount, and to apply a brand-new mutation optimistically the instant
 *  the user acts (RFC 0078 §5). */
export function applyOneMutation(
  snapshot: OfflineSnapshot,
  mutation: PendingMutation,
): OfflineSnapshot {
  const itemsByListId = { ...snapshot.itemsByListId };

  switch (mutation.op) {
    case 'addItem': {
      const p = mutation.payload as AddItemPayload;
      const existing = itemsByListId[p.listId] ?? [];
      if (existing.some((i) => i.id === p.id)) return snapshot;
      const newItem: ListItemRow = {
        id: p.id,
        name: p.name.trim(),
        quantity: '1',
        unit: null,
        category: null,
        icon: null,
        checkedAt: null,
        sortOrder: existing.length,
      };
      itemsByListId[p.listId] = [...existing, newItem];
      return { ...snapshot, itemsByListId };
    }
    case 'updateItem': {
      const p = mutation.payload as UpdateItemPayload;
      const existing = itemsByListId[p.listId] ?? [];
      itemsByListId[p.listId] = existing.map((i) =>
        i.id === p.itemId ? { ...i, name: p.name, quantity: p.quantity, unit: p.unit } : i,
      );
      return { ...snapshot, itemsByListId };
    }
    case 'deleteItem': {
      const p = mutation.payload as DeleteItemPayload;
      const existing = itemsByListId[p.listId] ?? [];
      itemsByListId[p.listId] = existing.filter((i) => i.id !== p.itemId);
      return { ...snapshot, itemsByListId };
    }
    case 'setBought': {
      const p = mutation.payload as SetBoughtPayload;
      const existing = itemsByListId[p.listId] ?? [];
      itemsByListId[p.listId] = existing.map((i) =>
        i.id === p.itemId ? { ...i, checkedAt: p.bought ? p.at : null } : i,
      );
      return { ...snapshot, itemsByListId };
    }
    default:
      return snapshot;
  }
}

/** Folds a list of queued mutations (in enqueue order) over a baseline
 *  snapshot — see `applyOneMutation`'s doc comment. */
export function applyPending(
  snapshot: OfflineSnapshot,
  mutations: PendingMutation[],
): OfflineSnapshot {
  return mutations.reduce(applyOneMutation, snapshot);
}
