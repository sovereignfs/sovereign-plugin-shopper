import { getCombinedItems } from '../../_lib/actions';
import CombinedPane from './CombinedPane';

/**
 * Read-only roll-up of items across every list the user can access (SHP-02).
 * SPEC.md open question 5 resolves this as read-only for Phase 1 — check
 * items off from their own list instead. Render body lives in `CombinedPane`
 * (shared with `MobileShopperCarousel`'s trailing slide).
 */
export default async function CombinedViewPage() {
  const items = await getCombinedItems();
  return <CombinedPane items={items} />;
}
