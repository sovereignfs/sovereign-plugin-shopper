/**
 * Shared helper for the query-shape tests. Not a `.test.ts` file, so vitest's
 * `app/_lib/**\/__tests__/**\/*.test.ts` glob doesn't collect it as a suite.
 *
 * Walks a drizzle SQL condition object (the return value of `and()`/`eq()`/
 * `isNull()`) and collects the names of every column referenced directly in
 * it. Column objects carry a circular `table` back-reference that in turn
 * holds every *other* column on that table — walking into it would make this
 * detector report a column as "referenced" just because a sibling column from
 * the same table happened to appear elsewhere in the condition, which would
 * silently defeat the check. Skipping the `table` key avoids that false
 * positive while still finding any column the condition actually names.
 *
 * This is what makes a where-clause assertion a real regression trap: the
 * fake DBs in these suites don't evaluate predicates, so they return the same
 * canned rows whether or not a filter is present. Asserting on the condition
 * itself is the only way to catch a dropped `tenant_id` or `checked_at`.
 */
export function referencedColumnNames(node: unknown, seen = new Set<unknown>()): Set<string> {
  const names = new Set<string>();
  function walk(value: unknown) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const obj = value as Record<string, unknown>;
    if (typeof obj.name === 'string' && typeof obj.columnType === 'string') {
      names.add(obj.name);
    }
    for (const key of Object.keys(obj)) {
      if (key === 'table') continue;
      walk(obj[key]);
    }
  }
  walk(node);
  return names;
}
