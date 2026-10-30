/**
 * The setup steps, each rule asked directly with a probe and services the
 * case controls: which steps are offered, to whom, in what order and what each
 * says, the reader's skips, and when the whole answer is not known.
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
vi.mock("../../../auth/access/route-gate-adapters", () => ({
  callerMayPerform: (
    _scope: unknown,
    action: string,
    resource: string
  ): Promise<boolean> => mayPerform(action, resource) as Promise<boolean>,
}));
vi.mock("../../../di", () => ({
  getService: (name: keyof typeof services) => services[name],
}));
// Whether the schema builder is on: production turns it off unless the host
// says otherwise.
const builder = vi.hoisted(() => ({ enabled: true }));
vi.mock("../../../shared/builder-access", () => ({
  isBuilderEnabled: () => builder.enabled,
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
import type { ContentAnswer } from "../reader-content";
import {
  answeredWithin,
  setupSteps,
  skippedKinds,
  withSkips,
  writtenSinceCreated,
} from "../setup";
import {
  SETUP_SKIPPABLE_KINDS,
  SETUP_STEP_KINDS,
  type SetupAnswer,
  type SetupStep,
} from "../setup-steps";

interface World {
  collections?: { slugs: string[]; reachable: boolean };
  singles?: { slugs: string[]; reachable: boolean };
  content?: ContentAnswer;
  createCollection?: boolean;
  /** The first collection the reader may create an entry in. */
  firstCreatable?: string;
  /**
   * Whether sample content was loaded or declined; "fails" when that cannot
   * be read, which leaves the step out. Out of the way unless a case names it.
   */
  sample?: boolean | "fails";
}

function probeOf(world: World): ConditionProbe {
  const collections = world.collections ?? { slugs: [], reachable: true };
  const singles = world.singles ?? { slugs: [], reachable: true };
  return {
    caller: { user: { id: "u1", roles: ["admin"] } },
    readableSlugs: async () => collections.slugs,
    readableSingles: async () => singles.slugs,
    collectionsRead: async () => collections,
    singlesRead: async () => singles,
    hasContent: async () => world.content ?? false,
    mayCreateEntry: async () => world.firstCreatable !== undefined,
    mayCreateCollection: async () => world.createCollection ?? false,
    mayCreateOnDashboard: async () => false,
    mayReadReleases: async () => false,
    releasesExist: async () => false,
    firstCreatableCollection: async () => world.firstCreatable,
    sampleAnswered: async () => {
      const sample = world.sample ?? "fails";
      if (sample === "fails") throw new Error("meta down");
      return sample;
    },
    setup: () => {
      throw new Error("not under test");
    },
  };
}

const at = (iso: string) => new Date(iso);

beforeEach(() => {
  vi.clearAllMocks();
  builder.enabled = true;
  published.clear();
  mayPerform.mockResolvedValue(false);
  services.activityLogService.singlesWithRecordedSaves.mockResolvedValue(
    new Set()
  );
  services.adapter.select.mockResolvedValue([{ id: "u1" }]);
});

/** The steps by kind, for one world, and the whole answer. */
async function stepsFor(world: World) {
  const answer = await setupSteps(probeOf(world));
  return {
    answer,
    byKind: answer.known
      ? (Object.fromEntries(answer.steps.map(step => [step.kind, step])) as {
          [K in SetupStep["kind"]]?: Extract<SetupStep, { kind: K }>;
        })
      : {},
  };
}

describe("the vocabulary", () => {
  it("names the five kinds in the card's order, and only Singles and Invite as skippable", () => {
    expect(SETUP_STEP_KINDS).toEqual([
      "sample",
      "collection",
      "entry",
      "singles",
      "invite",
    ]);
    expect(SETUP_SKIPPABLE_KINDS).toEqual(["singles", "invite"]);
  });
});

