import { integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Shopper Postgres schema mirror.
 *
 * Application code should import `db/schema.ts` (→ `app/_db/schema.ts`).
 * This file mirrors the same physical column names and broadly compatible
 * scalar types for Postgres migration generation only — it is never imported
 * by application code. No native `boolean`/`bigint` here: application code
 * stays on the SQLite-typed schema, so Postgres columns must serialize
 * identically to it (see docs/plugin-database.md).
 */

export const shopperLists = pgTable('shopper_lists', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  householdId: text('household_id'),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('personal'),
  createdBy: text('created_by').notNull(),
  archivedAt: integer('archived_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const shopperListShares = pgTable(
  'shopper_list_shares',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    listId: text('list_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('shopper_list_shares_list_user_idx').on(t.listId, t.userId)],
);

export const shopperProducts = pgTable(
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

export const shopperListItems = pgTable('shopper_list_items', {
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

export const shopperPurchases = pgTable('shopper_purchases', {
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

export const shopperUserState = pgTable('shopper_user_state', {
  userId: text('user_id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  lastListId: text('last_list_id'),
  updatedAt: integer('updated_at').notNull(),
});
