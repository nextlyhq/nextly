/**
 * Which languages the walk reads each host in: a top-level field by its own
 * classification, anything deeper in every configured language, because core
 * stores a localized field group's values per language under a parent that is
 * not translated.
 */
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "@nextlyhq/plugin-sdk";

/**
 * The conditional writes the writer made and who each was made as, a failure
 * for the next one, the forms the stored reads asked for, and the answers the
 * next stored reads give, in turn.
 */
const stored = vi.hoisted(() => ({
  writes: [] as { data: Record<string, unknown> }[],
  identities: [] as unknown[],
  failNext: undefined as unknown,
  forms: [] as string[],
  answers: [] as unknown[],
}));

// The stored read and the conditional write are core's, which a unit test
// does not boot: the read answers the next scripted answer where a test gave
// one, else every field as stored, an empty document, on a live row with no
// public state and no pending draft; the write is recorded, or fails as the
// test says.
vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readStoredFields: async (
    _identity: unknown,
    request: { fields: readonly string[]; form: string }
  ) => {
    stored.forms.push(request.form);
    if (stored.answers.length > 0) return stored.answers.shift();
    return {
      kind: "found",
      values: Object.fromEntries(
        request.fields.map(name => [
          name,
          { kind: "value", value: { nodes: [] } },
        ])
      ),
      live: { publicState: null, workingDraft: false },
    };
  },
  updateIfUnchanged: async (
    identity: unknown,
    update: { data: Record<string, unknown> }
  ) => {
    stored.identities.push(identity);
    const failure = stored.failNext;
    stored.failNext = undefined;
    if (failure !== undefined) throw failure;
    stored.writes.push(update);
  },
}));

import {
  siteCopiesWriter,
  singleToWalk,
  siteHostReader,
  siteHostSource,
  siteHostWriter,
  systemHostWriter,
  type RewriteSite,
  type SingleToWalk,
} from "./site";

/** A site with one collection, `notes`, holding one entry, `n1`, and these Singles. */
function siteWith(
  declaration: unknown,
  singles: readonly SingleToWalk[] = []
): RewriteSite {
  const nextly = {
    find: async () => ({ items: [{ id: "n1" }], meta: { hasNext: false } }),
  };
  return {
    nextly: async () => nextly as never,
    collectionSlugs: async () => ["notes"],
    resolveCollection: async () => declaration,
    singles: async () => singles,
    locales: () => ["en", "de"],
    defaultLocale: () => "en",
    layouts: "layouts",
    hints: async () => [],
    componentId: "card",
    identity: async () => ({ user: { id: "u1" } }),
  };
}

/** Every host the walk yields, as `path@locale`. */
async function hostsOf(
  declaration: unknown,
  singles: readonly SingleToWalk[] = []
): Promise<string[]> {
  const found: string[] = [];
  const source = siteHostSource(siteWith(declaration, singles));
  for await (const document of source.documents(null)) {
    for (const { host } of document.hosts) {
      found.push(`${host.path.join(".") || "*"}@${host.locale ?? "-"}`);
    }
  }
  return found;
}

/** Every host the walk yields, as `path@locale`, marked `~` where it may be one stored value. */
async function sharedness(
  declaration: unknown,
  singles: readonly SingleToWalk[] = []
): Promise<string[]> {
  const found: string[] = [];
  const source = siteHostSource(siteWith(declaration, singles));
  for await (const document of source.documents(null)) {
    for (const { host, maybeShared } of document.hosts) {
      found.push(
        `${host.path.join(".") || "*"}@${host.locale ?? "-"}${maybeShared === true ? "~" : ""}`
      );
    }
  }
  return found;
}

describe("which hosts may read one stored value in every language", () => {
  it("knows a translated top-level field is stored per language", async () => {
    const hosts = await sharedness({
      localized: true,
      fields: [{ type: "blocks", name: "content", localized: true }],
    });
    expect(hosts).toEqual(["content@en", "content@de"]);
  });

  it("marks what is read per language only because it is unknown", async () => {
    // A Single made in the admin: its fields' own flags are unknown.
    const home = singleToWalk(
      { slug: "home", fields: [{ type: "blocks", name: "content" }] },
      undefined,
      true
    );
    expect(await sharedness({ fields: [] }, [home])).toEqual([
      "content@en~",
      "content@de~",
    ]);
    // A field under a named group, and a scan of the row.
    expect(
      await sharedness({
        fields: [
          {
            type: "group",
            name: "hero",
            fields: [{ type: "blocks", name: "body" }],
          },
          { type: "fieldGroup", name: "more", group: "more-group" },
        ],
      })
    ).toEqual(["hero.body@en~", "hero.body@de~", "*@en~", "*@de~"]);
  });
});

