import { NextResponse } from 'next/server';
import { getLists, getListItems, getSharedLists } from '../../_lib/actions';
import type { OfflineSnapshot } from '../../_lib/offline-types';

/**
 * Client-fetchable read for the offline shell (RFC 0078) — `page.tsx` is a
 * neutral SSR shell with no data of its own; `OfflineShopperView` calls this
 * on mount (mirroring Launcher's `/api/plugins`) to populate both the live
 * view and the `sdk.offline` cache for next time there's no network.
 *
 * A plain Route Handler, not a Server Action — same reasoning as this
 * plugin's DOCX-export precedent in `sovereign-tritext`: only a `fetch()`-able
 * endpoint works from an arbitrary client component. Gated by the platform's
 * ordinary session middleware, same as any other plugin route.
 */
export async function GET() {
  const [lists, sharedLists] = await Promise.all([getLists(), getSharedLists()]);
  const allListIds = [...lists.map((l) => l.id), ...sharedLists.map((l) => l.id)];

  const itemsByListId: Record<string, OfflineSnapshot['itemsByListId'][string]> = {};
  await Promise.all(
    allListIds.map(async (listId) => {
      itemsByListId[listId] = await getListItems(listId);
    }),
  );

  const snapshot: OfflineSnapshot = { lists, sharedLists, itemsByListId };
  return NextResponse.json(snapshot);
}
