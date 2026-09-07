import type { ListItemRow } from './types';

/** Anything groupable by category — a list item (`ListItemRow`) or a combined
 *  roll-up row (`CombinedItemRow`), which carries no `sort_order` of its own. */
interface Categorized {
  category: string | null;
}

export interface CategoryGroup<T extends Categorized = ListItemRow> {
  category: string;
  items: T[];
}

const UNCATEGORIZED = 'Uncategorized';

/** Groups active (unchecked) items by category for the list view (SHP-08),
 *  preserving each item's `sort_order` within its group and ordering groups
 *  by their first item's `sort_order` (so the group layout doesn't jump
 *  around as items are added). Items with no category land in a trailing
 *  "Uncategorized" group. Pure — takes the already sort_order-sorted list
 *  from getListItems(), doesn't hit the DB itself.
 *
 *  Generic over the row type so the combined view (SHP-02) groups by the
 *  same rules rather than re-deriving them: it used to build its own Map
 *  inline and lost the Uncategorized-last rule, so the two views ordered
 *  their sections differently. */
export function groupItemsByCategory<T extends Categorized>(items: T[]): CategoryGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.category ?? UNCATEGORIZED;
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  const entries = [...groups.entries()];
  // Uncategorized always sorts last, regardless of when it first appeared.
  entries.sort((a, b) => {
    if (a[0] === UNCATEGORIZED) return 1;
    if (b[0] === UNCATEGORIZED) return -1;
    return 0; // stable: Map preserves first-appearance insertion order otherwise
  });

  return entries.map(([category, groupItems]) => ({ category, items: groupItems }));
}