describe("the languages each host is read in", () => {
  it("reads a field behind a field group in every language of an untranslated parent", async () => {
    const hosts = await hostsOf({
      fields: [
        { type: "text", name: "title" },
        { type: "fieldGroup", name: "hero", group: "hero-group" },
      ],
    });

    expect(hosts).toEqual(["*@en", "*@de"]);
  });

  it("reads a field under a named group in every language", async () => {
    const hosts = await hostsOf({
      fields: [
        {
          type: "group",
          name: "hero",
          fields: [{ type: "blocks", name: "body" }],
        },
      ],
    });

    expect(hosts).toEqual(["hero.body@en", "hero.body@de"]);
  });

  it("CONTROL: reads an untranslated top-level field once", async () => {
    const hosts = await hostsOf({
      fields: [{ type: "blocks", name: "content" }],
    });

    expect(hosts).toEqual(["content@-"]);
  });

  it("reads every field of a Single made in the admin in every language", async () => {
    // Listed with no declaration in code: its fields' own flags are unknown.
    const home = singleToWalk(
      { slug: "home", fields: [{ type: "blocks", name: "content" }] },
      undefined,
      true
    );

    const hosts = await hostsOf({ fields: [] }, [home]);

    expect(hosts).toEqual(["content@en", "content@de"]);
  });

  it("CONTROL: a Single declared in code keeps its fields' own flags", async () => {
    const home = singleToWalk(
      { slug: "home", fields: [{ type: "blocks", name: "content" }] },
      {
        localized: true,
        fields: [{ type: "blocks", name: "content", localized: false }],
      },
      true
    );

    const hosts = await hostsOf({ fields: [] }, [home]);

    expect(hosts).toEqual(["content@-"]);
  });

  it("skips a hint naming a collection that no longer resolves", async () => {
    const site = siteWith({ fields: [{ type: "blocks", name: "content" }] });
    const hinted = await siteHostSource({
      ...site,
      hints: async () => [
        { slug: "gone", id: "x" },
        { slug: "notes", id: "n1" },
      ],
      resolveCollection: async slug => {
        if (slug === "gone") throw new Error("no such collection");
        return { fields: [{ type: "blocks", name: "content" }] };
      },
    }).hinted();

    expect(hinted.map(document => document.key)).toEqual([
      "collection\u001Fnotes\u001Fn1",
    ]);
  });

  it("leaves the fields the walk reaches directly out of a row scan", async () => {
    const source = siteHostSource(
      siteWith({
        fields: [
          { type: "blocks", name: "content" },
          {
            type: "repeater",
            name: "rows",
            fields: [{ type: "blocks", name: "body" }],
          },
        ],
      })
    );
    const scans: unknown[] = [];
    for await (const document of source.documents(null)) {
      for (const candidate of document.hosts) {
        if (candidate.access === "scan") scans.push(candidate.excluded);
      }
    }

    expect(scans).toEqual([[["content"]], [["content"]]]);
  });
});

