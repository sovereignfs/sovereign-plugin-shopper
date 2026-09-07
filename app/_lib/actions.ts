'use server';

import { sdk } from '@sovereignfs/sdk';
import { and, asc, desc, eq, inArray, isNotNull, isNull, like } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { randomUUID } from 'node:crypto';
import {
  shopperListItems,
  shopperListShares,
  shopperLists,
  shopperProducts,
  shopperPurchases,
  shopperUserState,
} from '../_db/schema';
import { suggestCategoryAndIcon } from './icons';
import { normalize, now } from './helpers';
import type {
  CombinedItemRow,
  DirectoryUserRow,
  ListItemDetail,
  ListItemRow,
  ListRow,
  ListShareRow,
  ProductSuggestion,
  SharedListRow,
} from './types';

// DrizzleClient is typed as `unknown` in the SDK (dialect-agnostic contract).
// We cast to the SQLite type here since the platform default dialect is SQLite.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = BaseSQLiteDatabase<'async', any, any>;

export async function getContext() {
  const session = await sdk.auth.requireSession();
  const db = (await sdk.db.getClient()) as Db;
  return { db, userId: session.user.id, tenantId: session.user.tenantId };
}

function toListRow(row: typeof shopperLists.$inferSelect, role: ListRow['role']): ListRow {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === 'household' ? 'household' : 'personal',
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    role,
    ownerUserId: row.ownerUserId,
  };
}

/** Lists owned by the current user, excluding archived ones. */
export async function getLists(): Promise<ListRow[]> {
  const { db, userId, tenantId } = await getContext();
  const rows = await db
    .select()
    .from(shopperLists)
    .where(
      and(
        eq(shopperLists.tenantId, tenantId),
        eq(shopperLists.ownerUserId, userId),
        isNull(shopperLists.archivedAt),
      ),
    )
    .orderBy(shopperLists.createdAt);
  return rows.map((row) => toListRow(row, 'owner'));
}

/** Lists shared with the current user by someone else (SHP-02). Nothing can
 *  populate `shopper_list_shares` yet — sharing UI is T-10 — so this is
 *  always empty until then, but the read path is ready for it. */
export async function getSharedLists(): Promise<SharedListRow[]> {
  const { db, userId, tenantId } = await getContext();
  const rows = await db
    .select({ list: shopperLists, role: shopperListShares.role })
    .from(shopperListShares)
    .innerJoin(shopperLists, eq(shopperListShares.listId, shopperLists.id))
    .where(and(eq(shopperListShares.tenantId, tenantId), eq(shopperListShares.userId, userId)))
    .orderBy(shopperListShares.createdAt);

  const visible = rows.filter((r) => r.list.archivedAt === null);
  if (visible.length === 0) return [];

  const ownerIds = [...new Set(visible.map((r) => r.list.ownerUserId))];
  const owners = await sdk.directory.resolveUsers({ ids: ownerIds });
  const ownerNameById = new Map(owners.map((o) => [o.id, o.name ?? o.email]));

  return visible.map((r) => ({
    id: r.list.id,
    name: r.list.name,
    role: r.role === 'editor' ? 'editor' : 'viewer',
    ownerName: ownerNameById.get(r.list.ownerUserId) ?? 'Someone',
  }));
}

/** A single list the current user can access — owned or shared with them.
 *  Returns null if it doesn't exist, is archived, or the caller has neither
 *  ownership nor a share. */
export async function getList(listId: string): Promise<ListRow | null> {
  const { db, userId, tenantId } = await getContext();

  const [owned] = await db
    .select()
    .from(shopperLists)
    .where(
      and(
        eq(shopperLists.id, listId),
        eq(shopperLists.tenantId, tenantId),
        eq(shopperLists.ownerUserId, userId),
        isNull(shopperLists.archivedAt),
      ),
    )
    .limit(1);
  if (owned) return toListRow(owned, 'owner');

  const [shared] = await db
    .select({ list: shopperLists, role: shopperListShares.role })
    .from(shopperListShares)
    .innerJoin(shopperLists, eq(shopperListShares.listId, shopperLists.id))
    .where(
      and(
        eq(shopperListShares.listId, listId),
        eq(shopperListShares.tenantId, tenantId),
        eq(shopperListShares.userId, userId),
        isNull(shopperLists.archivedAt),
      ),
    )
    .limit(1);
  if (shared) return toListRow(shared.list, shared.role === 'editor' ? 'editor' : 'viewer');

  return null;
}

