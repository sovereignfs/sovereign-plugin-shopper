'use client';

import { useIsMobile } from '@sovereignfs/ui';
import type { ReactNode } from 'react';
import type { ListRow, SharedListRow } from '../_lib/types';
import Sidebar from './Sidebar';
import MobileShopperCarousel from './MobileShopperCarousel';
import styles from '../(shell)/layout.module.css';

interface Props {
  lists: ListRow[];
  sharedLists: SharedListRow[];
  children: ReactNode;
}

/**
 * Forks the plugin's root shell between the desktop two-pane layout
 * (unchanged) and the mobile swipeable-lists carousel — same split as
 * sovereign-tasks' `MobileAwareShell`. Uses the platform's default 768px
 * breakpoint (`@sovereignfs/ui`'s `useIsMobile()`), not a plugin-local
 * override: Tasks' narrower 640px was specifically to avoid squeezing its
 * three-column desktop layout at tablet widths, which doesn't apply to
 * Shopper's simpler two-pane sidebar+content layout.
 *
 * On mobile, `children` (page.tsx's server-rendered output for the current
 * route) is deliberately not rendered — `MobileShopperCarousel` fetches its
 * own client-side data per slide so swiping is instant. It's still passed
 * through as `refreshSignal`: React re-invokes this component with a new
 * `children` reference on every server refresh (any `router.refresh()` call
 * inside AddItemBar/ItemRow/ItemEditDialog/etc.), which the carousel uses
 * purely as a signal to re-fetch its active slide.
 */
export default function MobileAwareShell({ lists, sharedLists, children }: Props) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className={styles.mobileShell} data-plugin-fullbleed>
        <MobileShopperCarousel lists={lists} sharedLists={sharedLists} refreshSignal={children} />
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <div className={styles.sidebar}>
        <Sidebar lists={lists} sharedLists={sharedLists} />
      </div>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
