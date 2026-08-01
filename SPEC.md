# Sovereign Shopper

**Version:** 0.2\
**Date:** July 2026\
**Author(s):** kasunben\
**Purpose:** Canonical specification for the Sovereign Shopper plugin — the single
source of truth for its manifest, access model, data model, and build plan.\
**Status:** Draft

---

Sovereign Shopper is a privacy-first, self-hosted **shared grocery list** that
grows into a **household purchase ledger**. Its primary entry point is a
shared shopping list; every other feature is built around it. The data spine
is the **purchase transaction** — every time a member taps an item as
"bought", a transaction is recorded. That ledger later powers smarter
suggestions, household analytics, and a clear path toward a future standalone
household-ledger app (the name **Shopper** reaches deliberately past
groceries).

The plugin is `type: sovereign` — maintained in a separate external repository
(`sovereign-shopper`).

This specification documents the **full product vision**, not only what
Phase 1 ships. Features are milestone-sequenced, but the milestones are
**not** capped by today's SDK surface: each one names the platform capability
it depends on, and a dedicated
[Platform capabilities and runtime gaps](#platform-capabilities-and-runtime-gaps)
section consolidates what the runtime must grow for the later milestones.

## Scope decision for Phase 1 (this revision)

The original draft's v0.1 bundled the grocery list with a **mandatory
household model**: forced onboarding, owner/member roles, invites, and a
household analytics view. **This revision changes Phase 1** to ship the
grocery list alone, sharable directly with specific users — no household,
no roles, no onboarding gate, no analytics. The household model becomes
**Phase 2**, layered on top without a breaking migration (see
[Data model](#data-model) for how list/product/purchase ownership shifts from
user-scoped to household-scoped when that phase lands).

This is a deliberate simplification, not a reflection of reduced ambition —
the full-vision milestones (v0.3–v0.7 below) are unchanged from the original
draft, just renumbered to fit after the new Phase 1/2 split. See
[Changelog](#changelog).

## Current platform refresh (July 2026)

Re-verified against the running codebase, not just RFC status headers — RFC
"Draft" status does not always mean unimplemented:

| SDK surface | RFC | Status | Notes |
| --- | --- | --- | --- |
| `sdk.auth` | — | ✅ Stable | |
| `sdk.db` | — | ✅ Stable | |
| `sdk.directory` | 0041 | ✅ Implemented | RFC still reads "Draft" but `packages/sdk/src/directory.ts` is real and live. Needed for the Phase 1 share-target picker (SHP-09). |
| `sdk.mailer` | — | ✅ Stable | No-op without SMTP configured. |
| `sdk.notifications` | 0015 | ✅ Implemented | |
| `sdk.activity` | 0005 | ✅ Implemented | |
| `sdk.data` | 0002 | ✅ Implemented | |
| `sdk.storage` | 0044 | ❌ Stub | `packages/sdk/src/unimplemented.ts` throws `NotImplementedError`. Blocks photos, receipt images, generated icon assets. |
| `sdk.events` | 0045 | ❌ Missing | "Plugin events and realtime channels" — Draft RFC, no code. Blocks live shared-list sync; polling is the fallback. |
| `sdk.jobs` | 0046 | 🟨 Partially implemented (Phase 1 subset) | Blocks predictive restock / scheduled rollups until the full surface lands. |
| `sdk.tools` | 0047 | ❌ Missing | Confirmed absent from `packages/sdk/src` entirely (same finding as the Docs and Wallet plugin audits). Blocks confirmed assistant/automation writes. |

**Net finding: Phase 1 (simple shared list) has no platform blockers** —
same conclusion as Sovereign Docs. Every surface it needs
(`sdk.auth`, `sdk.db`, `sdk.directory`, `sdk.notifications`) already works.

## Contents

- [Identity and manifest](#identity-and-manifest)
- [Access control](#access-control)
- [Functional requirements](#functional-requirements)
- [Directory structure](#directory-structure)
- [Data model](#data-model)
- [SDK dependencies](#sdk-dependencies)
- [Platform capabilities and runtime gaps](#platform-capabilities-and-runtime-gaps)
- [UI](#ui)
- [Build plan](#build-plan)
- [Open questions](#open-questions)
- [Changelog](#changelog)

---

## Identity and manifest

| Property                           | Value                                             |
| ----------------------------------- | -------------------------------------------------- |
| `id`                                | `fs.sovereign.shopper`                                |
| `name`                              | `Shopper`                                             |
| `type`                              | `sovereign`                                         |
| `runtime`                           | `native`                                            |
| `routePrefix`                       | `/shopper`                                            |
| `shell`                             | `default`                                           |
| `adminOnly`                         | omitted (`false`)                                   |
| `icon`                              | `icon.svg`                                          |
| `permissions`                       | full intended set — see below                       |
| `repository`                        | `https://github.com/sovereignfs/sovereign-plugin-shopper`     |
| `compatibility.minPlatformVersion`  | `0.19.0`                                            |

The manifest declares the **full intended permission set** up front,
annotated by current platform status. Reserved permissions throw
`NotImplementedError` when their SDK surface is used, but are valid manifest
values today; declaring them signals intent and lets later milestones light
up without a manifest change.

| Permission            | Status      | Used for                                    |
| ---------------------- | ----------- | ------------------------------------------- |
| `auth:session`         | ✅ today    | Current session; user lookup for members    |
| `db:readWrite`         | ✅ today    | All `shopper_*` tables                        |
| `mailer:send`          | ✅ today    | Optional invite emails (Phase 2, no-op without SMTP) |
| `storage:readWrite`    | ⛔ reserved | Item photos, receipt images, icon assets    |
| `notifications:send`   | ✅ today    | Shared-list + ledger notifications          |
| `events:publish`       | ⛔ reserved | Real-time shared-list sync                  |
| `events:subscribe`     | ⛔ reserved | Real-time shared-list sync                  |
| `activity:write`       | ✅ today    | Household activity feed (Phase 2+)          |

Proposed `manifest.json` (Phase 1 declares only the permissions it uses; the
reserved ones are added as their milestones land):

```json
{
  "schemaVersion": 1,
  "id": "fs.sovereign.shopper",
  "name": "Shopper",
  "version": "0.1.0",
  "description": "A shared grocery list.",
  "type": "sovereign",
  "runtime": "native",
  "routePrefix": "/shopper",
  "shell": "default",
  "database": {
    "isolation": "isolated",
    "dialect": "sqlite"
  },
  "icon": "icon.svg",
  "permissions": ["auth:session", "db:readWrite", "notifications:send", "data:provide"],
  "repository": "https://github.com/sovereignfs/sovereign-plugin-shopper",
  "compatibility": {
    "minPlatformVersion": "0.19.0"
  }
}
```

## Access control

Available to authenticated users who can launch installed plugins. No admin
gate.

**Phase 1 — no household, direct list ownership and sharing:**

- A user owns the lists they create (`shopper_lists.owner_user_id`).
- A list is private to its owner until explicitly shared.
- The owner can share a list with a specific user as `editor` (can add/edit/
  check items) or `viewer` (read-only) via `sdk.directory`'s user picker —
  no invite link, no email, no acceptance flow. Sharing is instance-internal
  and immediate, the same pattern as Sovereign Docs' instance sharing.
- The owner can revoke a share at any time.
- There is no forced onboarding — a new user simply has zero lists until
  they create or are shared one.

**Phase 2 — household model added on top (see Build plan):** owner/member
roles per household, invites, a household's auto-shared default list, and a
household analytics view. Phase 1's direct per-list sharing (`shopper_list_shares`)
continues to exist unchanged — it becomes the mechanism for sharing a list
*beyond* a household's membership, exactly as originally speced (SHP-14
equivalent).

## Functional requirements

Requirements are versioned to their milestone. IDs are stable within this
revision — never renumber or reuse a `SHP-*` id going forward. (This revision
itself renumbers the original draft's `SHP-01–64` into the sequence below,
as a one-time restructuring — see [Changelog](#changelog).)

### v0.1 — Simple shared grocery list (Phase 1 — this build)

| ID | Requirement |
| --- | --- |
| SHP-01 | Create a shopping list, owned by the creating user. No household required. |
| SHP-02 | Switch between the user's own lists and lists shared with them. Opt-in combined view aggregates items across all accessible lists (read-only roll-up). |
| SHP-03 | Landing page is the last-used list (per-user state). |
| SHP-04 | Add an item to a list with type-ahead auto-suggestions sourced from the list owner's product catalog and purchase history. One-tap quick-add from a suggestion. |
| SHP-05 | Each list item displays an icon indicating what it is — curated icon set with a category-mapped fallback. |
| SHP-06 | Edit-item view: name, quantity, unit, category, icon, barcode, price. Saving updates the linked catalog product so the next add of the same item is pre-filled. |
| SHP-07 | Tap an item to mark it bought: sets `checked_at` and records a purchase transaction (buyer, time, list, quantity, price if known). Un-tapping reverses both. |
| SHP-08 | Clear bought items from a list; reorder items (`sort_order`); group the list view by category. |
| SHP-09 | Share a list with a specific user as `editor` or `viewer`, via `sdk.directory`'s user picker. Owner can revoke. |

**Done when:** a user creates a list, adds items via suggestions with icons,
taps to buy (recording transactions), and shares the list with another user
who can see and edit it per their role.

### v0.2 — Households, roles, invites, analytics

| ID | Requirement |
| --- | --- |
| SHP-20 | Optional household creation: name; creator becomes `owner`. A user may belong to zero or more households (not mandatory). |
| SHP-21 | Invite a user to a household via a shareable link/code; optional email delivery via `sdk.mailer` (no-op when SMTP is unconfigured). Accepting joins as `member`. |
| SHP-22 | Manage membership: remove a member; leave a household. The last `owner` can never be removed. |
| SHP-23 | Each household gets a default shared shopping list, auto-shared with all members. |
| SHP-24 | A list can be reassigned from personal to household-owned (migrates `owner_user_id` scoping to `household_id` scoping — see data model). |
| SHP-25 | Household view = analytics and insights: spend over time, category breakdown, most-frequent/recent items, who-bought-what — derived from purchase transactions. Member management also lives here. |

### v0.3 — Light inventory and learned suggestions

| ID | Requirement |
| --- | --- |
| SHP-30 | Per-product on-hand quantity (light inventory), adjusted from purchases and manual edits. |
| SHP-31 | Per-product low-stock threshold and flag; low items are surfaced as suggestions while building a list. |
| SHP-32 | Suggestion ranking learns from purchase frequency and recency; remembered category and icon are auto-applied to repeat items. |

### v0.4 — Media and capture

_Depends on `storage:readWrite` and device camera (`sdk.device.*`) — see
[runtime gaps](#platform-capabilities-and-runtime-gaps)._

| ID | Requirement |
| --- | --- |
| SHP-40 | Attach a photo to a product or list item (`sdk.storage`). |
| SHP-41 | Barcode scanning to add or look up items (`sdk.device` camera / Web `getUserMedia`), with optional external product lookup (e.g. Open Food Facts) via a plugin server route. |

### v0.5 — Real-time and notifications

_Depends on `events:*`; notifications can use `sdk.notifications` today._

| ID | Requirement |
| --- | --- |
| SHP-50 | Live shared-list sync — members see adds and check-offs in real time (`sdk.events`); polling is the fallback where unavailable. |
| SHP-51 | Notifications (in-app + push/email) for "item added to a shared list", "someone bought X", and invites (`sdk.notifications`). |
| SHP-52 | Household/list activity feed backed by domain tables plus platform-visible `sdk.activity` events. |

### v0.6 — Intelligence

_Depends on assistant/harness integration, plugin tool contracts, and
background scheduling — see [runtime gaps](#platform-capabilities-and-runtime-gaps)._

| ID | Requirement |
| --- | --- |
| SHP-60 | AI unique icon/image generation per item, mediated through the assistant/harness layer. |
| SHP-61 | Receipt scan → bulk purchases (image OCR + line-item parsing into transactions), with confirmed tool execution for writes. |
| SHP-62 | Smart auto-categorization of new items. |
| SHP-63 | Predictive restock: suggest a list from consumption patterns (requires scheduled/background execution). |

### v0.7 — Ledger

_Toward the standalone household-ledger app._

| ID | Requirement |
| --- | --- |
| SHP-70 | Price history and spend trends per product and per household. |
| SHP-71 | Budgets per category with progress tracking. |
| SHP-72 | Recurring purchases / auto-recurring list items. |
| SHP-73 | Multi-currency purchases. |
| SHP-74 | CSV / export of the household ledger. |

## Directory structure

```
sovereign-shopper/
├── manifest.json
├── icon.svg                    # Shopper icon — sidebar middle section + Launcher grid
├── app/
│   ├── layout.tsx              # list switcher + content area
│   ├── page.tsx                # last-used list (landing), or empty state if none
│   ├── lists/
│   │   └── [listId]/page.tsx   # a shopping list (add, check, edit, share)
│   ├── household/               # Phase 2+
│   │   └── [householdId]/page.tsx  # analytics dashboard + member management
│   └── api/
│       └── [...path]/route.ts  # suggestion lookup, external barcode lookup (Phase 4+)
├── db/
│   └── schema.ts               # all shopper_* tables
├── migrations/                 # Drizzle migration files
├── components/
│   ├── ListView.tsx            # checkable rows + group-by-category
│   ├── AddItemBar.tsx          # type-ahead suggestion input + quick-add
│   ├── ItemEditSheet.tsx       # name/quantity/unit/category/icon/barcode/price
│   ├── ListSwitcher.tsx        # own lists / shared-with-me / combined view
│   ├── IconPicker.tsx          # curated icon set + category fallback
│   ├── ShareDialog.tsx         # share a list with a specific user (Phase 1)
│   ├── HouseholdAnalytics.tsx  # spend trend / category breakdown / top items (Phase 2)
│   └── OnboardingForm.tsx      # create household / accept invite (Phase 2)
├── lib/
│   ├── suggestions.ts          # catalog + history ranking
│   ├── analytics.ts            # query-time aggregations over shopper_purchases
│   └── icons.ts                # category → icon mapping
└── package.json
```

## Data model

All tables prefixed `shopper_`, all carry `tenant_id` per the platform
architectural rule. Monetary amounts are stored as integers (smallest
currency unit), never as floats. Quantities are numeric and may be
fractional (e.g. `1.5 kg`); stored dialect-agnostically (SQLite ↔ Postgres
parity), never as a binary float.

**Phase 1 introduces ownership as `owner_user_id` on lists/products/purchases.
Phase 2 adds `household_id` (nullable) alongside it** — a list/product/purchase
is scoped to *either* its owner user *or* a household, never both, and Phase
2's migration (SHP-24) is the only path that moves a row from one scoping to
the other. This avoids a breaking schema change when households land.

### `shopper_lists`

| Column          | Type       | Notes                                                            |
| --------------- | ---------- | ----------------------------------------------------------------- |
| `id`            | uuid / pk  |                                                                   |
| `tenant_id`     | string     |                                                                   |
| `owner_user_id` | string     | FK → users. Set in Phase 1; always the creator at first.          |
| `household_id`  | uuid?      | Nullable. FK → `shopper_households`. Null until Phase 2 (SHP-24).   |
| `name`          | string     |                                                                   |
| `kind`          | enum       | `personal \| household`. `household` only valid once `household_id` is set. |
| `created_by`    | string     | FK → users.                                                       |
| `archived_at`   | timestamp? | Nullable.                                                         |
| `created_at`    | timestamp  |                                                                   |
| `updated_at`    | timestamp  |                                                                   |

### `shopper_list_shares` (Phase 1)

| Column       | Type      | Notes               |
| ------------ | --------- | ------------------- |
| `id`         | uuid / pk |                     |
| `tenant_id`  | string    |                     |
| `list_id`    | uuid      | FK → `shopper_lists`. |
| `user_id`    | string    | FK → users.         |
| `role`       | enum      | `editor \| viewer`. |
| `created_at` | timestamp |                     |

Unique index on (`list_id`, `user_id`). This is the **only** sharing
mechanism in Phase 1. In Phase 2, household membership grants implicit
access to the household's default list; this table continues to handle
explicit per-user shares beyond that.

### `shopper_products`

The catalog of remembered items — the source of auto-suggestions and the
place edits accumulate so repeat adds get faster.

| Column                 | Type      | Notes                                                       |
| ----------------------- | --------- | ------------------------------------------------------------ |
| `id`                    | uuid / pk |                                                              |
| `tenant_id`             | string    |                                                              |
| `owner_user_id`         | string    | FK → users. Catalog owner in Phase 1 (the list creator).     |
| `household_id`          | uuid?     | Nullable. FK → `shopper_households`. Set once migrated (Phase 2). |
| `name`                  | string    |                                                              |
| `normalized_name`       | string    | Lower/trimmed form for dedupe + suggestion matching.         |
| `category`              | string?   | Nullable.                                                    |
| `icon`                  | string?   | Nullable. Curated-set key (Phase 1).                         |
| `icon_asset_path`       | string?   | Nullable. Generated/uploaded icon asset (v0.6, `storage`).   |
| `barcode`               | string?   | Nullable. Stored from edit (Phase 1); scanned input is v0.4. |
| `photo_path`            | string?   | Nullable. Product photo (v0.4, `storage`).                   |
| `default_unit`          | string?   | Nullable. e.g. `pcs`, `g`, `ml`.                             |
| `typical_price`         | integer?  | Nullable. Cents.                                             |
| `on_hand_qty`           | numeric?  | Nullable. Light inventory (v0.3).                            |
| `low_stock_threshold`   | numeric?  | Nullable. Null = not tracked (v0.3).                         |
| `created_by`            | string    | FK → users.                                                  |
| `created_at`            | timestamp |                                                              |
| `updated_at`            | timestamp |                                                              |

Unique index on (`owner_user_id`, `normalized_name`) in Phase 1; add
(`household_id`, `normalized_name`) once Phase 2 migration exists.

### `shopper_list_items`

| Column       | Type       | Notes                                                          |
| ------------ | ---------- | ---------------------------------------------------------------- |
| `id`         | uuid / pk  |                                                                  |
| `tenant_id`  | string     |                                                                  |
| `list_id`    | uuid       | FK → `shopper_lists`.                                              |
| `product_id` | uuid?      | Nullable. FK → `shopper_products`. Null for a pure ad-hoc entry.   |
| `name`       | string     | Snapshot label. Required when `product_id` is null.              |
| `quantity`   | numeric    | Fractional allowed. Not a binary float.                          |
| `unit`       | string?    | Nullable.                                                        |
| `category`   | string?    | Nullable.                                                        |
| `icon`       | string?    | Nullable.                                                        |
| `sort_order` | integer    | Manual ordering (SHP-08).                                        |
| `checked_at` | timestamp? | Nullable. Set when marked bought (SHP-07).                       |
| `added_by`   | string     | FK → users.                                                      |
| `created_at` | timestamp  |                                                                  |

### `shopper_purchases`

The ledger — one row written per "mark bought" (SHP-07). Designed to be
grocery-agnostic so the future standalone ledger app can build on it
directly.

| Column          | Type      | Notes                                                        |
| --------------- | --------- | -------------------------------------------------------------- |
| `id`            | uuid / pk |                                                                 |
| `tenant_id`     | string    |                                                                 |
| `owner_user_id` | string    | FK → users. List owner at time of purchase (Phase 1 scoping).  |
| `household_id`  | uuid?     | Nullable. FK → `shopper_households`. Set once migrated (Phase 2). |
| `list_id`       | uuid?     | Nullable. FK → `shopper_lists`.                                   |
| `list_item_id`  | uuid?     | Nullable. FK → `shopper_list_items`.                              |
| `product_id`    | uuid?     | Nullable. FK → `shopper_products`.                                |
| `name`          | string    | Snapshot label.                                                 |
| `quantity`      | numeric   | Fractional allowed.                                             |
| `unit`          | string?   | Nullable.                                                       |
| `price`         | integer?  | Nullable. Cents.                                                |
| `currency`      | string?   | Nullable. ISO 4217.                                             |
| `purchased_by`  | string    | FK → users.                                                     |
| `purchased_at`  | timestamp |                                                                 |

Analytics (SHP-25), price history (SHP-70), and low-stock detection (SHP-31)
are computed at query time from this table and `shopper_products` — no stored
aggregates.

### `shopper_user_state`

| Column         | Type        | Notes                                                |
| -------------- | ----------- | ------------------------------------------------------ |
| `user_id`      | string / pk | FK → users.                                             |
| `tenant_id`    | string      |                                                         |
| `last_list_id` | uuid?       | Nullable. FK → `shopper_lists`. Landing page (SHP-03).    |
| `updated_at`   | timestamp   |                                                         |

### `shopper_households` (Phase 2)

| Column        | Type       | Notes                     |
| ------------- | ---------- | -------------------------- |
| `id`          | uuid / pk  |                            |
| `tenant_id`   | string     |                            |
| `created_by`  | string     | FK → users.                |
| `name`        | string     |                            |
| `archived_at` | timestamp? | Nullable. Set on archive.  |
| `created_at`  | timestamp  |                            |

### `shopper_household_members` (Phase 2)

| Column         | Type      | Notes                    |
| -------------- | --------- | -------------------------- |
| `id`           | uuid / pk |                            |
| `tenant_id`    | string    |                            |
| `household_id` | uuid      | FK → `shopper_households`.   |
| `user_id`      | string    | FK → users.                |
| `role`         | enum      | `owner \| member`.         |
| `joined_at`    | timestamp |                            |

Unique index on (`household_id`, `user_id`). At least one `owner` per
household enforced at the app layer (SHP-22).

### `shopper_household_invites` (Phase 2)

| Column         | Type       | Notes                                           |
| -------------- | ---------- | ------------------------------------------------- |
| `id`           | uuid / pk  |                                                    |
| `tenant_id`    | string     |                                                    |
| `household_id` | uuid       | FK → `shopper_households`.                           |
| `code`         | string     | Unique token used in the shareable invite link.    |
| `email`        | string?    | Nullable. Set when the invite is also emailed.     |
| `invited_by`   | string     | FK → users.                                        |
| `expires_at`   | timestamp? | Nullable.                                          |
| `accepted_at`  | timestamp? | Nullable. Set on acceptance.                       |
| `accepted_by`  | string?    | Nullable. FK → users.                              |
| `created_at`   | timestamp  |                                                    |

### `shopper_budgets` (v0.7)

| Column         | Type      | Notes                            |
| -------------- | --------- | ---------------------------------- |
| `id`           | uuid / pk |                                    |
| `tenant_id`    | string    |                                    |
| `household_id` | uuid      | FK → `shopper_households`.           |
| `category`     | string?   | Nullable. Null = overall budget.   |
| `amount`       | integer   | Cents.                             |
| `period`       | enum      | `monthly \| weekly`.               |
| `created_at`   | timestamp |                                    |

## SDK dependencies

| SDK surface         | Status         | Used for                                         |
| -------------------- | -------------- | --------------------------------------------------- |
| `sdk.auth`           | ✅ stable       | Session                                              |
| `sdk.db`             | ✅ stable       | Read/write all `shopper_*` tables                      |
| `sdk.directory`      | ✅ implemented  | User lookup for Phase 1 sharing; Phase 2 invites/members |
| `sdk.mailer`         | ✅ stable       | Optional invite emails, Phase 2 (no-op without SMTP) |
| `sdk.notifications`  | ✅ implemented  | Shared-list + ledger notifications (v0.5)            |
| `sdk.activity`       | ✅ implemented  | Household/list activity feed (v0.5)                  |
| `sdk.data`           | ✅ implemented  | Catalog/list/purchase-history contracts              |
| `sdk.storage`        | ❌ stub, RFC 0044 | Photos, receipt images, generated icon assets (v0.4+) |
| `sdk.events`         | ❌ missing, RFC 0045 | Real-time shared-list sync (v0.5)                |
| `sdk.jobs`           | 🟨 partial, RFC 0046 | Predictive restock and scheduled maintenance (v0.6) |
| `sdk.tools`          | ❌ missing, RFC 0047 | Confirmed assistant/automation writes (v0.6)      |

## Platform capabilities and runtime gaps

1. **Object storage (`sdk.storage` / `storage:readWrite`)** — RFC 0044,
   confirmed stub. Blocks v0.4 (photos, SHP-40/41 lookup images) and v0.6
   (icon assets).
2. **Notifications (`sdk.notifications`)** — available. v0.5 should use the
   platform Notification Center and avoid plugin-owned push subscriptions.
3. **Realtime events (`sdk.events`)** — RFC 0045, confirmed missing. Blocks
   SHP-50 live sync. Polling is the v1 stopgap.
4. **Activity feed (`sdk.activity`)** — available. SHP-52 should combine
   plugin domain history with platform-visible audit events.
5. **Device / camera (`sdk.device.*`)** — the post-v1 Capacitor plan (SRS
   §3.12). SHP-40/41 capture works via Web `getUserMedia` in the PWA today.
6. **Assistant/harness integration** — SHP-60 (icon generation), SHP-61
   (receipt OCR/parsing), and SHP-62 (categorization) should route through
   the shared assistant layer rather than a plugin-local provider stack.
   Blocked in part by RFC 0047 (`sdk.tools`), confirmed absent from the SDK.
7. **Background jobs / scheduling (`sdk.jobs`)** — RFC 0046, confirmed
   partially implemented (Phase 1 subset exists). SHP-63 (predictive
   restock), SHP-72 (recurring items), and scheduled budget rollups need to
   verify whether the existing partial surface is sufficient or needs
   extension — check at v0.6 planning time, not now.
8. **Outbound HTTP** for external barcode/product lookup (SHP-41) — already
   available from native server routes; no new surface needed.

Items 1, 3, and 6 (fully) are hard platform blockers. Item 7 needs a
capability check at v0.6, not before. Items 2 and 4 are available today.

## UI

List-first and intentionally simple. The **list screen** is the home:
checkable rows with a per-item icon, a type-ahead add bar with suggestions, a
quantity stepper, and tap-to-buy. A lightweight **list switcher** moves
between the user's own lists, lists shared with them, and the combined view.
An **item edit** sheet covers category/icon/barcode/price. A **share dialog**
picks a user via `sdk.directory` and sets editor/viewer. The **household
view** (Phase 2) is an analytics dashboard plus member management.

**Net-new `@sovereignfs/ui` primitives likely needed:** a type-ahead
suggestion input, a quantity stepper (numeric input with +/− and a unit
suffix), a checkable list row, an icon picker, a low-stock badge chip
(v0.3+), and simple bar/spark charts for analytics (v0.2+, inline SVG/CSS,
no charting dependency). Drive these into `packages/ui` rather than building
inline where they are broadly reusable.

## Build plan

See [roadmap.md](roadmap.md) for the dependency-ordered, per-task build plan.
Summary of sequencing:

1. **v0.1 (Phase 1, this build)** — simple shared grocery list: create,
   switch, add/edit/check items, share directly with a user. No platform
   blockers.
2. **v0.2 (Phase 2)** — household model layered on top: create/invite/
   membership, default shared list, analytics, and the list ownership
   migration from user-scoped to household-scoped.
3. **v0.3** — light inventory and learned suggestions. No platform blockers.
4. **v0.4** — media and capture. Gated on `sdk.storage`.
5. **v0.5** — realtime and notifications. Gated on `sdk.events`;
   notifications/activity already available.
6. **v0.6** — intelligence. Gated on assistant/harness integration,
   `sdk.tools`, and confirming `sdk.jobs` sufficiency.
7. **v0.7** — ledger: price history, budgets, recurring, multi-currency,
   export.

## Open questions

1. **AI surface design.** The shape of a future `sdk.ai` (text/vision/image
   generation) and the self-hosted vs. bring-your-own-key model story —
   platform decision, not a plugin one.
2. **Storage model.** Generalize the on-disk avatar pattern vs. a pluggable
   object-store backend for `sdk.storage`.
3. **Realtime transport.** SSE vs. WebSocket vs. polling for v1, and which
   the runtime should standardize for `sdk.events`.
4. **Item icon source (Phase 1).** ✅ Resolved (T-06) — real curated Lucide
   SVG icons via `@sovereignfs/ui`'s `IconPicker` (not emoji), with a
   category-mapped fallback; sufficient until AI generation (v0.6) lands.
5. **Combined view (SHP-02).** ✅ Resolved (T-03) — read-only roll-up in
   Phase 1; editable combined view is deferred.
6. **Ledger generalization.** Keep `shopper_purchases` grocery-agnostic so the
   standalone ledger app can build on it without a breaking migration.
   Confirm no grocery-specific columns leak in.
7. **Invite delivery (Phase 2, SHP-21).** Link/code is the canonical path
   (works without SMTP); email via `sdk.mailer` is an optional convenience.
8. **Phase 1 → Phase 2 migration mechanics (new).** SHP-24's list
   reassignment from `owner_user_id` to `household_id` scoping needs a
   concrete migration script + UX (does the owner choose which lists join
   the household? what happens to `shopper_list_shares` on a migrated list?).
   Design this at the start of Phase 2, not deferred further.

## Changelog

| Version | Date     | Change |
| ------- | -------- | ------ |
| 0.1     | Jun 2026 | Initial draft — full-vision spec from the design session; identifies runtime capability gaps. |
| 0.2     | Jul 2026 | Restructured for a simplified Phase 1: household model (originally mandatory in v0.1) moved to a new v0.2; direct per-list sharing promoted to Phase 1. All `SHP-*` IDs renumbered as a one-time restructuring. Platform capability statuses re-verified against code. |
