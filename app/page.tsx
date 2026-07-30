import { OfflineShopperView } from './_offline/OfflineShopperView';

/**
 * Home — offline-capable (RFC 0078; `manifest.json` declares
 * `offline: true`). This shell renders nothing per-user: no list data, no
 * session. All of that is fetched client-side in `OfflineShopperView`,
 * which also mirrors cached data back in when offline and manages queued
 * writes via `sdk.offline-queue` — that's what makes this route's own
 * server-rendered HTML safe to precache and replay with no network on a
 * shared device.
 *
 * Formerly redirected straight to the user's last-opened list (SHP-03) —
 * a real per-user personalization that can't survive being baked into a
 * precached document. `OfflineShopperView` preserves the intent
 * client-side instead: it renders whichever list is first in the fetched
 * list, chosen after data loads rather than via a server redirect.
 */
export default function ShopperHomePage() {
  return <OfflineShopperView />;
}