/** Every list the current user can see, owned or shared — the source set
 *  for the combined view (SHP-02). */
export async function getAccessibleLists(): Promise<{ id: string; name: string }[]> {
  const [owned, shared] = await Promise.all([getLists(), getSharedLists()]);
  return [...owned, ...shared].map((l) => ({ id: l.id, name: l.name }));
}

/** Read-only roll-up of the items still to buy across every accessible list
 *  (SHP-02). Bought items are excluded, matching the per-list view where a
 *  checked item leaves its category group for `BoughtSection` — this view has
 *  no equivalent section (it's read-only, you un-buy from the item's own
 *  list), so a bought item here would just be noise in a "what's left to
 *  buy" roll-up. */
export async function getCombinedItems(): Promise<CombinedItemRow[]> {
  const { db, tenantId } = await getContext();
  const accessible = await getAccessibleLists();
  if (accessible.length === 0) return [];

  const listNameById = new Map(accessible.map((l) => [l.id, l.name]));
  const rows = await db
    .select()
    .from(shopperListItems)
    .where(
      and(
        eq(shopperListItems.tenantId, tenantId),
        isNull(shopperListItems.checkedAt),
        inArray(
          shopperListItems.listId,
          accessible.map((l) => l.id),
        ),
      ),
    )
    .orderBy(asc(shopperListItems.sortOrder), asc(shopperListItems.createdAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    category: row.category,
    icon: row.icon,
    sourceListId: row.listId,
    sourceListName: listNameById.get(row.listId) ?? 'Unknown list',
  }));
}

/** The current user's last-opened list id (SHP-03), or null if never set or
 *  no `shopper_user_state` row exists yet. */
export async function getLastListId(): Promise<string | null> {
  const { db, userId, tenantId } = await getContext();
  const [row] = await db
    .select({ lastListId: shopperUserState.lastListId })
    .from(shopperUserState)
    .where(and(eq(shopperUserState.userId, userId), eq(shopperUserState.tenantId, tenantId)))
    .limit(1);
  return row?.lastListId ?? null;
}

/** Records the list the current user just opened, for SHP-03's landing
 *  redirect. Called from the list detail page on every visit — idempotent
 *  upsert, not gated on ownership since a shared list can be "last used"
 *  too. */
export async function setLastList(listId: string): Promise<void> {
  const { db, userId, tenantId } = await getContext();
  const ts = now();
  await db
    .insert(shopperUserState)
    .values({ userId, tenantId, lastListId: listId, updatedAt: ts })
    .onConflictDoUpdate({
      target: shopperUserState.userId,
      set: { lastListId: listId, updatedAt: ts },
    });
}

/** Throws when the user already owns a live list by this name (compared
 *  case-insensitively, the same `normalize()` the product catalog uses).
 *  Application-level rather than a unique index: archived lists keep their
 *  names, so the constraint is "no two *visible* lists with one name", which
 *  a DB index over (owner, name) can't express without also blocking a
 *  re-use of an archived list's name. `exceptListId` skips the row being
 *  renamed so re-saving an unchanged name isn't a conflict with itself. */
async function assertListNameAvailable(
  db: Db,
  tenantId: string,
  userId: string,
  trimmed: string,
  exceptListId?: string,
): Promise<void> {
  const rows = await db
    .select({ id: shopperLists.id, name: shopperLists.name })
    .from(shopperLists)
    .where(
      and(
        eq(shopperLists.tenantId, tenantId),
        eq(shopperLists.ownerUserId, userId),
        isNull(shopperLists.archivedAt),
      ),
    );
  const normalized = normalize(trimmed);
  const clash = rows.some((row) => row.id !== exceptListId && normalize(row.name) === normalized);
  if (clash) throw new Error(`You already have a list called “${trimmed}”.`);
}

export async function createList(name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('List name is required.');

  const { db, userId, tenantId } = await getContext();
  await assertListNameAvailable(db, tenantId, userId, trimmed);
  const id = randomUUID();
  const ts = now();

  await db.insert(shopperLists).values({
    id,
    tenantId,
    ownerUserId: userId,
    name: trimmed,
    kind: 'personal',
    createdBy: userId,
    createdAt: ts,
    updatedAt: ts,
  });

  return id;
}

/** Owner-only (SHP-01). Was previously scoped by `owner_user_id` in the
 *  UPDATE's WHERE clause alone — a non-owner's call matched zero rows and
 *  returned as a silent no-op instead of an explicit error, inconsistent
 *  with every other mutating action here. Fixed in T-11's hardening pass to
 *  use the same explicit getList() + role check pattern as the rest. */
