import { useId } from 'react';

/**
 * A pair of kitty image ids for one mounted card — `id` for its preview image, `id + 1` for its
 * favicon. Distinct and stable for every mounted card, even two showing the same URL.
 */
export const useOverlayId = () => {
  const id = useId();
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return 10000 + ((hash >>> 0) % 1000000000) * 2;
};

export default useOverlayId;
