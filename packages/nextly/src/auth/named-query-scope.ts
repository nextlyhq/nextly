/**
 * Whether the code running now is a page builder named query's `run`.
 *
 * A named query is developer code a published page runs to read its rows.
 * It is handed one reader, which reads as an anonymous visitor, only what
 * the query declares, each read counted against the page's allowance and
 * tagging the page's cache. Every guarantee the page builder makes about a
 * named query rests on that reader being the ONLY way it reads. But `run` is
 * ordinary server code: a closure that imports the Direct API could read a
 * collection it never declared, uncounted and untagged, or read with the
 * server's access, and its rows would reach a published page.
 *
 * So the renderer runs `run` inside a frame ({@link openNamedQueryFrame}),
 * and the entry points into the server refuse while it is open: every
 * Direct API method, the instance's own service getters, and the resolution
 * of a plugin's service. The reader's own reads go through the frame's
 * `read` door, which leaves the frame for the length of that read: the door
 * belongs to the frame that opened it, so code inside `run` cannot open one
 * of its own and walk through it.
 *
 * A guardrail against mistakes in the app's own code, not a sandbox: what
 * the server hands out is never wrapped, so an object taken before the run
 * and called during it is not refused. That is code written to get round the
 * guard, which a named query, as the app's own code, could always write.
 *
 * `AsyncLocalStorage`, for the reason every caller scope here uses it: pages
 * render concurrently. The cost is one store lookup per Direct API call.
 *
 * @module auth/named-query-scope
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { NextlyError } from "../errors/nextly-error";

/** One open frame: the query it runs, as the log names it. */
interface FrameToken {
  readonly name: string;
}

const namedQueryFrame = new AsyncLocalStorage<FrameToken>();

/**
 * One named query's frame: `run` executes the query inside it, and `read` is
 * the one door through which the query's own reader reads.
 *
 * @experimental
 */
export interface NamedQueryFrame {
  /** Run `operation` inside the frame. Refused inside another frame. */
  run<T>(operation: () => T): T;
  /**
   * Run `operation` outside the frame, for the reader handed to the query.
   * Refused unless called from inside THIS frame, so a frame code opens
   * for itself is no way out of the one it runs in.
   */
  read<T>(operation: () => T): T;
}

/** The refusal for a call made where a named query may not make one. */
function refusal(query: string, operation: string): NextlyError {
  // The log names the query and the call; a named query reads only through
  // the reader it is given.
  return NextlyError.forbidden({
    logContext: { reason: "named-query-trusted-read", query, operation },
  });
}

/**
 * Open the frame a named query `name` runs in.
 *
 * @experimental
 */
export function openNamedQueryFrame(name: string): NamedQueryFrame {
  const token: FrameToken = { name };
  return Object.freeze({
    run<T>(operation: () => T): T {
      const outer = namedQueryFrame.getStore();
      if (outer !== undefined) {
        throw refusal(outer.name, "a named query frame of its own");
      }
      return namedQueryFrame.run(token, operation);
    },
    read<T>(operation: () => T): T {
      const current = namedQueryFrame.getStore();
      if (current !== token) {
        throw refusal(current?.name ?? name, "a frame's reader door");
      }
      return namedQueryFrame.exit(operation);
    },
  });
}

/**
 * The refusal for a Direct API call made inside a named query's frame, or
 * nothing outside one. `operation` names the call in the log.
 */
export function refusedInsideNamedQuery(
  operation: string
): NextlyError | undefined {
  const frame = namedQueryFrame.getStore();
  return frame === undefined ? undefined : refusal(frame.name, operation);
}
