import { describe, expect, it } from "vitest";

import {
  type BlocksSurvey,
  configuredSpacingMode,
  readJoiningDecision,
  settleSpacingModeOnce,
  siteVerdict,
  spacingModeFor,
  type SpacingModeAtStartDeps,
} from "./spacing-mode-at-start";

const SLUGS = {
  layouts: "layouts",
  settings: "page-builder-settings",
} as const;

/**
 * The registry's survey on an ordinary site: the plugin's own collections and
 * one the Schema Builder made, and a Single with a blocks field. The Layouts
 * collection is named too, as a survey that found a blocks field on it would.
 */
const SURVEY: BlocksSurvey = {
  collections: ["pages", "components", "landing-pages", "layouts"],
  singles: [{ slug: "home", paths: ["hero.body"] }],
  locales: [],
};
const survey = () => Promise.resolve(SURVEY);

interface FindArgs {
  collection: string;
  where?: unknown;
}

/**
 * A Direct API double holding rows per collection and the recorded seed, and
 * keeping every `find` it was asked, so a case can say what was read.
 */
/** A stored row: its id, or the id with the columns a case reads. */
type Row = string | { id: string; areas?: unknown; created_at?: unknown };

function site(
  rows: Record<string, Row[]>,
  seededLayout: string | null,
  singles: Record<string, { live?: unknown; draft?: unknown }> = {}
) {
  const asked: FindArgs[] = [];
  const nextly = {
    find: (args: FindArgs) => {
      asked.push(args);
      const except = (
        args.where as { id?: { not_equals?: string } } | undefined
      )?.id?.not_equals;
      const items = (rows[args.collection] ?? [])
        .map(row => (typeof row === "string" ? { id: row } : row))
        .filter(row => row.id !== except);
      const limit = (args as { limit?: number }).limit ?? 1;
      return Promise.resolve({ items: items.slice(0, limit) });
    },
    findSingle: (args: { slug: string; draft?: boolean; locale?: string }) => {
      asked.push({ collection: `single:${args.slug}` });
      if (args.slug === SLUGS.settings) {
        return Promise.resolve({ seededLayout, defaultLayout: null });
      }
      // A language's own document, under `slug@locale`, else the slug's.
      const stored =
        (args.locale === undefined
          ? undefined
          : singles[`${args.slug}@${args.locale}`]) ?? singles[args.slug];
      return Promise.resolve(
        (args.draft === true ? stored?.draft : stored?.live) ?? null
      );
    },
  } as unknown as SpacingModeAtStartDeps["nextly"];
  return { nextly, asked };
}

describe("spacingModeFor", () => {
  it("keeps an existing site on classic and starts a fresh one on gaps", () => {
    expect(spacingModeFor("existing")).toBe("classic");
    expect(spacingModeFor("fresh")).toBe("gaps");
  });
});

describe("configuredSpacingMode", () => {
  it("reads a model the host's configuration states, and nothing else", () => {
    expect(configuredSpacingMode({ spacingMode: "classic" })).toBe("classic");
    expect(configuredSpacingMode({ spacingMode: "gaps" })).toBe("gaps");
    expect(configuredSpacingMode({ spacingMode: "wide" })).toBeUndefined();
    expect(configuredSpacingMode({})).toBeUndefined();
    expect(configuredSpacingMode(undefined)).toBeUndefined();
  });
});

