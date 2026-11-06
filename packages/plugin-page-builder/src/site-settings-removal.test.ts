/**
 * A breakpoint save racing another save of the site style, and a removal
 * whose walk fails after its set is stored.
 *
 * The Single here is an in-memory one that judges a write by the version it
 * hands back, as core's does: a write from a version another save replaced
 * is refused with `STALE_VERSION` and stores nothing. The other save is made
 * at the moment between the route's read and its write, from inside the step
 * the route takes there (the count, or the runs it asks).
 *
 * @module site-settings-removal.test
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import type { RemovalDryRun } from "./breakpoint-removal/dry-run";
import type { BreakpointRun } from "./breakpoint-removal/run-store";
import type { BreakpointRemovalService } from "./breakpoint-removal/service";
import type { RewriteReport } from "./host-rewrite/contract";
import { LAYOUTS_SLUG } from "./collections/layouts";
import {
  writeSiteBreakpoints,
  type BreakpointRemoval,
  type BreakpointsRouteContext,
  type VersionedSiteStyle,
} from "./site-settings";
import { SITE_STYLE_SLUG } from "./site-style-storage";

const DESKTOP = { id: "desktop", label: "Desktop" };
const TABLET = { id: "tablet", label: "Tablet", maxWidth: 1024 };
const MOBILE = { id: "mobile", label: "Mobile", maxWidth: 640 };
const set = (...viewport: object[]) => ({ viewport, container: [] });

/** A shared style holding a value at Tablet beside one at every size. */
const BAND = {
  id: "c-band",
  slug: "band",
  orderIndex: 0,
  styles: { base: { base: { color: "#111111" }, tablet: { color: "#555" } } },
};
/** A shared style another save adds while the removal is being made. */
const ADDED = {
  id: "c-added",
  slug: "added",
  orderIndex: 1,
  styles: { base: { base: { color: "#222222" } } },
};

/** The site style's Single, judging each write by the version it carries. */
function versionedSingle(stored: Record<string, unknown>) {
  let doc = { ...stored };
  let version = 1;
  return {
    get doc() {
      return doc;
    },
    read: (): VersionedSiteStyle => ({
      tokens: null,
      fonts: null,
      classes: doc.classes ?? null,
      breakpoints: doc.breakpoints ?? null,
      version: String(version),
    }),
    /** Someone else's save, made from the current version. */
    saveElsewhere: (data: Record<string, unknown>) => {
      doc = { ...doc, ...data };
      version += 1;
    },
    nextly: {
      updateSingle: vi.fn(
        async (args: { data: Record<string, unknown> }): Promise<unknown> => {
          const { _rev: given, ...data } = args.data;
          if (given !== undefined && given !== String(version)) {
            throw NextlyError.staleVersion({
              data: { currentVersion: String(version) },
            });
          }
          doc = { ...doc, ...data };
          version += 1;
          return {};
        }
      ),
    },
  };
}

const FINISHED: RewriteReport = {
  rewritten: [],
  unchanged: [],
  left: [],
  caughtByFinalWalk: [],
  finished: true,
};

/** The runs, as a fake: one removal opened, and what each call did. */
function fakeService(over: Partial<BreakpointRemovalService> = {}) {
  const abandon = vi.fn(async () => {});
  const service: BreakpointRemovalService = {
    openRun: async () => null,
    runById: async () => null,
    begin: async removedIds =>
      ({
        id: "run-1",
        removedIds,
        before: null,
        beforeEmitted: null,
        startedBy: "user:user-1",
        phase: "converting",
        cursor: null,
        open: true,
      }) satisfies BreakpointRun,
    abandon,
    walk: async () => FINISHED,
    holding: async () => [],
    openRemoval: async () => null,
    openRemovalAsSaved: async () => null,
    carryOn: async () => {},
    retire: async () => {},
    publish: async () => {},
    keepFragment: async () => "row-1",
    discardFragment: async () => {},
    purgeFragments: async () => {},
    ...over,
  };
  return { service, abandon };
}

/** The installed plugin's removal over the Single, counting through `count`. */
function removalOver(
  single: ReturnType<typeof versionedSingle>,
  service: BreakpointRemovalService,
  over: {
    count?: () => Promise<void>;
    logError?: (message: string, meta: Record<string, unknown>) => void;
    stored?: () => Promise<VersionedSiteStyle>;
    defaults?: BreakpointRemoval["defaults"];
  } = {}
): BreakpointRemoval {
  return {
    ...(over.defaults === undefined ? {} : { defaults: over.defaults }),
    stored: over.stored ?? (async () => single.read()),
    count: async () => {
      await over.count?.();
      return { removed: [], unreadable: 0, complete: true } as RemovalDryRun;
    },
    cascade: {
      service: () => service,
      walkMs: 1_000,
      countMs: 1_000,
      ...(over.logError === undefined ? {} : { logError: over.logError }),
    },
  };
}

