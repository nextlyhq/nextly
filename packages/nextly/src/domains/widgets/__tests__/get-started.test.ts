/**
 * The Get started steps, each rule asked directly with a probe and services
 * the case controls: which steps are offered, to whom, and what each says,
 * including when the answer is not known.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mayPerform, services } = vi.hoisted(() => ({
  mayPerform: vi.fn(),
  services: {
    singleRegistryService: { getSingleBySlug: vi.fn() },
    adapter: { selectOne: vi.fn(), select: vi.fn() },
    activityLogService: { singlesWithRecordedSaves: vi.fn() },
  },
}));
vi.mock("../../../auth/authenticated-scope", () => ({
  callerMayPerform: (
    _scope: unknown,
    action: string,
    resource: string
  ): Promise<boolean> => mayPerform(action, resource) as Promise<boolean>,
}));
vi.mock("../../../di", () => ({
  getService: (name: keyof typeof services) => services[name],
}));
// Which Singles have a published source: the fallback reads only those tables.
const { published } = vi.hoisted(() => ({ published: new Set<string>() }));
vi.mock("../reader-content", async importOriginal => {
  const actual = await importOriginal<typeof import("../reader-content")>();
  return {
    ...actual,
    queryableSlugs: (_kind: string, readable: readonly string[]) =>
      readable.filter(slug => published.has(slug)),
  };
});

import type { ConditionProbe } from "../condition-probe";
import {
  answeredWithin,
  getStartedSteps,
  skippedSteps,
  withSkips,
  writtenSinceCreated,
} from "../get-started";
import type { ContentAnswer } from "../reader-content";

interface World {
  collections?: { slugs: string[]; reachable: boolean };
  singles?: { slugs: string[]; reachable: boolean };
  content?: ContentAnswer;
  createCollection?: boolean;
  createEntry?: boolean;
}

function probeOf(world: World): ConditionProbe {
  const collections = world.collections ?? { slugs: [], reachable: true };
  const singles = world.singles ?? { slugs: [], reachable: true };
  return {
    caller: { user: { id: "u1", roles: ["editor"] } },
    readableSlugs: async () => collections.slugs,
    readableSingles: async () => singles.slugs,
    collectionsRead: async () => collections,
    singlesRead: async () => singles,
    hasContent: async () => world.content ?? false,
    mayCreateEntry: async () => world.createEntry ?? false,
    mayCreateCollection: async () => world.createCollection ?? false,
    getStarted: () => {
      throw new Error("not under test");
    },
  };
}

const at = (iso: string) => new Date(iso);

beforeEach(() => {
  vi.clearAllMocks();
  published.clear();
  mayPerform.mockResolvedValue(false);
  services.activityLogService.singlesWithRecordedSaves.mockResolvedValue(
    new Set()
  );
  services.adapter.select.mockResolvedValue([{ id: "u1" }]);
});

/** The statuses by step key, for one reader. */
async function statusesFor(world: World) {
  const answer = await getStartedSteps(probeOf(world));
  return {
    answer,
    byKey: Object.fromEntries(
      answer.steps.map(step => [step.key, step.status])
    ),
  };
}

describe("creating a collection", () => {
  it("is done once the reader can read a collection", async () => {
    const { byKey } = await statusesFor({
      collections: { slugs: ["posts"], reachable: true },
    });
    expect(byKey.collection).toBe("done");
  });

  it("is offered as waiting only to a reader who could create one", async () => {
    expect(
      (await statusesFor({ createCollection: true })).byKey.collection
    ).toBe("open");
    // The must-differ half: the same install, a reader who could not.
    expect(
      (await statusesFor({ createCollection: false })).byKey
    ).not.toHaveProperty("collection");
  });

  it("is not known, never waiting, when the collections could not be listed", async () => {
    const { answer, byKey } = await statusesFor({
      collections: { slugs: [], reachable: false },
      createCollection: true,
    });
    expect(byKey.collection).toBe("unknown");
    expect(answer.unknown).toBe(true);
  });
});

