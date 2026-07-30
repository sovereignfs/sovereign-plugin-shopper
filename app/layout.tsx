import type { ReactNode } from 'react';
import { registerPortabilityHandlers } from './_lib/portability';

/**
 * Plugin-wide root layout — deliberately neutral (RFC 0078: this plugin
 * declares `offline: true`, so its bare `routePrefix` page, `page.tsx`,
 * must render with no per-user data; since this layout wraps that page too,
 * it must stay neutral as well). Personalized chrome (sidebar, list
 * fetching) lives one level down in `(shell)/layout.tsx`, which only wraps
 * the nested `/lists/*` and `/combined` routes — never the offline entry
 * point.
 *
 * Portability registration (RFC 0007/0033/0068) is the one thing every
 * request still needs regardless of route: in-process and reset on restart,
 * so it must run from *some* request-scoped plugin route on every request.
 * Kept here (not in `(shell)/layout.tsx`) so it still runs for a request to
 * the bare, offline-capable `/shopper` page too — best-effort, a
 * registration failure must not block the plugin's own UI.
 */
export default async function ShopperRootLayout({ children }: { children: ReactNode }) {
  try {
    await registerPortabilityHandlers();
  } catch {
    // Portability is a best-effort platform integration.
  }

  return children;
}
