/**
 * The repair, against a site whose state it can be made to race.
 *
 * The fake keeps rows and the settings Single in memory, so every assertion
 * is about the state a run leaves behind rather than the calls it made: the
 * property each case separates is what the site holds afterwards.
 *
 * - A seed whose settings write fails is removed again: the seed is created
 *   first and recorded second, and an unrecorded seed would sit in the
 *   Layouts list for good beside the next run's.
 * - A make-default that lands while a run is repairing keeps its choice: the
 *   run writes only while the default is still the unusable one it saw.
 * - A slug the database refuses as taken, though the scan did not see it
 *   (MySQL compares slugs without case or accents), moves the seed to the
 *   next numbered slug.
 * - The name scan reads only the columns it compares.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import type { LayoutRemovalStore } from "../layout-removal/store";

import { ensureDefaultLayout } from "./ensure-default";
import type { DefaultLayoutDirectApi } from "./store";

const SLUGS = { layouts: "layouts", settings: "page-builder-settings" };

interface Row {
  id: string;
  title: string;
  slug: string;
  status: string;
}

interface SiteOptions {
  rows?: Row[];
  settings?: Record<string, unknown>;
  /** The first settings write fails. */
  failFirstSettingsWrite?: boolean;
  /**
   * Another request's settings write, landing right after the settings read
   * numbered `after` (1-based) has answered.
   */
  landing?: { after: number; data: Record<string, unknown> };
  /** Slugs the database refuses as taken, whatever the scan reported. */
  refusedSlugs?: readonly string[];
  /**
   * Another process's seed, committed at the moment the first refusal
   * happens: its row and its settings write. Models two runs racing to seed.
   */
  concurrentSeed?: Row;
}

/** A site in memory. Creates, updates and deletes act on its rows. */
function site(options: SiteOptions = {}) {
  const rows: Row[] = [...(options.rows ?? [])];
  const deleted: string[] = [];
  const finds: Record<string, unknown>[] = [];
  // What each write sent, as sent: the stored settings merge it away.
  const settingsWritten: Record<string, unknown>[] = [];
  const layoutUpdates: { id: string; data: Record<string, unknown> }[] = [];
  let settings: Record<string, unknown> = { ...(options.settings ?? {}) };
  let settingsReads = 0;
  let settingsWrites = 0;
  let created = 0;

  const matches = (row: Row, args: { where?: unknown; status?: string }) => {
    const where = args.where as
      | { id?: { in?: string[]; equals?: string } }
      | undefined;
    if (where?.id?.in !== undefined && !where.id.in.includes(row.id)) {
      return false;
    }
    if (where?.id?.equals !== undefined && where.id.equals !== row.id) {
      return false;
    }
    return args.status !== "published" || row.status === "published";
  };

  const nextly = {
    // No working drafts on this site: the read falls back to the live row.
    findByID: async () => null,
    findSingle: async () => {
      const answer = { ...settings };
      settingsReads += 1;
      if (options.landing?.after === settingsReads) {
        settings = { ...settings, ...options.landing.data };
      }
      return answer;
    },
    updateSingle: async ({ data }: { data: Record<string, unknown> }) => {
      settingsWritten.push(data);
      settingsWrites += 1;
      if (options.failFirstSettingsWrite === true && settingsWrites === 1) {
        throw new Error("the settings write failed");
      }
      settings = { ...settings, ...data };
      return { item: settings };
    },
    find: async (args: Record<string, unknown>) => {
      finds.push(args);
      return {
        items: rows.filter(row => matches(row, args)),
        meta: { hasNext: false },
      };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (options.refusedSlugs?.includes(String(data.slug)) === true) {
        const other = options.concurrentSeed;
        if (other !== undefined && !rows.some(row => row.id === other.id)) {
          rows.push(other);
          settings = {
            ...settings,
            seededLayout: other.id,
            defaultLayout: other.id,
          };
        }
        throw NextlyError.duplicate();
      }
      created += 1;
      const row = {
        id: `seed-${String(created)}`,
        title: String(data.title),
        slug: String(data.slug),
        status: String(data.status),
      };
      rows.push(row);
      return { item: row };
    },
    update: async ({
      id,
      data,
    }: {
      id: string;
      data: Record<string, unknown>;
    }) => {
      layoutUpdates.push({ id, data });
      const row = rows.find(candidate => candidate.id === id);
      if (row !== undefined && typeof data.status === "string") {
        row.status = data.status;
      }
      return { item: row };
    },
    delete: async ({ id }: { id: string }) => {
      deleted.push(id);
      rows.splice(
        rows.findIndex(row => row.id === id),
        1
      );
      return { item: { id } };
    },
  } as unknown as DefaultLayoutDirectApi;

  return {
    nextly,
    rows,
    deleted,
    finds,
    settingsWritten,
    layoutUpdates,
    settings: () => settings,
  };
}

