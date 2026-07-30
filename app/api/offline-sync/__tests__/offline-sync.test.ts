import { getTableName, type Table } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    auth: { requireSession: vi.fn(async () => ({ user: { id: 'user-1', tenantId: 'tenant-1' } })) },
    db: { getClient: vi.fn(async () => fakeDb) },
  },
}));

const LIST_ID = 'list-1';
const TENANT_ID = 'tenant-1';
const OWNER_ID = 'user-1';

let lists: Record<string, unknown>[];
let listItems: Record<string, unknown>[];
let products: Record<string, unknown>[];
let purchases: Record<string, unknown>[];

function reset() {
  lists = [
    {
      id: LIST_ID,
      tenantId: TENANT_ID,
      ownerUserId: OWNER_ID,
      householdId: null,
      name: 'Groceries',
      kind: 'personal',
      createdBy: OWNER_ID,
      archivedAt: null,
      createdAt: 1000,
      updatedAt: 1000,
    },
  ];
  listItems = [];
  products = [];
  purchases = [];
}

function tableRows(tableName: string): Record<string, unknown>[] {
  switch (tableName) {
    case 'shopper_lists':
      return lists;
    case 'shopper_list_items':
      return listItems;
    case 'shopper_products':
      return products;
    case 'shopper_purchases':
      return purchases;
    case 'shopper_list_shares':
      return [];
    default:
      return [];
  }
}

/**
 * A stateful fake — unlike `access-control.test.ts`'s canned-response
 * style, idempotency/LWW tests here need mutations to actually persist
 * across sequential `applyMutation` calls within one test. Filters by
 * table name only (matches this plugin's established fake-DB convention —
 * it never evaluates WHERE predicates), which is enough since each test
 * only ever has one row per id.
 */
const fakeDb = {
  select(_fields?: unknown) {
    return {
      from(table: Table) {
        const tableName = getTableName(table);
        const rows = tableRows(tableName);
        const builder = {
          innerJoin() {
            return builder;
          },
          where() {
            return builder;
          },
          orderBy() {
            return builder;
          },
          limit: async (n: number) => rows.slice(0, n),
          then(resolve: (rows: unknown[]) => void) {
            resolve(rows);
          },
        };
        return builder;
      },
    };
  },
  insert(table: Table) {
    return {
      values(row: Record<string, unknown>) {
        tableRows(getTableName(table)).push(row);
        return Promise.resolve();
      },
    };
  },
  update(table: Table) {
    return {
      set(patch: Record<string, unknown>) {
        return {
          where() {
            const rows = tableRows(getTableName(table));
            // Applies to the single row under test — fine given the fake
            // never evaluates WHERE predicates (see doc comment above).
            Object.assign(rows[0] as Record<string, unknown>, patch);
            return Promise.resolve();
          },
        };
      },
    };
  },
  delete(table: Table) {
    return {
      where() {
        const tableName = getTableName(table);
        if (tableName === 'shopper_list_items') listItems.length = 0;
        if (tableName === 'shopper_purchases') purchases.length = 0;
        return Promise.resolve();
      },
    };
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  reset();
});

describe('applyMutation — addItem', () => {
  it('inserts a new item using the client-minted id', async () => {
    const { applyMutation } = await import('../route');
    const status = await applyMutation(
      'addItem',
      { id: 'item-1', listId: LIST_ID, name: 'Milk' },
      2000,
    );
    expect(status).toBe('applied');
    expect(listItems).toHaveLength(1);
    expect(listItems[0]).toMatchObject({ id: 'item-1', name: 'Milk', listId: LIST_ID });
  });

  it('is idempotent — a retried addItem with the same id is a no-op re-apply', async () => {
    const { applyMutation } = await import('../route');
    await applyMutation('addItem', { id: 'item-1', listId: LIST_ID, name: 'Milk' }, 2000);
    const status = await applyMutation(
      'addItem',
      { id: 'item-1', listId: LIST_ID, name: 'Milk' },
      2000,
    );
    expect(status).toBe('applied');
    expect(listItems).toHaveLength(1); // not inserted twice
  });

  it('fails when the parent list does not exist', async () => {
    lists = [];
    const { applyMutation } = await import('../route');
    const status = await applyMutation(
      'addItem',
      { id: 'item-1', listId: 'gone-list', name: 'Milk' },
      2000,
    );
    expect(status).toBe('failed');
    expect(listItems).toHaveLength(0);
  });
});

