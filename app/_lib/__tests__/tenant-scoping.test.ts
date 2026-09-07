import { getTableName, type Table } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// The condition walker this sweep depends on is shared with the combined-view
// query-shape test — see its doc comment for why it must skip `.table`.
import { referencedColumnNames } from './condition-utils';

vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    auth: { requireSession: vi.fn(async () => ({ user: { id: 'user-1', tenantId: 'tenant-1' } })) },
    db: { getClient: vi.fn(async () => fakeDb) },
    directory: { searchUsers: vi.fn(async () => []), resolveUsers: vi.fn(async () => []) },
  },
}));

function expectTenantScoped(condition: unknown) {
  expect(referencedColumnNames(condition)).toContain('tenant_id');
}

const rowsByTable: Record<string, Record<string, unknown>[]> = {};

function seed(tableName: string, rows: Record<string, unknown>[]) {
  rowsByTable[tableName] = rows;
}

const whereCalls: { table: string; condition: unknown }[] = [];
const updateCalls: { table: string; condition: unknown }[] = [];
const deleteCalls: { table: string; condition: unknown }[] = [];
const insertCalls: { table: string; values: Record<string, unknown> }[] = [];

const fakeDb = {
  select() {
    return {
      from(table: Table) {
        const tableName = getTableName(table);
        const builder = {
          innerJoin() {
            return builder;
          },
          where(condition: unknown) {
            whereCalls.push({ table: tableName, condition });
            return builder;
          },
          orderBy() {
            return builder;
          },
          limit: async () => rowsByTable[tableName] ?? [],
          then(resolve: (rows: unknown[]) => void) {
            resolve(rowsByTable[tableName] ?? []);
          },
        };
        return builder;
      },
    };
  },
  insert(table: Table) {
    const tableName = getTableName(table);
    return {
      values(values: Record<string, unknown>) {
        insertCalls.push({ table: tableName, values });
        return {
          onConflictDoUpdate: async () => {},
          then(resolve: (v: undefined) => void) {
            resolve(undefined);
          },
        };
      },
    };
  },
  update(table: Table) {
    const tableName = getTableName(table);
    return {
      set() {
        return {
          async where(condition: unknown) {
            updateCalls.push({ table: tableName, condition });
          },
        };
      },
    };
  },
  delete(table: Table) {
    const tableName = getTableName(table);
    return {
      async where(condition: unknown) {
        deleteCalls.push({ table: tableName, condition });
      },
    };
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(rowsByTable)) rowsByTable[key] = [];
  whereCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  insertCalls.length = 0;

  seed('shopper_lists', [
    {
      id: 'list-1',
      tenantId: 'tenant-1',
      ownerUserId: 'user-1',
      householdId: null,
      name: 'Weekly groceries',
      kind: 'personal',
      createdBy: 'user-1',
      archivedAt: null,
      createdAt: 1000,
      updatedAt: 1000,
    },
  ]);
  seed('shopper_list_items', [
    {
      id: 'item-1',
      tenantId: 'tenant-1',
      listId: 'list-1',
      productId: null,
      name: 'Milk',
      quantity: '1',
      unit: null,
      category: null,
      icon: null,
      sortOrder: 0,
      checkedAt: null,
      addedBy: 'user-1',
      createdAt: 1000,
    },
  ]);
  seed('shopper_products', []);
  seed('shopper_purchases', []);
  seed('shopper_list_shares', []);
  seed('shopper_user_state', []);
});