export async function renameList(listId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('List name is required.');

  const list = await getList(listId);
  if (!list) throw new Error('List not found.');
  if (list.role !== 'owner') throw new Error('Only the owner can rename this list.');

  const { db, userId, tenantId } = await getContext();
  await assertListNameAvailable(db, tenantId, userId, trimmed, listId);
  await db
    .update(shopperLists)
    .set({ name: trimmed, updatedAt: now() })
    .where(and(eq(shopperLists.id, listId), eq(shopperLists.tenantId, tenantId)));
}

/** Owner-only (SHP-01). See renameList's doc comment — same silent-no-op
 *  bug, same T-11 fix. */
export async function archiveList(listId: string): Promise<void> {
  const list = await getList(listId);
  if (!list) throw new Error('List not found.');
  if (list.role !== 'owner') throw new Error('Only the owner can archive this list.');

  const { db, tenantId } = await getContext();
  await db
    .update(shopperLists)
    .set({ archivedAt: now(), updatedAt: now() })
    .where(and(eq(shopperLists.id, listId), eq(shopperLists.tenantId, tenantId)));
}

/** Items on a list, in manual order (SHP-04/06/07/08). Access-checked —
 *  returns [] rather than throwing if the caller can't see the list, so a
 *  page render never has to special-case "list not found" twice. */
export async function getListItems(listId: string): Promise<ListItemRow[]> {
  const list = await getList(listId);
  if (!list) return [];

  const { db, tenantId } = await getContext();
  const rows = await db
    .select()
    .from(shopperListItems)
    .where(and(eq(shopperListItems.listId, listId), eq(shopperListItems.tenantId, tenantId)))
    .orderBy(asc(shopperListItems.sortOrder), asc(shopperListItems.createdAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    category: row.category,
    icon: row.icon,
    checkedAt: row.checkedAt,
    sortOrder: row.sortOrder,
  }));
}

/** Type-ahead suggestions for the add-item bar (SHP-04) — matches against
 *  the *list owner's* catalog, not the acting user's, so an editor
 *  contributing to someone else's list sees (and adds to) that owner's
 *  remembered products. Simple prefix/contains + recency ranking; learned
 *  frequency ranking is v0.3 (T-23), not Phase 1. */
export async function searchListSuggestions(
  listId: string,
  query: string,
): Promise<ProductSuggestion[]> {
  const list = await getList(listId);
  if (!list) return [];
  const trimmed = query.trim();
  if (!trimmed) return [];

  const { db, tenantId } = await getContext();
  const rows = await db
    .select()
    .from(shopperProducts)
    .where(
      and(
        eq(shopperProducts.tenantId, tenantId),
        eq(shopperProducts.ownerUserId, list.ownerUserId),
        like(shopperProducts.normalizedName, `%${normalize(trimmed)}%`),
      ),
    )
    .orderBy(asc(shopperProducts.name))
    .limit(8);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    icon: row.icon,
    defaultUnit: row.defaultUnit,
  }));
}

/** Quick-add (SHP-04): finds or creates a catalog product scoped to the
 *  list's owner, then adds it to the list. Editors can add (they can write
 *  to a list they were given editor access to); viewers cannot — mirrors
 *  the read-only rule already applied to rename/archive. */
export async function addItemToList(listId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Item name is required.');

  const list = await getList(listId);
  if (!list) throw new Error('List not found.');
  if (list.role === 'viewer') throw new Error("You don't have permission to edit this list.");

  const { db, userId, tenantId } = await getContext();
  const normalized = normalize(trimmed);
  const ts = now();

  const [existingProduct] = await db
    .select()
    .from(shopperProducts)
    .where(
      and(
        eq(shopperProducts.tenantId, tenantId),
        eq(shopperProducts.ownerUserId, list.ownerUserId),
        eq(shopperProducts.normalizedName, normalized),
      ),
    )
    .limit(1);

  const product =
    existingProduct ??
    (await (async () => {
      const id = randomUUID();
      // Best-effort category + icon from the name (SHP-05) — a starting
      // guess, not a commitment; the manual picker (T-07) always wins if
      // the user changes it later.
      const { category, icon } = suggestCategoryAndIcon(trimmed);
      await db.insert(shopperProducts).values({
        id,
        tenantId,
        ownerUserId: list.ownerUserId,
        name: trimmed,
        normalizedName: normalized,
        category,
        icon,
        createdBy: userId,
        createdAt: ts,
        updatedAt: ts,
      });
      return { id, name: trimmed, category, icon, defaultUnit: null as string | null };
    })());

  const [lastItem] = await db
    .select({ sortOrder: shopperListItems.sortOrder })
    .from(shopperListItems)
    .where(eq(shopperListItems.listId, listId))
    .orderBy(desc(shopperListItems.sortOrder))
    .limit(1);
  const nextSortOrder = (lastItem?.sortOrder ?? -1) + 1;

  await db.insert(shopperListItems).values({
    id: randomUUID(),
    tenantId,
    listId,
    productId: product.id,
    name: product.name,
    quantity: '1',
    unit: product.defaultUnit,
    category: product.category,
    icon: product.icon,
    sortOrder: nextSortOrder,
    addedBy: userId,
    createdAt: ts,
    updatedAt: ts,
  });
}

