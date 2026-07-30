import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getContext, getList } from '../../_lib/actions';
import { normalize } from '../../_lib/helpers';
import { suggestCategoryAndIcon } from '../../_lib/icons';
import { shopperListItems, shopperProducts, shopperPurchases } from '../../_db/schema';
import type {
  AddItemPayload,
  DeleteItemPayload,
  OfflineSyncRequest,
  OfflineSyncResponse,
  SetBoughtPayload,
  UpdateItemPayload,
} from '../../_lib/offline-types';

/**
 * Applies a batch of queued offline mutations (RFC 0078 §4) — the server
 * half of the idempotent, absolute-state apply contract `sdk.offline-queue`
 * documents. A plain Route Handler (client `fetch()`-able, unlike a Server
 * Action), gated by the platform's ordinary session middleware exactly like
 * a page. `offline:write` (declared in manifest.json) is review/install-time
 * signal only — the real authorization boundary here is the same session +
 * role check every other mutating action in this file already performs;
 * see RFC 0078 §6 for why a manifest permission can't be host-enforced the
 * way `mailer:send` is for a plugin's own Route Handler.
 *
 * Applies **sequentially, halting at the first `failed` result** — a
 * mutation later in the batch that depends on an earlier one (e.g. editing
 * an item some earlier queued mutation was meant to create) is never
 * attempted out of order. Mutations never reached this round are simply
 * omitted from the response; `drainQueue` on the client leaves them queued
 * for the next attempt.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as OfflineSyncRequest;
  const outcomes: OfflineSyncResponse['outcomes'] = [];

  for (const mutation of body.mutations) {
    try {
      const status = await applyMutation(mutation.op, mutation.payload, mutation.clientTimestamp);
      outcomes.push({ id: mutation.id, status });
      if (status === 'failed') break;
    } catch (error) {
      outcomes.push({
        id: mutation.id,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      break;
    }
  }

  return NextResponse.json({ outcomes } satisfies OfflineSyncResponse);
}

/** Exported for direct unit testing — see `__tests__/offline-sync.test.ts`. */
export async function applyMutation(
  op: OfflineSyncRequest['mutations'][number]['op'],
  payload: OfflineSyncRequest['mutations'][number]['payload'],
  clientTimestamp: number,
): Promise<'applied' | 'skipped' | 'failed'> {
  switch (op) {
    case 'addItem':
      return applyAddItem(payload as AddItemPayload, clientTimestamp);
    case 'updateItem':
      return applyUpdateItem(payload as UpdateItemPayload, clientTimestamp);
    case 'deleteItem':
      return applyDeleteItem(payload as DeleteItemPayload);
    case 'setBought':
      return applySetBought(payload as SetBoughtPayload, clientTimestamp);
    default:
      return 'failed';
  }
}

async function applyAddItem(
  payload: AddItemPayload,
  clientTimestamp: number,
): Promise<'applied' | 'skipped' | 'failed'> {
  const list = await getList(payload.listId);
  if (!list) return 'failed'; // parent list gone — surface it, don't silently drop the add.
  if (list.role === 'viewer') return 'failed';

  const { db, userId, tenantId } = await getContext();

  const [existingById] = await db
    .select({ id: shopperListItems.id })
    .from(shopperListItems)
    .where(eq(shopperListItems.id, payload.id))
    .limit(1);
  if (existingById) return 'applied'; // idempotent retry — already inserted.

  const trimmed = payload.name.trim();
  if (!trimmed) return 'failed';
  const normalized = normalize(trimmed);

  const [existingProduct] = await db
    .select()
    .from(shopperProducts)
    .where(
      and(
        eq(shopperProducts.tenantId, tenantId),
        eq(shopperProducts.ownerUserId, list.ownerUserId),
        eq(shopperProducts.normalizedName, normalized),
      ),
    )
    .limit(1);

  const product =
    existingProduct ??
    (await (async () => {
      const id = randomUUID();
      const { category, icon } = suggestCategoryAndIcon(trimmed);
      await db.insert(shopperProducts).values({
        id,
        tenantId,
        ownerUserId: list.ownerUserId,
        name: trimmed,
        normalizedName: normalized,
        category,
        icon,
        createdBy: userId,
        createdAt: clientTimestamp,
        updatedAt: clientTimestamp,
      });
      return { id, category, icon, defaultUnit: null as string | null };
    })());

  const [lastItem] = await db
    .select({ sortOrder: shopperListItems.sortOrder })
    .from(shopperListItems)
    .where(eq(shopperListItems.listId, payload.listId))
    .orderBy(desc(shopperListItems.sortOrder))
    .limit(1);
  const nextSortOrder = (lastItem?.sortOrder ?? -1) + 1;

  await db.insert(shopperListItems).values({
    id: payload.id,
    tenantId,
    listId: payload.listId,
    productId: product.id,
    name: trimmed,
    quantity: '1',
    unit: product.defaultUnit,
    category: product.category,
    icon: product.icon,
    sortOrder: nextSortOrder,
    addedBy: userId,
    createdAt: clientTimestamp,
    updatedAt: clientTimestamp,
  });
  return 'applied';
}

