'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  CheckableListRow,
  EmptyState,
  Icon,
  Input,
  PageContainer,
  PageHeader,
} from '@sovereignfs/ui';
import { offline } from '@sovereignfs/sdk/offline';
import { drainQueue, offlineQueue, type SyncOutcome } from '@sovereignfs/sdk/offline-queue';
import { createList } from '../_lib/actions';
import { applyOneMutation, applyPending, type PendingMutation } from '../_lib/offline-apply';
import { resolveIcon } from '../_lib/icons';
import type { OfflineSnapshot } from '../_lib/offline-types';
import type { ListItemRow } from '../_lib/types';
import styles from './OfflineShopperView.module.css';

export const SHOPPER_PLUGIN_ID = 'fs.sovereign.shopper';
const SNAPSHOT_KEY = 'snapshot';

type Status = 'loading' | 'unavailable-offline' | 'loaded';

interface SyncResponse {
  outcomes: SyncOutcome[];
}

/** Same "last-opened, else first" preference the old server redirect (SHP-03)
 *  used, shared between the online-redirect path and the offline fallback's
 *  own tab selection below. */
function pickTargetListId(snapshot: OfflineSnapshot): string | null {
  const accessible = [
    ...snapshot.lists.map((l) => l.id),
    ...snapshot.sharedLists.map((l) => l.id),
  ];
  if (accessible.length === 0) return null;
  if (snapshot.lastListId && accessible.includes(snapshot.lastListId)) {
    return snapshot.lastListId;
  }
  return accessible[0] ?? null;
}

/**
 * Shopper home (RFC 0078 — `manifest.json` declares `offline: true` and the
 * `offline:write` permission). `page.tsx` renders this as a user-neutral
 * shell so its SSR output stays safe to precache.
 *
 * **While online**, this component's only real job is a client-side redirect
 * to `/shopper/lists/[id]` (last-opened list, SHP-03) — the full `ListPane`
 * experience (sidebar, mobile carousel, drag-reorder, sharing, the full item
 * edit dialog) lives there, unchanged, under the `(shell)` route group. The
 * redirect happens after mount, never baked into this page's own SSR HTML,
 * so the neutral-shell/offline-precaching property RFC 0078 needs still
 * holds.
 *
 * **While offline** (or before the live fetch resolves), it falls back to
 * rendering a deliberately simpler inline view straight from the cached
 * snapshot + queued mutations — no drag-reorder, sharing, or list
 * create/rename/archive (out of scope for offline writes, see RFC 0078's
 * locked decisions). List switching here is in-memory state, never a real
 * navigation — the only SW-precached, offline-reachable URL is this page's
 * own bare `/shopper`; navigating to `/shopper/lists/[id]` while genuinely
 * offline would fall through to the generic `/offline` fallback.
 */
