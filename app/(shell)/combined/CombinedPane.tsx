'use client';

import { EmptyState, Icon, PageHeader } from '@sovereignfs/ui';
import { groupItemsByCategory } from '../../_lib/group';
import { resolveIcon } from '../../_lib/icons';
import type { CombinedItemRow } from '../../_lib/types';
import styles from './page.module.css';

interface Props {
  items: CombinedItemRow[];
}

/**
 * Combined-view render, shared by the desktop route (`page.tsx`,
 * server-fetched) and `MobileShopperCarousel` (client-fetched, its trailing
 * slide) — same split as `ListPane`. Grouping goes through the same
 * `groupItemsByCategory` the list view uses (Uncategorized last), rather
 * than a second inline Map that ordered its sections differently.
 */
export default function CombinedPane({ items }: Props) {
  const groups = groupItemsByCategory(items);

  return (
    <div className={styles.page}>
      <PageHeader title="All lists" description="Everything across your accessible lists" />

      <div className={styles.banner}>
        Read-only — check items off from their own list to keep this view simple.
      </div>

      {items.length === 0 ? (
        <EmptyState
          heading="Nothing left to buy"
          description="Items from all your lists show up here until someone marks them bought."
        />
      ) : (
        <div className={styles.groups}>
          {groups.map((group) => (
            <section key={group.category} className={styles.group}>
              <h2 className={styles.groupLabel}>{group.category}</h2>
              <ul className={styles.itemList}>
                {group.items.map((item) => (
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
