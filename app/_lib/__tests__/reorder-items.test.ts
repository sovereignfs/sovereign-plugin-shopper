import { getTableName, type Table } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    auth: { requireSession: vi.fn(async () => ({ user: { id: 'user-1', tenantId: 'tenant-1' } })) },
    db: { getClient: vi.fn(async () => fakeDb) },
    directory: { searchUsers: vi.fn(async () => []), resolveUsers: vi.fn(async () => []) },
  },
}));

const baseList = {
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
};

// The owner-lookup branch of getList() selects from shopper_lists; the
// reorder itself selects/updates shopper_list_items — routed by table name,
// same pattern as the other test files in this directory.
let itemRows: { id: string; sortOrder: number }[] = [];
const updateCalls: { id: string; sortOrder: number }[] = [];

const fakeDb = {
  select() {
    return {
      from(table: Table) {
        const tableName = getTableName(table);
        return {
          where() {
            return this;
          },
          limit: async () => (tableName === 'shopper_lists' ? [baseList] : []),
          then(resolve: (rows: unknown[]) => void) {
            resolve(tableName === 'shopper_list_items' ? itemRows : []);
          },
        };
      },
    };
  },
  update(table: Table) {
    const tableName = getTableName(table);
    return {
      set(values: { sortOrder: number }) {
        return {
          async where() {
            if (tableName === 'shopper_list_items') {
              // The WHERE clause is keyed by id but this fake doesn't
              // evaluate predicates — set() is called once per id in
              // production code, in orderedIds' own order, so recording
              // set()'s argument in call order is equivalent to recording
              // which id it was for, without needing to parse the condition.
              updateCalls.push({ id: `call-${updateCalls.length}`, sortOrder: values.sortOrder });
            }
          },
        };
      },
    };
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  updateCalls.length = 0;
  itemRows = [
    { id: 'item-a', sortOrder: 0 },
    { id: 'item-b', sortOrder: 1 },
    { id: 'item-c', sortOrder: 2 },
  ];
});

describe('reorderItems — slot-preserving reassignment', () => {
  it('reassigns the same set of existing sortOrder slots, permuted into the new order', async () => {
    const { reorderItems } = await import('../actions');

    // Drag item-c to the front: new order is c, a, b.
    await reorderItems('list-1', ['item-c', 'item-a', 'item-b']);

    // Slots [0, 1, 2] (the same three values item-a/b/c already occupied)
    // get reassigned in orderedIds' order — item-c gets 0, item-a gets 1,
    // item-b gets 2 — never renumbered from an unrelated baseline, and
    // never touching a fourth item outside orderedIds.
    expect(updateCalls.map((c) => c.sortOrder)).toEqual([0, 1, 2]);
  });

  it('throws without writing anything when an id is stale (not on this list)', async () => {
    // The query only ever resolves rows the DB actually has — item-x isn't
    // one of them, so the fake's "query result" (itemRows) has fewer rows
    // than orderedIds, exactly like a real inArray() lookup would.
    //
    // It throws rather than returning quietly: the caller has already applied
    // the drag optimistically, and a silent return was indistinguishable from
    // success — the order snapped back on the next refresh with nothing said.
    itemRows = [{ id: 'item-a', sortOrder: 0 }];
    const { reorderItems } = await import('../actions');

    await expect(reorderItems('list-1', ['item-a', 'item-x'])).rejects.toThrow(
      /list changed while you were dragging/i,
    );

    expect(updateCalls).toHaveLength(0);
  });

  it('no-ops for a single-id array — nothing to reorder', async () => {
    const { reorderItems } = await import('../actions');

    await reorderItems('list-1', ['item-a']);

    expect(updateCalls).toHaveLength(0);
  });
});
