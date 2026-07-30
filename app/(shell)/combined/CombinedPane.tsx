'use client';

import { EmptyState, Icon, PageHeader } from '@sovereignfs/ui';
import { resolveIcon } from '../../_lib/icons';
import type { CombinedItemRow } from '../../_lib/types';
import styles from './page.module.css';

interface Props {
  items: CombinedItemRow[];
}

/**
 * Combined-view render, shared by the desktop route (`page.tsx`,
 * server-fetched) and `MobileShopperCarousel` (client-fetched, its trailing
 * slide) — same split as `ListPane`.
 */
export default function CombinedPane({ items }: Props) {
  const grouped = new Map<string, CombinedItemRow[]>();
  for (const item of items) {
    const key = item.category ?? 'Uncategorized';
    const bucket = grouped.get(key) ?? [];
    bucket.push(item);
    grouped.set(key, bucket);
  }

  return (
    <div className={styles.page}>
      <PageHeader title="All lists" description="Everything across your accessible lists" />

      <div className={styles.banner}>
        Read-only — check items off from their own list to keep this view simple.
      </div>

      {items.length === 0 ? (
        <EmptyState
          heading="No items yet"
          description="Items you add to your lists will show up here once you start adding them."
        />
      ) : (
        <div className={styles.groups}>
          {[...grouped.entries()].map(([category, categoryItems]) => (
            <section key={category} className={styles.group}>
              <h2 className={styles.groupLabel}>{category}</h2>
              <ul className={styles.itemList}>
                {categoryItems.map((item) => (
                  <li key={item.id} className={styles.item}>
                    <span className={styles.itemIcon}>
                      <Icon name={resolveIcon(item.icon, item.category)} size="md" aria-hidden />
                    </span>
                    <span className={styles.itemName}>{item.name}</span>
                    <span className={styles.sourceTag}>{item.sourceListName}</span>
                    <span className={styles.quantity}>
                      {item.quantity}
                      {item.unit ? ` ${item.unit}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