const ctx: BreakpointsRouteContext = {
  self: {
    collections: { [LAYOUTS_SLUG]: "site_layouts" },
    singles: { [SITE_STYLE_SLUG]: "site_style" },
  },
  user: { id: "user-1" },
  // Signed in with a session: the run records who started it.
  caller: { authMethod: "session", can: async () => true } as never,
};

const post = (breakpoints: unknown) =>
  new Request("http://local/site/breakpoints", {
    method: "POST",
    body: JSON.stringify({ breakpoints, confirmRemoval: true, version: "1" }),
  });

async function refusal(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("a breakpoint save racing another save of the site style", () => {
  it("strips again, from what the other save stored, a shared style saved while the removal was made", async () => {
    const single = versionedSingle({
      breakpoints: set(DESKTOP, TABLET),
      classes: [BAND],
    });
    let rows = 0;
    const keepFragment = vi.fn(async () => `row-${String((rows += 1))}`);
    const discardFragment = vi.fn(async () => {});
    const { service, abandon } = fakeService({ keepFragment, discardFragment });
    const removal = removalOver(single, service, {
      // A shared style saved in Design while the removal counts.
      count: async () => single.saveElsewhere({ classes: [BAND, ADDED] }),
    });

    const response = await writeSiteBreakpoints(
      post(set(DESKTOP)),
      ctx,
      single.nextly,
      removal
    );

    expect(response.status).toBe(200);
    expect(single.doc.breakpoints).toEqual(set(DESKTOP));
    // The other save's style kept, and Tablet stripped from the one it held.
    expect(single.doc.classes).toEqual([
      { ...BAND, styles: { base: { base: { color: "#111111" } } } },
      ADDED,
    ]);
    // CONTROL: the first write was refused, and the second made.
    expect(single.nextly.updateSingle).toHaveBeenCalledTimes(2);
    expect(abandon).not.toHaveBeenCalled();
    // A row kept for each attempt, and the refused attempt's deleted again.
    expect(keepFragment).toHaveBeenCalledTimes(2);
    expect(discardFragment.mock.calls).toEqual([["row-1"]]);
  });

  it("refuses a removal whose breakpoints another save changed meanwhile, and drops its run", async () => {
    const single = versionedSingle({
      breakpoints: set(DESKTOP, TABLET),
      classes: [BAND],
    });
    const { service, abandon } = fakeService();
    const removal = removalOver(single, service, {
      count: async () =>
        single.saveElsewhere({
          breakpoints: set(DESKTOP, TABLET, MOBILE),
        }),
    });

    const refused = await refusal(
      writeSiteBreakpoints(post(set(DESKTOP)), ctx, single.nextly, removal)
    );

    expect(refused).toMatchObject({ code: "CONFLICT" });
    expect(String((refused as Error).message)).toContain(
      "The site's breakpoints were changed while this was being saved."
    );
    expect(single.doc.breakpoints).toEqual(set(DESKTOP, TABLET, MOBILE));
    expect(abandon).toHaveBeenCalledWith("run-1");
  });

  it("gives up after a few refused writes, storing nothing and dropping its run", async () => {
    const single = versionedSingle({
      breakpoints: set(DESKTOP, TABLET),
      classes: [BAND],
    });
    const { service, abandon } = fakeService();
    // Every read is followed by another shared-style save before the write.
    const removal = removalOver(single, service, {
      stored: async () => {
        const read = single.read();
        single.saveElsewhere({ classes: [BAND] });
        return read;
      },
    });

    const refused = await refusal(
      writeSiteBreakpoints(post(set(DESKTOP)), ctx, single.nextly, removal)
    );

    expect(refused).toMatchObject({ code: "STALE_VERSION" });
    expect(single.nextly.updateSingle).toHaveBeenCalledTimes(3);
    expect(single.doc.breakpoints).toEqual(set(DESKTOP, TABLET));
    expect(abandon).toHaveBeenCalledWith("run-1");
  });

  it("refuses a set read before a removal was saved and written after it, which would define its breakpoint again", async () => {
    const single = versionedSingle({ breakpoints: set(DESKTOP, TABLET) });
    // Between this save's read and its write, another removes Tablet: by the
    // time the runs are asked, its set is stored and its run open.
    const { service } = fakeService({
      holding: async () => {
        single.saveElsewhere({ breakpoints: set(DESKTOP) });
        return [];
      },
    });
    const removal = removalOver(single, service);

    const refused = await refusal(
      writeSiteBreakpoints(
        post(set(DESKTOP, TABLET, MOBILE)),
        ctx,
        single.nextly,
        removal
      )
    );

    expect(refused).toMatchObject({ code: "STALE_VERSION" });
    // The removal's set stands: Tablet is not defined again under it.
    expect(single.doc.breakpoints).toEqual(set(DESKTOP));
  });
});

describe("a removal of a breakpoint a code-supplied shared style holds", () => {
  it("stores the code's style stripped as its override, and leaves untouched code styles to the code", async () => {
    const coded = {
      id: "c-coded",
      slug: "coded",
      orderIndex: 2,
      locked: true,
      styles: {
        base: { base: { color: "#333333" }, tablet: { color: "#444" } },
      },
    };
    const plain = {
      id: "c-plain",
      slug: "plain",
      orderIndex: 3,
      styles: { base: { base: { color: "#666666" } } },
    };
    const single = versionedSingle({
      breakpoints: set(DESKTOP, TABLET),
      classes: [BAND],
    });
    const keepFragment = vi.fn(async () => "row-1");
    const { service } = fakeService({ keepFragment });
    const removal = removalOver(single, service, {
      defaults: { classes: [coded, plain] },
    });

    const response = await writeSiteBreakpoints(
      post(set(DESKTOP)),
      ctx,
      single.nextly,
      removal
    );

    expect(response.status).toBe(200);
    expect(single.doc.classes).toEqual([
      { ...BAND, styles: { base: { base: { color: "#111111" } } } },
      { ...coded, styles: { base: { base: { color: "#333333" } } } },
    ]);
    // What the write took out was kept first, the code's style named as the
    // override the strip stored, which putting it back takes out again.
    expect(keepFragment).toHaveBeenCalledWith({
      runId: "run-1",
      host: null,
      form: "site",
      fragment: {
        classes: {
          [BAND.id]: expect.anything(),
          "c-coded": { base: { tablet: { color: "#444" } } },
        },
        overridden: ["c-coded"],
      },
    });
  });
});

describe("a removal's write whose outcome its error does not tell", () => {
  it("keeps the run of a write that stored its set and then threw", async () => {
    const single = versionedSingle({ breakpoints: set(DESKTOP, TABLET) });
    // The write commits; a hook after it throws.
    const commit = single.nextly.updateSingle;
    single.nextly.updateSingle = vi.fn(async args => {
      await commit(args);
      throw new Error("an after-update hook failed");
    });
    const { service, abandon } = fakeService();
    const removal = removalOver(single, service);

    const response = await writeSiteBreakpoints(
      post(set(DESKTOP)),
      ctx,
      single.nextly,
      removal
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { item: unknown };
    expect(body.item).toMatchObject({ removal: { runId: "run-1" } });
    expect(single.doc.breakpoints).toEqual(set(DESKTOP));
    expect(abandon).not.toHaveBeenCalled();
  });

  it("drops the run of a write that threw and stored nothing", async () => {
    const single = versionedSingle({ breakpoints: set(DESKTOP, TABLET) });
    single.nextly.updateSingle = vi.fn(async () => {
      throw new Error("the database is unreachable");
    });
    const { service, abandon } = fakeService();
    const removal = removalOver(single, service);

    await expect(
      writeSiteBreakpoints(post(set(DESKTOP)), ctx, single.nextly, removal)
    ).rejects.toThrow("the database is unreachable");
    expect(abandon).toHaveBeenCalledWith("run-1");
  });
});

describe("a re-add whose old runs cannot give up their claim", () => {
  it("refuses the save and stores nothing", async () => {
    const single = versionedSingle({ breakpoints: set(DESKTOP) });
    const { service } = fakeService({
      retire: async () => {
        throw new Error("the runs table cannot be written");
      },
    });
    const removal = removalOver(single, service);

    await expect(
      writeSiteBreakpoints(
        post(set(DESKTOP, TABLET)),
        ctx,
        single.nextly,
        removal
      )
    ).rejects.toThrow("the runs table cannot be written");
    // The re-add is not stored with the old claims in place.
    expect(single.doc.breakpoints).toEqual(set(DESKTOP));
  });
});

describe("a removal whose walk fails after its set is stored", () => {
  it("answers with its run, still going, for its route to carry on", async () => {
    const single = versionedSingle({ breakpoints: set(DESKTOP, TABLET) });
    const { service, abandon } = fakeService({
      walk: async () => {
        throw new Error("the progress table could not be written");
      },
    });
    const logError = vi.fn();
    const removal = removalOver(single, service, { logError });

    const response = await writeSiteBreakpoints(
      post(set(DESKTOP)),
      ctx,
      single.nextly,
      removal
    );

    expect(response.status).toBe(202);
    const body = (await response.json()) as { item: unknown };
    expect(body.item).toMatchObject({
      breakpoints: set(DESKTOP),
      removal: { runId: "run-1", finished: false },
    });
    // The set is stored, and the run kept open to be carried on.
    expect(single.doc.breakpoints).toEqual(set(DESKTOP));
    expect(abandon).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("walk failed"),
      expect.objectContaining({ runId: "run-1" })
    );
  });
});