describe("adding a first entry", () => {
  it("is done once the reader can see an entry, waiting while they could add one, absent otherwise", async () => {
    expect((await statusesFor({ content: true })).byKey.entry).toBe("done");
    expect(
      (await statusesFor({ content: false, createEntry: true })).byKey.entry
    ).toBe("open");
    expect(
      (await statusesFor({ content: false, createEntry: false })).byKey
    ).not.toHaveProperty("entry");
  });

  it("is not known when the content check could not answer", async () => {
    expect(
      (await statusesFor({ content: "unknown", createEntry: true })).byKey.entry
    ).toBe("unknown");
  });
});

describe("filling in each Single", () => {
  const singles = { slugs: ["home", "about", "footer"], reachable: true };

  beforeEach(() => {
    mayPerform.mockImplementation(
      async (action: string, resource: string) =>
        action === "update" && resource !== "footer"
    );
    published.add("home").add("about").add("footer");
    services.singleRegistryService.getSingleBySlug.mockImplementation(
      async (slug: string) => ({ slug, tableName: `single_${slug}` })
    );
  });

  it("offers a step per Single the reader may update, in registry order", async () => {
    const { answer } = await statusesFor({ singles });
    expect(answer.steps.map(step => step.key)).toEqual([
      "single:home",
      "single:about",
    ]);
  });

  it("ticks a Single the trail recorded a save of, asking the trail once for all of them", async () => {
    services.activityLogService.singlesWithRecordedSaves.mockResolvedValue(
      new Set(["home"])
    );
    services.adapter.selectOne.mockResolvedValue({
      created_at: at("2026-01-01T00:00:00Z"),
      updated_at: at("2026-01-01T00:00:00Z"),
    });

    const { byKey } = await statusesFor({ singles });

    expect(byKey["single:home"]).toBe("done");
    expect(byKey["single:about"]).toBe("open");
    expect(
      services.activityLogService.singlesWithRecordedSaves
    ).toHaveBeenCalledTimes(1);
    expect(
      services.activityLogService.singlesWithRecordedSaves
    ).toHaveBeenCalledWith(["home", "about"]);
    // The fallback read only the Single the trail had no record of.
    expect(services.adapter.selectOne).toHaveBeenCalledTimes(1);
    expect(services.adapter.selectOne).toHaveBeenCalledWith(
      "single_about",
      expect.anything()
    );
  });

  it("ticks a Single saved before the trail recorded saves, from its stored instants", async () => {
    services.adapter.selectOne.mockImplementation(async (table: string) =>
      table === "single_home"
        ? {
            created_at: at("2026-01-01T00:00:00Z"),
            updated_at: at("2026-01-02T00:00:00Z"),
          }
        : {
            created_at: at("2026-01-01T00:00:00Z"),
            updated_at: at("2026-01-01T00:00:00Z"),
          }
    );
    const { byKey } = await statusesFor({ singles });
    expect(byKey["single:home"]).toBe("done");
    expect(byKey["single:about"]).toBe("open");
  });

  it("is not known for a Single whose table is not known to match, or whose read failed", async () => {
    published.delete("home");
    services.adapter.selectOne.mockRejectedValue(new Error("no such table"));
    const { byKey } = await statusesFor({ singles });
    expect(byKey["single:home"]).toBe("unknown");
    expect(byKey["single:about"]).toBe("unknown");
  });

  it("is not known when the trail could not be asked", async () => {
    services.activityLogService.singlesWithRecordedSaves.mockRejectedValue(
      new Error("down")
    );
    const { byKey } = await statusesFor({ singles });
    expect(byKey["single:home"]).toBe("unknown");
  });

  it("never counts a filled-in Single as content", async () => {
    services.activityLogService.singlesWithRecordedSaves.mockResolvedValue(
      new Set(["home", "about"])
    );
    const { byKey } = await statusesFor({
      singles,
      content: false,
      createEntry: true,
    });
    expect(byKey.entry).toBe("open");
  });

  it("makes the whole answer not known when the Singles could not be listed", async () => {
    const { answer } = await statusesFor({
      singles: { slugs: [], reachable: false },
    });
    expect(answer.unknown).toBe(true);
    expect(answer.steps.some(step => step.kind === "single")).toBe(false);
  });
});