/** Full edit-form detail for one item (SHP-06, T-07) — joins in the linked
 *  product's barcode/price, which don't live on the list-item row itself.
 *  Returns null if the item doesn't exist, isn't on this list, or the
 *  caller can't access the list. */
export async function getListItemDetail(
  listId: string,
  itemId: string,
): Promise<ListItemDetail | null> {
  const list = await getList(listId);
  if (!list) return null;

  const { db, tenantId } = await getContext();
  const [item] = await db
    .select()
    .from(shopperListItems)
    .where(
      and(
        eq(shopperListItems.id, itemId),
        eq(shopperListItems.listId, listId),
        eq(shopperListItems.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!item) return null;

  let barcode: string | null = null;
  let price: number | null = null;
  if (item.productId) {
    const [product] = await db
      .select({ barcode: shopperProducts.barcode, price: shopperProducts.typicalPrice })
      .from(shopperProducts)
      .where(eq(shopperProducts.id, item.productId))
      .limit(1);
    if (product) {
      barcode = product.barcode;
      price = product.price;
    }
  }

  return {
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    category: item.category,
    icon: item.icon,
    checkedAt: item.checkedAt,
    sortOrder: item.sortOrder,
    productId: item.productId,
    barcode,
    price,
  };
}

export interface UpdateListItemInput {
  name: string;
  quantity: string;
  unit: string | null;
  category: string | null;
  icon: string | null;
  barcode: string | null;
  /** Cents, or null to clear. */
  price: number | null;
}

/** Saves item edits (SHP-06). Updates the list-item row itself (name,
 *  quantity, unit, category, icon) and, when the item is linked to a
 *  catalog product, the product row too (name, category, icon, default
 *  unit, barcode, price) — "the next add of the same item is pre-filled"
 *  per SPEC.md. Viewers are blocked, same rule as every other write. */
export async function updateListItem(
  listId: string,
  itemId: string,
  input: UpdateListItemInput,
): Promise<void> {
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error('Item name is required.');

  const list = await getList(listId);
  if (!list) throw new Error('List not found.');
  if (list.role === 'viewer') throw new Error("You don't have permission to edit this list.");

  const { db, tenantId } = await getContext();
  const ts = now();

  const [item] = await db
    .select({ productId: shopperListItems.productId })
    .from(shopperListItems)
    .where(and(eq(shopperListItems.id, itemId), eq(shopperListItems.listId, listId)))
    .limit(1);
  if (!item) throw new Error('Item not found.');

  await db
    .update(shopperListItems)
    .set({
      name: trimmed,
      quantity: input.quantity,
      unit: input.unit,
      category: input.category,
      icon: input.icon,
      updatedAt: ts,
    })
    .where(and(eq(shopperListItems.id, itemId), eq(shopperListItems.tenantId, tenantId)));

  if (item.productId) {
    await db
      .update(shopperProducts)
      .set({
        name: trimmed,
        normalizedName: normalize(trimmed),
        category: input.category,
        icon: input.icon,
        defaultUnit: input.unit,
        barcode: input.barcode,
        typicalPrice: input.price,
        updatedAt: ts,
      })
      .where(and(eq(shopperProducts.id, item.productId), eq(shopperProducts.tenantId, tenantId)));
  }
}

/** Removes an item from the list (not the catalog product behind it, which
 *  stays for future suggestions). Viewers are blocked. */
export async function deleteListItem(listId: string, itemId: string): Promise<void> {
  const list = await getList(listId);
  if (!list) throw new Error('List not found.');
  if (list.role === 'viewer') throw new Error("You don't have permission to edit this list.");

  const { db, tenantId } = await getContext();
  await db
    .delete(shopperListItems)
    .where(
      and(
        eq(shopperListItems.id, itemId),
        eq(shopperListItems.listId, listId),
        eq(shopperListItems.tenantId, tenantId),
      ),
    );
}

/** Tap-to-buy (SHP-07): marks an item bought or reverses that. Marking bought
 *  sets `checked_at` and writes a `shopper_purchases` row (buyer, time,
 *  list, quantity, price from the linked product's `typical_price` if
 *  known) — the data spine the household ledger and analytics (v0.2+) will
 *  read from. Un-tapping clears `checked_at` and removes the purchase row
 *  it created, so accidental taps leave no trace. Viewers are blocked. */
export async function toggleItemBought(listId: string, itemId: string): Promise<void> {
  const list = await getList(listId);
  if (!list) throw new Error('List not found.');
  if (list.role === 'viewer') throw new Error("You don't have permission to edit this list.");

  const { db, userId, tenantId } = await getContext();
  const [item] = await db
    .select()
    .from(shopperListItems)
    .where(and(eq(shopperListItems.id, itemId), eq(shopperListItems.listId, listId)))
    .limit(1);
  if (!item) throw new Error('Item not found.');

  const ts = now();

  if (item.checkedAt) {
    await db
      .update(shopperListItems)
      .set({ checkedAt: null, updatedAt: ts })
      .where(and(eq(shopperListItems.id, itemId), eq(shopperListItems.tenantId, tenantId)));
    await db
      .delete(shopperPurchases)
      .where(
        and(eq(shopperPurchases.listItemId, itemId), eq(shopperPurchases.tenantId, tenantId)),
      );
    return;
  }

  let price: number | null = null;
  if (item.productId) {
    const [product] = await db
      .select({ price: shopperProducts.typicalPrice })
      .from(shopperProducts)
      .where(eq(shopperProducts.id, item.productId))
      .limit(1);
    price = product?.price ?? null;
  }

  await db
    .update(shopperListItems)
    .set({ checkedAt: ts, updatedAt: ts })
    .where(and(eq(shopperListItems.id, itemId), eq(shopperListItems.tenantId, tenantId)));

  await db.insert(shopperPurchases).values({
    id: randomUUID(),
    tenantId,
    ownerUserId: list.ownerUserId,
    listId,
    listItemId: itemId,
    productId: item.productId,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    price,
    purchasedBy: userId,
    purchasedAt: ts,
  });
}

/** Removes every bought item from the list (SHP-08). Their purchase history
 *  stays — this only tidies the active list, it isn't undoing the buy — but
 *  each surviving `shopper_purchases` row has its `list_item_id` cleared
 *  first so nothing dangles once the item row it pointed at is gone. */
export async function clearBoughtItems(listId: string): Promise<void> {
  const list = await getList(listId);
  if (!list) throw new Error('List not found.');
  if (list.role === 'viewer') throw new Error("You don't have permission to edit this list.");

  const { db, tenantId } = await getContext();
  const bought = await db
    .select({ id: shopperListItems.id })
    .from(shopperListItems)
    .where(
      and(
        eq(shopperListItems.listId, listId),
        eq(shopperListItems.tenantId, tenantId),
        isNotNull(shopperListItems.checkedAt),
      ),
    );
  const boughtIds = bought.map((r) => r.id);
  if (boughtIds.length === 0) return;

  await db
    .update(shopperPurchases)
    .set({ listItemId: null })
    .where(
      and(inArray(shopperPurchases.listItemId, boughtIds), eq(shopperPurchases.tenantId, tenantId)),
    );

  await db
    .delete(shopperListItems)
    .where(and(inArray(shopperListItems.id, boughtIds), eq(shopperListItems.tenantId, tenantId)));
}

/** Reorders items within a category group (SHP-08, drag-and-drop) — the
 *  caller (the grouped list view) determines the group's new id order; this
 *  reassigns the *same set* of `sort_order` values that set of ids already
 *  occupies, permuted into the new order, rather than renumbering from 0.
 *  That's deliberate: `sort_order` is one flat column shared across the
 *  whole list, not scoped per category — `groupItemsByCategory` derives
 *  each category *section's* position from comparing categories' first-item
 *  `sort_order`, so renumbering a dragged category's items to 0..n would
 *  collide with every other category's values and scramble which section
 *  renders first. Reassigning existing slots leaves every item outside
 *  `orderedIds` completely untouched. Throws (no partial write) if any id
 *  doesn't resolve to a row on this list — a stale id from a concurrent edit
 *  elsewhere. It used to return silently instead, which the caller couldn't
 *  distinguish from success: the optimistic order stayed on screen until the
 *  refresh snapped it back, with nothing explaining why. */
export async function reorderItems(listId: string, orderedIds: string[]): Promise<void> {
  const list = await getList(listId);
  if (!list) throw new Error('List not found.');
  if (list.role === 'viewer') throw new Error("You don't have permission to edit this list.");
  if (orderedIds.length < 2) return;

  const { db, tenantId } = await getContext();
  const rows = await db
    .select({ id: shopperListItems.id, sortOrder: shopperListItems.sortOrder })
    .from(shopperListItems)
    .where(
      and(
        inArray(shopperListItems.id, orderedIds),
        eq(shopperListItems.listId, listId),
        eq(shopperListItems.tenantId, tenantId),
      ),
    );
  if (rows.length !== orderedIds.length) {
    throw new Error('This list changed while you were dragging — nothing was reordered.');
  }

  const slots = rows.map((r) => r.sortOrder).sort((a, b) => a - b);
  await Promise.all(
    orderedIds.map((id, i) =>
      db
        .update(shopperListItems)
        .set({ sortOrder: slots[i] })
        .where(and(eq(shopperListItems.id, id), eq(shopperListItems.tenantId, tenantId))),
    ),
  );
}

/** Search box results for the share dialog (SHP-09, T-10) — a thin wrapper
 *  around sdk.directory.searchUsers so the client component never imports
 *  the SDK directly. */
export async function searchDirectoryUsers(query: string): Promise<DirectoryUserRow[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  await sdk.auth.requireSession();
  const results = await sdk.directory.searchUsers({ query: trimmed, limit: 8 });
  return results.map((u) => ({ id: u.id, name: u.name ?? u.email, email: u.email }));
}

/** Current shares for a list — the share dialog's "People with access" list
 *  (SHP-09, T-10). Owner-only; returns [] for anyone else rather than
 *  throwing, since the dialog itself is never shown to a non-owner. */
export async function getListShares(listId: string): Promise<ListShareRow[]> {
  const list = await getList(listId);
  if (!list || list.role !== 'owner') return [];

  const { db, tenantId } = await getContext();
  const rows = await db
    .select()
    .from(shopperListShares)
    .where(and(eq(shopperListShares.listId, listId), eq(shopperListShares.tenantId, tenantId)));
  if (rows.length === 0) return [];

  const users = await sdk.directory.resolveUsers({ ids: rows.map((r) => r.userId) });
  const userById = new Map(users.map((u) => [u.id, u]));

  return rows.map((r) => {
    const user = userById.get(r.userId);
    return {
      userId: r.userId,
      name: user?.name ?? user?.email ?? 'Unknown user',
      email: user?.email ?? '',
      role: r.role === 'editor' ? 'editor' : 'viewer',
    };
  });
}

/** Grants (or updates) a share (SHP-09, T-10). Owner-only — an editor
 *  cannot re-share a list they were only given editor access to. Upserts on
 *  the (list_id, user_id) unique index, so sharing again with a different
 *  role just changes it rather than erroring on a duplicate. */
export async function shareList(
  listId: string,
  userId: string,
  role: 'editor' | 'viewer',
): Promise<void> {
  const list = await getList(listId);
  if (!list) throw new Error('List not found.');
  if (list.role !== 'owner') throw new Error('Only the owner can share this list.');

  const { db, tenantId } = await getContext();
  await db
    .insert(shopperListShares)
    .values({ id: randomUUID(), tenantId, listId, userId, role, createdAt: now() })
    .onConflictDoUpdate({
      target: [shopperListShares.listId, shopperListShares.userId],
      set: { role },
    });
}

/** Revokes a share (SHP-09, T-10). Owner-only. */
export async function revokeShare(listId: string, userId: string): Promise<void> {
  const list = await getList(listId);
  if (!list) throw new Error('List not found.');
  if (list.role !== 'owner') throw new Error('Only the owner can manage sharing.');

  const { db, tenantId } = await getContext();
  await db
    .delete(shopperListShares)
    .where(
      and(
        eq(shopperListShares.listId, listId),
        eq(shopperListShares.userId, userId),
        eq(shopperListShares.tenantId, tenantId),
      ),
    );
}