export function OfflineShopperView() {
  const router = useRouter();
  const redirected = useRef(false);
  // True from the moment the initial online load resolves with a target
  // list until the redirect actually fires — keeps the loading skeleton up
  // instead of flashing the simplified inline view for the one tick before
  // navigation takes over.
  const [redirecting, setRedirecting] = useState(false);
  const [status, setStatus] = useState<Status>('loading');
  const [view, setView] = useState<OfflineSnapshot | null>(null);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [addValue, setAddValue] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editQuantity, setEditQuantity] = useState('');
  const [editUnit, setEditUnit] = useState('');
  const [newListName, setNewListName] = useState('');
  const [creatingList, setCreatingList] = useState(false);
  const [createListError, setCreateListError] = useState<string | null>(null);

  const rebuildView = useCallback(async (snap: OfflineSnapshot) => {
    const pending = await offlineQueue.list(SHOPPER_PLUGIN_ID);
    const mutations = pending as unknown as PendingMutation[];
    setView(applyPending(snap, mutations));
    setPendingCount(pending.length);
  }, []);

  const loadLive = useCallback(async (): Promise<OfflineSnapshot | null> => {
    try {
      const res = await fetch('/shopper/api/offline-snapshot');
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const data = (await res.json()) as OfflineSnapshot;
      setStatus('loaded');
      await offline.set(SHOPPER_PLUGIN_ID, SNAPSHOT_KEY, data);
      await rebuildView(data);
      return data;
    } catch {
      return null;
    }
  }, [rebuildView]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await drainQueue(SHOPPER_PLUGIN_ID, async (batch) => {
        const res = await fetch('/shopper/api/offline-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mutations: batch }),
        });
        if (!res.ok) throw new Error(`Sync request failed: ${res.status}`);
        const data = (await res.json()) as SyncResponse;
        return data.outcomes;
      });
      if (result.failed.length > 0) {
        setSyncError(
          `${result.failed.length} change${result.failed.length === 1 ? '' : 's'} couldn't sync — ${result.failed[0]?.error ?? 'unknown error'}`,
        );
      }
      if (result.applied.length > 0 || result.skipped.length > 0) {
        // Reconcile with canonical server state rather than patching
        // individual fields (RFC 0078 §4) — sort order, auto-suggested
        // category/icon, etc. are only known after a real fetch.
        await loadLive();
      } else {
        const pending = await offlineQueue.list(SHOPPER_PLUGIN_ID);
        setPendingCount(pending.length);
      }
    } catch {
      setSyncError('Could not reach the server to sync your changes.');
    } finally {
      setSyncing(false);
    }
  }, [loadLive]);

  useEffect(() => {
    let cancelled = false;

    offline
      .get<OfflineSnapshot>(SHOPPER_PLUGIN_ID, SNAPSHOT_KEY)
      .then(async (cached) => {
        if (cancelled || !cached) return;
        setStatus('loaded');
        await rebuildView(cached);
      })
      .catch(() => {
        // IndexedDB unavailable or failed to read — the live fetch below
        // still determines the actual render.
      });

    (async () => {
      const data = await loadLive();
      if (cancelled) return;
      if (data) {
        const target = pickTargetListId(data);
        if (target) setRedirecting(true);
        // Drain any queued offline writes before redirecting — the full
        // ListPane page does its own fresh server fetch with no knowledge
        // of this page's local mutation queue, so anything still pending
        // needs to land first or it would look like data loss.
        await sync();
        if (cancelled || redirected.current) return;
        if (target) {
          redirected.current = true;
          router.replace(`/shopper/lists/${target}`);
        }
      } else {
        setStatus((s) => (s === 'loading' ? 'unavailable-offline' : s));
      }
    })();

    const handleOnline = () => void sync();
    window.addEventListener('online', handleOnline);

    return () => {
      cancelled = true;
      window.removeEventListener('online', handleOnline);
    };
    // Deliberately run once on mount — loadLive/sync are stable via
    // useCallback, router is stable per Next's useRouter contract. A later
    // reconnect (the 'online' listener below) re-syncs but doesn't redirect
    // — only the initial online mount does, so reconnecting while the user
    // is actively using the offline fallback doesn't yank them elsewhere.
  }, []);

  const accessibleLists = useMemo(() => {
    if (!view) return [];
    return [
      ...view.lists.map((l) => ({ id: l.id, name: l.name, canEdit: l.role !== 'viewer' })),
      ...view.sharedLists.map((l) => ({ id: l.id, name: l.name, canEdit: l.role === 'editor' })),
    ];
  }, [view]);

  useEffect(() => {
    if (selectedListId || accessibleLists.length === 0) return;
    // Prefer the last-opened list (SHP-03) over "first by creation date" —
    // falls back when it's null (never set) or no longer accessible
    // (archived/unshared since), same fallback the old server redirect had.
    const lastListId = view?.lastListId ?? null;
    const last = lastListId ? accessibleLists.find((l) => l.id === lastListId) : undefined;
    const target = last ?? accessibleLists[0];
    if (target) setSelectedListId(target.id);
  }, [accessibleLists, selectedListId, view]);

  async function enqueueAndApply(mutation: PendingMutation) {
    if (!view) return;
    setView((v) => (v ? applyOneMutation(v, mutation) : v));
    await offlineQueue.enqueue(SHOPPER_PLUGIN_ID, mutation.op, mutation.payload);
    setPendingCount((c) => c + 1);
    if (navigator.onLine) void sync();
  }

  async function handleAddSubmit(listId: string) {
    const trimmed = addValue.trim();
    if (!trimmed) return;
    setAddValue('');
    await enqueueAndApply({
      op: 'addItem',
      payload: { id: crypto.randomUUID(), listId, name: trimmed },
    });
  }

  async function handleToggleBought(listId: string, item: ListItemRow) {
    await enqueueAndApply({
      op: 'setBought',
      payload: {
        listId,
        itemId: item.id,
        bought: item.checkedAt === null,
        at: Math.floor(Date.now() / 1000),
      },
    });
  }

  function startEdit(item: ListItemRow) {
    setEditingId(item.id);
    setEditName(item.name);
    setEditQuantity(item.quantity);
    setEditUnit(item.unit ?? '');
  }

  async function commitEdit(listId: string, itemId: string) {
    const trimmed = editName.trim();
    setEditingId(null);
    if (!trimmed) return;
    await enqueueAndApply({
      op: 'updateItem',
      payload: {
        listId,
        itemId,
        name: trimmed,
        quantity: editQuantity.trim() || '1',
        unit: editUnit.trim() || null,
      },
    });
  }

  async function handleDelete(listId: string, itemId: string) {
    await enqueueAndApply({ op: 'deleteItem', payload: { listId, itemId } });
  }

  // List creation is online-only (RFC 0078's locked write scope covers
  // item-level operations only) — `createList` is the same server action
  // the online sidebar's `CreateListForm` calls; here it's invoked directly
  // from client code, which works for any 'use server' action, online only.
  //
  // Navigates straight to the new list's real route (same `router.replace`
  // this component already uses for the SHP-03 redirect above) instead of
  // calling `loadLive()` and staying on this neutral/offline shell — that
  // used to be the only path, which left the user looking at this page's
  // own simplified inline list/items UI (no sidebar, no drag-reorder, no
  // sharing) with no way to reach the real ThreeColumnLayout shell short of
  // a full page reload (which re-runs the mount effect's own redirect logic
  // from scratch and finds a real target this time). This page's whole job
  // is to redirect once a target list exists — creating the first list
  // makes one exist immediately, so it should redirect immediately too,
  // not wait for a future mount.
  async function handleCreateList() {
    const trimmed = newListName.trim();
    if (!trimmed) return;
    setCreatingList(true);
    setCreateListError(null);
    try {
      const id = await createList(trimmed);
      setNewListName('');
      router.replace(`/shopper/lists/${id}`);
    } catch {
      setCreateListError('Could not create the list — check your connection and try again.');
      setCreatingList(false);
    }
  }

  if (status === 'loading' || redirecting) {
    return (
      <PageContainer>
        <PageHeader title="Shopper" />
      </PageContainer>
    );
  }

  if (status === 'unavailable-offline' || !view) {
    return (
      <PageContainer>
        <PageHeader title="Shopper" />
        <EmptyState
          icon="alert-triangle"
          heading="Not available offline yet"
          description="Open Shopper once online to make your lists available with no connection."
        />
      </PageContainer>
    );
  }

  if (accessibleLists.length === 0) {
    return (
      <PageContainer>
        <PageHeader title="Shopper" />
        <EmptyState
          heading="No lists yet"
          description="Create a list to get started — this needs a connection."
          action={
            <div className={styles.createListAction}>
              <form
                className={styles.createListBar}
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleCreateList();
                }}
              >
                <Input
                  className={styles.createListInput}
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="List name…"
                  aria-label="New list name"
                  disabled={creatingList}
                />
                <Button
                  className={styles.createListSubmit}
                  type="submit"
                  size="sm"
                  disabled={creatingList}
                >
                  {creatingList ? 'Creating…' : 'Create list'}
                </Button>
              </form>
              {createListError && <p className={styles.syncErrorText}>{createListError}</p>}
            </div>
          }
        />
      </PageContainer>
    );
  }

  const selected = accessibleLists.find((l) => l.id === selectedListId) ?? accessibleLists[0];
  const items = (selected ? view.itemsByListId[selected.id] : []) ?? [];
  const activeItems = items.filter((i) => i.checkedAt === null);
  const boughtItems = items.filter((i) => i.checkedAt !== null);

  return (
    <PageContainer>
      <PageHeader title="Shopper" />

      {pendingCount > 0 && (
        <div className={styles.syncBar}>
          <span>
            {pendingCount} change{pendingCount === 1 ? '' : 's'} pending sync
            {syncing ? '…' : ''}
          </span>
          {syncError && !syncing && (
            <>
              <span className={styles.syncErrorText}>{syncError}</span>
              <Button variant="secondary" size="sm" onClick={() => void sync()}>
                Retry
              </Button>
            </>
          )}
        </div>
      )}

      {accessibleLists.length > 1 && (
        <div className={styles.tabs} role="tablist" aria-label="Your lists">
          {accessibleLists.map((l) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={l.id === selected?.id}
              className={l.id === selected?.id ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              onClick={() => setSelectedListId(l.id)}
            >
              {l.name}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <>
          {selected.canEdit && (
            <form
              className={styles.addBar}
              onSubmit={(e) => {
                e.preventDefault();
                void handleAddSubmit(selected.id);
              }}
            >
              <Input
                value={addValue}
                onChange={(e) => setAddValue(e.target.value)}
                placeholder="Add an item…"
                aria-label="Add an item"
              />
              <Button type="submit" size="sm">
                Add
              </Button>
            </form>
          )}

          {items.length === 0 ? (
            <EmptyState
              heading="No items yet"
              description={
                selected.canEdit
                  ? 'Add an item above to get started.'
                  : "This list doesn't have any items yet."
              }
            />
          ) : (
            <ul className={styles.items}>
              {activeItems.map((item) =>
                editingId === item.id ? (
                  <li key={item.id} className={styles.editRow}>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      aria-label="Item name"
                    />
                    <Input
                      value={editQuantity}
                      onChange={(e) => setEditQuantity(e.target.value)}
                      aria-label="Quantity"
                      className={styles.editQuantity}
                    />
                    <Input
                      value={editUnit}
                      onChange={(e) => setEditUnit(e.target.value)}
                      aria-label="Unit"
                      placeholder="unit"
                      className={styles.editUnit}
                    />
                    <Button size="sm" onClick={() => void commitEdit(selected.id, item.id)}>
                      Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </li>
                ) : (
                  <li key={item.id} className={styles.item}>
                    <CheckableListRow
                      checked={false}
                      onCheckedChange={() => void handleToggleBought(selected.id, item)}
                      label={item.name}
                      icon={<Icon name={resolveIcon(item.icon, item.category)} size="md" aria-hidden />}
                      disabled={!selected.canEdit}
                      trailing={
                        <div className={styles.trailing}>
                          <span className={styles.quantity}>
                            {item.quantity}
                            {item.unit ? ` ${item.unit}` : ''}
                          </span>
                          {selected.canEdit && (
                            <>
                              <button
                                type="button"
                                className={styles.iconButton}
                                aria-label={`Edit ${item.name}`}
                                onClick={() => startEdit(item)}
                              >
                                <Icon name="pencil" size="sm" aria-hidden />
                              </button>
                              <button
                                type="button"
                                className={styles.iconButton}
                                aria-label={`Delete ${item.name}`}
                                onClick={() => void handleDelete(selected.id, item.id)}
                              >
                                <Icon name="trash-2" size="sm" aria-hidden />
                              </button>
                            </>
                          )}
                        </div>
                      }
                    />
                  </li>
                ),
              )}

              {boughtItems.length > 0 && (
                <li className={styles.boughtHeader}>Bought ({boughtItems.length})</li>
              )}
              {boughtItems.map((item) => (
                <li key={item.id} className={styles.item}>
                  <CheckableListRow
                    checked
                    onCheckedChange={() => void handleToggleBought(selected.id, item)}
                    label={item.name}
                    icon={<Icon name={resolveIcon(item.icon, item.category)} size="md" aria-hidden />}
                    disabled={!selected.canEdit}
                    trailing={
                      <span className={styles.quantity}>
                        {item.quantity}
                        {item.unit ? ` ${item.unit}` : ''}
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </PageContainer>
  );
}
