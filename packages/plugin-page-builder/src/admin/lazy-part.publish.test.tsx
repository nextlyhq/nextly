// @vitest-environment jsdom
/**
 * A part whose code is fetched when first drawn, and which asks a question
 * before a publish (the blocks field asks about the components and Layout a
 * page needs): a publish started while its code is on its way waits for it
 * and then asks the part's question, a publish after its fetch failed is
 * refused rather than let through unasked, and a save is never held.
 *
 * The before-action seam is captured as in `publish-offer.test.tsx`: the
 * test runs the handlers as the runner does, reading the mounted ones afresh
 * on every pass and running them again while a check before the write fails.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const befores = new Set<
  (action: string, checks: (() => boolean)[]) => Promise<void> | void
>();
const routes = vi.fn();

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => {
  const React = await import("react");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useBeforeDocumentAction: (
      handler: (
        action: string,
        store: {
          writesSettled(): Promise<boolean>;
          checkBeforeWrite(check: () => boolean): void;
        }
      ) => Promise<void> | void
    ) => {
      const latest = React.useRef(handler);
      React.useEffect(() => {
        latest.current = handler;
      });
      React.useEffect(() => {
        const run = (action: string, checks: (() => boolean)[]) =>
          latest.current(action, {
            writesSettled: async () => true,
            checkBeforeWrite: check => {
              checks.push(check);
            },
          });
        befores.add(run);
        return () => {
          befores.delete(run);
        };
      }, []);
    },
    writePluginRoute: (args: { path: string; body: unknown }) =>
      routes(args.path, args.body),
  };
});

/** Holds the blocks field's module back until a test lets it arrive. */
const blocksFieldArrives = deferred<void>();
vi.mock("./BlocksField", async () => {
  await blocksFieldArrives.promise;
  return { BlocksField: Field };
});
vi.mock("./editor-stylesheet", () => ({}));

const { lazyPart } = await import("./lazy-part");
const { useFormPublishOffer } = await import("./publish-offer");
const { PUBLISHING_ACTIONS } = await import("./publishing-actions");

afterEach(() => {
  cleanup();
  befores.clear();
  routes.mockReset();
});

const DOCUMENT = { formatVersion: 1, kind: "page", nodes: [] };

/** Like the runner: every mounted handler, again while a check fails. */
async function run(action = "publish"): Promise<void> {
  for (let pass = 0; pass < 3; pass++) {
    const checks: (() => boolean)[] = [];
    for (const before of [...befores]) await before(action, checks);
    if (checks.every(check => check())) return;
  }
  throw new Error("the work kept changing before the write");
}

const form = {};

/** A blocks field as far as publishing goes: the form's publish question. */
function Field(): JSX.Element {
  return useFormPublishOffer({
    form,
    name: "content",
    value: () => DOCUMENT,
    layout: null,
    subject: "page",
  });
}

/** A fetch the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("a part that asks before a publish, while its code is fetched", () => {
  it("holds a publish until the part is drawn, then asks its question", async () => {
    routes.mockResolvedValue({ dependencies: [], missing: 0 });
    const fetch = deferred<typeof Field>();
    const Part = lazyPart(() => fetch.promise, {
      holdsActions: PUBLISHING_ACTIONS,
    });
    render(<Part />);

    let settled = false;
    const publishing = run().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    fetch.resolve(Field);
    await publishing;

    expect(routes).toHaveBeenCalledWith("/publish-readiness", {
      documents: [DOCUMENT],
      layout: null,
    });
  });

  it("refuses a publish once the part's code could not be fetched", async () => {
    const Part = lazyPart(() => Promise.reject(new Error("offline")), {
      holdsActions: PUBLISHING_ACTIONS,
    });
    render(<Part />);
    await screen.findByRole("alert");

    await expect(run()).rejects.toThrow(
      "Part of this page could not be loaded, so nothing was published. Check your connection and try again."
    );
    expect(routes).not.toHaveBeenCalled();
  });

  it("refuses a publish held when the fetch fails", async () => {
    const fetch = deferred<typeof Field>();
    const Part = lazyPart(() => fetch.promise, {
      holdsActions: PUBLISHING_ACTIONS,
    });
    render(<Part />);

    const publishing = run();
    fetch.reject(new Error("offline"));

    await expect(publishing).rejects.toThrow(
      "Part of this page could not be loaded"
    );
  });

  it("does not hold a save", async () => {
    const fetch = deferred<typeof Field>();
    const Part = lazyPart(() => fetch.promise, {
      holdsActions: PUBLISHING_ACTIONS,
    });
    render(<Part />);

    await expect(run("save")).resolves.toBeUndefined();
  });

  it("lets a held publish through when the part leaves the screen", async () => {
    const fetch = deferred<typeof Field>();
    const Part = lazyPart(() => fetch.promise, {
      holdsActions: PUBLISHING_ACTIONS,
    });
    const { unmount } = render(<Part />);

    const publishing = run();
    await waitFor(() => expect(befores.size).toBe(1));
    unmount();

    await expect(publishing).resolves.toBeUndefined();
    expect(routes).not.toHaveBeenCalled();
  });

  it("is how the admin entry registers the blocks field", async () => {
    routes.mockResolvedValue({ dependencies: [], missing: 0 });
    const { BlocksField } = await import("./index");
    render(<BlocksField {...({} as Parameters<typeof BlocksField>[0])} />);

    let settled = false;
    const publishing = run().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    blocksFieldArrives.resolve();
    await publishing;

    expect(routes).toHaveBeenCalledWith("/publish-readiness", {
      documents: [DOCUMENT],
      layout: null,
    });
  });

  it("holds nothing for a part that asks nothing", async () => {
    const fetch = deferred<typeof Field>();
    const Part = lazyPart(() => fetch.promise);
    render(<Part />);

    await expect(run()).resolves.toBeUndefined();
  });
});
