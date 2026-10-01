import { useEffect, useMemo, useRef, useState } from 'react';

import { type DecodedImage, renderIcon } from '../../core/icon';
import { isFresh, type Preview, type PreviewCache } from '../../core/preview';

/** Cells a favicon takes in the detail pane: 8×8 pixels in half blocks. */
export const ICON_COLS = 8;
export const ICON_ROWS = 4;

/** Wait this long after the cursor stops before fetching, so scrolling past pages fetches none. */
const SETTLE_MS = 300;

export interface PreviewState {
  preview: Preview | undefined;
  /** The favicon as lines of half blocks, once there is one. */
  icon: string[] | undefined;
  isFetching: boolean;
}

/**
 * The cached preview of `url`, fetched when it is missing or stale and `auto` is on — or right
 * away, cached or not, each time `forceKey` changes (the `f` key).
 *
 * `onFetched` hears about every preview that lands, so the list can pick up a title the page
 * gave for a bookmark that has none.
 */
export const usePreview = (
  cache: PreviewCache,
  url: string | undefined,
  { auto, forceKey, onFetched }: { auto: boolean; forceKey: number; onFetched?: () => void },
): PreviewState => {
  const [preview, setPreview] = useState<Preview | undefined>(() =>
    url ? cache.get(url) : undefined,
  );
  const [image, setImage] = useState<DecodedImage | undefined>(undefined);
  const [isFetching, setIsFetching] = useState(false);
  //? The `forceKey` already acted on. Consumed the moment the effect sees a new one, so moving
  //? the cursor before the forced fetch starts does not force a fetch of the next page as well
  const handledForce = useRef(forceKey);
  //? Read through a ref: callers write it inline, and as a dependency it would refetch on every
  //? render
  const onFetchedRef = useRef(onFetched);
  onFetchedRef.current = onFetched;

  useEffect(() => {
    let live = true;
    const cached = url ? cache.get(url) : undefined;
    setPreview(cached);
    setImage(undefined);
    setIsFetching(false);
    if (!url) return;
    void cache.icon(cached).then((next) => live && setImage(next));

    const force = forceKey !== handledForce.current;
    handledForce.current = forceKey;
    if (!force && (!auto || isFresh(cached))) return;
    const timer = setTimeout(
      () => {
        setIsFetching(true);
        void cache.ensure(url, { force }).then(async (next) => {
          if (!live) return;
          setPreview(next);
          setIsFetching(false);
          onFetchedRef.current?.();
          const icon = await cache.icon(next);
          if (live) setImage(icon);
        });
      },
      force ? 0 : SETTLE_MS,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [cache, url, auto, forceKey]);

  const icon = useMemo(
    () => (image ? renderIcon(image, ICON_COLS, ICON_ROWS) : undefined),
    [image],
  );
  return { preview, icon, isFetching };
};

export default usePreview;