/**
 * A Layout removal fence that holds nothing and lets every step through: no
 * case here is about a removal, and the seed's cleanup delete only needs its
 * steps to answer.
 */
const openFence = {
  removalOf: async () => null,
  mark: async () => ({ kind: "marked" }),
  advance: async () => true,
  settle: async () => true,
  stop: async () => true,
  releaseTombstone: async () => {},
  unsettled: async () => [],
} as unknown as LayoutRemovalStore;

function depsFor(s: ReturnType<typeof site>) {
  return {
    nextly: s.nextly,
    slugs: SLUGS,
    removals: openFence,
    warn: () => {},
  };
}

describe("a seed whose settings write fails", () => {
  it("is deleted again, and the next run leaves exactly one seed", async () => {
    const s = site({ failFirstSettingsWrite: true });

    await expect(ensureDefaultLayout(depsFor(s))).rejects.toThrow(
      "the settings write failed"
    );
    expect(s.deleted).toEqual(["seed-1"]);
    expect(s.rows).toHaveLength(0);

    await expect(ensureDefaultLayout(depsFor(s))).resolves.toBe("seeded");
    expect(s.rows.map(row => row.slug)).toEqual(["site-layout"]);
    expect(s.settings()).toMatchObject({
      defaultLayout: s.rows[0]?.id,
      seededLayout: s.rows[0]?.id,
    });
  });
});

describe("a make-default landing while the repair runs", () => {
  const newer: Row = {
    id: "newer",
    title: "Landing",
    slug: "landing",
    status: "published",
  };

  it("keeps the newer default when the repair would point it back at the seed", async () => {
    const seed: Row = {
      id: "seed",
      title: "Site layout",
      slug: "site-layout",
      status: "published",
    };
    const s = site({
      rows: [seed, newer],
      settings: { defaultLayout: "gone", seededLayout: "seed" },
      landing: { after: 1, data: { defaultLayout: "newer" } },
    });

    await ensureDefaultLayout(depsFor(s));

    expect(s.settings()).toMatchObject({
      defaultLayout: "newer",
      seededLayout: "seed",
    });
  });

  it("keeps the newer default when it lands while a new seed is being created, and still records the seed", async () => {
    const s = site({
      rows: [newer],
      settings: { defaultLayout: null, seededLayout: null },
      landing: { after: 2, data: { defaultLayout: "newer" } },
    });

    await ensureDefaultLayout(depsFor(s));

    const created = s.rows.find(row => row.id !== "newer");
    expect(created?.slug).toBe("site-layout");
    expect(s.settings()).toMatchObject({
      defaultLayout: "newer",
      seededLayout: created?.id,
    });
  });
});

