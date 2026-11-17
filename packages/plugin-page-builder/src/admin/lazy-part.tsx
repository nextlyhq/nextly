"use client";

/**
 * A part of the plugin's admin, registered now and fetched when first drawn.
 *
 * The app's generated component map imports the admin entry with the admin's
 * first load, so every part the entry imports eagerly reaches every admin
 * screen, the sign-in page included. The entry registers each part through
 * this instead: the registry holds a small component, and the part's own code
 * (the editor, the block engine, the editor stylesheet) is fetched by
 * `import()` when a screen draws it.
 *
 * Not `React.lazy`: a lazy component keeps a rejected import and rethrows it
 * on every later render, so one failed fetch would leave the part broken
 * until a full reload, and it needs a `Suspense` boundary above it, which a
 * plugin cannot count on wherever the admin draws its parts. This holds the
 * fetch itself: parts drawn while it is on its way share it, what it
 * delivered is kept (so a later mount draws the part at once), and a failure
 * is forgotten, so "Try again" fetches afresh.
 *
 * @module @nextlyhq/plugin-page-builder/admin/lazy-part
 */
import { useBeforeDocumentAction } from "@nextlyhq/plugin-sdk/admin";
import { Button } from "@nextlyhq/ui";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type JSX,
  type ReactNode,
} from "react";

/** The props the wrapper passes through, untouched, to the part it draws. */
type PassedProps = Record<string, unknown>;

/** How a part takes part in the document actions while it is fetched. */
interface LazyPartOptions {
  /**
   * The document actions, by id, that the part asks about before they store
   * (the blocks field asks about the components and Layout a page needs
   * before a publish). The part's own handler registers only once it is
   * drawn, so the wrapper holds these actions while the code is on its way:
   * once the part is drawn they run again with its handler among them, and
   * once its fetch has failed they are refused, so the question is never
   * skipped. Other actions are not held.
   */
  readonly holdsActions?: ReadonlySet<string>;
}

/** A held action, told whether the part was drawn or left the screen. */
interface HeldAction {
  readonly resolve: (drawn: boolean) => void;
  readonly reject: (error: Error) => void;
}

/** Why an action held for a part whose code could not be fetched is refused. */
const NOT_LOADED =
  "Part of this page could not be loaded, so nothing was published. Check your connection and try again.";

/**
 * A component drawing the part `load` fetches, with the props it is given.
 *
 * `load` runs on the first draw, not here, and once for every draw after it
 * until it succeeds.
 *
 * Typed as the part itself: the wrapper hands the part exactly the props it
 * receives, so a host that imports it keeps the part's own type, a generic
 * signature included.
 */
export function lazyPart<Part extends (props: never) => ReactNode>(
  load: () => Promise<Part>,
  options: LazyPartOptions = {}
): Part {
  const holds = options.holdsActions;
  let loaded: ComponentType<PassedProps> | null = null;
  let pending: Promise<ComponentType<PassedProps>> | null = null;

  function fetchPart(): Promise<ComponentType<PassedProps>> {
    pending ??= load().then(
      fetched => {
        // Drawn only with the props a caller handed the wrapper, which are
        // `Part`'s own (the wrapper is typed as `Part`); the checker cannot
        // follow that through a generic signature.
        const part = fetched as unknown as ComponentType<PassedProps>;
        loaded = part;
        return part;
      },
      (error: unknown) => {
        pending = null;
        throw error;
      }
    );
    return pending;
  }

  /** The part's state on this screen, fetching while it is loading. */
  function usePartState(): [PartState, (next: PartState) => void] {
    // Held as `{ part }`: a component is a function, which `useState` would
    // call as an initialiser or an updater.
    const [state, setState] = useState<PartState>(() =>
      loaded ? { part: loaded } : "loading"
    );

    // Fetches while the part is loading: on the first draw, and again after
    // "Try again" sets the state back to loading. A failure ends it here.
    useEffect(() => {
      if (state !== "loading") return;
      let live = true;
      fetchPart().then(
        part => {
          if (live) setState({ part });
        },
        () => {
          if (live) setState("failed");
        }
      );
      return () => {
        live = false;
      };
    }, [state]);

    return [state, setState];
  }

  function LazyPart(props: PassedProps): ReactNode {
    const [state, setState] = usePartState();
    return drawPart(state, setState, props);
  }

  // A separate component rather than a hook called on a condition: only a
  // part that holds actions registers with the document's actions.
  function HoldingLazyPart(props: PassedProps): ReactNode {
    const [state, setState] = usePartState();
    useHeldActions(state, holds ?? new Set());
    return drawPart(state, setState, props);
  }

  // The wrapper takes `Part`'s props and draws `Part` with them, so it stands
  // for `Part`; the checker cannot relate it to a generic signature.
  const wrapper = holds === undefined ? LazyPart : HoldingLazyPart;
  preloads.set(wrapper, () => {
    // A failure is forgotten by `fetchPart`; the draw asks again.
    fetchPart().catch(() => undefined);
  });
  return wrapper as unknown as Part;
}

