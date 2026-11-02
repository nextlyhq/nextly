/**
 * A module fetched with `import()` that one failed fetch does not break for
 * the session.
 *
 * `React.lazy` keeps a rejected import and rethrows it on every later render,
 * so a connection blip, or a chunk a deploy has since removed, leaves what it
 * guards broken until a full reload. This holds the fetch instead: a preload
 * and a use share the one in flight, what it delivered is remembered (so a
 * later mount starts with it, not a loading state), and a failure is
 * forgotten, so the next attempt issues a fresh `import()`. Rendering its
 * three states is `useRetryableModule`'s part.
 *
 * @module lib/retryable-module
 */

export interface RetryableModule<T> {
  /** What the fetch delivered, once it has; `null` until then. */
  loaded: () => T | null;
  /**
   * Starts the fetch, or joins the one in flight. A failure clears it, so
   * the next call fetches again.
   */
  load: () => Promise<T>;
  /**
   * Fetches ahead of a use, when nothing has arrived yet. A failure says
   * nothing here: the use fetches again, and that is where it is shown.
   */
  preload: () => void;
}

export function retryableModule<T>(
  fetch: () => Promise<T>
): RetryableModule<T> {
  // The browser keeps every fetched module until a full reload, so keeping
  // what arrived costs nothing and spares a later mount its loading state.
  let loaded: T | null = null;
  let pending: Promise<T> | null = null;

  function load(): Promise<T> {
    pending ??= fetch().then(
      value => {
        loaded = value;
        return value;
      },
      (error: unknown) => {
        pending = null;
        throw error;
      }
    );
    return pending;
  }

  return {
    loaded: () => loaded,
    load,
    preload: () => {
      if (loaded === null) load().catch(() => undefined);
    },
  };
}
