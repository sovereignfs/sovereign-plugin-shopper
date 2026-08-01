import type { ListItemRow, ListRow, SharedListRow } from './types';

/**
 * Shape returned by `GET /shopper/api/offline-snapshot` and cached via
 * `sdk.offline` (RFC 0074/0078). Everything the offline shell needs to
 * render every accessible list with no further round-trips.
 */
export interface OfflineSnapshot {
  lists: ListRow[];
  sharedLists: SharedListRow[];
  /** The user's last-opened list (SHP-03, `shopper_user_state.last_list_id`),
   *  or null if never set. The offline shell prefers this over "first list
   *  by creation date" when picking its initial selection. */
  lastListId: string | null;
  itemsByListId: Record<string, ListItemRow[]>;
}

/** `offlineQueue.enqueue(PLUGIN_ID, 'addItem', payload)` — the client mints
 *  the permanent id itself (RFC 0078 §4), so a retried sync is a plain
 *  idempotent `INSERT ... ON CONFLICT DO NOTHING`, no temp-id reconciliation. */
export interface AddItemPayload {
  id: string;
  listId: string;
  name: string;
}

/** `offlineQueue.enqueue(PLUGIN_ID, 'updateItem', payload)` — absolute field
 *  values for just the fields the offline edit form exposes (name/quantity/
 *  unit); category/icon/barcode/price are online-only edits, untouched here. */
export interface UpdateItemPayload {
  listId: string;
  itemId: string;
  name: string;
  quantity: string;
  unit: string | null;
}

/** `offlineQueue.enqueue(PLUGIN_ID, 'deleteItem', payload)`. */
export interface DeleteItemPayload {
  listId: string;
  itemId: string;
}

/** `offlineQueue.enqueue(PLUGIN_ID, 'setBought', payload)` — the absolute
 *  intended state, never a toggle (RFC 0078 §4: a retried toggle could
 *  double-flip if the client never saw the first response). */
export interface SetBoughtPayload {
  listId: string;
  itemId: string;
  bought: boolean;
  at: number;
}

/** The request body `POST /shopper/api/offline-sync` accepts — the client's
 *  full current queue for this plugin, in enqueue order. */
export interface OfflineSyncRequest {
  mutations: {
    id: string;
    op: 'addItem' | 'updateItem' | 'deleteItem' | 'setBought';
    payload: AddItemPayload | UpdateItemPayload | DeleteItemPayload | SetBoughtPayload;
    clientTimestamp: number;
  }[];
}

export interface OfflineSyncOutcome {
  id: string;
  status: 'applied' | 'skipped' | 'failed';
  error?: string;
}

export interface OfflineSyncResponse {
  outcomes: OfflineSyncOutcome[];
}