async function applyUpdateItem(
  payload: UpdateItemPayload,
  clientTimestamp: number,
): Promise<'applied' | 'skipped' | 'failed'> {
  const list = await getList(payload.listId);
  if (!list) return 'skipped';
  if (list.role === 'viewer') return 'failed';

  const { db, tenantId } = await getContext();
  const [item] = await db
    .select({ updatedAt: shopperListItems.updatedAt })
    .from(shopperListItems)
    .where(and(eq(shopperListItems.id, payload.itemId), eq(shopperListItems.listId, payload.listId)))
    .limit(1);
  if (!item) return 'skipped'; // deleted elsewhere — nothing to reconcile.

  // Last-write-wins: only apply if this mutation is newer than whatever's
  // already there (an online edit, or an earlier-synced offline mutation).
  if (clientTimestamp <= item.updatedAt) return 'skipped';

  const trimmed = payload.name.trim();
  if (!trimmed) return 'failed';

  await db
    .update(shopperListItems)
    .set({
      name: trimmed,
      quantity: payload.quantity,
      unit: payload.unit,
      updatedAt: clientTimestamp,
    })
    .where(and(eq(shopperListItems.id, payload.itemId), eq(shopperListItems.tenantId, tenantId)));
  return 'applied';
}

async function applyDeleteItem(payload: DeleteItemPayload): Promise<'applied' | 'skipped'> {
  const list = await getList(payload.listId);
  if (!list) return 'skipped';
  if (list.role === 'viewer') return 'skipped';

  const { db, tenantId } = await getContext();
  await db
    .delete(shopperListItems)
    .where(
      and(
        eq(shopperListItems.id, payload.itemId),
        eq(shopperListItems.listId, payload.listId),
        eq(shopperListItems.tenantId, tenantId),
      ),
    );
  return 'applied'; // naturally idempotent — a no-op if already gone.
}

async function applySetBought(
  payload: SetBoughtPayload,
  clientTimestamp: number,
): Promise<'applied' | 'skipped' | 'failed'> {
  const list = await getList(payload.listId);
  if (!list) return 'skipped';
  if (list.role === 'viewer') return 'failed';

  const { db, userId, tenantId } = await getContext();
  const [item] = await db
    .select()
    .from(shopperListItems)
    .where(and(eq(shopperListItems.id, payload.itemId), eq(shopperListItems.listId, payload.listId)))
    .limit(1);
  if (!item) return 'skipped';

  // Checked before the LWW gate below, deliberately: a retried delivery of
  // this *same* mutation (client saw no response but the first attempt
  // actually landed) has clientTimestamp === item.updatedAt, which the LWW
  // check alone would misclassify as "not newer" and return 'skipped' —
  // functionally harmless (drainQueue treats skipped the same as applied,
  // removing it from the queue either way) but mislabels a successful
  // no-op retry as a lost conflict. Checking state equality first reports
  // it accurately as 'applied', and also covers the distinct case of a
  // late, stale mutation whose target state someone else already reached.
  const alreadyBought = item.checkedAt !== null;
  if (alreadyBought === payload.bought) return 'applied';

  if (clientTimestamp <= item.updatedAt) return 'skipped';

  if (!payload.bought) {
    await db
      .update(shopperListItems)
      .set({ checkedAt: null, updatedAt: clientTimestamp })
      .where(and(eq(shopperListItems.id, payload.itemId), eq(shopperListItems.tenantId, tenantId)));
    await db
      .delete(shopperPurchases)
      .where(
        and(
          eq(shopperPurchases.listItemId, payload.itemId),
          eq(shopperPurchases.tenantId, tenantId),
        ),
      );
    return 'applied';
  }

  let price: number | null = null;
  if (item.productId) {
    const [product] = await db
      .select({ price: shopperProducts.typicalPrice })
      .from(shopperProducts)
      .where(eq(shopperProducts.id, item.productId))
      .limit(1);
    price = product?.price ?? null;
  }

  await db
    .update(shopperListItems)
    .set({ checkedAt: payload.at, updatedAt: clientTimestamp })
    .where(and(eq(shopperListItems.id, payload.itemId), eq(shopperListItems.tenantId, tenantId)));

  await db.insert(shopperPurchases).values({
    id: randomUUID(),
    tenantId,
    ownerUserId: list.ownerUserId,
    listId: payload.listId,
    listItemId: payload.itemId,
    productId: item.productId,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    price,
    purchasedBy: userId,
    purchasedAt: payload.at,
  });
  return 'applied';
}