describe("the version a host write sends", () => {
  // A rewrite's write is made from its read of the host, so it sends that
  // read's version: a save of the row in between refuses it, and the run
  // reports the host as changed rather than overwriting the save.
  const host = {
    kind: "collection" as const,
    slug: "notes",
    id: "n1",
    path: ["content"],
  };

  function siteOver(nextly: Record<string, unknown>): RewriteSite {
    return {
      ...siteWith({ fields: [] }),
      nextly: async () => nextly as never,
    };
  }

  it("reads the live row's version", async () => {
    const read = await siteHostReader(
      siteOver({
        findByID: async () => ({ id: "n1", content: { nodes: [] }, _rev: "7" }),
      })
    )(host);
    expect(read.rev).toBe("7");
  });

  it("writes with the version the host was read at", async () => {
    stored.writes.length = 0;
    const writer = siteHostWriter(siteOver({}));
    const result = await writer({
      host,
      value: { nodes: [] },
      mode: "save",
      expected: { form: "published", hash: "h" },
      rev: "7",
    });
    expect(result).toEqual({ kind: "written" });
    expect(stored.writes.map(write => write.data)).toEqual([
      { content: { nodes: [] }, _rev: "7" },
    ]);
  });

  it("reports a write refused as made from an out-of-date version as changed", async () => {
    stored.failNext = new NextlyError({
      code: "STALE_VERSION",
      publicMessage: "This document changed since the version you gave.",
    });
    const writer = siteHostWriter(siteOver({}));
    const result = await writer({
      host,
      value: { nodes: [] },
      mode: "save",
      expected: { form: "published", hash: "h" },
      rev: "7",
    });
    expect(result).toEqual({ kind: "changed" });
  });
});

describe("a working draft that moves between the live read and the draft read", () => {
  const host = {
    kind: "collection" as const,
    slug: "notes",
    id: "n1",
    path: ["content"],
  };
  /** The reader over a row whose version each read gives in turn, or none. */
  const reader = (versions: string[] = []) =>
    siteHostReader({
      ...siteWith({ fields: [] }),
      nextly: async () =>
        ({
          findByID: async () => {
            const rev = versions.length > 1 ? versions.shift() : versions[0];
            return { id: "n1", ...(rev === undefined ? {} : { _rev: rev }) };
          },
        }) as never,
    });
  /** A found stored read of `content`, holding `text`, in this lifecycle. */
  const found = (text: string, workingDraft: boolean) => ({
    kind: "found",
    values: { content: { kind: "value", value: { text } } },
    live: { publicState: "published", workingDraft },
  });

  function script(...answers: unknown[]): void {
    stored.forms.length = 0;
    stored.answers.length = 0;
    stored.answers.push(...answers);
  }

  it("reads the host again rather than taking the live row as a draft discarded after the live read", async () => {
    // The live read finds a draft pending; by the draft read it was
    // discarded, so that read falls back to the live row and says so.
    script(found("live", true), found("live", false), found("live", false));

    const read = await reader()(host);

    expect(stored.forms).toEqual(["published", "draft", "published"]);
    // No draft to save: the host is judged, and written, as its live row
    // alone, so the discarded draft is not made again.
    expect(read.draft).toBeNull();
    expect(read.published).toEqual({ kind: "value", value: { text: "live" } });
    expect(read.liveState).toBe("published");
  });

  it("CONTROL: takes the draft read as the draft while it still reports one pending", async () => {
    script(found("live", true), found("draft", true));

    const read = await reader()(host);

    expect(stored.forms).toEqual(["published", "draft"]);
    expect(read.draft).toEqual({ kind: "value", value: { text: "draft" } });
    expect(read.published).toEqual({ kind: "value", value: { text: "live" } });
  });

  it("reads the host again when the row's version moved between the live read and the draft read", async () => {
    // A draft published and a new one saved between the reads: both report a
    // draft pending in the same state, and only the version tells.
    script(
      found("live", true),
      found("new draft", true),
      found("live now", true),
      found("new draft", true)
    );

    const read = await reader(["1", "2"])(host);

    expect(stored.forms).toEqual(["published", "draft", "published", "draft"]);
    expect(read.published).toEqual({
      kind: "value",
      value: { text: "live now" },
    });
    expect(read.draft).toEqual({ kind: "value", value: { text: "new draft" } });
    expect(read.rev).toBe("2");
  });

  it("CONTROL: keeps a pair read over one version, and sends that version", async () => {
    script(found("live", true), found("draft", true));

    const read = await reader(["5"])(host);

    expect(stored.forms).toEqual(["published", "draft"]);
    expect(read.draft).toEqual({ kind: "value", value: { text: "draft" } });
    expect(read.rev).toBe("5");
  });

  it("reads the host again when the document is gone by the draft read", async () => {
    script(found("live", true), { kind: "absent" }, { kind: "absent" });

    const read = await reader()(host);

    expect(stored.forms).toEqual(["published", "draft", "published"]);
    expect(read).toMatchObject({ published: { kind: "absent" }, draft: null });
  });

  it("refuses to judge a host whose draft keeps moving, rather than guessing", async () => {
    script(
      ...Array.from({ length: 3 }, () => [
        found("live", true),
        found("live", false),
      ]).flat()
    );

    await expect(reader()(host)).rejects.toThrow(/kept changing/);
    expect(stored.forms).toHaveLength(6);
    stored.answers.length = 0;
  });
});

