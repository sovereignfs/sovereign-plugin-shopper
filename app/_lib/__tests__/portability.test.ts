import { getTableName, type Table } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DeletionContext,
  DeletionResult,
  ExportContext,
  ImportContext,
  PluginExportSection,
} from '@sovereignfs/sdk';

type Row = Record<string, unknown>;
type Condition =
  | { kind: 'eq'; key: string; value: unknown }
  | { kind: 'and'; conditions: Condition[] }
  | { kind: 'or'; conditions: Condition[] };

function toCamel(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_match, c: string) => c.toUpperCase());
}

// Real and()/or()/eq() build opaque SQL AST nodes; mocking them to build a
// small, interpretable Condition tree instead lets the fake db below actually
// filter rows per-query, matching the precision the real handler depends on.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: { name: string }, value: unknown): Condition => ({
      kind: 'eq',
      key: toCamel(column.name),
      value,
    }),
    and: (...conditions: Condition[]): Condition => ({ kind: 'and', conditions }),
    or: (...conditions: Condition[]): Condition => ({ kind: 'or', conditions }),
    // Reuses the 'eq' node shape with an array `value` — matches() below
    // special-cases an array value as membership rather than equality.
    inArray: (column: { name: string }, values: unknown[]): Condition => ({
      kind: 'eq',
      key: toCamel(column.name),
      value: values,
    }),
  };
});

function matches(row: Row, condition?: Condition): boolean {
  if (!condition) return true;
  if (condition.kind === 'eq') {
    if (Array.isArray(condition.value)) return condition.value.includes(row[condition.key]);
    return row[condition.key] === condition.value;
  }
  if (condition.kind === 'and') return condition.conditions.every((c) => matches(row, c));
  return condition.conditions.some((c) => matches(row, c));
}

const capturedExporter = { fn: null as ((ctx: ExportContext) => Promise<PluginExportSection>) | null };
const capturedImporter = {
  fn: null as ((section: PluginExportSection, ctx: ImportContext) => Promise<void>) | null,
};
const capturedDeleter = {
  fn: null as ((ctx: DeletionContext) => Promise<DeletionResult>) | null,
};

vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    db: { getClient: vi.fn(async () => fakeDb) },
    portability: {
      provideExport: vi.fn(async (fn: typeof capturedExporter.fn) => {
        capturedExporter.fn = fn;
      }),
      provideImport: vi.fn(async (fn: typeof capturedImporter.fn) => {
        capturedImporter.fn = fn;
      }),
      provideDelete: vi.fn(async (fn: typeof capturedDeleter.fn) => {
        capturedDeleter.fn = fn;
      }),
    },
  },
}));

interface Store extends Record<string, Row[]> {
  shopper_lists: Row[];
  shopper_list_shares: Row[];
  shopper_products: Row[];
  shopper_list_items: Row[];
  shopper_purchases: Row[];
  shopper_user_state: Row[];
}

let store: Store = {
  shopper_lists: [],
  shopper_list_shares: [],
  shopper_products: [],
  shopper_list_items: [],
  shopper_purchases: [],
  shopper_user_state: [],
};

function resetStore() {
  store = {
    shopper_lists: [],
    shopper_list_shares: [],
    shopper_products: [],
    shopper_list_items: [],
    shopper_purchases: [],
    shopper_user_state: [],
  };
}