describe("starting with sample content", () => {
  it("is open while nobody answered and the site holds no entry, and done once anyone loaded or declined it", async () => {
    expect(
      (await stepsFor({ sample: false, content: false })).byKind.sample?.status
    ).toBe("open");
    // Done whatever the site holds since: one person's answer settles it.
    expect(
      (await stepsFor({ sample: true, content: true })).byKind.sample?.status
    ).toBe("done");
  });

  it("is not offered once the site has an entry and nobody answered", async () => {
    const { answer, byKind } = await stepsFor({ sample: false, content: true });
    expect(answer.known).toBe(true);
    expect(byKind).not.toHaveProperty("sample");
  });

  it("is not offered, never shown waiting, when the site's answer cannot be read, and the rest still answers", async () => {
    const { answer, byKind } = await stepsFor({
      sample: "fails",
      content: false,
      firstCreatable: "posts",
    });
    expect(answer.known).toBe(true);
    expect(byKind).not.toHaveProperty("sample");
    // "Add your first entry" alone.
    expect(byKind.entry?.status).toBe("open");
  });
});

describe("creating a collection", () => {
  it("is done once the reader can read a collection", async () => {
    expect(
      (await stepsFor({ collections: { slugs: ["posts"], reachable: true } }))
        .byKind.collection?.status
    ).toBe("done");
  });

  it("is offered as open with none only to a reader who could create one", async () => {
    expect(
      (await stepsFor({ createCollection: true })).byKind.collection?.status
    ).toBe("open");
    // The must-differ half: the same install, a reader who could not.
    expect(
      (await stepsFor({ createCollection: false })).byKind
    ).not.toHaveProperty("collection");
  });

  it("is not offered where the schema builder is off, to any reader", async () => {
    // 🔴 Its action is the builder, which production keeps off: a reader who
    // may create collections would get a step every route refuses.
    builder.enabled = false;
    const { answer, byKind } = await stepsFor({ createCollection: true });
    expect(answer.known).toBe(true);
    expect(byKind).not.toHaveProperty("collection");
  });

  it("makes the answer not known, never a step open, when the collections could not be listed", async () => {
    const { answer } = await stepsFor({
      collections: { slugs: [], reachable: false },
      createCollection: true,
    });
    expect(answer).toEqual({ known: false });
  });
});

describe("adding a first entry", () => {
  it("is done once the reader can see an entry", async () => {
    expect((await stepsFor({ content: true })).byKind.entry).toEqual({
      kind: "entry",
      status: "done",
    });
  });

  it("is open naming the first collection the reader may create in, so it opens a new entry there", async () => {
    expect(
      (await stepsFor({ content: false, firstCreatable: "posts" })).byKind.entry
    ).toEqual({ kind: "entry", status: "open", collection: "posts" });
  });

  it("is not offered to a reader who may create in no collection", async () => {
    expect((await stepsFor({ content: false })).byKind).not.toHaveProperty(
      "entry"
    );
  });

  it("makes the answer not known when the content check could not answer", async () => {
    expect(
      (await stepsFor({ content: "unknown", firstCreatable: "posts" })).answer
    ).toEqual({ known: false });
  });

  it("makes the answer not known when whether the reader could add one is not known", async () => {
    const probe: ConditionProbe = {
      ...probeOf({ content: false }),
      firstCreatableCollection: () =>
        Promise.reject(new Error("permission read failed")),
    };
    expect(await setupSteps(probe)).toEqual({ known: false });
  });
});

