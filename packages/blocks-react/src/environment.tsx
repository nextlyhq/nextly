"use client";

/**
 * `@nextlyhq/blocks-react/environment` — the document and window a block's
 * own code should measure and listen against.
 *
 * A block renders in more than one place. On the published site it is in the
 * page's own document; in the editor it is drawn inside the canvas, which is
 * meant to become a frame of its own. A block that reaches for the globals
 * (`window.innerWidth`, `document.addEventListener`) keeps RENDERING in both
 * places, but its measurements and listeners would target the admin page
 * rather than the frame it is drawn in. So block code asks here, or reads its
 * own node's `ownerDocument` and `defaultView`, and never the globals.
 *
 * Its own entry, and a client one, because the root entry is server-only:
 * React's server build has no `createContext`, so a context created in a
 * module the root re-exports would fail every page that renders a block. A
 * block calling the hook is therefore a client component, which is what a
 * block measuring or listening has to be anyway.
 *
 * @module environment
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type JSX,
  type ReactNode,
} from "react";

/**
 * Where a block is drawn: the document holding its elements and that
 * document's window.
 *
 * @experimental The editor's canvas frame is still being built, and this may
 *   grow with it.
 */
export interface BlockEnvironment {
  readonly document: Document;
  readonly window: Window;
}

/**
 * Whether a provider is present, and what it states.
 *
 * Wrapped rather than storing the environment directly, because a provider
 * that has not found its frame yet states `undefined`, and that must not be
 * mistaken for no provider at all: falling back to the globals there would
 * hand an editor block the admin page in place of the canvas.
 */
interface Provided {
  readonly environment: BlockEnvironment | undefined;
}

const BlockEnvironmentContext = createContext<Provided | null>(null);

/** What {@link BlockEnvironmentProvider} takes. */
export interface BlockEnvironmentProviderProps {
  /** The environment to hand the blocks below, or `undefined` until known. */
  readonly value: BlockEnvironment | undefined;
  readonly children?: ReactNode;
}

/**
 * States the environment for every block drawn below it. The editor's canvas
 * provides one; a published page needs none.
 *
 * @experimental See {@link BlockEnvironment}.
 */
export function BlockEnvironmentProvider({
  value,
  children,
}: BlockEnvironmentProviderProps): JSX.Element {
  return (
    <BlockEnvironmentContext.Provider value={{ environment: value }}>
      {children}
    </BlockEnvironmentContext.Provider>
  );
}

/**
 * The page's own document and window, or `undefined` where there are none.
 *
 * Read through `globalThis` so a server render, which has neither, gets
 * `undefined` rather than a reference error.
 */
function ownEnvironment(): BlockEnvironment | undefined {
  const { document, window } = globalThis as {
    document?: Document;
    window?: Window;
  };
  if (document === undefined || window === undefined) return undefined;
  return { document, window };
}

/**
 * The document and window this block is drawn in.
 *
 * - Inside the editor, what the canvas provides: its frame's own document and
 *   window, from the first render.
 * - Anywhere else, the page's own, but only once the block has MOUNTED.
 *   `undefined` on the server, which has neither, and on the first render in
 *   the browser too, so the markup a hydrating render produces is the markup
 *   the server sent. Read it in an effect or after mount, as a measurement
 *   has to be anyway.
 *
 * @experimental See {@link BlockEnvironment}.
 */
export function useBlockEnvironment(): BlockEnvironment | undefined {
  const provided = useContext(BlockEnvironmentContext);
  const [mounted, setMounted] = useState<BlockEnvironment | undefined>(
    undefined
  );
  // Run whether or not a provider answers, because a hook's calls may not
  // depend on a condition; with a provider present the value is never read.
  useEffect(() => {
    if (provided === null) setMounted(ownEnvironment());
  }, [provided]);
  return provided === null ? mounted : provided.environment;
}
