import { getTableName, type Table } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { referencedColumnNames } from './condition-utils';

vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    auth: { requireSession: vi.fn(async () => ({ user: { id: 'user-1', tenantId: 'tenant-1' } })) },
    db: { getClient: vi.fn(async () => fakeDb) },
    directory: { searchUsers: vi.fn(async () => []), resolveUsers: vi.fn(async () => []) },
  },
}));

const rowsByTable: Record<string, Record<string, unknown>[]> = {};
const whereCalls: { table: string; condition: unknown }[] = [];
const insertCalls: { table: string; values: Record<string, unknown> }[] = [];
const updateCalls: { table: string }[] = [];

/** Same shape as the other suites' fakes — routes by table name and does not
 *  evaluate predicates, which is why the checked_at assertion below inspects
 *  the condition object rather than the rows it returns. */
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
          async where() {
            updateCalls.push({ table: tableName });
          },
        };
      },
    };
  },
  delete() {
    return { async where() {} };
  },
};

function list(id: string, name: string) {
  return {
    id,
    tenantId: 'tenant-1',
    ownerUserId: 'user-1',
    householdId: null,
    name,
    kind: 'personal',
    createdBy: 'user-1',
    archivedAt: null,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(rowsByTable)) rowsByTable[key] = [];
  whereCalls.length = 0;
  insertCalls.length = 0;
  updateCalls.length = 0;

  rowsByTable['shopper_lists'] = [list('list-1', 'Weekly groceries')];
  rowsByTable['shopper_list_items'] = [
    {
      id: 'item-1',
      tenantId: 'tenant-1',
      listId: 'list-1',
      productId: null,
      name: 'Milk',
      quantity: '2',
      unit: 'L',
      category: 'Dairy & Eggs',
      icon: 'milk',
      sortOrder: 0,
      checkedAt: null,
      addedBy: 'user-1',
      createdAt: 1000,
      updatedAt: 1000,
    },
  ];
  rowsByTable['shopper_list_shares'] = [];
  rowsByTable['shopper_products'] = [];
  rowsByTable['shopper_purchases'] = [];
  rowsByTable['shopper_user_state'] = [];
});

describe('getCombinedItems — only what is still to buy', () => {
  // The combined view shipped without this filter: it selected every item on
  // every accessible list, so already-bought items sat in its category groups
  // with nothing marking them bought, in the one view whose entire job is
  // "what's left to buy". The fake never evaluates a WHERE clause, so this
  // asserts the query actually names checked_at rather than trusting the rows.
  it('filters the item query by checked_at', async () => {
    const { getCombinedItems } = await import('../actions');
    await getCombinedItems();

    const itemQuery = whereCalls.find((c) => c.table === 'shopper_list_items');
    expect(itemQuery).toBeDefined();
    const columns = referencedColumnNames(itemQuery?.condition);
    expect(columns).toContain('checked_at');
    expect(columns).toContain('tenant_id');
  });

  it('tags each row with the list it came from', async () => {
    const { getCombinedItems } = await import('../actions');
    const items = await getCombinedItems();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: 'Milk',
      sourceListId: 'list-1',
      sourceListName: 'Weekly groceries',
    });
  });
});

describe('list names are unique among a user’s live lists', () => {
  it('createList rejects a name already in use, ignoring case and padding', async () => {
    const { createList } = await import('../actions');

    await expect(createList('  weekly GROCERIES  ')).rejects.toThrow(/already have a list called/i);
    expect(insertCalls.filter((c) => c.table === 'shopper_lists')).toHaveLength(0);
  });

  it('createList accepts a name nothing else is using', async () => {
    const { createList } = await import('../actions');

    await createList('Hardware store');
    expect(insertCalls.find((c) => c.table === 'shopper_lists')?.values.name).toBe(
      'Hardware store',
    );
  });

  it('renameList rejects a name another list already holds', async () => {
    rowsByTable['shopper_lists'] = [list('list-1', 'Weekly groceries'), list('list-2', 'Pharmacy')];
    const { renameList } = await import('../actions');

    await expect(renameList('list-1', 'Pharmacy')).rejects.toThrow(/already have a list called/i);
    expect(updateCalls).toHaveLength(0);
  });

  it('renameList lets a list keep its own name — the clash check skips itself', async () => {
    const { renameList } = await import('../actions');

    await renameList('list-1', 'Weekly groceries');
    expect(updateCalls.filter((c) => c.table === 'shopper_lists')).toHaveLength(1);
  });
});
