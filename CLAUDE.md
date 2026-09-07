# CLAUDE.md — sovereign-shopper

Guidance for Claude Code working in this plugin repository.

## What this is

**Sovereign Shopper** — a privacy-first, self-hosted shared grocery list that
grows into a household purchase ledger. A `type: sovereign` Sovereign plugin
maintained in its own repository (`sovereign-shopper`).

Spec: [SPEC.md](SPEC.md) · Wireframes: [UI.md](UI.md) · Tasks: [roadmap.md](roadmap.md)

## Identity

| Property     | Value                                                        |
| ------------ | ------------------------------------------------------------- |
| Plugin ID    | `fs.sovereign.shopper`                                          |
| Route prefix | `/shopper`                                                      |
| Database     | `isolated`, `sqlite` — no slug prefix required, but tables keep the `shopper_` prefix for readability |
| Permissions  | `auth:session`, `db:readWrite`, `notifications:send`, `data:provide` |
| Min platform | `0.19.0`                                                      |
| Table prefix | `shopper_` (convention, not required by isolated mode)          |

## SDK-only rule

**Never import from `@sovereignfs/db` directly.** All database access goes
through `sdk.db`. This is enforced by the platform's ESLint SDK boundary rule
and is the defining constraint of an externally-maintained plugin.

```ts
// ✅ correct
import { sdk } from '@sovereignfs/sdk';
const db = await sdk.db.getClient();

// ❌ wrong — breaks the plugin/platform boundary
import { getPlatformDb } from '@sovereignfs/db';
```

## tenant_id scoping

Every query that touches user data **must** filter by both `tenant_id` and
the current user's `id` (Phase 1: `owner_user_id`; Phase 2+ adds
`household_id` as an alternative scope — see below). There is no exception.

```ts
const lists = await db
  .select()
  .from(shopperLists)
  .where(and(eq(shopperLists.tenantId, tenantId), eq(shopperLists.ownerUserId, userId)));
```

## Ownership scoping: Phase 1 vs. Phase 2

`shopper_lists`, `shopper_products`, and `shopper_purchases` all carry **both**
`owner_user_id` (set today) and a nullable `household_id` (unused until
Phase 2). A row is scoped to *either* its owner user *or* a household, never
both — Phase 2's migration is the only path that moves a row from one
scoping to the other. **Do not write query code that assumes `household_id`
is populated** — it is always `null` in Phase 1. See SPEC.md's "Data model"
intro and open question 8 for the full rationale before touching Phase 2.

## Quantity and money storage

- **Quantities** (`shopper_list_items.quantity`, `shopper_purchases.quantity`,
  `shopper_products.on_hand_qty`/`low_stock_threshold`) are `text` columns
  holding a canonical decimal string (e.g. `"1.5"`), **never** a Drizzle
  `real`/binary float. Parse with a decimal-safe helper, not `parseFloat`
  alone, when doing arithmetic (e.g. combined-view aggregation).
- **Money** (`shopper_products.typical_price`, `shopper_purchases.price`) is
  `integer`, smallest currency unit (cents) — consistent with Splitify and
  Sovereign Wallet's ledger track.

## Table prefix

All plugin tables are prefixed `shopper_`:

- `shopper_lists`
- `shopper_list_shares`
- `shopper_products`
- `shopper_list_items`
- `shopper_purchases`
- `shopper_user_state`
- `shopper_households`, `shopper_household_members`, `shopper_household_invites` (Phase 2)
- `shopper_budgets` (v0.7)

## Milestone scope

Requirement IDs are stable — never renumber or reuse a `SHP-*` id (already
renumbered once, from the original full-vision draft, when Phase 1 was
rescoped to drop the mandatory household model — see SPEC.md Changelog).

| Milestone | SHP IDs | Status      | Description                                                   |
| --------- | ------- | ----------- | --------------------------------------------------------------- |
| v0.1      | 01–09   | in progress | Simple shared list: create, switch, add/edit/check items, direct per-user sharing. No household. |
| v0.2      | 20–25   | blocked     | Households, roles, invites, analytics — needs the Phase 1→2 migration design (SPEC open question 8) first |
| v0.3      | 30–32   | blocked     | Light inventory, learned suggestions                            |
| v0.4      | 40–41   | blocked     | Media/capture — requires `sdk.storage` (RFC 0044, currently a stub) |
| v0.5      | 50–52   | blocked     | Realtime/notifications — live sync requires `sdk.events` (RFC 0045, missing) |
| v0.6      | 60–63   | blocked     | Intelligence — requires assistant/harness integration, `sdk.tools` (RFC 0047, missing) |
| v0.7      | 70–74   | blocked     | Ledger: price history, budgets, recurring, multi-currency, export |

