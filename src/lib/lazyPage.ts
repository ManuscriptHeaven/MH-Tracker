import { lazy, type ComponentType } from 'react';

const RELOAD_FLAG = 'mh_lazy_chunk_reloaded';

/**
 * Lazy-load a page that is exported by name.
 *
 * After a new deployment the old JavaScript chunks no longer exist, so a tab
 * that was opened before the deploy can fail to fetch a page chunk. In that
 * case reload once to pick up the new build instead of showing an error.
 */
export function lazyPage<Name extends string, Page extends ComponentType<any>>(
  load: () => Promise<Record<Name, Page>>,
  name: Name,
) {
  return lazy(async () => {
    try {
      const module = await load();
      try {
        sessionStorage.removeItem(RELOAD_FLAG);
      } catch {
        // Storage can be unavailable (private mode); the page still loads.
      }
      return { default: module[name] };
    } catch (error) {
      let alreadyReloaded = true;
      try {
        alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === '1';
        if (!alreadyReloaded) sessionStorage.setItem(RELOAD_FLAG, '1');
      } catch {
        // Without storage we cannot guard against a reload loop, so do not reload.
      }
      if (!alreadyReloaded && typeof window !== 'undefined') {
        window.location.reload();
        return new Promise<never>(() => {});
      }
      throw error;
    }
  });
}