const fakeDb = {
  select(columns?: Record<string, unknown>) {
    return {
      from(table: Table) {
        const tableName = getTableName(table);
        return {
          where: async (condition?: Condition) => {
            const rows = (store[tableName] ?? []).filter((row) => matches(row, condition));
            if (!columns) return rows;
            return rows.map((row) => {
              const projected: Row = {};
              for (const key of Object.keys(columns)) projected[key] = row[key];
              return projected;
            });
          },
        };
      },
    };
  },
  insert(table: Table) {
    const tableName = getTableName(table);
    return {
      values: async (row: Row) => {
        (store[tableName] ??= []).push(row);
      },
    };
  },
  delete(table: Table) {
    const tableName = getTableName(table);
    return {
      where: async (condition?: Condition) => {
        store[tableName] = (store[tableName] ?? []).filter((row) => !matches(row, condition));
      },
    };
  },
  update(table: Table) {
    const tableName = getTableName(table);
    return {
      set(values: Row) {
        return {
          where: async (condition?: Condition) => {
            for (const row of store[tableName] ?? []) {
              if (matches(row, condition)) Object.assign(row, values);
            }
          },
        };
      },
    };
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('portability export', () => {
  it("exports only the user's own lists, items, products, purchases, and user state", async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.shopper_lists = [
      { id: 'list-1', tenantId: 't1', ownerUserId: 'u1', name: 'Groceries', kind: 'personal', createdBy: 'u1', archivedAt: null, createdAt: 1, updatedAt: 1 },
      { id: 'list-2', tenantId: 't1', ownerUserId: 'other', name: 'Not mine', kind: 'personal', createdBy: 'other', archivedAt: null, createdAt: 1, updatedAt: 1 },
    ];
    store.shopper_list_items = [
      { id: 'item-1', tenantId: 't1', listId: 'list-1', productId: null, name: 'Milk', quantity: '1', unit: null, category: null, icon: null, sortOrder: 0, checkedAt: null, addedBy: 'u1', createdAt: 1 },
      { id: 'item-2', tenantId: 't1', listId: 'list-2', productId: null, name: 'Not mine', quantity: '1', unit: null, category: null, icon: null, sortOrder: 0, checkedAt: null, addedBy: 'other', createdAt: 1 },
    ];
    store.shopper_products = [
      { id: 'prod-1', tenantId: 't1', ownerUserId: 'u1', name: 'Milk', normalizedName: 'milk', category: null, icon: null, iconAssetPath: null, barcode: null, photoPath: null, defaultUnit: null, typicalPrice: null, onHandQty: null, lowStockThreshold: null, createdBy: 'u1', createdAt: 1, updatedAt: 1 },
    ];
    store.shopper_purchases = [
      { id: 'pur-1', tenantId: 't1', ownerUserId: 'u1', listId: 'list-1', listItemId: 'item-1', productId: 'prod-1', name: 'Milk', quantity: '1', unit: null, price: 250, currency: 'USD', purchasedBy: 'u1', purchasedAt: 1 },
    ];
    store.shopper_user_state = [{ userId: 'u1', tenantId: 't1', lastListId: 'list-1', updatedAt: 1 }];

    const section = await capturedExporter.fn?.({
      userId: 'u1',
      tenantId: 't1',
      options: { includeFiles: true },
    });
    expect(section).toBeDefined();

    const data = (section as PluginExportSection).data as {
      lists: { id: string }[];
      items: { id: string }[];
      products: { id: string }[];
      purchases: { id: string }[];
      userState: { lastListId: string | null } | null;
    };
    expect(data.lists.map((l) => l.id)).toEqual(['list-1']);
    expect(data.items.map((i) => i.id)).toEqual(['item-1']);
    expect(data.products.map((p) => p.id)).toEqual(['prod-1']);
    expect(data.purchases.map((p) => p.id)).toEqual(['pur-1']);
    expect(data.userState?.lastListId).toBe('list-1');
  });
});

describe('portability import', () => {
  it('remaps ids and scopes every inserted row to the importing user', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    const section: PluginExportSection = {
      pluginId: 'fs.sovereign.shopper',
      schemaVersion: 1,
      data: {
        lists: [{ id: 'src-list-1', name: 'Groceries', kind: 'personal', createdBy: 'src-user', archivedAt: null, createdAt: 1, updatedAt: 1 }],
        listShares: [],
        products: [],
        items: [{ id: 'src-item-1', listId: 'src-list-1', productId: null, name: 'Milk', quantity: '1', unit: null, category: null, icon: null, sortOrder: 0, checkedAt: null, addedBy: 'src-user', createdAt: 1 }],
        purchases: [],
        userState: null,
      },
    };

    let seenNewListId: string | undefined;
    const remapId = (originalId: string) => {
      if (originalId === 'src-list-1') seenNewListId = seenNewListId ?? 'new-list-1';
      return originalId === 'src-list-1' ? 'new-list-1' : `new-${originalId}`;
    };

    await capturedImporter.fn?.(section, { userId: 'u2', tenantId: 't1', remapId });

    expect(store.shopper_lists).toEqual([
      expect.objectContaining({ id: 'new-list-1', tenantId: 't1', ownerUserId: 'u2', createdBy: 'u2' }),
    ]);
    expect(store.shopper_list_items).toEqual([
      expect.objectContaining({ id: 'new-src-item-1', listId: 'new-list-1', addedBy: 'u2' }),
    ]);
    expect(seenNewListId).toBe('new-list-1');
  });

  it('skips an item whose listId is not part of this export', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    const section: PluginExportSection = {
      pluginId: 'fs.sovereign.shopper',
      schemaVersion: 1,
      data: {
        lists: [],
        listShares: [],
        products: [],
        items: [{ id: 'orphan-item', listId: 'not-in-export', productId: null, name: 'X', quantity: '1', unit: null, category: null, icon: null, sortOrder: 0, checkedAt: null, addedBy: 'src-user', createdAt: 1 }],
        purchases: [],
        userState: null,
      },
    };

    await capturedImporter.fn?.(section, { userId: 'u2', tenantId: 't1', remapId: (id) => `new-${id}` });
    expect(store.shopper_list_items).toEqual([]);
  });
});

