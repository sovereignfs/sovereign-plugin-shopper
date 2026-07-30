'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import styles from './MobileShopperCarousel.module.css';

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
function navEntries(lists: ListRow[], sharedLists: SharedListRow[]): { id: string }[] {
  return [...lists.map((l) => ({ id: l.id })), ...sharedLists.map((l) => ({ id: l.id }))];
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

export default function MobileShopperCarousel({ lists, sharedLists, refreshSignal }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRefreshSignal = useRef(true);
  // Set right before the scroll-settle handler's own router.replace, so the
  // pathname-sync effect can tell that specific navigation apart from a
  // genuinely external one (tapping a Sidebar <Link>, browser back/forward)
  // — see MobileTasksCarousel's identical flag for the full rationale.
  const isInternalNav = useRef(false);

  // Memoized so activeNavEntry (derived below) keeps a stable reference
  // across re-renders that don't actually change the list set — otherwise
  // every effect keyed on activeNavEntry (item-edit fetch, setLastList)
  // would re-fire on every render, including its own state updates, causing
  // an infinite fetch loop.
  const nav = useMemo(() => navEntries(lists, sharedLists), [lists, sharedLists]);
  const hasCombined = nav.length >= 2;
  const combinedIndex = nav.length + 1;

  const [activeIndex, setActiveIndex] = useState(() => indexForPathname(pathname, nav));
  const initialIndexRef = useRef(activeIndex);
  const activeIndexRef = useRef(activeIndex);
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

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

  // Initial scroll position, once — subsequent activeIndex changes come from
  // the user's own scroll gesture and must not be fought with a re-snap.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: initialIndexRef.current * el.clientWidth, behavior: 'instant' });
  }, []);

  // Sync to the pathname whenever it changes for a reason other than this
  // carousel's own scroll-settle handler below — e.g. tapping a list row's
  // <Link> on the Lists index slide (Sidebar), which navigates but never
  // touches scrollLeft itself.
  const didMountPathSync = useRef(false);
  useEffect(() => {
    if (!didMountPathSync.current) {
      didMountPathSync.current = true;
      return;
    }
    if (isInternalNav.current) {
      isInternalNav.current = false;
      return;
    }
    const newIndex = indexForPathname(pathname, nav);
    if (newIndex === activeIndexRef.current) return;
    setActiveIndex(newIndex);
    scrollRef.current?.scrollTo({ left: newIndex * scrollRef.current.clientWidth, behavior: 'smooth' });
  }, [pathname, nav]);

  // Re-align on viewport resize (e.g. orientation change) so the active
  // slide stays framed correctly.
  useEffect(() => {
    function handleResize() {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({ left: activeIndex * el.clientWidth, behavior: 'instant' });
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [activeIndex]);

  // Debounced "settled" detection — avoids depending on the newer `scrollend`
  // event, which pre-17.4 iOS Safari/WKWebView doesn't support.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function handleScroll() {
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
      scrollTimer.current = setTimeout(() => {
        const current = scrollRef.current;
        if (!current) return;
        const width = current.clientWidth;
        if (!width) return;
        const newIndex = Math.round(current.scrollLeft / width);
        if (newIndex === activeIndexRef.current) return;
        setActiveIndex(newIndex);
        isInternalNav.current = true;
        if (newIndex >= 1 && newIndex <= nav.length) {
          router.replace(`/shopper/lists/${nav[newIndex - 1]?.id}`, { scroll: false });
        } else if (hasCombined && newIndex === combinedIndex) {
          router.replace('/shopper/combined', { scroll: false });
        } else {
          router.replace('/shopper', { scroll: false });
        }
      }, 120);
    }
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    };
  }, [nav, hasCombined, combinedIndex, router]);

  // Item-edit dialog: driven by the ?item= param on the active list slide,
  // same convention as desktop. Unlike Tasks' detail pane, ItemEditDialog is
  // already a self-adapting Dialog (auto-fullscreen on mobile) rendered
  // inline by ListPane — no separate Sheet wrapper needed here.
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
    <div className={styles.wrap}>
      <div className={styles.scroller} ref={scrollRef}>
        <div className={styles.slide}>
          <Sidebar lists={lists} sharedLists={sharedLists} />
        </div>

        {nav.map((entry) => {
          const state = listState[entry.id];
          return (
            <div className={styles.slide} key={entry.id}>
              {state && state.status === 'loaded' && state.list ? (
                <ListPane
                  listId={entry.id}
                  list={state.list}
                  items={state.items}
                  editingItem={activeNavEntry?.id === entry.id ? editingItem : null}
                />
              ) : (
                <div className={styles.slideLoading}>Loading…</div>
              )}
            </div>
          );
        })}

        {hasCombined && (
          <div className={styles.slide}>
            {combinedItems !== null ? (
              <CombinedPane items={combinedItems} />
            ) : (
              <div className={styles.slideLoading}>Loading…</div>
            )}
          </div>
        )}
      </div>

      {(nav.length > 0 || hasCombined) && (
        <div className={styles.dots} aria-hidden>
          {['index', ...nav.map((n) => n.id), ...(hasCombined ? ['combined'] : [])].map((key, i) => (
            <span
              key={key}
              className={[styles.dot, i === activeIndex ? styles.dotActive : ''].join(' ')}
            />
          ))}
        </div>
      )}
    </div>
  );
}
