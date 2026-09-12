import { useEffect, useState } from 'react';

/**
 * First index of a scrolling window that keeps `selected` inside it.
 *
 * Ink draws every child it is given; a list longer than the terminal does not
 * scroll, it spills past the bottom of the screen and takes the rest of the
 * layout with it. So a long list has to be sliced before rendering, and this is
 * the offset to slice at — it only moves when the selection would otherwise
 * leave the window, so the list stays still while the cursor travels down it.
 */
export const useScrollWindow = (
  count: number,
  selected: number,
  size: number,
): [number, React.Dispatch<React.SetStateAction<number>>] => {
  const [start, setStart] = useState(0);

  useEffect(() => {
    setStart((previous) => {
      const last = Math.max(0, count - size);
      let next = Math.min(previous, last);
      if (selected < next) next = selected;
      else if (selected >= next + size) next = selected - size + 1;
      return Math.max(0, Math.min(next, last));
    });
  }, [count, selected, size]);

  return [start, setStart];
};

export default useScrollWindow;