describe("inviting a teammate", () => {
  it("is offered only to someone who may both create and read users", async () => {
    mayPerform.mockImplementation(
      async (action: string, resource: string) =>
        resource === "users" && action === "create"
    );
    expect((await statusesFor({})).byKey).not.toHaveProperty("invite");

    mayPerform.mockImplementation(
      async (_: string, resource: string) => resource === "users"
    );
    expect((await statusesFor({})).byKey.invite).toBe("open");
  });

  it("is done once there is a second account, which a pending invitation is", async () => {
    mayPerform.mockImplementation(
      async (_: string, resource: string) => resource === "users"
    );
    services.adapter.select.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    expect((await statusesFor({})).byKey.invite).toBe("done");
  });
});

describe("the order, the count and the reader's skips", () => {
  it("offers the four kinds in order and counts done and skipped as done", async () => {
    mayPerform.mockImplementation(async (action: string, resource: string) =>
      resource === "users" ? true : action === "update"
    );
    published.add("home");
    services.singleRegistryService.getSingleBySlug.mockResolvedValue({
      tableName: "single_home",
    });
    services.adapter.selectOne.mockResolvedValue({
      created_at: at("2026-01-01T00:00:00Z"),
      updated_at: at("2026-01-01T00:00:00Z"),
    });
    const answer = await getStartedSteps(
      probeOf({
        collections: { slugs: ["posts"], reachable: true },
        singles: { slugs: ["home"], reachable: true },
        content: false,
        createEntry: true,
      })
    );
    expect(answer.steps.map(step => step.kind)).toEqual([
      "collection",
      "entry",
      "single",
      "invite",
    ]);
    expect({ done: answer.done, total: answer.total }).toEqual({
      done: 1,
      total: 4,
    });

    const skipped = withSkips(
      answer,
      skippedSteps({ skipped: ["single:home", "invite", "entry", 7] })
    );
    expect(skipped.steps.map(step => step.status)).toEqual([
      "done",
      // Not skippable: creating a first entry is the point of the card.
      "open",
      "skipped",
      "skipped",
    ]);
    expect({ done: skipped.done, total: skipped.total }).toEqual({
      done: 3,
      total: 4,
    });
  });

  it("reads no skips from settings that do not hold a list of keys", () => {
    expect(skippedSteps(undefined).size).toBe(0);
    expect(skippedSteps({ skipped: "invite" }).size).toBe(0);
  });
});

describe("a stored document written after it was created", () => {
  it("counts only a later write: equal instants are an untouched document", () => {
    expect(
      writtenSinceCreated({
        created_at: at("2026-01-01T00:00:00Z"),
        updated_at: at("2026-01-01T00:00:01Z"),
      })
    ).toBe(true);
    expect(
      writtenSinceCreated({
        created_at: at("2026-01-01T00:00:00Z"),
        updated_at: at("2026-01-01T00:00:00Z"),
      })
    ).toBe(false);
    expect(writtenSinceCreated({ created_at: "x", updated_at: "y" })).toBe(
      false
    );
  });
});

describe("answering each Single within a bound and a budget", () => {
  it("runs at most the limit at once", async () => {
    let inFlight = 0;
    let most = 0;
    const answers = await answeredWithin(
      Array.from({ length: 20 }, (_, i) => `s${i}`),
      async () => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise(resolve => setTimeout(resolve, 1));
        inFlight -= 1;
        return true;
      },
      8
    );
    expect(most).toBe(8);
    expect([...answers.values()].every(value => value === true)).toBe(true);
  });

  it('answers "unknown" for what is not answered within the budget', async () => {
    vi.useFakeTimers();
    try {
      const pending = answeredWithin(
        ["fast", "slow"],
        slug =>
          slug === "fast"
            ? Promise.resolve(true)
            : new Promise<boolean>(() => {}),
        8,
        100
      );
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toEqual(
        new Map<string, boolean | "unknown">([
          ["fast", true],
          ["slow", "unknown"],
        ])
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