describe("filling in the Singles", () => {
  const singles = {
    slugs: ["home", "about", "footer", "contact", "legal"],
    reachable: true,
  };
  const unchanged = {
    created_at: at("2026-01-01T00:00:00Z"),
    updated_at: at("2026-01-01T00:00:00Z"),
  };

  beforeEach(() => {
    mayPerform.mockImplementation(
      async (action: string, resource: string) =>
        action === "update" && resource !== "footer"
    );
    for (const slug of singles.slugs) published.add(slug);
    services.singleRegistryService.getSingleBySlug.mockImplementation(
      async (slug: string) => ({ slug, tableName: `single_${slug}` })
    );
    services.adapter.selectOne.mockResolvedValue(unchanged);
  });

  it("is ONE step for every Single the reader may update, in registry order", async () => {
    const { answer, byKind } = await stepsFor({ singles });
    expect(answer.known && answer.steps.map(step => step.kind)).toEqual([
      "singles",
    ]);
    expect(byKind.singles?.singles.map(single => single.slug)).toEqual([
      "home",
      "about",
      "contact",
      "legal",
    ]);
    expect(byKind.singles?.status).toBe("open");
  });

  it("marks a Single the trail recorded a save of, asking the trail once for all of them", async () => {
    services.activityLogService.singlesWithRecordedSaves.mockResolvedValue(
      new Set(["home"])
    );
    const { byKind } = await stepsFor({ singles });
    expect(byKind.singles?.singles.slice(0, 2)).toEqual([
      { slug: "home", filledIn: true },
      { slug: "about", filledIn: false },
    ]);
    expect(
      services.activityLogService.singlesWithRecordedSaves
    ).toHaveBeenCalledTimes(1);
    expect(
      services.activityLogService.singlesWithRecordedSaves
    ).toHaveBeenCalledWith(["home", "about", "contact", "legal"]);
    // The fallback read only the Singles the trail had no record of.
    expect(services.adapter.selectOne).not.toHaveBeenCalledWith(
      "single_home",
      expect.anything()
    );
  });

  it("marks a Single saved before the trail recorded saves from its stored instants", async () => {
    services.adapter.selectOne.mockImplementation(async (table: string) =>
      table === "single_about"
        ? {
            created_at: at("2026-01-01T00:00:00Z"),
            updated_at: at("2026-01-02T00:00:00Z"),
          }
        : unchanged
    );
    const { byKind } = await stepsFor({ singles });
    expect(
      byKind.singles?.singles.find(single => single.slug === "about")
    ).toEqual({ slug: "about", filledIn: true });
  });

  it("is done once every one of them is saved", async () => {
    services.activityLogService.singlesWithRecordedSaves.mockResolvedValue(
      new Set(["home", "about", "contact", "legal"])
    );
    const { byKind } = await stepsFor({ singles });
    expect(byKind.singles?.status).toBe("done");
  });

  it("makes the answer not known for a Single whose table is not known to match, or whose read failed", async () => {
    published.delete("home");
    expect((await stepsFor({ singles })).answer).toEqual({ known: false });
    published.add("home");
    services.adapter.selectOne.mockRejectedValue(new Error("no such table"));
    expect((await stepsFor({ singles })).answer).toEqual({ known: false });
  });

  it("makes the answer not known when the trail could not be asked", async () => {
    services.activityLogService.singlesWithRecordedSaves.mockRejectedValue(
      new Error("down")
    );
    expect((await stepsFor({ singles })).answer).toEqual({ known: false });
  });

  it("makes the answer not known when whether the reader may update one is not known", async () => {
    mayPerform.mockImplementation(async (action: string, resource: string) => {
      if (resource === "about") throw new Error("permission read failed");
      return action === "update";
    });
    expect((await stepsFor({ singles })).answer).toEqual({ known: false });
  });

  it("is not offered when the reader may update no Single", async () => {
    mayPerform.mockResolvedValue(false);
    const { answer, byKind } = await stepsFor({ singles });
    expect(answer.known).toBe(true);
    expect(byKind).not.toHaveProperty("singles");
  });

  it("makes the whole answer not known when the Singles could not be listed", async () => {
    expect(
      (await stepsFor({ singles: { slugs: [], reachable: false } })).answer
    ).toEqual({ known: false });
  });

  it("never counts a filled-in Single as content", async () => {
    services.activityLogService.singlesWithRecordedSaves.mockResolvedValue(
      new Set(singles.slugs)
    );
    const { byKind } = await stepsFor({
      singles,
      content: false,
      firstCreatable: "posts",
    });
    expect(byKind.entry?.status).toBe("open");
  });
});

describe("inviting a teammate", () => {
  it("is offered only to someone who may both create and read users", async () => {
    mayPerform.mockImplementation(
      async (action: string, resource: string) =>
        resource === "users" && action === "create"
    );
    expect((await stepsFor({})).byKind).not.toHaveProperty("invite");

    mayPerform.mockImplementation(
      async (_: string, resource: string) => resource === "users"
    );
    expect((await stepsFor({})).byKind.invite?.status).toBe("open");
  });

  it("is done once there is a second account, which a pending invitation is", async () => {
    mayPerform.mockImplementation(
      async (_: string, resource: string) => resource === "users"
    );
    services.adapter.select.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    expect((await stepsFor({})).byKind.invite?.status).toBe("done");
  });
});

