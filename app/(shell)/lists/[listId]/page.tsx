import { notFound } from 'next/navigation';
import { getList, getListItemDetail, getListItems, setLastList } from '../../../_lib/actions';
import ListPane from './ListPane';

interface Props {
  params: Promise<{ listId: string }>;
  searchParams: Promise<{ item?: string }>;
}

/**
 * List detail route. Fetches + access-checks, then hands off to `ListPane`
 * (shared with `MobileShopperCarousel`, which fetches the same data
 * client-side per slide — see that component's doc comment). Records itself
 * as the last-opened list (SHP-03) on every visit; the carousel does the
 * equivalent itself since it never renders this route on mobile.
 */
export default async function ListDetailPage({ params, searchParams }: Props) {
  const { listId } = await params;
  const { item: itemId } = await searchParams;
  const list = await getList(listId);
  if (!list) notFound();

  await setLastList(listId);
  const items = await getListItems(listId);
  const canEdit = list.role !== 'viewer';
  const editingItem = canEdit && itemId ? await getListItemDetail(listId, itemId) : null;

  return <ListPane listId={listId} list={list} items={items} editingItem={editingItem} />;
}
