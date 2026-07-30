import type { ReactNode } from 'react';
import { getLists, getSharedLists } from '../_lib/actions';
import MobileAwareShell from '../_components/MobileAwareShell';

/**
 * Two-pane shell on desktop: sidebar (list switcher) + content pane, per
 * UI.md screens 1-3. Sidebar shows "My lists", "Shared with me" (SHP-02) and
 * a "Combined view" link. Mobile (<=768px) forks to a completely different
 * component tree — a swipeable scroll-snap carousel (`MobileAwareShell` →
 * `MobileShopperCarousel`), the dedicated carousel/switcher screens from
 * UI.md 6-9 — same pattern as sovereign-tasks' mobile shell.
 *
 * Lives in the `(shell)` route group (RFC 0078) so it wraps only the
 * personalized `/lists/*` and `/combined` routes — never the plugin's
 * offline-capable bare `routePrefix` page (`app/page.tsx`, one level up),
 * which must stay neutral. Portability registration moved to the true root
 * `app/layout.tsx` so it still runs for that route too.
 */
export default async function ShopperShellLayout({ children }: { children: ReactNode }) {
  const [lists, sharedLists] = await Promise.all([getLists(), getSharedLists()]);

  return (
    <MobileAwareShell lists={lists} sharedLists={sharedLists}>
      {children}
    </MobileAwareShell>
  );
}
