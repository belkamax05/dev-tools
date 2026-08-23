import type { ReactNode } from 'react';

/** The subset of ink's `RenderOptions` this lib passes through. */
export interface InkRenderOptions {
  stdout?: NodeJS.WriteStream;
  stdin?: NodeJS.ReadStream;
  stderr?: NodeJS.WriteStream;
  debug?: boolean;
  exitOnCtrlC?: boolean;
  patchConsole?: boolean;
}

/** The subset of ink's `Instance` this lib drives. */
export interface InkInstance {
  rerender: (node: ReactNode) => void;
  unmount: (error?: Error | number | null) => void;
  waitUntilExit: () => Promise<unknown>;
  cleanup: () => void;
  clear: () => void;
}

/**
 * Structural stand-in for ink's `render`.
 *
 * Typed here rather than imported from `ink` so a caller can inject the `render` of *its own*
 * ink install. Each repo resolves `ink`/`react` from its own `node_modules`, and a component
 * must be rendered by the reconciler that shares its React copy or its hooks find no dispatcher.
 */
export type InkRender = (node: ReactNode, options?: InkRenderOptions) => InkInstance;
