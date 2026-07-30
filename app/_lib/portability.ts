import { sdk } from '@sovereignfs/sdk';
import type {
  DeletionContext,
  DeletionResult,
  ExportContext,
  ImportContext,
  PluginExportSection,
} from '@sovereignfs/sdk';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import {
  shopperListItems,
  shopperListShares,
  shopperLists,
  shopperProducts,
  shopperPurchases,
  shopperUserState,
} from '../_db/schema';

// The SDK intentionally returns an opaque dialect-agnostic DB client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BaseSQLiteDatabase<'async', any, any>;

const PLUGIN_ID = 'fs.sovereign.shopper';
const EXPORT_SCHEMA_VERSION = 1;

/**
 * Registers Shopper's export/import/delete participation (RFC 0007 / RFC 0033,
 * RFC 0068). Must be called from a request-scoped Shopper route — this repo
 * calls it from `app/layout.tsx`, same as every other request-scoped setup
 * (registrations are in-process and reset on restart).
 */
export async function registerPortabilityHandlers(): Promise<void> {
  await sdk.portability.provideExport(exportShopperData);
  await sdk.portability.provideImport(importShopperData);
  await sdk.portability.provideDelete(deleteAllShopperData);
}

// ---- Export shape ----
// Keyed by each row's *original* id. `householdId` is always null in Phase 1
// (see plugin CLAUDE.md) and intentionally omitted here — nothing to export.
// Shares *granted to* this user on someone else's list are another user's
// data, not this user's own, so they are not exported (same punt Tasks makes
// on collaborator fields, pending sdk.directory-backed cross-user handling).