**Do not start v0.2 work until the Phase 1 → Phase 2 migration is designed**
(roadmap.md T-12) — retrofitting `household_id` scoping onto live Phase 1
data without a plan risks a destructive migration.

## UI rules

- Consume `@sovereignfs/ui` components and `--sv-*` tokens exclusively.
- Never hardcode colours, spacing, or radii — always reference tokens.
- **DS-first: this plugin is a consumer.** All three primitives Phase 1
  needed have landed in `@sovereignfs/ui`, none plugin-local:
  1. ✅ **`CheckableListRow`** (whole-row tap target, strikethrough-on-checked,
     T-08) — platform PR [#198](https://github.com/sovereignfs/sovereign/pull/198),
     **still open/draft, not yet merged** — this repo's `workspace:*` link to
     `@sovereignfs/ui` only resolves it while the `claude-sv` checkout is on
     `feat/checkable-list-row` (or later, whatever it gets rebased onto once
     merged).
  2. ✅ **`SuggestionInput`** (text input + anchored async result list, T-05)
     — platform PR [#194](https://github.com/sovereignfs/sovereign/pull/194),
     merged to `main`.
  3. ✅ **`QuantityStepper`** (numeric input with +/− and a unit suffix, T-07)
     — platform PR [#197](https://github.com/sovereignfs/sovereign/pull/197),
     merged to `main`.

  Also added, ahead of the original three: ✅ **`IconPicker`** (T-06,
  platform PR [#195](https://github.com/sovereignfs/sovereign/pull/195)) plus
  21 curated grocery-item/category icons in `@sovereignfs/ui`'s `Icon` set —
  merged to `main`, but via [#196](https://github.com/sovereignfs/sovereign/pull/196):
  #195 was stacked on #194's branch, and merging #194 into `main` didn't
  retarget it, so it landed on the wrong branch and needed a follow-up
  cherry-pick PR. **Lesson: base new platform-repo PRs directly on `main`,
  don't stack on another open draft** — #197 and #198 both followed this.

  See [UI.md](UI.md#engineering-notes) for the full rationale. Do not
  hand-roll plugin-local versions "to be promoted later" — that's exactly
  the pattern `sovereign-tasks`' `TaskItem.tsx` fell into and UI.md flags as
  a mistake not to repeat.
- **Tap-to-buy's tap target is the row body, not a separate control**
  (SHP-07, T-08): `CheckableListRow`'s whole row toggles bought/not-bought.
  Editing therefore needed its own affordance — a pencil `<Link
  href="?item=...">` in the row's `trailing` slot (`ItemRow.tsx`) — rather
  than sharing the row click the way T-07 originally wired it (fixed as part
  of T-08, since T-08 is what defines the row-tap interaction per SPEC.md).
- **Manual reorder (SHP-08) is drag-and-drop, not up/down buttons** — the
  original chevron-button version (T-09) didn't work reliably in practice
  and was replaced with `dnd-kit` (`@dnd-kit/core`, `@dnd-kit/sortable`,
  `@dnd-kit/utilities`), matching `sovereign-tasks`' identical drag-reorder
  pattern (`dndSensors.ts`'s `useReorderSensors`, copied verbatim from that
  plugin and not `@sovereignfs/ui`-exported; the drag handle itself is
  `@sovereignfs/ui`'s exported `GripIcon`, which replaced this plugin's own
  copy of it once the DS started exporting one).
  **Each category group mounts its own independent `DndContext`** (unique
  `id` prop per group, e.g. `` `shopper-items-${category}` ``) wrapping a
  `SortableContext` scoped to just that group's item ids — items still can't
  cross a category boundary, same invariant the buttons enforced, but now
  it's structural (dnd-kit's collision detection only sees ids registered to
  the `SortableContext` a drag started in) rather than a UI affordance
  choice.
  - The drag handle (`GripIcon`, `ItemRow.tsx`'s trailing slot) is the only
    element carrying `{...attributes} {...listeners}` — **not** whole-row
    drag like `TaskItem`'s. `CheckableListRow`'s entire row is this
    plugin's primary tap-to-buy target (SHP-07); forwarding drag listeners
    onto it would compete with that core interaction, unlike Tasks' small
    `Checkbox`. This also means no `data-no-dnd` markers are needed
    anywhere in the row.
  - `ItemRow` owns its own `<li>` (not the parent `.map()`) — `useSortable`'s
    ref/transform-style has to attach to the actual sortable DOM node.
  - **`reorderItems(listId, orderedIds)` (`actions.ts`) is not a straight
    port of Tasks' `reorderTasks`.** Tasks renumbers its dragged array to
    `0..n`, which works because `tasks_items.sort_order` has no cross-list
    grouping concern. Shopper's `sort_order` is one flat column shared
    across the *whole list*, and `groupItemsByCategory` derives each
    category *section's* position by comparing categories' first-item
    `sort_order` — renumbering a dragged category to `0..n` would collide
    with every other category's values and scramble which section renders
    first. `reorderItems` instead fetches the `sort_order` values that
    `orderedIds` already occupies, sorts them, and reassigns them in the
    new order — the same permutation-not-renumbering invariant the old
    `swapItemOrder` (a pure two-item slot swap) already relied on,
    generalized to N items. Bails out with no partial write if any id in
    `orderedIds` doesn't resolve to a row on the list (a stale id from a
    concurrent edit elsewhere).
  - Optimistic UI is `useOptimistic(items, itemsReducer)` in `ListPane.tsx`
    over the *full* item array (active + bought) — the `'reorder'` action
    splices a category's reordered subset back in, same technique
    `TasksPane`'s `tasksReducer` uses.
- **Category groups derive from `groupItemsByCategory`** (`app/_lib/group.ts`,
  pure, no DB access) — groups order by first-appearance in `sort_order`,
  with "Uncategorized" (`category: null`) always sorted last regardless of
  when those items were added. Bought items never appear in a category
  group — they move to `BoughtSection.tsx`'s own collapsed list the moment
  `checked_at` is set (see tap-to-buy above).
- **Layout**: list switcher (sidebar on desktop, its own screen on mobile,
  ≤768px canonical breakpoint — use `useIsMobile`/`MOBILE_BREAKPOINT_PX`
  from `@sovereignfs/ui`, never a plugin-local number) + a content pane for
  the active list. **Item editing is a `Dialog` (T-07), not a `Sheet`** —
  UI.md screen 4 originally speced a `Sheet`, but `Sheet`'s own doc comment
  says it's "for the mobile case specifically" with "no equivalent
  presentation" on desktop, discovered while implementing T-07; `Dialog`
  already auto-adapts mobile to a full-screen overlay, covering both
  breakpoints without a bespoke desktop layout. Sharing is also a `Dialog`
  (scrim, centered, auto-adapts to a full overlay on mobile) — see UI.md
  screen 5.
- **Icon set resolved** (SPEC.md open question 4 / UI.md open question 1,
  T-06): real curated Lucide SVG icons via `IconPicker`, not emoji. Category
  + keyword-match logic lives in `app/_lib/icons.ts`
  (`suggestCategoryAndIcon`, `resolveIcon`); `addItemToList` auto-assigns an
  icon+category by name keyword when a new catalog product is created;
  `IconPicker` itself is wired into the edit dialog (T-07,
  `ItemEditDialog.tsx`) so a user can override the guess.
- Every mutation needs an inline pending label and expected-error path
  (`useActionState`, shared `ActionResult` convention) — never let a thrown
  error blow past to the platform 500. `app/error.tsx` is required (see
  UI.md screen 10 for its exact copy/behavior).

## Sharing model (Phase 1)

Direct per-user sharing only — no invite link, no email, no acceptance flow.
The owner picks a user via `sdk.directory.searchUsers()`, grants `editor` or
`viewer` on `shopper_list_shares`, and can revoke at any time. This is
deliberately the same pattern as Sovereign Docs' instance sharing. Household
membership (Phase 2) will grant *implicit* access to a household's default
list; `shopper_list_shares` continues to exist unchanged as the mechanism for
sharing a list *beyond* that membership.

## Mobile shell

Below 768px (the platform's canonical `MOBILE_BREAKPOINT_PX`, via
`@sovereignfs/ui`'s `useIsMobile()` — **not** a plugin-local override) the
plugin renders a completely different component tree, ported directly from
sovereign-tasks' identical pattern (see that plugin's own CLAUDE.md "Mobile
shell" section for the fuller original rationale; only Shopper-specific
deltas are called out below). `layout.tsx` delegates to
`app/_components/MobileAwareShell.tsx`, which on mobile mounts
`MobileShopperCarousel.tsx` instead of rendering `children` (the routed
page's server output) at all.

- **Carousel model**: slide 0 is `Sidebar` full-page (reused unchanged from
  desktop); slide *n* (1 ≤ n ≤ number of accessible lists) is that list,
  owned lists first then shared — same order as the desktop `Sidebar`. A
  trailing **Combined view** slide (`CombinedPane`) is appended only once
  there are 2+ accessible lists, matching the desktop Sidebar's own
  "Combined view — available once you have 2+ lists" gating. A native
  `scroll-snap-type: x` container gives swipe physics for free, no hand-
  rolled pointer dragging. **Swiping right (finger left→right) reveals the
  previous slide** (toward the Lists index); swiping left advances toward
  the next list, then the Combined view — same convention as sovereign-tasks,
  chosen deliberately for behavioral consistency between the two plugins.
  Unlike Tasks, there's no "land on the Lists index, not the first list"
  special case to handle: `page.tsx`'s existing SHP-03 redirect
  (`getLastListId`/first-accessible fallback) already lands the user on a
  concrete `/shopper/lists/[id]` route server-side, before the carousel ever
  mounts — so the carousel's `indexForPathname` has no bare-`/shopper` case
  in practice.
- **Shared render components, not shared data-fetching**: `ListPane`
  (`app/lists/[listId]/ListPane.tsx`) and `CombinedPane`
  (`app/combined/CombinedPane.tsx`) are the extracted presentation bodies of
  `lists/[listId]/page.tsx` and `combined/page.tsx` respectively — pure
  props-in components with no data-fetching of their own. The desktop route
  fetches server-side and renders them; `MobileShopperCarousel` fetches the
  same already-exported `'use server'` actions (`getList`, `getListItems`,
  `getListItemDetail`, `getCombinedItems`) client-side per slide, caches per
  list id, and eagerly prefetches `activeIndex ± 1` so a swipe never shows a
  spinner — same decoupled-data strategy as sovereign-tasks'
  `MobileTasksCarousel`, for the same reason (a real prop-threaded
  alternative would force a remount on every swipe-triggered navigation).
- **`setLastList` moves into the carousel itself**: on desktop this is
  called from `lists/[listId]/page.tsx` on every visit (SHP-03). The mobile
  carousel bypasses that route entirely, so it calls `setLastList` itself
  whenever the settled slide is a real list (not the index or Combined
  slide) — the one genuinely new piece of state-keeping this port needed
  that sovereign-tasks has no equivalent of (Tasks has no "last opened
  list" concept).
- **No `Sheet` wrapper needed for item editing** — unlike Tasks' task-detail
  pane (which needed a hand-wrapped `Sheet` because it supplies its own
  custom header), `ItemEditDialog` is already `@sovereignfs/ui`'s `Dialog`,
  which auto-adapts to a full-screen overlay on mobile per its own doc
  comment. `MobileShopperCarousel` fetches `getListItemDetail` client-side
  keyed on the active slide + `?item=` param and passes it straight through
  to `ListPane`'s existing `editingItem` prop — no new overlay-management
  code required.
- **`router.refresh()` still works**: `MobileAwareShell` passes `children`
  through to the carousel as `refreshSignal` — not to render, purely as a
  signal. Every mutating component under `app/_components/` already calls
  `router.refresh()` on success (`AddItemBar`, `ItemRow`, `ItemEditDialog`,
  `BoughtSection`, `ListHeaderActions`, `Sidebar`, `CreateListForm`), so none
  of them needed touching for this port.
- **Settled-slide detection is a debounced `scroll` listener**, not the
  `scrollend` event — same pre-17.4 iOS Safari/WKWebView compatibility
  reasoning as sovereign-tasks.
- **Known pre-existing issue, not introduced by this port**: `PageHeader`'s
  title and `ListHeaderActions`' Share/Rename/Archive buttons overlap at
  narrow (~375px) widths — this is a `ListPane`/`PageHeader` layout gap that
  already existed under the old CSS-stacked mobile fallback this port
  replaced; worth a follow-up pass, out of scope here since it's unrelated
  to swipe navigation itself.

## Versioning

This plugin follows its own semver, independent of the platform version:

- `fix/` → patch (0.0.x)
- `feat/` → minor (0.x.0)
- Breaking change → major (x.0.0)

Current version: **0.6.0** (`manifest.json` is the source of truth — this line
has drifted before; check it there first)

## Running locally

The plugin is mounted into the Sovereign platform during development. From
the platform monorepo root:

```bash
pnpm dev   # starts runtime on :3000; plugin routes are available at /shopper
```

When porting to the standalone `sovereign-shopper` repo, the plugin is
installed via `sv plugin add` and the platform hot-reloads it.

## Testing (`app/_lib/__tests__/`)

`pnpm test` runs Vitest against `app/_lib/**/__tests__/**/*.test.ts`
(`vitest.config.ts`). Server actions are tested by mocking `@sovereignfs/sdk`
directly — `vi.mock('@sovereignfs/sdk', ...)` with `sdk.db.getClient`
resolving a hand-rolled `fakeDb` that implements just enough of Drizzle's
chainable `select().from().where()/.innerJoin()/.orderBy()/.limit()`,
`insert().values()/.onConflictDoUpdate()`, `update().set().where()`,
`delete().where()` shape to run real action code, routed by table name via
`getTableName()` from `drizzle-orm`. This is the same pattern
`sovereign-plainwrite`'s test suite already established — kept consistent
across the plugin family rather than introducing a different mocking style
here.

**This fake never evaluates WHERE predicates** — it routes purely by table
name (and, where a test needs to distinguish two same-table queries in one
action, by call order). That's enough for role/access-rejection tests
(`access-control.test.ts`: a viewer's write throws, a non-shared user's
`getList()` resolves `null`) and empty-state/revoke tests
(`edge-cases.test.ts`), but it means a naive version of this fake *cannot*
catch a regression that silently drops `eq(table.tenantId, tenantId)` from a
query — the fake would return the same canned rows regardless. To make the
tenant-scoping sweep (`tenant-scoping.test.ts`) an actual regression trap, its
fake instead **captures the condition object** passed to `.where()`/
`update().set().where()`/`.delete().where()` (or the values object passed to
`.insert().values()`) and walks it to confirm a `tenant_id`-named column (or
`tenantId` value) is really referenced — see that file's
`referencedColumnNames()` helper and its doc comment for why the walk must
skip a column's circular `.table` back-reference (it holds every sibling
column too, which would otherwise produce false negatives).

**Bug found and fixed by this sweep (T-11):** `renameList` and `archiveList`
used to scope their `UPDATE ... WHERE` by `eq(shopper_lists.owner_user_id,
userId)` directly instead of the `getList()` + role-check pattern every other
mutating action in `actions.ts` uses. A non-owner's call matched zero rows and
returned successfully as a silent no-op instead of throwing — inconsistent
with the rest of the file and impossible to distinguish from success in the
UI. Both now call `getList()` first and throw `'Only the owner can
rename/archive this list.'` for any non-owner role, same as
`shareList`/`revokeShare`.

## Open questions (from SPEC.md and UI.md)

1. ✅ **Icon set** — resolved T-06, see UI rules above.
2. ✅ **Quantity stepper unit list** — resolved T-07: a fixed short list
   (pcs/kg/g/lb/L/mL/bag/box/bunch/pack/dozen) via a plain `Select`, not free
   text with autocomplete. `QuantityStepper` itself only owns the numeric
   part — swapping the unit list later doesn't touch that component.
3. ✅ **New-component ownership** — resolved by precedent: `SuggestionInput`
   (T-05), `IconPicker` (T-06), and `QuantityStepper` (T-07) all landed as
   platform-repo PRs opened from this plugin's own roadmap work, not a
   separate prerequisite task. Same pattern applies to the still-open
   checkable-list-row primitive (T-08).
4. **Phase 1 → Phase 2 migration mechanics** — design before starting v0.2
   (roadmap T-12).
5. ✅ **Severing a deleted account's attribution on other people's lists** —
   resolved by platform **RFC 0097**: attribution columns are nullable and a
   deletion handler sets them to `null`, counting those rows in the new
   `DeletionResult.anonymized` rather than in `deleted`. A platform-wide
   "deleted user" sentinel was considered and rejected (invisible to the type
   system; needs hand-exclusion from every filter and aggregate forever; buys
   nothing at render time because `sdk.directory.resolveUsers()` returns
   nothing for it either way). `added_by`/`purchased_by` are now nullable in
   both dialect schemas (migration `0002`), and `deleteAllShopperData` severs
   after its ownership-scoped deletes — what still matches is exactly the set
   of rows on other people's lists. **When a UI eventually renders either
   column, render `null` as no byline at all**, not "Deleted user" (RFC 0097
   §4). `sovereign-tasks` has the same gap on `assignee_id` and has not yet
   adopted this.