describe("siteVerdict", () => {
  it("leaves the recorded seed out, and a site holding only it is fresh", async () => {
    const { nextly, asked } = site({ layouts: ["seed"] }, "seed");
    expect(await siteVerdict({ nextly, slugs: SLUGS, survey })).toBe("fresh");
    expect(asked.at(-1)?.where).toEqual({ id: { not_equals: "seed" } });
  });

  it("calls a site existing on a page without reading Layouts", async () => {
    const { nextly, asked } = site({ pages: ["p"], layouts: ["seed"] }, null);
    expect(await siteVerdict({ nextly, slugs: SLUGS, survey })).toBe(
      "existing"
    );
    expect(asked.map(a => a.collection)).toEqual(["pages"]);
  });

  it("calls a site existing on a collection the Schema Builder made", async () => {
    const { nextly } = site({ "landing-pages": ["lp"] }, null);
    expect(await siteVerdict({ nextly, slugs: SLUGS, survey })).toBe(
      "existing"
    );
  });

  it("calls a site existing on a Single storing blocks, live or as a draft", async () => {
    const blocks = { hero: { body: { nodes: [{ id: "n" }] } } };
    // SQLite hands a JSON column back as text, the group's included.
    const asText = {
      hero: JSON.stringify({ body: { nodes: [{ id: "n" }] } }),
    };
    for (const stored of [
      { live: blocks },
      { draft: blocks },
      { live: asText },
    ]) {
      const { nextly } = site({}, null, { home: stored });
      expect(await siteVerdict({ nextly, slugs: SLUGS, survey })).toBe(
        "existing"
      );
    }
  });

  it("reads a Single in every configured language, live and as a draft", async () => {
    const blocks = { hero: { body: { nodes: [{ id: "n" }] } } };
    const localized = () =>
      Promise.resolve({ ...SURVEY, locales: ["en", "de"] });
    for (const stored of [{ live: blocks }, { draft: blocks }]) {
      // German alone holds the page; English is empty.
      const { nextly } = site({}, null, {
        "home@en": { live: { hero: { body: { nodes: [] } } } },
        "home@de": stored,
      });
      expect(
        await siteVerdict({ nextly, slugs: SLUGS, survey: localized })
      ).toBe("existing");
    }
  });

  it("does not count a Single whose blocks field is empty or absent", async () => {
    const { nextly } = site({}, null, {
      home: { live: { hero: { body: { nodes: [] } } }, draft: { hero: {} } },
    });
    expect(await siteVerdict({ nextly, slugs: SLUGS, survey })).toBe("fresh");
  });

  it("leaves the seed out even when the survey names the Layouts collection", async () => {
    const { nextly, asked } = site({ layouts: ["seed"] }, "seed");
    expect(await siteVerdict({ nextly, slugs: SLUGS, survey })).toBe("fresh");
    // One read of the Layouts, the one that leaves the seed out.
    const layoutReads = asked.filter(a => a.collection === "layouts");
    expect(layoutReads.map(read => read.where)).toEqual([
      { id: { not_equals: "seed" } },
    ]);
  });

  it("calls a site existing on a component", async () => {
    const { nextly } = site({ components: ["c"] }, null);
    expect(await siteVerdict({ nextly, slugs: SLUGS, survey })).toBe(
      "existing"
    );
  });

  it("is undecided while the only content is an empty Layout made moments ago and no seed is recorded", async () => {
    // What another instance's seed looks like before its record lands.
    const { nextly } = site(
      {
        layouts: [
          {
            id: "maybe-a-seed",
            areas: [],
            created_at: new Date().toISOString(),
          },
        ],
      },
      null
    );
    expect(await siteVerdict({ nextly, slugs: SLUGS, survey })).toBe(
      "undecided"
    );
  });

  it("calls a site existing on a Layout with areas filled and no seed recorded", async () => {
    // An earlier version's default: no seed was ever recorded for it, so
    // waiting for one would wait for ever.
    const { nextly } = site(
      {
        layouts: [
          {
            id: "old-default",
            areas: [{ area: "header", component: "c" }],
            created_at: new Date().toISOString(),
          },
        ],
      },
      null
    );
    expect(await siteVerdict({ nextly, slugs: SLUGS, survey })).toBe(
      "existing"
    );
  });

  it("calls a site existing on an empty Layout made long ago and no seed recorded", async () => {
    const { nextly } = site(
      {
        layouts: [
          {
            id: "old-blank",
            areas: [],
            created_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      null
    );
    expect(await siteVerdict({ nextly, slugs: SLUGS, survey })).toBe(
      "existing"
    );
  });

  it("calls a site existing on two Layouts and no seed recorded", async () => {
    // A seed is one Layout; two cannot both be one.
    const now = new Date().toISOString();
    const { nextly } = site(
      {
        layouts: [
          { id: "a", areas: [], created_at: now },
          { id: "b", areas: [], created_at: now },
        ],
      },
      null
    );
    expect(await siteVerdict({ nextly, slugs: SLUGS, survey })).toBe(
      "existing"
    );
  });

  it("calls a site existing on a Layout beside the recorded seed", async () => {
    const { nextly } = site({ layouts: ["seed", "mine"] }, "seed");
    expect(await siteVerdict({ nextly, slugs: SLUGS, survey })).toBe(
      "existing"
    );
  });
});

describe("settleSpacingModeOnce", () => {
  it("reads nothing more once a model is recorded", async () => {
    const { nextly, asked } = site({ pages: ["p"] }, null);
    let adopted = false;
    const outcome = await settleSpacingModeOnce({
      nextly,
      slugs: SLUGS,
      survey,
      store: {
        read: () => Promise.resolve("gaps"),
        adoptIfUnset: () => {
          adopted = true;
          return Promise.resolve(true);
        },
      },
    });
    expect(outcome).toBe("kept");
    expect(asked).toEqual([]);
    expect(adopted).toBe(false);
  });

  it("writes nothing when it cannot decide", async () => {
    // Another instance's seed, made moments ago and not yet recorded.
    const { nextly } = site(
      {
        layouts: [
          {
            id: "maybe-a-seed",
            areas: [],
            created_at: new Date().toISOString(),
          },
        ],
      },
      null
    );
    const writes: string[] = [];
    const outcome = await settleSpacingModeOnce({
      nextly,
      slugs: SLUGS,
      survey,
      store: {
        read: () => Promise.resolve(null),
        adoptIfUnset: mode => {
          writes.push(mode);
          return Promise.resolve(true);
        },
      },
    });
    expect(outcome).toBe("deferred");
    expect(writes).toEqual([]);
  });

  it("expires the cached site style once it records a model, and only then", async () => {
    const expiries: string[] = [];
    const run = (adopted: boolean, recorded: "gaps" | null) =>
      settleSpacingModeOnce({
        nextly: site({ pages: ["p"] }, null).nextly,
        slugs: SLUGS,
        survey,
        store: {
          read: () => Promise.resolve(recorded),
          adoptIfUnset: () => Promise.resolve(adopted),
        },
        expire: () => {
          expiries.push(recorded ?? (adopted ? "recorded" : "refused"));
          return Promise.resolve();
        },
      });
    expect(await run(true, null)).toBe("classic");
    expect(expiries).toEqual(["recorded"]);
    // Another instance or the owner recorded one first: that write expired it.
    expect(await run(false, null)).toBe("kept");
    // Already recorded: nothing changed, so nothing is expired.
    expect(await run(true, "gaps")).toBe("kept");
    expect(expiries).toEqual(["recorded"]);
  });

  it("records nothing when the host's configuration states a model, in either direction", async () => {
    for (const [rows, configured] of [
      [{}, "classic"],
      [{ pages: ["p"] }, "gaps"],
    ] as const) {
      const { nextly, asked } = site(rows, null);
      const writes: string[] = [];
      const outcome = await settleSpacingModeOnce({
        nextly,
        slugs: SLUGS,
        survey,
        configured,
        store: {
          read: () => Promise.resolve(null),
          adoptIfUnset: mode => {
            writes.push(mode);
            return Promise.resolve(true);
          },
        },
      });
      expect(outcome).toBe("configured");
      expect(writes).toEqual([]);
      expect(asked).toEqual([]);
    }
  });
});

describe("readJoiningDecision", () => {
  /** A store whose row a decision records after it settles. */
  function recording() {
    let row: "classic" | "gaps" | null = null;
    let reads = 0;
    return {
      store: {
        read: () => {
          reads += 1;
          return Promise.resolve(row);
        },
      },
      record: (mode: "classic" | "gaps") => {
        row = mode;
      },
      reads: () => reads,
    };
  }

  it("waits for a decision in flight and answers what it recorded", async () => {
    const { store, record } = recording();
    const decision = new Promise<void>(resolve =>
      setTimeout(() => {
        record("classic");
        resolve();
      }, 20)
    );
    expect(await readJoiningDecision(store, () => decision)).toBe("classic");
  });

  it("asks for no decision when a model is recorded", async () => {
    const { store, record, reads } = recording();
    record("gaps");
    let asked = false;
    const answer = await readJoiningDecision(store, () => {
      asked = true;
      return null;
    });
    expect(answer).toBe("gaps");
    expect(asked).toBe(false);
    expect(reads()).toBe(1);
  });

  it("answers no model when nothing is deciding, or the decision failed", async () => {
    expect(await readJoiningDecision(recording().store, () => null)).toBeNull();
    expect(
      await readJoiningDecision(recording().store, () =>
        Promise.reject(new Error("the survey failed"))
      )
    ).toBeNull();
  });

  it("stops waiting for a decision that never settles", async () => {
    const stalled = new Promise<void>(() => {});
    expect(
      await readJoiningDecision(recording().store, () => stalled, 10)
    ).toBeNull();
  });
});
