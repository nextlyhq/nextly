/**
 * Every read behind the dashboard's conditions happens at most once per request, however many
 * conditions ask it: they run on every dashboard load, for every reader. Asked through the real
 * probe and the real evaluators, with the reads they make counted at their own seams.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  readableOfKind: vi.fn(),
  readerMayCreateEntry: vi.fn(),
  createDisabledSlugs: vi.fn(),
  /** Readable entities with no published source: a pending or failed migration. */
  unpublished: new Set<string>(),
  callerMayReadReleases: vi.fn(),
  callerMayReadAnyRelease: vi.fn(),
}));
vi.mock("../reader-content", async importOriginal => ({
  ...(await importOriginal<typeof import("../reader-content")>()),
  readableOfKind: reads.readableOfKind,
  readerMayCreateEntry: reads.readerMayCreateEntry,
  createDisabledSlugs: reads.createDisabledSlugs,
  queryableSlugs: (_kind: string, readable: readonly string[]) =>
    readable.filter(slug => !reads.unpublished.has(slug)),
}));
vi.mock("../../releases/releases-widget-source", () => ({
  callerMayReadReleases: reads.callerMayReadReleases,
  callerMayReadAnyRelease: reads.callerMayReadAnyRelease,
}));

import { evaluateConditions } from "../conditions";
import type { WidgetCondition } from "../lifecycle";

const caller = { user: { id: "u1", roles: ["editor"] } };

function given(world: {
  collections?: string[];
  singles?: string[];
  mayReadReleases?: boolean;
  releaseExists?: boolean;
  unpublished?: string[];
  createDisabled?: string[];
}) {
  reads.unpublished.clear();
  for (const slug of world.unpublished ?? []) reads.unpublished.add(slug);
  reads.createDisabledSlugs.mockResolvedValue(new Set(world.createDisabled));
  reads.readableOfKind.mockImplementation(
    async (_caller: unknown, kind: "collection" | "single") => ({
      slugs: (kind === "collection" ? world.collections : world.singles) ?? [],
      reachable: true,
    })
  );
  reads.readerMayCreateEntry.mockResolvedValue(true);
  reads.callerMayReadReleases.mockResolvedValue(world.mayReadReleases ?? true);
  reads.callerMayReadAnyRelease.mockResolvedValue(world.releaseExists ?? true);
}

/** The conditions asked together, as one request asks them: through one probe of its own. */
async function ask(conditions: WidgetCondition[]) {
  return evaluateConditions(new Set(conditions), caller);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the dashboard's conditions, asked together", () => {
  it("make each read once, whichever conditions share it", async () => {
    // A reader with no content, so Needs attention asks about releases too, as
    // Upcoming releases does: one release decision between them, not two.
    given({});
    const verdicts = await ask([
      "content:present",
      "collections:present",
      "singles:present",
      "create:available",
      "attention:readable",
      "releases:present",
    ]);
    expect(verdicts.get("attention:readable")).toBe(true);
    expect(verdicts.get("releases:present")).toBe(true);
    expect(reads.callerMayReadReleases).toHaveBeenCalledTimes(1);
    expect(reads.callerMayReadAnyRelease).toHaveBeenCalledTimes(1);
    expect(reads.readerMayCreateEntry).toHaveBeenCalledTimes(1);
    expect(reads.createDisabledSlugs).toHaveBeenCalledTimes(1);
    // One listing per kind, for the presence conditions and the create decision alike.
    expect(reads.readableOfKind).toHaveBeenCalledTimes(2);
  });

  it("asks nothing about releases for a reader with content who needs only Needs attention", async () => {
    given({ collections: ["posts"] });
    expect((await ask(["attention:readable"])).get("attention:readable")).toBe(
      true
    );
    expect(reads.callerMayReadReleases).not.toHaveBeenCalled();
  });

  it("reads no release for a reader who may not read releases, and answers none", async () => {
    given({ mayReadReleases: false });
    const verdicts = await ask(["releases:present", "attention:readable"]);
    expect(verdicts.get("releases:present")).toBe(false);
    expect(verdicts.get("attention:readable")).toBe(false);
    expect(reads.callerMayReadAnyRelease).not.toHaveBeenCalled();
  });

  it("answers releases:present from whether one exists, for a reader who may read them", async () => {
    given({ releaseExists: false });
    expect((await ask(["releases:present"])).get("releases:present")).toBe(
      false
    );
  });

  it("offers Needs attention on nothing it could not count: a collection without a published source", async () => {
    // 🔴 Offered on the registry's listing, a reader whose one collection was
    // mid-migration got a card that could only answer "not available".
    given({
      collections: ["pending"],
      unpublished: ["pending"],
      mayReadReleases: false,
    });
    expect((await ask(["attention:readable"])).get("attention:readable")).toBe(
      false
    );
    // The same reader still has content: the presence conditions read the registry.
    expect((await ask(["content:present"])).get("content:present")).toBe(true);
  });

  it("offers Needs attention on a readable Single that has no published source", async () => {
    // 🔴 The card reads Singles from their registry and version rows, never
    // through a source, so a Single mid-migration still has changes to count.
    given({ singles: ["home"], unpublished: ["home"], mayReadReleases: false });
    expect((await ask(["attention:readable"])).get("attention:readable")).toBe(
      true
    );
  });

  it("offers Create only where the card would offer something, leaving out collections that turn creating off", async () => {
    // 🔴 Asked over every readable collection, a site whose only writable
    // collection was form submissions got a Create card with nothing in it.
    given({ collections: ["submissions"], createDisabled: ["submissions"] });
    reads.readerMayCreateEntry.mockImplementation(
      async (_caller: unknown, slugs: readonly string[]) => slugs.length > 0
    );
    expect((await ask(["create:available"])).get("create:available")).toBe(
      false
    );
    expect(reads.readerMayCreateEntry).toHaveBeenCalledWith(
      caller,
      [],
      expect.any(Function)
    );
  });
});