describe("a slug the database refuses as taken", () => {
  it("moves the seed to the next numbered slug", async () => {
    const s = site({ refusedSlugs: ["site-layout"] });

    await expect(ensureDefaultLayout(depsFor(s))).resolves.toBe("seeded");

    expect(s.rows.map(row => row.slug)).toEqual(["site-layout-2"]);
    expect(s.settings()).toMatchObject({ defaultLayout: s.rows[0]?.id });
  });

  it("gives up after a bounded number of refusals, creating nothing", async () => {
    const s = site({
      refusedSlugs: [
        "site-layout",
        "site-layout-2",
        "site-layout-3",
        "site-layout-4",
        "site-layout-5",
        "site-layout-6",
      ],
    });

    await expect(ensureDefaultLayout(depsFor(s))).rejects.toThrow();
    expect(s.rows).toHaveLength(0);
  });
});

describe("the name scan", () => {
  it("reads only the title and slug of each Layout", async () => {
    const s = site();

    await ensureDefaultLayout(depsFor(s));

    const scans = s.finds.filter(args => args.where === undefined);
    expect(scans).toHaveLength(1);
    expect(scans[0]).toMatchObject({
      status: "all",
      select: { title: true, slug: true },
    });
  });
});

describe("two runs seeding at once", () => {
  it("adopts the other run's seed when the slug is refused because it just took it", async () => {
    const other: Row = {
      id: "other-seed",
      title: "Site layout",
      slug: "site-layout",
      status: "published",
    };
    const s = site({ refusedSlugs: ["site-layout"], concurrentSeed: other });

    await expect(ensureDefaultLayout(depsFor(s))).resolves.toBe("kept");

    expect(s.rows.map(row => row.id)).toEqual(["other-seed"]);
    expect(s.settings()).toMatchObject({
      seededLayout: "other-seed",
      defaultLayout: "other-seed",
    });
  });
});

describe("who chose the default", () => {
  it("is cleared when the repair points the default back at the seed", async () => {
    const s = site({
      rows: [
        {
          id: "seed",
          title: "Site layout",
          slug: "site-layout",
          status: "published",
        },
      ],
      settings: {
        defaultLayout: "gone",
        seededLayout: "seed",
        defaultLayoutChangedBy: "admin-1",
      },
    });

    await expect(ensureDefaultLayout(depsFor(s))).resolves.toBe("repointed");

    expect(s.settings()).toMatchObject({
      defaultLayout: "seed",
      defaultLayoutChangedBy: null,
    });
  });

  it("is cleared when the repair makes a new seed the default", async () => {
    const s = site({
      settings: {
        defaultLayout: null,
        seededLayout: null,
        defaultLayoutChangedBy: "admin-1",
      },
    });

    await expect(ensureDefaultLayout(depsFor(s))).resolves.toBe("seeded");

    expect(s.settings()).toMatchObject({
      defaultLayout: s.rows[0]?.id,
      defaultLayoutChangedBy: null,
    });
  });
});

describe("the version each repair write sends", () => {
  it("points the default back at the seed with the version its last read gave, and republishes the seed as an overwrite", async () => {
    // A make-default landing between the repair's read and its write refuses
    // the write instead of being undone; the seed it owns is published
    // whatever it holds.
    const s = site({
      rows: [
        {
          id: "seed",
          title: "Default (site)",
          slug: "default-site",
          status: "draft",
        },
      ],
      settings: { defaultLayout: "gone", seededLayout: "seed", _rev: "2" },
    });

    await expect(ensureDefaultLayout(depsFor(s))).resolves.toBe("repointed");

    expect(s.layoutUpdates).toEqual([
      { id: "seed", data: { status: "published", _overwrite: true } },
    ]);
    expect(s.settingsWritten).toEqual([
      { defaultLayout: "seed", defaultLayoutChangedBy: null, _rev: "2" },
    ]);
  });

  it("records a new seed on settings never stored as an overwrite, there being nothing to be out of date with", async () => {
    const s = site({ settings: {} });

    await expect(ensureDefaultLayout(depsFor(s))).resolves.toBe("seeded");

    expect(s.settingsWritten[0]).toMatchObject({ _overwrite: true });
    expect(s.settingsWritten[0]).not.toHaveProperty("_rev");
  });
});