describe("the order, the count and the reader's skips", () => {
  async function everyStep(): Promise<SetupAnswer> {
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
    return setupSteps(
      probeOf({
        collections: { slugs: ["posts"], reachable: true },
        singles: { slugs: ["home"], reachable: true },
        content: false,
        firstCreatable: "posts",
        sample: false,
      })
    );
  }

  it("offers the five kinds in order and counts only done steps as done", async () => {
    const answer = await everyStep();
    expect(answer.known && answer.steps.map(step => step.kind)).toEqual([
      "sample",
      "collection",
      "entry",
      "singles",
      "invite",
    ]);
    expect(answer.known && { done: answer.done, total: answer.total }).toEqual({
      done: 1,
      total: 5,
    });
  });

  it("applies a skip only to an open step of a skippable kind, and counts it done", async () => {
    const skipped = withSkips(
      await everyStep(),
      skippedKinds("singles,invite,entry,sample,collection,nonsense")
    );
    expect(skipped.known && skipped.steps.map(step => step.status)).toEqual([
      // Sample content has its own decline, and a collection and a first entry
      // are what a site is for: none of the three is skippable.
      "open",
      "done",
      "open",
      "skipped",
      "skipped",
    ]);
    expect(
      skipped.known && { done: skipped.done, total: skipped.total }
    ).toEqual({ done: 3, total: 5 });
  });

  it("leaves a step already done as done, and an answer not known as not known", () => {
    const done: SetupAnswer = {
      known: true,
      steps: [{ kind: "invite", status: "done" }],
      done: 1,
      total: 1,
    };
    expect(withSkips(done, skippedKinds("invite"))).toEqual(done);
    expect(withSkips({ known: false }, skippedKinds("invite"))).toEqual({
      known: false,
    });
  });

  it("reads no skips from an empty or unknown stored value", () => {
    expect(skippedKinds(undefined).size).toBe(0);
    expect(skippedKinds("").size).toBe(0);
    expect([...skippedKinds("entry, nonsense ,invite")]).toEqual(["invite"]);
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

describe("the whole answer's deadline", () => {
  it("offers no step once the deadline cut a check short, and says the answer is not known", async () => {
    vi.useFakeTimers();
    try {
      const never = <T>() => new Promise<T>(() => {});
      mayPerform.mockImplementation(() => never());
      const probe: ConditionProbe = {
        ...probeOf({}),
        mayCreateCollection: () => never(),
        hasContent: () => never(),
        singlesRead: () => never(),
      };
      const pending = setupSteps(probe, 100);
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toEqual({ known: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts no read once the deadline has fired", async () => {
    vi.useFakeTimers();
    try {
      // Two Singles are two authorization groups: the first is one Single on
      // its own, so the caches it fills serve the rest. The first stalls past
      // the deadline and then answers.
      let release: (allowed: boolean) => void = () => {};
      mayPerform.mockImplementation((action: string, resource: string) =>
        action === "update" && resource === "home"
          ? new Promise<boolean>(resolve => {
              release = resolve;
            })
          : Promise.resolve(true)
      );
      published.add("home").add("about");
      const pending = setupSteps(
        probeOf({ singles: { slugs: ["home", "about"], reachable: true } }),
        100
      );
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toEqual({ known: false });

      release(true);
      await vi.advanceTimersByTimeAsync(0);
      // 🔴 The race must stop the work, not only the wait.
      expect(mayPerform).not.toHaveBeenCalledWith("update", "about");
      expect(
        services.activityLogService.singlesWithRecordedSaves
      ).not.toHaveBeenCalled();
      expect(
        services.singleRegistryService.getSingleBySlug
      ).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves no timer behind once the answer is in", async () => {
    vi.useFakeTimers();
    try {
      await setupSteps(probeOf({ content: true }), 100);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