/** How to fetch each lazy part's code before it is drawn, by its wrapper. */
const preloads = new WeakMap<object, () => void>();

/**
 * Fetch a lazy part's code now, before it is drawn: where a screen's address
 * already says the part comes next. The part's first draw takes this fetch
 * rather than asking again; a failed one is forgotten, so the draw asks
 * afresh. A component that is not a lazy part is left alone.
 */
export function preloadPart(part: object): void {
  preloads.get(part)?.();
}

/** Where a part's fetch stands on one screen. */
type PartState = { part: ComponentType<PassedProps> } | "loading" | "failed";

/** The part once fetched, the way to fetch it again, or nothing meanwhile. */
function drawPart(
  state: PartState,
  setState: (next: PartState) => void,
  props: PassedProps
): ReactNode {
  if (typeof state === "object") {
    const Part = state.part;
    return <Part {...props} />;
  }
  if (state === "failed") {
    return <PartLoadError onRetry={() => setState("loading")} />;
  }
  // Nothing while the code is on its way: an admin surface that hides a
  // section with an empty body keeps it hidden, and a part that arrives
  // quickly does not flash a loading mark.
  return null;
}

/**
 * Holds the actions `holds` names while the part's code is on its way (see
 * `LazyPartOptions.holdsActions`).
 */
function useHeldActions(state: PartState, holds: ReadonlySet<string>): void {
  // Whether the part is drawn, its fetch has failed, and the actions held
  // meanwhile; read by the handler below, which runs outside a render.
  const drawn = useRef(false);
  const failed = useRef(false);
  const held = useRef(new Set<HeldAction>());

  // After the part's own effects (a child's run first), so its handler is
  // registered by the time a held action runs the handlers again.
  useEffect(() => {
    drawn.current = typeof state === "object";
    failed.current = state === "failed";
    if (state === "loading") return;
    for (const action of held.current) {
      if (failed.current) action.reject(new Error(NOT_LOADED));
      else action.resolve(true);
    }
    held.current.clear();
  }, [state]);

  // A part that leaves the screen asks nothing: what it held goes ahead.
  useEffect(() => {
    const waiting = held.current;
    return () => {
      drawn.current = false;
      for (const action of waiting) action.resolve(false);
      waiting.clear();
    };
  }, []);

  useBeforeDocumentAction(async (action, store) => {
    if (!holds.has(action) || drawn.current) return;
    if (failed.current) throw new Error(NOT_LOADED);
    const wasDrawn = await new Promise<boolean>((resolve, reject) => {
      held.current.add({ resolve, reject });
    });
    // The handlers this action ran were read before the part registered its
    // own: a check that fails runs them all again, the part's with them.
    if (wasDrawn) store.checkBeforeWrite(() => false);
  });
}

/**
 * A part's fetch, joined with the editor's stylesheet.
 *
 * For the parts that draw the builder's own controls or the plugin's `nx-pb-`
 * classes, which the sheet styles. Fetched with them rather than imported by
 * the admin entry, so a screen that draws none of them never downloads it.
 */
export function withEditorStylesheet<Part>(part: Promise<Part>): Promise<Part> {
  return Promise.all([import("./editor-stylesheet"), part]).then(
    ([, loaded]) => loaded
  );
}

/** A fetch that failed, and the way to ask for it again. */
function PartLoadError({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 p-4 text-sm text-muted-foreground"
    >
      <p>
        This part of the page could not be loaded. Check your connection and try
        again.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
