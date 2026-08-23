'use client';

import {
  SwipableMobileCarousel,
  SwipableMobileCarouselSlide,
  SwipableMobileCarouselSlideBody,
  useCarouselRouteSync,
} from '@sovereignfs/ui';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CombinedPane from '../(shell)/combined/CombinedPane';
import ListPane from '../(shell)/lists/[listId]/ListPane';
import {
  getCombinedItems,
  getList,
  getListItemDetail,
  getListItems,
  setLastList,
} from '../_lib/actions';
import type { CombinedItemRow, ListItemDetail, ListItemRow, ListRow, SharedListRow } from '../_lib/types';
import Sidebar from './Sidebar';

interface ListSlideState {
  list: ListRow | null;
  items: ListItemRow[];
  status: 'loading' | 'loaded' | 'error';
}

interface Props {
  lists: ListRow[];
  sharedLists: SharedListRow[];
  /** Changes identity on every server re-render of the plugin's routes (i.e.
   *  whenever anything anywhere calls router.refresh()) — see
   *  MobileAwareShell's doc comment. Purely a signal to re-fetch the active
   *  slide; this carousel's own data lives in client state, decoupled from
   *  page.tsx's server props. */
  refreshSignal: unknown;
}

/** Nav order matches the desktop Sidebar: owned lists first, then shared. */
function navEntries(lists: ListRow[], sharedLists: SharedListRow[]): { id: string; name: string }[] {
  return [
    ...lists.map((l) => ({ id: l.id, name: l.name })),
    ...sharedLists.map((l) => ({ id: l.id, name: l.name })),
  ];
}

/** Slide 0 is the Lists index; slide n (1<=n<=nav.length) is nav[n-1]; the
 *  trailing slide (only present once there are 2+ accessible lists, matching
 *  the desktop Sidebar's "Combined view" gating) is the combined roll-up. */
function indexForPathname(pathname: string, nav: { id: string }[]): number {
  const listMatch = pathname.match(/^\/shopper\/lists\/([^/]+)/);
  if (listMatch) {
    const idx = nav.findIndex((n) => n.id === listMatch[1]);
    if (idx !== -1) return idx + 1;
  }
  if (pathname === '/shopper/combined' && nav.length >= 2) return nav.length + 1;
  return 0;
}

/** Inverse of indexForPathname — the path to navigate to once a swipe
 *  settles on a given slide index. Index 0 (the Lists index slide) is the
 *  one case that deliberately does NOT navigate to its "natural" URL: bare
 *  `/shopper` always client-redirects to the last-used list on mount
 *  (`OfflineShopperView`, RFC 0078 — `redirected.current` resets on every
 *  fresh mount, so this fires every single time, not just once per
 *  session). Settling there and navigating to `/shopper` would immediately
 *  bounce back to a list, undoing the swipe/tap before the user ever sees
 *  the slide settle — a real bug in the pre-migration hand-rolled carousel
 *  too (`indexForPathname`'s equivalent fallback), just never surfaced.
 *  Returning `currentPathname` unchanged is a deliberate no-op navigation:
 *  the slide still renders correctly (driven by `activeIndex`, not the
 *  URL), it just doesn't try to represent "viewing the Lists index" as its
 *  own distinct URL, since bare `/shopper` can no longer mean that. */
function pathForIndex(
  index: number,
  nav: { id: string }[],
  hasCombined: boolean,
  currentPathname: string,
): string {
  if (index >= 1 && index <= nav.length) return `/shopper/lists/${nav[index - 1]?.id}`;
  if (hasCombined && index === nav.length + 1) return '/shopper/combined';
  return currentPathname;
}

