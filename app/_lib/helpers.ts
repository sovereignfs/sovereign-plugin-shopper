/**
 * Plain (non-`'use server'`) synchronous helpers shared by `actions.ts` and
 * the offline Route Handlers (`app/api/offline-*`). Next.js requires every
 * export of a `'use server'` file to be an async function — `normalize`/
 * `now` are pure and synchronous, so they can't live in `actions.ts` itself
 * despite being used there too. Same fix `sovereign-tritext` already
 * established for its own sync helpers (`blockSummary.ts`).
 */

/** Trimmed, lowercased form used for catalog dedupe/matching (SHP-04). */
export function normalize(name: string): string {
  return name.trim().toLowerCase();
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}