// A regression that dropped `eq(table.tenantId, tenantId)` from a query's
// WHERE clause would still pass every access-control test (role checks don't
// depend on tenant) but would leak data across tenants in production. This
// sweep asserts the tenant_id column is actually named in the WHERE/UPDATE/
// DELETE condition — or present in the inserted row — for a representative
// action against every `shopper_*` table (SHP-01..09).
describe('tenant-scoping sweep across shopper_* tables', () => {
  it('shopper_lists: getList scopes its owned-list lookup by tenant', async () => {
    const { getList } = await import('../actions');
    await getList('list-1');
    const call = whereCalls.find((c) => c.table === 'shopper_lists');
    expect(call).toBeDefined();
    expectTenantScoped(call?.condition);
  });

  it('shopper_lists: renameList scopes its UPDATE by tenant', async () => {
    const { renameList } = await import('../actions');
    await renameList('list-1', 'New name');
    const call = updateCalls.find((c) => c.table === 'shopper_lists');
    expect(call).toBeDefined();
    expectTenantScoped(call?.condition);
  });

  it('shopper_lists: createList inserts a row carrying tenant_id', async () => {
    const { createList } = await import('../actions');
    await createList('Second list');
    const call = insertCalls.find((c) => c.table === 'shopper_lists');
    expect(call?.values.tenantId).toBe('tenant-1');
  });

  it('shopper_list_items: getListItems scopes its lookup by tenant', async () => {
    const { getListItems } = await import('../actions');
    await getListItems('list-1');
    const call = whereCalls.find((c) => c.table === 'shopper_list_items');
    expect(call).toBeDefined();
    expectTenantScoped(call?.condition);
  });

  it('shopper_list_items: deleteListItem scopes its DELETE by tenant', async () => {
    const { deleteListItem } = await import('../actions');
    await deleteListItem('list-1', 'item-1');
    const call = deleteCalls.find((c) => c.table === 'shopper_list_items');
    expect(call).toBeDefined();
    expectTenantScoped(call?.condition);
  });

  it('shopper_list_items: toggleItemBought scopes its UPDATE by tenant', async () => {
    const { toggleItemBought } = await import('../actions');
    await toggleItemBought('list-1', 'item-1');
    const call = updateCalls.find((c) => c.table === 'shopper_list_items');
    expect(call).toBeDefined();
    expectTenantScoped(call?.condition);
  });

  it('shopper_products: searchListSuggestions scopes its lookup by tenant', async () => {
    const { searchListSuggestions } = await import('../actions');
    await searchListSuggestions('list-1', 'milk');
    const call = whereCalls.find((c) => c.table === 'shopper_products');
    expect(call).toBeDefined();
    expectTenantScoped(call?.condition);
  });

  it('shopper_purchases: toggleItemBought inserts a purchase row carrying tenant_id', async () => {
    const { toggleItemBought } = await import('../actions');
    await toggleItemBought('list-1', 'item-1');
    const call = insertCalls.find((c) => c.table === 'shopper_purchases');
    expect(call?.values.tenantId).toBe('tenant-1');
  });

  it('shopper_list_shares: shareList inserts a share row carrying tenant_id', async () => {
    const { shareList } = await import('../actions');
    await shareList('list-1', 'user-2', 'viewer');
    const call = insertCalls.find((c) => c.table === 'shopper_list_shares');
    expect(call?.values.tenantId).toBe('tenant-1');
  });

  it('shopper_list_shares: revokeShare scopes its DELETE by tenant', async () => {
    const { revokeShare } = await import('../actions');
    await revokeShare('list-1', 'user-2');
    const call = deleteCalls.find((c) => c.table === 'shopper_list_shares');
    expect(call).toBeDefined();
    expectTenantScoped(call?.condition);
  });

  it('shopper_user_state: getLastListId scopes its lookup by tenant', async () => {
    const { getLastListId } = await import('../actions');
    await getLastListId();
    const call = whereCalls.find((c) => c.table === 'shopper_user_state');
    expect(call).toBeDefined();
    expectTenantScoped(call?.condition);
  });

  it('shopper_user_state: setLastList inserts a row carrying tenant_id', async () => {
    const { setLastList } = await import('../actions');
    await setLastList('list-1');
    const call = insertCalls.find((c) => c.table === 'shopper_user_state');
    expect(call?.values.tenantId).toBe('tenant-1');
  });
});
