import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Plugin schema — sovereign-shopper.
 *
 * Runtime query schema. This file intentionally lives under app/ because the
 * Sovereign runtime mounts the plugin app tree into Next routes — server
 * components/actions must not import runtime query helpers from outside that
 * mounted tree. `db/schema.ts` re-exports this file for tooling (drizzle-kit).
 *
 * Conventions:
 * - IDs: ULIDs stored as text.
 * - Timestamps: Unix epoch seconds stored as integer.
 * - Quantities: stored as text holding a canonical decimal string (e.g.
 *   "1.5") — SPEC.md requires dialect-agnostic, non-binary-float storage for
 *   fractional quantities.
 * - Money (`price`, `typical_price`): integer, smallest currency unit (cents).
 * - `database.isolation: "isolated"` (see manifest.json) — no slug prefix is
 *   required, but table names keep the `shopper_` prefix from SPEC.md for
 *   readability and consistency with the doc.
 * - `tenant_id` on every user-scoped table (multi-tenancy readiness).
 *
 * Phase 1 scope only (SPEC.md v0.1): no household_id usage yet — the column
 * exists now, nullable, so Phase 2 (households) adds no destructive
 * migration. See SPEC.md "Data model" for the full field-by-field rationale.
 */

export const shopperLists = sqliteTable('shopper_lists', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  householdId: text('household_id'),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('personal'), // 'personal' | 'household'
  createdBy: text('created_by').notNull(),
  archivedAt: integer('archived_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const shopperListShares = sqliteTable(
  'shopper_list_shares',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    listId: text('list_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').notNull(), // 'editor' | 'viewer'
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('shopper_list_shares_list_user_idx').on(t.listId, t.userId)],
);

export const shopperProducts = sqliteTable(
  'shopper_products',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    householdId: text('household_id'),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    category: text('category'),
    icon: text('icon'),
    iconAssetPath: text('icon_asset_path'),
    barcode: text('barcode'),
    photoPath: text('photo_path'),
    defaultUnit: text('default_unit'),
    typicalPrice: integer('typical_price'),
    onHandQty: text('on_hand_qty'),
    lowStockThreshold: text('low_stock_threshold'),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('shopper_products_owner_normalized_idx').on(t.ownerUserId, t.normalizedName),
  ],
);

export const shopperListItems = sqliteTable('shopper_list_items', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  listId: text('list_id').notNull(),
  productId: text('product_id'),
  name: text('name').notNull(),
  quantity: text('quantity').notNull(),
  unit: text('unit'),
  category: text('category'),
  icon: text('icon'),
  sortOrder: integer('sort_order').notNull().default(0),
  checkedAt: integer('checked_at'),
  addedBy: text('added_by'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const shopperPurchases = sqliteTable('shopper_purchases', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  householdId: text('household_id'),
  listId: text('list_id'),
  listItemId: text('list_item_id'),
  productId: text('product_id'),
  name: text('name').notNull(),
  quantity: text('quantity').notNull(),
  unit: text('unit'),
  price: integer('price'),
  currency: text('currency'),
  purchasedBy: text('purchased_by'),
  purchasedAt: integer('purchased_at').notNull(),
});

export const shopperUserState = sqliteTable('shopper_user_state', {
  userId: text('user_id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  lastListId: text('last_list_id'),
  updatedAt: integer('updated_at').notNull(),
});
