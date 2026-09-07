export interface ListRow {
  id: string;
  name: string;
  kind: 'personal' | 'household';
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** The current user's relationship to this list. 'owner' for everything
   *  returned by getLists(); 'editor'/'viewer' only appears on a list
   *  fetched via getList() when it was shared rather than owned. */
  role: 'owner' | 'editor' | 'viewer';
  /** Always the list's actual owner, regardless of the current user's role —
   *  the product catalog (SHP-04) is scoped to this id, not the acting
   *  user's, so an editor's suggestions/adds contribute to the owner's
   *  catalog. */
  ownerUserId: string;
}

/** A row from the SHP-04 add-item suggestion dropdown. */
export interface ProductSuggestion {
  id: string;
  name: string;
  category: string | null;
  icon: string | null;
  defaultUnit: string | null;
}

/** One item on a list (SHP-04/06/07/08). */
export interface ListItemRow {
  id: string;
  name: string;
  quantity: string;
  unit: string | null;
  category: string | null;
  icon: string | null;
  checkedAt: number | null;
  sortOrder: number;
}

/** Full edit-form shape for one item (SHP-06, T-07) — the list-item row plus
 *  its linked catalog product's barcode/price, which live on
 *  `shopper_products` (not per-list-item). Saving writes back to both. */
export interface ListItemDetail extends ListItemRow {
  productId: string | null;
  barcode: string | null;
  /** Cents, or null if never set. */
  price: number | null;
}

/** A list shared with the current user by someone else (SHP-02). */
export interface SharedListRow {
  id: string;
  name: string;
  role: 'editor' | 'viewer';
  ownerName: string;
}

/** A row in the share dialog's "People with access" list (SHP-09, T-10). */
export interface ListShareRow {
  userId: string;
  name: string;
  email: string;
  role: 'editor' | 'viewer';
}

/** A matched user from the share dialog's search box (SHP-09, T-10). */
export interface DirectoryUserRow {
  id: string;
  name: string;
  email: string;
}

/** One item in the read-only combined roll-up (SHP-02) — a shopper_list_items
 *  row plus which list it came from, so the combined view can tag it. No
 *  `checkedAt`: `getCombinedItems` only returns items still to buy, so the
 *  field would always be null here. */
export interface CombinedItemRow {
  id: string;
  name: string;
  quantity: string;
  unit: string | null;
  category: string | null;
  icon: string | null;
  sourceListId: string;
  sourceListName: string;
}