interface ExportList {
  id: string;
  name: string;
  kind: string;
  createdBy: string;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface ExportListShare {
  id: string;
  listId: string;
  userId: string;
  role: string;
  createdAt: number;
}

interface ExportProduct {
  id: string;
  name: string;
  normalizedName: string;
  category: string | null;
  icon: string | null;
  iconAssetPath: string | null;
  barcode: string | null;
  photoPath: string | null;
  defaultUnit: string | null;
  typicalPrice: number | null;
  onHandQty: string | null;
  lowStockThreshold: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

interface ExportListItem {
  id: string;
  listId: string;
  productId: string | null;
  name: string;
  quantity: string;
  unit: string | null;
  category: string | null;
  icon: string | null;
  sortOrder: number;
  checkedAt: number | null;
  addedBy: string;
  createdAt: number;
  updatedAt: number;
}

interface ExportPurchase {
  id: string;
  listId: string | null;
  listItemId: string | null;
  productId: string | null;
  name: string;
  quantity: string;
  unit: string | null;
  price: number | null;
  currency: string | null;
  purchasedBy: string;
  purchasedAt: number;
}

interface ExportUserState {
  lastListId: string | null;
  updatedAt: number;
}

interface ShopperExportData {
  lists: ExportList[];
  listShares: ExportListShare[];
  products: ExportProduct[];
  items: ExportListItem[];
  purchases: ExportPurchase[];
  /** null when the user never opened Shopper (no row exists). */
  userState: ExportUserState | null;
}

async function exportShopperData(ctx: ExportContext): Promise<PluginExportSection> {
  const db = (await sdk.db.getClient()) as Db;
  const { userId, tenantId } = ctx;

  const listRows = await db
    .select()
    .from(shopperLists)
    .where(and(eq(shopperLists.tenantId, tenantId), eq(shopperLists.ownerUserId, userId)));
  const listIds = listRows.map((l) => l.id);

  const lists: ExportList[] = listRows.map((l) => ({
    id: l.id,
    name: l.name,
    kind: l.kind,
    createdBy: l.createdBy,
    archivedAt: l.archivedAt,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  }));

  let listShares: ExportListShare[] = [];
  let items: ExportListItem[] = [];

  if (listIds.length > 0) {
    const [shareRows, itemRows] = await Promise.all([
      db
        .select()
        .from(shopperListShares)
        .where(
          and(eq(shopperListShares.tenantId, tenantId), inArray(shopperListShares.listId, listIds)),
        ),
      db
        .select()
        .from(shopperListItems)
        .where(and(eq(shopperListItems.tenantId, tenantId), inArray(shopperListItems.listId, listIds))),
    ]);
    listShares = shareRows.map((s) => ({
      id: s.id,
      listId: s.listId,
      userId: s.userId,
      role: s.role,
      createdAt: s.createdAt,
    }));
    items = itemRows.map((i) => ({
      id: i.id,
      listId: i.listId,
      productId: i.productId,
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
      category: i.category,
      icon: i.icon,
      sortOrder: i.sortOrder,
      checkedAt: i.checkedAt,
      addedBy: i.addedBy,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    }));
  }

  const productRows = await db
    .select()
    .from(shopperProducts)
    .where(and(eq(shopperProducts.tenantId, tenantId), eq(shopperProducts.ownerUserId, userId)));
  const products: ExportProduct[] = productRows.map((p) => ({
    id: p.id,
    name: p.name,
    normalizedName: p.normalizedName,
    category: p.category,
    icon: p.icon,
    iconAssetPath: p.iconAssetPath,
    barcode: p.barcode,
    photoPath: p.photoPath,
    defaultUnit: p.defaultUnit,
    typicalPrice: p.typicalPrice,
    onHandQty: p.onHandQty,
    lowStockThreshold: p.lowStockThreshold,
    createdBy: p.createdBy,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));

  const purchaseRows = await db
    .select()
    .from(shopperPurchases)
    .where(and(eq(shopperPurchases.tenantId, tenantId), eq(shopperPurchases.ownerUserId, userId)));
  const purchases: ExportPurchase[] = purchaseRows.map((p) => ({
    id: p.id,
    listId: p.listId,
    listItemId: p.listItemId,
    productId: p.productId,
    name: p.name,
    quantity: p.quantity,
    unit: p.unit,
    price: p.price,
    currency: p.currency,
    purchasedBy: p.purchasedBy,
    purchasedAt: p.purchasedAt,
  }));

  const stateRows = await db
    .select()
    .from(shopperUserState)
    .where(and(eq(shopperUserState.tenantId, tenantId), eq(shopperUserState.userId, userId)));
  const stateRow = stateRows[0];
  const userState: ExportUserState | null = stateRow
    ? { lastListId: stateRow.lastListId, updatedAt: stateRow.updatedAt }
    : null;

  const data: ShopperExportData = { lists, listShares, products, items, purchases, userState };
  return { pluginId: PLUGIN_ID, schemaVersion: EXPORT_SCHEMA_VERSION, data };
}

// ---- Import ----

function isShopperExportData(value: unknown): value is ShopperExportData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ShopperExportData>;
  return (
    Array.isArray(candidate.lists) &&
    Array.isArray(candidate.listShares) &&
    Array.isArray(candidate.products) &&
    Array.isArray(candidate.items) &&
    Array.isArray(candidate.purchases)
  );
}

async function importShopperData(section: PluginExportSection, ctx: ImportContext): Promise<void> {
  if (section.schemaVersion !== EXPORT_SCHEMA_VERSION || !isShopperExportData(section.data)) {
    throw new Error('Shopper import section has an unrecognized shape.');
  }
  const data = section.data;
  const db = (await sdk.db.getClient()) as Db;

  const originalListIds = new Set(data.lists.map((l) => l.id));
  const originalProductIds = new Set(data.products.map((p) => p.id));

  for (const list of data.lists) {
    await db.insert(shopperLists).values({
      id: ctx.remapId(list.id),
      tenantId: ctx.tenantId,
      ownerUserId: ctx.userId,
      householdId: null,
      name: list.name,
      kind: list.kind,
      createdBy: ctx.userId,
      archivedAt: list.archivedAt,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
    });
  }

  for (const product of data.products) {
    await db.insert(shopperProducts).values({
      id: ctx.remapId(product.id),
      tenantId: ctx.tenantId,
      ownerUserId: ctx.userId,
      householdId: null,
      name: product.name,
      normalizedName: product.normalizedName,
      category: product.category,
      icon: product.icon,
      iconAssetPath: product.iconAssetPath,
      barcode: product.barcode,
      photoPath: product.photoPath,
      defaultUnit: product.defaultUnit,
      typicalPrice: product.typicalPrice,
      onHandQty: product.onHandQty,
      lowStockThreshold: product.lowStockThreshold,
      createdBy: ctx.userId,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    });
  }

  for (const item of data.items) {
    if (!originalListIds.has(item.listId)) continue;
    await db.insert(shopperListItems).values({
      id: ctx.remapId(item.id),
      tenantId: ctx.tenantId,
      listId: ctx.remapId(item.listId),
      productId: item.productId && originalProductIds.has(item.productId)
        ? ctx.remapId(item.productId)
        : null,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      category: item.category,
      icon: item.icon,
      sortOrder: item.sortOrder,
      checkedAt: item.checkedAt,
      addedBy: ctx.userId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  }

  for (const purchase of data.purchases) {
    await db.insert(shopperPurchases).values({
      id: ctx.remapId(purchase.id),
      tenantId: ctx.tenantId,
      ownerUserId: ctx.userId,
      householdId: null,
      listId: purchase.listId && originalListIds.has(purchase.listId)
        ? ctx.remapId(purchase.listId)
        : null,
      // A remapped list item's id is deterministic per source id via
      // ctx.remapId even though it wasn't looked up above — same original id
      // always yields the same new id within this import.
      listItemId: purchase.listItemId ? ctx.remapId(purchase.listItemId) : null,
      productId: purchase.productId && originalProductIds.has(purchase.productId)
        ? ctx.remapId(purchase.productId)
        : null,
      name: purchase.name,
      quantity: purchase.quantity,
      unit: purchase.unit,
      price: purchase.price,
      currency: purchase.currency,
      purchasedBy: ctx.userId,
      purchasedAt: purchase.purchasedAt,
    });
  }

  // shopper_user_state is a per-user singleton (PK is user_id) — only seed it
  // when the importing account doesn't already have one, same "additive,
  // never overwrite" rule Tasks applies to its own singleton row.
  if (data.userState) {
    const existing = await db
      .select({ userId: shopperUserState.userId })
      .from(shopperUserState)
      .where(and(eq(shopperUserState.tenantId, ctx.tenantId), eq(shopperUserState.userId, ctx.userId)));
    if (existing.length === 0) {
      await db.insert(shopperUserState).values({
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        lastListId:
          data.userState.lastListId && originalListIds.has(data.userState.lastListId)
            ? ctx.remapId(data.userState.lastListId)
            : null,
        updatedAt: data.userState.updatedAt,
      });
    }
  }

  // List shares are not re-created: `listShares[].userId` names another
  // user's account on the source instance, which has no guaranteed
  // counterpart on the importing instance. Re-granting access safely needs
  // sdk.directory-backed user resolution, the same gap Tasks' assigneeId
  // hits — out of scope here.
}

// ---- Delete ----

async function deleteAllShopperData(ctx: DeletionContext): Promise<DeletionResult> {
  const db = ctx.db as Db;
  let deleted = 0;

  const listRows = await db
    .select({ id: shopperLists.id })
    .from(shopperLists)
    .where(and(eq(shopperLists.tenantId, ctx.tenantId), eq(shopperLists.ownerUserId, ctx.userId)));
  const listIds = listRows.map((l) => l.id);

  if (listIds.length > 0) {
    const [itemRows, shareRows] = await Promise.all([
      db
        .select({ id: shopperListItems.id })
        .from(shopperListItems)
        .where(and(eq(shopperListItems.tenantId, ctx.tenantId), inArray(shopperListItems.listId, listIds))),
      db
        .select({ id: shopperListShares.id })
        .from(shopperListShares)
        .where(
          and(
            eq(shopperListShares.tenantId, ctx.tenantId),
            or(inArray(shopperListShares.listId, listIds), eq(shopperListShares.userId, ctx.userId)),
          ),
        ),
    ]);
    await db
      .delete(shopperListItems)
      .where(and(eq(shopperListItems.tenantId, ctx.tenantId), inArray(shopperListItems.listId, listIds)));
    await db
      .delete(shopperListShares)
      .where(
        and(
          eq(shopperListShares.tenantId, ctx.tenantId),
          or(inArray(shopperListShares.listId, listIds), eq(shopperListShares.userId, ctx.userId)),
        ),
      );
    deleted += itemRows.length + shareRows.length;
  } else {
    // The user may still hold shares granted by someone else's list even
    // with no owned lists of their own.
    const shareRows = await db
      .select({ id: shopperListShares.id })
      .from(shopperListShares)
      .where(and(eq(shopperListShares.tenantId, ctx.tenantId), eq(shopperListShares.userId, ctx.userId)));
    await db
      .delete(shopperListShares)
      .where(and(eq(shopperListShares.tenantId, ctx.tenantId), eq(shopperListShares.userId, ctx.userId)));
    deleted += shareRows.length;
  }

  deleted += listRows.length;
  await db
    .delete(shopperLists)
    .where(and(eq(shopperLists.tenantId, ctx.tenantId), eq(shopperLists.ownerUserId, ctx.userId)));

  const productRows = await db
    .select({ id: shopperProducts.id })
    .from(shopperProducts)
    .where(and(eq(shopperProducts.tenantId, ctx.tenantId), eq(shopperProducts.ownerUserId, ctx.userId)));
  await db
    .delete(shopperProducts)
    .where(and(eq(shopperProducts.tenantId, ctx.tenantId), eq(shopperProducts.ownerUserId, ctx.userId)));
  deleted += productRows.length;

  const purchaseRows = await db
    .select({ id: shopperPurchases.id })
    .from(shopperPurchases)
    .where(and(eq(shopperPurchases.tenantId, ctx.tenantId), eq(shopperPurchases.ownerUserId, ctx.userId)));
  await db
    .delete(shopperPurchases)
    .where(and(eq(shopperPurchases.tenantId, ctx.tenantId), eq(shopperPurchases.ownerUserId, ctx.userId)));
  deleted += purchaseRows.length;

  const stateRows = await db
    .select({ userId: shopperUserState.userId })
    .from(shopperUserState)
    .where(and(eq(shopperUserState.tenantId, ctx.tenantId), eq(shopperUserState.userId, ctx.userId)));
  await db
    .delete(shopperUserState)
    .where(and(eq(shopperUserState.tenantId, ctx.tenantId), eq(shopperUserState.userId, ctx.userId)));
  deleted += stateRows.length;

  return { deleted };
}