describe('portability delete', () => {
  it("deletes only the user's own lists, items, shares, products, purchases, and state", async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.shopper_lists = [
      { id: 'list-1', tenantId: 't1', ownerUserId: 'u1', name: 'Mine', kind: 'personal', createdBy: 'u1', archivedAt: null, createdAt: 1, updatedAt: 1 },
      { id: 'list-2', tenantId: 't1', ownerUserId: 'other', name: 'Not mine', kind: 'personal', createdBy: 'other', archivedAt: null, createdAt: 1, updatedAt: 1 },
    ];
    store.shopper_list_items = [
      { id: 'item-1', tenantId: 't1', listId: 'list-1', productId: null, name: 'Milk', quantity: '1', unit: null, category: null, icon: null, sortOrder: 0, checkedAt: null, addedBy: 'u1', createdAt: 1 },
    ];
    store.shopper_list_shares = [
      { id: 'share-1', tenantId: 't1', listId: 'list-1', userId: 'other', role: 'viewer', createdAt: 1 },
      { id: 'share-2', tenantId: 't1', listId: 'list-2', userId: 'u1', role: 'viewer', createdAt: 1 },
    ];
    store.shopper_products = [
      { id: 'prod-1', tenantId: 't1', ownerUserId: 'u1', name: 'Milk', normalizedName: 'milk', category: null, icon: null, iconAssetPath: null, barcode: null, photoPath: null, defaultUnit: null, typicalPrice: null, onHandQty: null, lowStockThreshold: null, createdBy: 'u1', createdAt: 1, updatedAt: 1 },
    ];
    store.shopper_purchases = [
      { id: 'pur-1', tenantId: 't1', ownerUserId: 'u1', listId: 'list-1', listItemId: 'item-1', productId: 'prod-1', name: 'Milk', quantity: '1', unit: null, price: 250, currency: 'USD', purchasedBy: 'u1', purchasedAt: 1 },
    ];
    store.shopper_user_state = [{ userId: 'u1', tenantId: 't1', lastListId: 'list-1', updatedAt: 1 }];

    const result = await capturedDeleter.fn?.({ userId: 'u1', tenantId: 't1', db: fakeDb });
    expect(result).toBeDefined();

    expect(store.shopper_lists).toEqual([expect.objectContaining({ id: 'list-2' })]);
    expect(store.shopper_list_items).toEqual([]);
    // share-1 (on u1's own list) and share-2 (granted to u1) are both gone;
    // only list-2's other-owned share would remain if it existed.
    expect(store.shopper_list_shares).toEqual([]);
    expect(store.shopper_products).toEqual([]);
    expect(store.shopper_purchases).toEqual([]);
    expect(store.shopper_user_state).toEqual([]);
    expect(result?.deleted).toBeGreaterThan(0);
  });

  it("severs the user's attribution on other people's rows instead of deleting them (RFC 0097)", async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    // list-2 belongs to `other`; u1 was an editor on it.
    store.shopper_lists = [
      { id: 'list-2', tenantId: 't1', ownerUserId: 'other', name: 'Not mine', kind: 'personal', createdBy: 'other', archivedAt: null, createdAt: 1, updatedAt: 1 },
    ];
    store.shopper_list_items = [
      // u1 added this to someone else's list — must survive, attribution severed.
      { id: 'item-theirs', tenantId: 't1', listId: 'list-2', productId: null, name: 'Bread', quantity: '1', unit: null, category: null, icon: null, sortOrder: 0, checkedAt: null, addedBy: 'u1', createdAt: 1, updatedAt: 1 },
      // Untouched: someone else's row on someone else's list.
      { id: 'item-other', tenantId: 't1', listId: 'list-2', productId: null, name: 'Eggs', quantity: '1', unit: null, category: null, icon: null, sortOrder: 1, checkedAt: null, addedBy: 'other', createdAt: 1, updatedAt: 1 },
    ];
    store.shopper_purchases = [
      // Owned by `other`, purchased by u1 — their ledger entry, must survive.
      { id: 'pur-theirs', tenantId: 't1', ownerUserId: 'other', listId: 'list-2', listItemId: 'item-theirs', productId: null, name: 'Bread', quantity: '1', unit: null, price: 200, currency: 'USD', purchasedBy: 'u1', purchasedAt: 1 },
    ];

    const result = await capturedDeleter.fn?.({ userId: 'u1', tenantId: 't1', db: fakeDb });

    // The rows still exist — they belong to `other`.
    expect(store.shopper_list_items).toHaveLength(2);
    expect(store.shopper_purchases).toHaveLength(1);

    // ...but no longer name the deleted account.
    expect(store.shopper_list_items.find((r) => r.id === 'item-theirs')?.addedBy).toBeNull();
    expect(store.shopper_purchases[0]?.purchasedBy).toBeNull();

    // A third party's attribution is untouched.
    expect(store.shopper_list_items.find((r) => r.id === 'item-other')?.addedBy).toBe('other');

    // Severed rows are counted separately, never as deletions.
    expect(result?.anonymized).toBe(2);
    expect(result?.deleted).toBe(0);
  });

  it('does not sever attribution belonging to another tenant', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.shopper_list_items = [
      { id: 'item-t2', tenantId: 't2', listId: 'list-9', productId: null, name: 'Rice', quantity: '1', unit: null, category: null, icon: null, sortOrder: 0, checkedAt: null, addedBy: 'u1', createdAt: 1, updatedAt: 1 },
    ];

    const result = await capturedDeleter.fn?.({ userId: 'u1', tenantId: 't1', db: fakeDb });

    expect(store.shopper_list_items[0]?.addedBy).toBe('u1');
    expect(result?.anonymized).toBe(0);
  });
});
