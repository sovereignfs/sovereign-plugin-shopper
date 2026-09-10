import { Spinner } from '@sovereignfs/ui';
import styles from './loading.module.css';

/**
 * Covers the combined view (`getCombinedItems`) and a single list
 * (`getList`/`getListItems`) — both await the database before they can
 * render.
 */
export default function ShopperShellLoading() {
  return (
    <div className={styles.root} role="status" aria-live="polite">
      <Spinner />
      <span>Loading…</span>
    </div>
  );
}