describe('applyMutation — updateItem (last-write-wins)', () => {
  beforeEach(() => {
    listItems = [
      {
        id: 'item-1',
        tenantId: TENANT_ID,
        listId: LIST_ID,
        productId: null,
        name: 'Milk',
        quantity: '1',
        unit: null,
        category: null,
        icon: null,
        sortOrder: 0,
        checkedAt: null,
        addedBy: OWNER_ID,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];
  });

  it('applies when the mutation is newer than the row', async () => {
    const { applyMutation } = await import('../route');
    const status = await applyMutation(
      'updateItem',
      { listId: LIST_ID, itemId: 'item-1', name: 'Oat milk', quantity: '2', unit: 'L' },
      2000,
    );
    expect(status).toBe('applied');
    expect(listItems[0]).toMatchObject({ name: 'Oat milk', quantity: '2', unit: 'L', updatedAt: 2000 });
  });

  it('skips when the mutation is older than or equal to the row\'s updatedAt', async () => {
    (listItems[0] as { updatedAt: number }).updatedAt = 5000;
    const { applyMutation } = await import('../route');
    const status = await applyMutation(
      'updateItem',
      { listId: LIST_ID, itemId: 'item-1', name: 'Oat milk', quantity: '2', unit: 'L' },
      2000,
    );
    expect(status).toBe('skipped');
    expect(listItems[0]).toMatchObject({ name: 'Milk' }); // unchanged
  });

  it('skips (not fails) when the item was deleted elsewhere', async () => {
    listItems = [];
    const { applyMutation } = await import('../route');
    const status = await applyMutation(
      'updateItem',
      { listId: LIST_ID, itemId: 'item-1', name: 'Oat milk', quantity: '2', unit: 'L' },
      2000,
    );
    expect(status).toBe('skipped');
  });
});

describe('applyMutation — deleteItem', () => {
  it('is idempotent — deleting an already-gone item still reports applied', async () => {
    listItems = [];
    const { applyMutation } = await import('../route');
    const status = await applyMutation('deleteItem', { listId: LIST_ID, itemId: 'item-1' }, 2000);
    expect(status).toBe('applied');
  });
});

describe('applyMutation — setBought (absolute state, not a toggle)', () => {
  beforeEach(() => {
    listItems = [
      {
        id: 'item-1',
        tenantId: TENANT_ID,
        listId: LIST_ID,
        productId: null,
        name: 'Milk',
        quantity: '1',
        unit: null,
        category: null,
        icon: null,
        sortOrder: 0,
        checkedAt: null,
        addedBy: OWNER_ID,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];
  });

  it('marks an item bought and records a purchase row', async () => {
    const { applyMutation } = await import('../route');
    const status = await applyMutation(
      'setBought',
      { listId: LIST_ID, itemId: 'item-1', bought: true, at: 3000 },
      3000,
    );
    expect(status).toBe('applied');
    expect(listItems[0]).toMatchObject({ checkedAt: 3000 });
    expect(purchases).toHaveLength(1);
  });

  it('a retried "bought: true" delivery does not insert a second purchase row', async () => {
    const { applyMutation } = await import('../route');
    await applyMutation(
      'setBought',
      { listId: LIST_ID, itemId: 'item-1', bought: true, at: 3000 },
      3000,
    );
    const status = await applyMutation(
      'setBought',
      { listId: LIST_ID, itemId: 'item-1', bought: true, at: 3000 },
      3000,
    );
    expect(status).toBe('applied'); // no-op re-apply, not an error
    expect(purchases).toHaveLength(1); // still just one
  });

  it('unmarking clears checkedAt and removes the purchase row', async () => {
    (listItems[0] as { checkedAt: number | null }).checkedAt = 3000;
    purchases = [{ id: 'p-1', listItemId: 'item-1', tenantId: TENANT_ID }];
    const { applyMutation } = await import('../route');
    const status = await applyMutation(
      'setBought',
      { listId: LIST_ID, itemId: 'item-1', bought: false, at: 4000 },
      4000,
    );
    expect(status).toBe('applied');
    expect(listItems[0]).toMatchObject({ checkedAt: null });
    expect(purchases).toHaveLength(0);
  });
});
