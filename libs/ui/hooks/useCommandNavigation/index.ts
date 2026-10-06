import { useCallback, useState } from 'react';

export interface NavigationLevel<T> {
  /** Names of the groups descended through to reach this level, outermost first. */
  path: string[];
  items: T[];
}

/** Breadcrumb-style navigation stack over hierarchical rows. */
const useCommandNavigation = <T>(initialItems: T[], initialStack?: NavigationLevel<T>[]) => {
  const [stack, setStack] = useState<NavigationLevel<T>[]>(
    initialStack ?? [{ path: [], items: initialItems }],
  );

  //? The stack is never emptied, so there is always a level to render
  const current = stack[stack.length - 1] as NavigationLevel<T>;

  const navigateInto = useCallback((name: string, items: T[]) => {
    setStack((prev) => {
      const parent = prev[prev.length - 1] as NavigationLevel<T>;
      return [...prev, { path: [...parent.path, name], items }];
    });
  }, []);

  const navigateBack = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const navigateRoot = useCallback(() => {
    setStack((prev) => prev.slice(0, 1));
  }, []);

  return { current, stack, navigateInto, navigateBack, navigateRoot };
};

export default useCommandNavigation;
