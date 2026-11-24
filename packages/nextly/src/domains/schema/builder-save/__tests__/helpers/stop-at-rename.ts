/**
 * A file rename a test stops a settle at: after the rename, never returning, as a process killed
 * there leaves the folder; or failing in its place. Every other rename runs as it is.
 *
 * Installed by a test file over `node:fs/promises`:
 * `vi.mock("node:fs/promises", async original =>
 *   (await import("./helpers/stop-at-rename")).stoppingRenames(await original()))`.
 */
import type * as FsPromises from "node:fs/promises";

type Picks = (from: string, to: string) => boolean;

/** Which rename to stop after or to fail, and how a stopped one is reached and let go. */
export const renames = {
  stopAfter: undefined as Picks | undefined,
  fail: undefined as Picks | undefined,
  reached: undefined as (() => void) | undefined,
  release: undefined as (() => void) | undefined,
};

/** `actual` with its `rename` stopping or failing where `renames` says. */
export function stoppingRenames(actual: typeof FsPromises): typeof FsPromises {
  const rename: typeof FsPromises.rename = async (from, to) => {
    if (renames.fail?.(String(from), String(to)) === true) {
      throw new Error(`EIO: rename ${String(from)}`);
    }
    await actual.rename(from, to);
    if (renames.stopAfter?.(String(from), String(to)) !== true) return;
    // One rename only: what runs after the stop renames as it is.
    renames.stopAfter = undefined;
    await new Promise<void>((_, reject) => {
      renames.release = () => reject(new Error("the process was killed"));
      renames.reached?.();
    });
  };
  // The module's default export holds the same functions, so it stops too.
  const { default: named } = actual as typeof actual & { default?: object };
  return {
    ...actual,
    rename,
    default: { ...named, rename },
  } as typeof FsPromises;
}

/** Run `settle` and stop it after the rename `at` picks; resolves once it has stopped there. */
export async function stoppedAtRename(
  at: Picks,
  settle: () => Promise<unknown>
): Promise<"reached" | string> {
  const reached = new Promise<string>(resolve => {
    renames.reached = () => resolve("reached");
  });
  renames.stopAfter = at;
  const ended = settle().then(
    answer => `it ended first: ${JSON.stringify(answer)}`,
    (error: unknown) => `it failed first: ${String(error)}`
  );
  return Promise.race([reached, ended]);
}

/** Lets a stopped settle go and puts every rename back as it is, once a case has looked. */
export function letRenamesGo(): void {
  renames.stopAfter = undefined;
  renames.fail = undefined;
  renames.reached = undefined;
  renames.release?.();
  renames.release = undefined;
}