describe("who a host write is made as", () => {
  const host = {
    kind: "collection" as const,
    slug: "notes",
    id: "n1",
    path: ["content"],
  };
  const write = {
    host,
    value: { nodes: [] },
    mode: "save" as const,
    expected: { form: "published" as const, hash: "h" },
  };

  it("makes a person's write as them, with its expectation judged as the system that read it", async () => {
    stored.identities.length = 0;

    await siteHostWriter(siteWith({ fields: [] }))(write);

    expect(stored.identities).toEqual([
      { caller: { user: { id: "u1" } }, checkedBy: { overrideAccess: true } },
    ]);
  });

  it("makes the system's own run's write as the system alone", async () => {
    stored.identities.length = 0;

    await systemHostWriter(siteWith({ fields: [] }))(write);

    expect(stored.identities).toEqual([{ overrideAccess: true }]);
  });
});

describe("the copies writer", () => {
  type Request = Parameters<
    Parameters<typeof siteCopiesWriter>[0]["rewriteField"]
  >[0];

  /** Whether core's rewrite is inside its transaction, asking `set.from`. */
  const transaction = { open: false };

  /**
   * A rewrite over stored copies, as core's: each copy from its own value,
   * every answer taken before any is written, all or none. A copy it is
   * handed whose value is rewritten by a structural copy, as a version
   * snapshot hands it.
   */
  function rewriteOver(copies: Record<string, unknown>, fail?: unknown) {
    const asked: { request: Request; opts: unknown }[] = [];
    const rewriteField = async (request: Request, opts?: unknown) => {
      asked.push({ request, opts });
      if (fail !== undefined) throw fail;
      if (!("from" in request.set)) throw new Error("expected set.from");
      const { from } = request.set;
      const next: Record<string, unknown> = {};
      transaction.open = true;
      try {
        for (const [name, value] of Object.entries(copies)) {
          next[name] = await from(structuredClone(value), {
            form: name === "live" ? "live" : "draft",
            locale: name === "live" || name === "draft" ? null : name,
          });
        }
      } finally {
        transaction.open = false;
      }
      Object.assign(copies, next);
      return { version: "8", copies: [] };
    };
    return { asked, rewriteField };
  }

  const host = {
    kind: "collection" as const,
    slug: "pages",
    id: "p1",
    path: ["content"],
  };

  /** Every value the step was asked about while a transaction was open. */
  const askedInside: unknown[] = [];

  /** Converts a value holding `copy`; refuses one marked so. */
  const step = (doc: unknown, form: { form: string }) => {
    if (transaction.open) askedInside.push(doc);
    const value = doc as { copy?: boolean; refuse?: boolean };
    if (value.refuse === true) return { kind: "refuse" as const, reason: "no" };
    return value.copy === true
      ? {
          kind: "rewritten" as const,
          value: { copy: false, judgedAs: form.form },
        }
      : { kind: "unchanged" as const };
  };

  it("rewrites each copy from its own value, from the version read, as the person, then brings the indexes in line", async () => {
    const copies = { live: { copy: true }, draft: { copy: true, own: 1 } };
    const { asked, rewriteField } = rewriteOver(copies);
    const after: unknown[] = [];

    const result = await siteCopiesWriter({
      rewriteField,
      as: async () => ({ as: "user", user: { id: "u1" } }),
      reason: "A component it used was deleted.",
      afterRewrite: async document => {
        after.push(document);
      },
    })({
      host,
      rev: "7",
      liveForm: "published",
      step,
      seeds: [
        { value: { copy: true }, form: "published" },
        { value: { own: 1, copy: true }, form: "draft" },
      ],
    });

    expect(result).toEqual({ kind: "written" });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.request).toMatchObject({
      collection: "pages",
      id: "p1",
      field: "content",
      expectedVersion: "7",
      reason: "A component it used was deleted.",
    });
    expect(asked[0]?.opts).toEqual({ as: "user", user: { id: "u1" } });
    // The live copy is judged in the state it was read in, a draft as one.
    expect(copies).toEqual({
      live: { copy: false, judgedAs: "published" },
      draft: { copy: false, judgedAs: "draft" },
    });
    expect(after).toEqual([{ slug: "pages", id: "p1" }]);
    // The step was asked nothing inside the rewrite's transaction, where its
    // reads would wait on the connection the transaction holds.
    expect(askedInside).toEqual([]);
  });

  it("judges a copy it did not read outside the transaction, and makes the rewrite again", async () => {
    // A draft in another language, which the walk did not read.
    const copies = {
      live: { copy: true },
      draft: { copy: true },
      es: { copy: true, es: 1 },
    };
    const { asked, rewriteField } = rewriteOver(copies);

    const result = await siteCopiesWriter({
      rewriteField,
      as: async () => undefined,
      reason: "r",
    })({
      host,
      rev: "7",
      liveForm: "published",
      step,
      seeds: [
        { value: { copy: true }, form: "published" },
        { value: { copy: true }, form: "draft" },
      ],
    });

    expect(result).toEqual({ kind: "written" });
    // The first rewrite stopped at the copy it had no answer for, wrote
    // nothing, and the second, from the same version, wrote every copy.
    expect(asked.map(call => call.request.expectedVersion)).toEqual(["7", "7"]);
    expect(copies.es).toEqual({ copy: false, judgedAs: "draft" });
    expect(askedInside).toEqual([]);
  });

  it("converges on a document with many drafts it did not read, with no edit between", async () => {
    // Six languages' drafts, none of them read by the walk.
    const copies: Record<string, unknown> = { live: { copy: true } };
    for (const locale of ["es", "fr", "de", "it", "pt", "nl"]) {
      copies[locale] = { copy: true, locale };
    }
    const { asked, rewriteField } = rewriteOver(copies);

    const result = await siteCopiesWriter({
      rewriteField,
      as: async () => undefined,
      reason: "r",
    })({
      host,
      rev: "7",
      liveForm: "published",
      step,
      seeds: [{ value: { copy: true }, form: "published" }],
    });

    expect(result).toEqual({ kind: "written" });
    // One rewrite stopped for each draft it met unjudged, then one wrote all.
    expect(asked).toHaveLength(7);
    expect(Object.values(copies)).toEqual(
      Object.values(copies).map(() => expect.objectContaining({ copy: false }))
    );
    expect(askedInside).toEqual([]);
  });

  it("answers a copy the step refuses, and brings nothing in line", async () => {
    const copies = { live: { copy: true }, draft: { refuse: true } };
    const { rewriteField } = rewriteOver(copies);
    const seeds = [
      { value: { copy: true }, form: "published" as const },
      { value: { refuse: true }, form: "draft" as const },
    ];
    const after: unknown[] = [];

    const result = await siteCopiesWriter({
      rewriteField,
      as: async () => undefined,
      reason: "r",
      afterRewrite: async document => {
        after.push(document);
      },
    })({ host, rev: "7", liveForm: "published", step, seeds });

    expect(result).toEqual({ kind: "step-refused", detail: "no" });
    expect(copies.live).toEqual({ copy: true });
    expect(after).toEqual([]);
  });

  it("answers a person's refusal as forbidden, and a save since the read as changed", async () => {
    const forbidden = await siteCopiesWriter({
      ...rewriteOver({ live: null, draft: null }, NextlyError.forbidden()),
      as: async () => undefined,
      reason: "r",
    })({ host, rev: "7", liveForm: "published", step, seeds: [] });
    const stale = await siteCopiesWriter({
      ...rewriteOver(
        { live: null, draft: null },
        new NextlyError({
          code: "STALE_VERSION",
          publicMessage: "Saved since.",
          logContext: { reason: "test" },
        })
      ),
      as: async () => undefined,
      reason: "r",
    })({ host, rev: "7", liveForm: "published", step, seeds: [] });

    expect(forbidden).toEqual({ kind: "forbidden" });
    expect(stale).toEqual({ kind: "changed" });
  });
});