export default function MobileShopperCarousel({ lists, sharedLists, refreshSignal }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isFirstRefreshSignal = useRef(true);

  // Memoized so activeNavEntry (derived below) keeps a stable reference
  // across re-renders that don't actually change the list set — otherwise
  // every effect keyed on activeNavEntry (item-edit fetch, setLastList)
  // would re-fire on every render, including its own state updates, causing
  // an infinite fetch loop.
  const nav = useMemo(() => navEntries(lists, sharedLists), [lists, sharedLists]);
  const hasCombined = nav.length >= 2;
  const combinedIndex = nav.length + 1;

  // Centralizes the pathname↔slide-index mapping and the "was this pathname
  // change our own settle, or an external navigation" distinction that used
  // to be hand-rolled here — see useCarouselRouteSync's own doc comment.
  // indexForPathname/pathForIndex read `nav`/`hasCombined`/`pathname` via
  // closure; identity doesn't matter since the hook stores them in refs and
  // reads the latest one on every settle.
  const { activeIndex, onSettle } = useCarouselRouteSync({
    indexForPathname: (path) => indexForPathname(path, nav),
    pathForIndex: (index) => pathForIndex(index, nav, hasCombined, pathname),
    pathname,
    onNavigate: (path) => router.replace(path, { scroll: false }),
  });

  const [listState, setListState] = useState<Record<string, ListSlideState>>({});
  const [combinedItems, setCombinedItems] = useState<CombinedItemRow[] | null>(null);
  const [editingItem, setEditingItem] = useState<ListItemDetail | null>(null);

  const activeNavEntry = activeIndex >= 1 && activeIndex <= nav.length ? nav[activeIndex - 1] : null;
  const itemIdParam = searchParams.get('item');

  const loadList = useCallback(async (listId: string) => {
    setListState((s) => {
      const existing = s[listId];
      // A background refresh (refreshSignal firing for the active slide)
      // should keep showing already-loaded content while refetching, not
      // flip back to a loading placeholder — that would remount ListPane and
      // flicker on every mutation. 'loading' is reserved for a slide's
      // genuine first-ever fetch, same reasoning as MobileTasksCarousel.
      const status = existing?.status === 'loaded' ? 'loaded' : 'loading';
      return { ...s, [listId]: { list: existing?.list ?? null, items: existing?.items ?? [], status } };
    });
    try {
      const [list, items] = await Promise.all([getList(listId), getListItems(listId)]);
      setListState((s) => ({ ...s, [listId]: { list, items, status: 'loaded' } }));
    } catch {
      setListState((s) => ({ ...s, [listId]: { list: null, items: [], status: 'error' } }));
    }
  }, []);

  const loadCombined = useCallback(async () => {
    try {
      setCombinedItems(await getCombinedItems());
    } catch {
      setCombinedItems([]);
    }
  }, []);

  // Fetch the active slide plus its immediate neighbors — a single swipe
  // never shows a loading spinner since the destination is already cached.
  useEffect(() => {
    const neighborIndexes = [activeIndex - 1, activeIndex, activeIndex + 1];
    for (const i of neighborIndexes) {
      if (i >= 1 && i <= nav.length) {
        const entry = nav[i - 1];
        if (entry && !listState[entry.id]) loadList(entry.id);
      } else if (hasCombined && i === combinedIndex && combinedItems === null) {
        loadCombined();
      }
    }
    // listState/combinedItems intentionally excluded — they're this effect's
    // own output, not inputs that should retrigger it.
  }, [activeIndex, nav, hasCombined, combinedIndex, loadList, loadCombined]);

  // Re-fetch the active slide whenever a mutation elsewhere triggers a server
  // refresh. Skips the first fire, which coincides with the mount effect above.
  useEffect(() => {
    if (isFirstRefreshSignal.current) {
      isFirstRefreshSignal.current = false;
      return;
    }
    if (activeNavEntry) loadList(activeNavEntry.id);
    else if (hasCombined && activeIndex === combinedIndex) loadCombined();
    // Intentionally only keyed on refreshSignal — the rest are read at fire-time.
  }, [refreshSignal]);

  // Records the active list as "last opened" (SHP-03) whenever the settled
  // slide is a real list — the desktop route's page.tsx normally owns this
  // call (setLastList on every visit), but the carousel bypasses that route
  // entirely on mobile, so it has to do the equivalent itself.
  useEffect(() => {
    if (activeNavEntry) setLastList(activeNavEntry.id).catch(() => {});
  }, [activeNavEntry]);

  // Item-edit dialog: driven by the ?item= param on the active list slide,
  // same convention as desktop. Unlike Tasks' detail pane, ItemEditDialog is
  // already a self-adapting Dialog (auto-fullscreen on mobile) rendered
  // inline by ListPane — no separate Sheet wrapper needed here. Kept as an
  // inline part of the routed slide's own tree (not a sibling of
  // SwipableMobileCarousel) — Dialog already portals itself, so it isn't
  // subject to the carousel's mount-window, and this is the pattern
  // SwipableMobileCarousel's own doc comment calls out as the reason this
  // carousel doesn't need Tasks' Sheet-wrapping detour.
  useEffect(() => {
    if (!itemIdParam || !activeNavEntry) {
      setEditingItem(null);
      return;
    }
    let cancelled = false;
    getListItemDetail(activeNavEntry.id, itemIdParam)
      .then((item) => {
        if (!cancelled) setEditingItem(item);
      })
      .catch(() => {
        if (!cancelled) setEditingItem(null);
      });
    return () => {
      cancelled = true;
    };
  }, [itemIdParam, activeNavEntry, refreshSignal]);

  return (
    <SwipableMobileCarousel activeIndex={activeIndex} onSettle={onSettle} aria-label="Shopper lists">
      <SwipableMobileCarouselSlide slideKey="index" label="Lists">
        <SwipableMobileCarouselSlideBody>
          <Sidebar lists={lists} sharedLists={sharedLists} />
        </SwipableMobileCarouselSlideBody>
      </SwipableMobileCarouselSlide>

      {nav.map((entry) => {
        const state = listState[entry.id];
        return (
          <SwipableMobileCarouselSlide key={entry.id} slideKey={entry.id} label={entry.name}>
            <SwipableMobileCarouselSlideBody loading={!state || !state.list}>
              {state?.list && (
                <ListPane
                  listId={entry.id}
                  list={state.list}
                  items={state.items}
                  editingItem={activeNavEntry?.id === entry.id ? editingItem : null}
                />
              )}
            </SwipableMobileCarouselSlideBody>
          </SwipableMobileCarouselSlide>
        );
      })}

      {hasCombined && (
        <SwipableMobileCarouselSlide slideKey="combined" label="Combined view">
          <SwipableMobileCarouselSlideBody loading={combinedItems === null}>
            {combinedItems !== null && <CombinedPane items={combinedItems} />}
          </SwipableMobileCarouselSlideBody>
        </SwipableMobileCarouselSlide>
      )}
    </SwipableMobileCarousel>
  );
}
