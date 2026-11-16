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
import { Button } from "@nextlyhq/ui";
import {
  useEffect,
  useState,
  type ComponentType,
  type JSX,
  type ReactNode,
} from "react";

/** The props the wrapper passes through, untouched, to the part it draws. */
type PassedProps = Record<string, unknown>;

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
  load: () => Promise<Part>
): Part {
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

  function LazyPart(props: PassedProps): ReactNode {
    // Held as `{ part }`: a component is a function, which `useState` would
    // call as an initialiser or an updater.
    const [state, setState] = useState<
      { part: ComponentType<PassedProps> } | "loading" | "failed"
    >(() => (loaded ? { part: loaded } : "loading"));

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

  // The wrapper takes `Part`'s props and draws `Part` with them, so it stands
  // for `Part`; the checker cannot relate it to a generic signature.
  return LazyPart as unknown as Part;
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
