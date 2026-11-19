import { describe, expect, it, vi } from "vitest";

import {
  consentCovers,
  consentToCover,
  countDeletions,
  deletionKey,
  deprecationNotices,
  describeDeletion,
  judgeDataLoss,
  NO_CONSENT,
  refusalForStart,
  resolveDataLossConsent,
  type DataLossConsent,
  type Deletion,
  type EarlierSpelling,
} from "../data-loss-consent";

const table = (name: string, extra: Partial<Deletion> = {}): Deletion =>
  ({ kind: "table", table: name, ...extra }) as Deletion;
const column = (t: string, c: string): Deletion => ({
  kind: "column",
  table: t,
  column: c,
});
const rows = (t: string): Deletion => ({ kind: "rows", table: t });
const unnamed: Deletion = {
  kind: "unnamed",
  description: "0003_x's DOWN drops a table or column",
};

/** The consent the flag gives, read as a command reads it. */
const flag = (value: string | boolean) =>
  resolveDataLossConsent({ flag: value, env: {} });
const env = (value: string) =>
  resolveDataLossConsent({ env: { NEXTLY_ACCEPT_DATA_LOSS: value } });

describe("reading the consent", () => {
  it("reads the flag alone as consent to every deletion", () => {
    expect(flag(true).given).toEqual({ from: "flag", targets: "all" });
  });

  it("reads a list as the tables and table.column pairs it names", () => {
    const consent = flag("posts, pages.summary");
    expect(consent.given?.targets).toEqual({
      tables: new Set(["posts"]),
      columns: new Set(["pages.summary"]),
    });
  });

  it("reads the variable as the flag is read", () => {
    expect(env("1").given).toEqual({ from: "env", targets: "all" });
    expect(env("true").given?.targets).toBe("all");
    expect(env("posts").given?.targets).toEqual({
      tables: new Set(["posts"]),
      columns: new Set(),
    });
  });

  it.each(["", "0", "false"])(
    "reads the variable set to %j as no consent",
    value => {
      expect(env(value).given).toBeNull();
    }
  );

  it("reads no consent when neither is given", () => {
    expect(resolveDataLossConsent({ env: {} }).given).toBeNull();
    expect(resolveDataLossConsent({ flag: false, env: {} }).given).toBeNull();
  });

  it("takes the flag over the variable, rather than adding them together", () => {
    const consent = resolveDataLossConsent({
      flag: "posts",
      env: { NEXTLY_ACCEPT_DATA_LOSS: "1" },
    });
    expect(consent.given).toEqual({
      from: "flag",
      targets: { tables: new Set(["posts"]), columns: new Set() },
    });
  });

  it.each(["posts,", "a.b.c", "posts.", ".summary", "my posts"])(
    "refuses the malformed list %j, naming the item it cannot read",
    value => {
      expect(() => flag(value)).toThrow(/is not a list of tables/);
      expect(() => env(value)).toThrow(/NEXTLY_ACCEPT_DATA_LOSS=/);
    }
  );

  it("refuses a flag that names nothing", () => {
    expect(() => flag("")).toThrow(/names nothing/);
  });
});

describe("what a consent covers", () => {
  it("covers every deletion without targets, a deletion it cannot name included", () => {
    const consent = flag(true);
    for (const d of [table("a"), column("a", "b"), rows("a"), unnamed]) {
      expect(consentCovers(consent, d)).toBe(true);
    }
  });

  it("covers every deletion in a table it names", () => {
    const consent = flag("posts");
    expect(consentCovers(consent, table("posts"))).toBe(true);
    expect(consentCovers(consent, column("posts", "summary"))).toBe(true);
    expect(consentCovers(consent, rows("posts"))).toBe(true);
  });

  it("covers a named column and nothing else in its table", () => {
    const consent = flag("pages.summary");
    expect(consentCovers(consent, column("pages", "summary"))).toBe(true);
    expect(consentCovers(consent, column("pages", "body"))).toBe(false);
    expect(consentCovers(consent, table("pages"))).toBe(false);
    expect(consentCovers(consent, rows("pages"))).toBe(false);
  });

  it("covers nothing outside what it names", () => {
    const consent = flag("posts,pages.summary");
    expect(consentCovers(consent, table("users"))).toBe(false);
    expect(consentCovers(consent, column("users", "summary"))).toBe(false);
    expect(consentCovers(consent, unnamed)).toBe(false);
  });

  it("covers nothing when none was given", () => {
    expect(consentCovers(NO_CONSENT, table("posts"))).toBe(false);
  });

  it("covers a translations table's drop by the table it translates", () => {
    // `posts_locales` holds the translations of `posts`' entries: naming `posts` loses both.
    const consent = flag("posts");
    const translations = table("posts_locales", { translates: "posts" });
    expect(consentCovers(consent, translations)).toBe(true);
    // Not the other way round, not another table's, and not by a column of it.
    expect(consentCovers(flag("posts_locales"), table("posts"))).toBe(false);
    expect(
      consentCovers(consent, table("pages_locales", { translates: "pages" }))
    ).toBe(false);
    expect(consentCovers(flag("posts.title"), translations)).toBe(false);
  });

  it("covers a table named as a translations table by its own name only, unless proven one", () => {
    // An entity's own table may be named `posts_locales`: the name proves nothing.
    const consent = flag("posts");
    expect(consentCovers(consent, table("posts_locales"))).toBe(false);
    expect(consentCovers(consent, column("posts_locales", "title"))).toBe(
      false
    );
    expect(consentCovers(consent, rows("posts_locales"))).toBe(false);
  });
});

describe("earlier spellings", () => {
  const commandScoped: EarlierSpelling[] = [
    "NEXTLY_ALLOW_CODE_FIRST_DROPS",
    "--allow-data-loss",
    "prune --force",
    "migrate:fresh --force",
  ];
  const used = (spelling: EarlierSpelling): DataLossConsent =>
    resolveDataLossConsent({
      env: { [spelling]: "1" },
      honours: [spelling],
      earlierFlags: [spelling],
    });

  it.each(commandScoped)(
    "honours %s for its command's deletions but not Nextly's own tables",
    spelling => {
      const consent = used(spelling);
      expect(consent.earlier).toEqual([spelling]);
      expect(consentCovers(consent, table("posts"))).toBe(true);
      expect(consentCovers(consent, column("posts", "x"))).toBe(true);
      expect(consentCovers(consent, unnamed)).toBe(true);
      expect(
        consentCovers(consent, table("nextly_users", { core: true }))
      ).toBe(false);
    }
  );

  it("honours NEXTLY_ALLOW_CORE_DESTRUCTIVE for Nextly's own tables only", () => {
    const consent = used("NEXTLY_ALLOW_CORE_DESTRUCTIVE");
    expect(
      consentCovers(consent, {
        kind: "column",
        table: "dynamic_collections",
        column: "access_rules",
        core: true,
      })
    ).toBe(true);
    expect(consentCovers(consent, column("posts", "summary"))).toBe(false);
  });

  it("lets no earlier spelling widen the consent given, naming it ignored", () => {
    const consent = resolveDataLossConsent({
      flag: "dc_posts.summary",
      env: { NEXTLY_ALLOW_CODE_FIRST_DROPS: "1" },
      honours: ["NEXTLY_ALLOW_CODE_FIRST_DROPS"],
    });
    expect(consentCovers(consent, column("dc_posts", "summary"))).toBe(true);
    expect(consentCovers(consent, column("dc_posts", "body"))).toBe(false);
    expect(deprecationNotices(consent)).toEqual([
      expect.stringMatching(
        /NEXTLY_ALLOW_CODE_FIRST_DROPS is ignored.*--accept-data-loss was given/
      ),
    ]);
  });

  it("lets the variable replace an earlier spelling the same way", () => {
    const consent = resolveDataLossConsent({
      env: {
        NEXTLY_ACCEPT_DATA_LOSS: "dc_posts.summary",
        NEXTLY_ALLOW_CODE_FIRST_DROPS: "1",
      },
      honours: ["NEXTLY_ALLOW_CODE_FIRST_DROPS"],
    });
    expect(consentCovers(consent, column("dc_posts", "body"))).toBe(false);
    expect(deprecationNotices(consent)[0]).toMatch(
      /ignored.*NEXTLY_ACCEPT_DATA_LOSS was given/
    );
  });

  it("ignores an earlier spelling its command does not honour", () => {
    const consent = resolveDataLossConsent({
      env: { NEXTLY_ALLOW_CODE_FIRST_DROPS: "1" },
      honours: ["--allow-data-loss"],
    });
    expect(consent.earlier).toEqual([]);
    expect(consentCovers(consent, table("posts"))).toBe(false);
  });

  it("reads an environment spelling only when set to 1", () => {
    const consent = resolveDataLossConsent({
      env: { NEXTLY_ALLOW_CODE_FIRST_DROPS: "yes" },
      honours: ["NEXTLY_ALLOW_CODE_FIRST_DROPS"],
    });
    expect(consent.earlier).toEqual([]);
  });

  it.each([
    ["NEXTLY_ALLOW_CORE_DESTRUCTIVE", /NEXTLY_ACCEPT_DATA_LOSS/],
    ["NEXTLY_ALLOW_CODE_FIRST_DROPS", /NEXTLY_ACCEPT_DATA_LOSS/],
    ["--allow-data-loss", /use --accept-data-loss/],
    ["prune --force", /prune's --force is deprecated.*--accept-data-loss/],
    [
      "migrate:fresh --force",
      /migrate:fresh's --force is deprecated.*--accept-data-loss/,
    ],
  ] as const)(
    "names %s as deprecated, with the new spelling",
    (spelling, newSpelling) => {
      const [notice] = deprecationNotices(used(spelling));
      expect(notice).toContain("deprecated");
      expect(notice).toMatch(newSpelling);
    }
  );

  it("names nothing as deprecated when no earlier spelling was used", () => {
    expect(deprecationNotices(flag(true))).toEqual([]);
  });
});

describe("judging a run's deletions", () => {
  const judge = (
    deletions: Deletion[],
    consent: DataLossConsent,
    interactive: boolean,
    answer = false,
    extra: {
      flag?: boolean;
      approved?: Deletion[];
      sourceOf?: (deletion: Deletion) => string | undefined;
    } = {}
  ) => {
    const printed: string[] = [];
    const ask = vi.fn(() => Promise.resolve(answer));
    return judgeDataLoss({
      deletions,
      consent,
      interactive,
      ask,
      print: line => printed.push(line),
      ...extra,
    }).then(verdict => ({ verdict, printed, ask }));
  };

  it("proceeds without a word when nothing is deleted", async () => {
    const { verdict, printed, ask } = await judge([], NO_CONSENT, false);
    expect(verdict).toEqual({ kind: "proceed" });
    expect(printed).toEqual([]);
    expect(ask).not.toHaveBeenCalled();
  });

  it("prints every table and column the consent without targets deletes, before proceeding", async () => {
    const { verdict, printed, ask } = await judge(
      [
        table("posts", { count: 12 } as Partial<Deletion>),
        { kind: "column", table: "pages", column: "summary", count: 3 },
      ],
      flag(true),
      false
    );
    expect(verdict).toEqual({ kind: "proceed" });
    expect(ask).not.toHaveBeenCalled();
    expect(printed).toEqual([
      "Deleting 2 items, with consent:",
      "  - table posts (12 rows)",
      "  - column pages.summary (3 non-empty values)",
    ]);
  });

  it("refuses a deletion a list leaves out, naming it, even with a terminal", async () => {
    const { verdict, ask } = await judge(
      [table("posts"), table("pages")],
      flag("posts"),
      true,
      true
    );
    expect(ask).not.toHaveBeenCalled();
    expect(verdict.kind).toBe("refused");
    if (verdict.kind !== "refused") return;
    expect(verdict.reason).toBe("not-covered");
    expect(verdict.uncovered).toEqual([table("pages")]);
    expect(verdict.message).toContain("table pages");
    expect(verdict.message).not.toContain("table posts\n");
    expect(verdict.message).toContain("Nothing was changed");
    // The consent that covers both: what was named, and what was left out.
    expect(verdict.message).toContain("--accept-data-loss=posts,pages");
  });

  it("asks a terminal, listing every deletion with its count", async () => {
    const { verdict, printed, ask } = await judge(
      [
        { kind: "table", table: "posts", count: 1 },
        { kind: "rows", table: "pages", count: 4 },
      ],
      NO_CONSENT,
      true,
      true
    );
    expect(printed).toEqual([
      "This deletes 2 items, which cannot be undone:",
      "  - table posts (1 row)",
      "  - rows of pages (the table has 4 rows)",
    ]);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(verdict).toEqual({ kind: "proceed" });
  });

  it("asks once for deletions from several files, naming each file above its own", async () => {
    const posts = table("posts");
    const pages = { kind: "rows", table: "pages" } as const;
    const summary = column("posts", "summary");
    const sources = new Map<Deletion, string>([
      [posts, "a.sql"],
      [summary, "a.sql"],
      [pages, "b.sql"],
    ]);
    const { verdict, printed, ask } = await judge(
      [posts, summary, pages],
      NO_CONSENT,
      true,
      true,
      { sourceOf: deletion => sources.get(deletion) }
    );
    expect(printed).toEqual([
      "This deletes 3 items, which cannot be undone:",
      "  a.sql:",
      "    - table posts",
      "    - column posts.summary",
      "  b.sql:",
      "    - rows of pages",
    ]);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(verdict).toEqual({ kind: "proceed" });
  });

  it("lists each translations table right after the table it translates, in the same file", async () => {
    // A file drops every translations table first; the listing reads each beside its table.
    const notesLocales = table("notes_locales", { translates: "notes" });
    const pagesLocales = table("pages_locales", { translates: "pages" });
    const notes = table("notes");
    const pages = table("pages");
    const otherLocales = table("other_locales", { translates: "other" });
    const elsewhere = table("other");
    const sources = new Map<Deletion, string>([
      [notesLocales, "a.sql"],
      [pagesLocales, "a.sql"],
      [notes, "a.sql"],
      [pages, "a.sql"],
      [otherLocales, "a.sql"],
      [elsewhere, "b.sql"],
    ]);
    const { verdict, printed } = await judge(
      [notesLocales, pagesLocales, notes, pages, otherLocales, elsewhere],
      flag(true),
      false,
      false,
      { sourceOf: deletion => sources.get(deletion) }
    );
    expect(verdict).toEqual({ kind: "proceed" });
    expect(printed).toEqual([
      "Deleting 6 items, with consent:",
      "  a.sql:",
      "    - table notes",
      "    - table notes_locales",
      "    - table pages",
      "    - table pages_locales",
      // Its table is another file's, so it stays where its own file put it.
      "    - table other_locales",
      "  b.sql:",
      "    - table other",
    ]);
  });

  it("covers a deletion on a schema-qualified table only by the consent without targets, and says so", async () => {
    const qualified: Deletion = { kind: "rows", table: "archive.comments" };
    const named = resolveDataLossConsent({ flag: "archive.comments", env: {} });
    expect(consentCovers(named, qualified)).toBe(false);
    expect(
      consentCovers(resolveDataLossConsent({ flag: true, env: {} }), qualified)
    ).toBe(true);
    const { verdict } = await judge([qualified], named, false);
    expect(verdict.kind).toBe("refused");
    if (verdict.kind !== "refused") return;
    expect(verdict.message).toContain("only by the consent without targets");
    expect(verdict.message).toContain(
      "--accept-data-loss (or NEXTLY_ACCEPT_DATA_LOSS=1)"
    );
  });

  it("stops when the terminal says no", async () => {
    const { verdict } = await judge([table("posts")], NO_CONSENT, true, false);
    expect(verdict).toEqual({ kind: "declined" });
  });

  it("refuses at once with no terminal, without asking, naming the consent that covers it", async () => {
    const { verdict, ask } = await judge(
      [table("posts"), column("pages", "summary")],
      NO_CONSENT,
      false,
      true
    );
    expect(ask).not.toHaveBeenCalled();
    expect(verdict.kind).toBe("refused");
    if (verdict.kind !== "refused") return;
    expect(verdict.reason).toBe("needs-consent");
    expect(verdict.message).toContain("table posts");
    expect(verdict.message).toContain("column pages.summary");
    expect(verdict.message).toContain(
      "--accept-data-loss=posts,pages.summary (or NEXTLY_ACCEPT_DATA_LOSS=posts,pages.summary)"
    );
  });

  it("names the consent without targets for a deletion it cannot name", async () => {
    const { verdict } = await judge(
      [table("posts"), unnamed],
      NO_CONSENT,
      false
    );
    if (verdict.kind !== "refused") throw new Error("expected a refusal");
    expect(verdict.message).toContain(
      "To consent: --accept-data-loss (or NEXTLY_ACCEPT_DATA_LOSS=1)"
    );
  });

  it("names only the variable where the command takes no flag", async () => {
    const { verdict } = await judge(
      [table("posts")],
      NO_CONSENT,
      false,
      false,
      {
        flag: false,
      }
    );
    if (verdict.kind !== "refused") throw new Error("expected a refusal");
    expect(verdict.message).toContain(
      "To consent: NEXTLY_ACCEPT_DATA_LOSS=posts."
    );
    expect(verdict.message).not.toContain("--accept-data-loss");
  });

  it("does not ask again about deletions already agreed to", async () => {
    const { verdict, ask } = await judge(
      [table("posts")],
      NO_CONSENT,
      false,
      false,
      { approved: [table("posts")] }
    );
    expect(ask).not.toHaveBeenCalled();
    expect(verdict).toEqual({ kind: "proceed" });
  });

  it("still judges a deletion that was not among those agreed to", async () => {
    const { verdict } = await judge(
      [table("posts"), table("pages")],
      NO_CONSENT,
      false,
      false,
      { approved: [table("posts")] }
    );
    if (verdict.kind !== "refused") throw new Error("expected a refusal");
    expect(verdict.uncovered).toEqual([table("pages")]);
  });
});

describe("describing a deletion", () => {
  it("says what is lost, and how much when counted", () => {
    expect(describeDeletion(table("posts"))).toBe("table posts");
    expect(describeDeletion({ kind: "table", table: "p", count: 1 })).toBe(
      "table p (1 row)"
    );
    expect(
      describeDeletion({ kind: "column", table: "p", column: "c", count: 0 })
    ).toBe("column p.c (0 non-empty values)");
    expect(describeDeletion(rows("p"))).toBe("rows of p");
    expect(
      describeDeletion({
        kind: "table",
        table: "dc_p",
        count: 2,
        alongside: "its 3 archived translations",
      })
    ).toBe("table dc_p (2 rows), with its 3 archived translations");
    expect(describeDeletion(unnamed)).toBe(
      "0003_x's DOWN drops a table or column"
    );
  });

  it("says why it goes, after what and how much", () => {
    expect(
      describeDeletion({
        kind: "table",
        table: "dc_posts",
        count: 3,
        reason: "no longer in the config",
      })
    ).toBe("table dc_posts (3 rows): no longer in the config");
    expect(
      describeDeletion({
        kind: "column",
        table: "dc_pages",
        column: "summary",
        reason: "rename to excerpt declined",
      })
    ).toBe("column dc_pages.summary: rename to excerpt declined");
  });
});

describe("counting deletions", () => {
  it("keeps a deletion uncounted when the database cannot be read", async () => {
    const broken = {
      all: () => {
        throw new Error("no database");
      },
    };
    const counted = await countDeletions(
      [table("posts"), column("posts", "x"), unnamed],
      broken,
      "sqlite"
    );
    expect(counted).toEqual([table("posts"), column("posts", "x"), unnamed]);
  });
});

describe("what naming an entity's main table covers", () => {
  // `dc_posts` is a collection's main table; the run also drops its
  // translation table and a junction it owns, and removes its rows in shared
  // tables.
  const owned = (d: Deletion): Deletion =>
    ({ ...d, owner: "dc_posts" }) as Deletion;
  const locales = owned(table("dc_posts_locales"));
  const junction = owned(table("dc_posts_dc_tags_tags"));
  const archived: Deletion = {
    kind: "rows",
    table: "nextly_i18n_archive",
    owner: "dc_posts",
    of: { kind: "collection", slug: "posts" },
  };
  const autosaves: Deletion = {
    kind: "rows",
    table: "nextly_versions",
    owner: "dc_posts",
    of: { kind: "collection", slug: "posts" },
  };

  it("covers every table the entity owns, and every deletion in one", () => {
    const consent = flag("dc_posts");
    expect(consentCovers(consent, table("dc_posts"))).toBe(true);
    expect(consentCovers(consent, locales)).toBe(true);
    expect(consentCovers(consent, junction)).toBe(true);
    expect(
      consentCovers(consent, owned(column("dc_posts_locales", "title")))
    ).toBe(true);
    expect(consentCovers(consent, owned(rows("dc_posts_dc_tags_tags")))).toBe(
      true
    );
  });

  it("covers the entity's rows in shared tables, and no other row there", () => {
    const consent = flag("dc_posts");
    expect(consentCovers(consent, archived)).toBe(true);
    expect(consentCovers(consent, autosaves)).toBe(true);
    // A file's own removal of rows in a shared table is not the entity's.
    expect(consentCovers(consent, rows("nextly_i18n_archive"))).toBe(false);
    expect(consentCovers(consent, table("nextly_i18n_archive"))).toBe(false);
  });

  it("covers none of it when it names another entity's main table", () => {
    const consent = flag("dc_pages");
    for (const d of [table("dc_posts"), locales, junction, archived]) {
      expect(consentCovers(consent, d)).toBe(false);
    }
  });

  it("covers no table the registry does not say the entity owns", () => {
    // Named like a translation table, but no registry row says it is one.
    expect(consentCovers(flag("dc_posts"), table("dc_posts_locales"))).toBe(
      false
    );
  });

  it("still covers every deletion in a shared table it names", () => {
    const consent = flag("nextly_i18n_archive");
    expect(consentCovers(consent, archived)).toBe(true);
    expect(consentCovers(consent, rows("nextly_i18n_archive"))).toBe(true);
    expect(consentCovers(consent, table("dc_posts"))).toBe(false);
  });

  it("leaves the form without targets and the earlier spellings as they were", () => {
    for (const d of [locales, archived]) {
      expect(consentCovers(flag(true), d)).toBe(true);
      expect(consentCovers(NO_CONSENT, d)).toBe(false);
    }
  });

  it("keeps an entity's rows in a shared table apart from the table's own removal", () => {
    expect(deletionKey(archived)).not.toBe(
      deletionKey(rows("nextly_i18n_archive"))
    );
    expect(deletionKey(locales)).not.toBe(
      deletionKey(table("dc_posts_locales"))
    );
  });

  it("names the entity's main table in the consent it asks for, never a shared table", () => {
    expect(
      consentToCover([table("dc_posts"), locales, junction, archived])
    ).toBe("--accept-data-loss=dc_posts (or NEXTLY_ACCEPT_DATA_LOSS=dc_posts)");
    // A junction dropped while its entity stays is named itself.
    expect(consentToCover([junction])).toBe(
      "--accept-data-loss=dc_posts_dc_tags_tags (or NEXTLY_ACCEPT_DATA_LOSS=dc_posts_dc_tags_tags)"
    );
    expect(consentToCover([archived])).toBe(
      "--accept-data-loss=dc_posts (or NEXTLY_ACCEPT_DATA_LOSS=dc_posts)"
    );
  });

  it("asks for the consent without targets for an entity's rows whose main table a list cannot name", () => {
    // Only the main table names an entity's rows in a shared table, and a list
    // cannot spell one holding a space or read one named like a yes or a no.
    for (const main of ["true", "dc posts"]) {
      expect(consentToCover([{ ...archived, owner: main }])).toBe(
        "--accept-data-loss (or NEXTLY_ACCEPT_DATA_LOSS=1)"
      );
    }
    // A table the entity owns is still named itself where its owner cannot be.
    expect(consentToCover([{ ...locales, owner: "true" } as Deletion])).toBe(
      "--accept-data-loss=dc_posts_locales (or NEXTLY_ACCEPT_DATA_LOSS=dc_posts_locales)"
    );
  });

  it("refuses a consent naming one entity for a run that also drops another", async () => {
    const single = (d: Deletion): Deletion =>
      ({ ...d, owner: "single_home" }) as Deletion;
    const homeRows: Deletion = {
      kind: "rows",
      table: "nextly_version_pins",
      owner: "single_home",
      of: { kind: "single", slug: "home" },
      count: 1,
    };
    const verdict = await judgeDataLoss({
      deletions: [
        table("dc_posts"),
        locales,
        archived,
        table("single_home"),
        single(table("single_home_locales")),
        homeRows,
      ],
      consent: flag("dc_posts"),
      interactive: true,
      ask: () => Promise.resolve(true),
      print: () => {},
    });
    if (verdict.kind !== "refused") throw new Error("expected a refusal");
    expect(verdict.uncovered).toEqual([
      table("single_home"),
      single(table("single_home_locales")),
      homeRows,
    ]);
    expect(verdict.message).toContain(
      "--accept-data-loss=dc_posts,single_home"
    );
  });
});

describe("the targets a refusal asks for", () => {
  // `dc_posts` is a collection's main table; `owned` marks a deletion of the
  // collection's, and `posts` is its slug.
  const owned = (d: Deletion): Deletion =>
    ({ ...d, owner: "dc_posts" }) as Deletion;
  const ofPosts = { kind: "collection", slug: "posts" } as const;
  const value = (deletions: Deletion[]) =>
    consentToCover(deletions).match(/^--accept-data-loss=(\S+) /)?.[1];

  it("names a deletion no entity owns by its own table, a column as its table and column", () => {
    expect(
      value([table("drafts"), column("pages", "summary"), rows("nextly_seo")])
    ).toBe("drafts,nextly_seo,pages.summary");
  });

  it("leaves out a column whose table it names", () => {
    expect(value([column("posts", "summary"), table("posts")])).toBe("posts");
  });

  it("names an entity's other deletion by its own table while the run names no owner", () => {
    expect(value([owned(column("dc_posts_locales", "title"))])).toBe(
      "dc_posts_locales.title"
    );
  });

  it("names only the owner once the run names it, wherever the run lists it", () => {
    expect(
      value([owned(column("dc_posts_locales", "title")), table("dc_posts")])
    ).toBe("dc_posts");
  });

  it("names an entity's rows in a shared table by its main table, which then covers the rest", () => {
    const archived: Deletion = {
      kind: "rows",
      table: "nextly_i18n_archive",
      owner: "dc_posts",
      of: ofPosts,
    };
    expect(value([owned(table("dc_posts_locales")), archived])).toBe(
      "dc_posts"
    );
  });

  it("names rows in a shared table by that table when no main table owns them", () => {
    const ownerless: Deletion = {
      kind: "rows",
      table: "nextly_versions",
      of: ofPosts,
    };
    expect(value([ownerless])).toBe("nextly_versions");
  });

  it("keeps the targets the consent named and adds the ones it left out", async () => {
    const verdict = await judgeDataLoss({
      deletions: [
        table("dc_pages"),
        column("posts", "summary"),
        owned(table("dc_posts_locales")),
      ],
      consent: flag("dc_pages,posts.summary"),
      interactive: false,
      ask: () => Promise.resolve(false),
      print: () => {},
    });
    if (verdict.kind !== "refused") throw new Error("expected a refusal");
    expect(verdict.message).toContain(
      "--accept-data-loss=dc_pages,dc_posts_locales,posts.summary"
    );
  });
});

describe("what an agreement to drop an entity's main table covers", () => {
  const archived: Deletion = {
    kind: "rows",
    table: "nextly_i18n_archive",
    owner: "dc_posts",
    of: { kind: "collection", slug: "posts" },
  };
  const locales: Deletion = {
    kind: "table",
    table: "dc_posts_locales",
    owner: "dc_posts",
  };
  const judge = (approved: Deletion[]) =>
    judgeDataLoss({
      deletions: [table("dc_posts"), locales, archived],
      consent: NO_CONSENT,
      interactive: false,
      ask: () => Promise.resolve(false),
      print: () => {},
      approved,
    });

  it("covers the entity's other tables and its rows in shared tables, as naming it does", async () => {
    expect(await judge([table("dc_posts")])).toEqual({ kind: "proceed" });
  });

  it("covers none of it when another table was agreed to", async () => {
    const verdict = await judge([table("nextly_i18n_archive")]);
    if (verdict.kind !== "refused") throw new Error("expected a refusal");
    expect(verdict.uncovered).toEqual([table("dc_posts"), locales, archived]);
  });
});

describe("listing what an entity's removal takes", () => {
  it("counts a table the entity owns, and names its owner", () => {
    expect(
      describeDeletion({
        kind: "table",
        table: "dc_posts_locales",
        owner: "dc_posts",
        count: 4,
      })
    ).toBe("table dc_posts_locales (4 rows), belonging to dc_posts");
  });

  it("counts the entity's rows in a shared table, not the table's", () => {
    expect(
      describeDeletion({
        kind: "rows",
        table: "nextly_i18n_archive",
        owner: "dc_posts",
        of: { kind: "collection", slug: "posts" },
        count: 3,
        reason: "its archived translations",
      })
    ).toBe(
      'rows of collection "posts" in nextly_i18n_archive (3 rows): its archived translations'
    );
    expect(
      describeDeletion({
        kind: "rows",
        table: "nextly_version_pins",
        owner: "single_home",
        of: { kind: "single", slug: "home" },
        count: 1,
      })
    ).toBe('rows of Single "home" in nextly_version_pins (1 row)');
    expect(
      describeDeletion({
        kind: "rows",
        table: "nextly_versions",
        owner: "dc_posts",
        of: { kind: "collection", slug: "posts" },
      })
    ).toBe('rows of collection "posts" in nextly_versions');
  });

  it("never counts an entity's rows as its shared table's every row", async () => {
    const counts: string[] = [];
    const db = {
      all: (query: unknown) => {
        counts.push(JSON.stringify(query));
        return [{ count: 99 }];
      },
    };
    const shared: Deletion = {
      kind: "rows",
      table: "nextly_versions",
      owner: "dc_posts",
      of: { kind: "collection", slug: "posts" },
    };
    const owned: Deletion = {
      kind: "table",
      table: "dc_posts_locales",
      owner: "dc_posts",
    };
    const counted = await countDeletions([shared, owned], db, "sqlite");
    expect(counted).toEqual([shared, { ...owned, count: 99 }]);
    expect(counts).toHaveLength(1);
  });
});

describe("a refusal, for a production start that ran the migrations itself", () => {
  /** The refusal of `deletions` under `consent`, with nobody to ask. */
  async function refused(
    deletions: Parameters<typeof judgeDataLoss>[0]["deletions"],
    consent: DataLossConsent = NO_CONSENT,
    flag?: boolean
  ): Promise<string> {
    const verdict = await judgeDataLoss({
      deletions,
      consent,
      interactive: false,
      ask: async () => false,
      print: () => {},
      ...(flag === undefined ? {} : { flag }),
    });
    if (verdict.kind !== "refused") throw new Error("expected a refusal");
    return verdict.message;
  }

  it("names the variable a start reads, then the command's flag, keeping the listing", async () => {
    const message = await refused([
      { kind: "column", table: "posts", column: "summary" },
      { kind: "table", table: "drafts" },
    ]);

    expect(refusalForStart(message)).toBe(
      message.replace(
        "To consent: --accept-data-loss=drafts,posts.summary (or NEXTLY_ACCEPT_DATA_LOSS=drafts,posts.summary).",
        'To consent: start with NEXTLY_ACCEPT_DATA_LOSS=drafts,posts.summary, or run "nextly migrate --accept-data-loss=drafts,posts.summary".'
      )
    );
    expect(refusalForStart(message)).not.toBe(message);
  });

  it("does so for the consent without targets", async () => {
    const message = await refused([
      { kind: "unnamed", description: "rows a statement removes" },
    ]);

    expect(refusalForStart(message)).toContain(
      'To consent: start with NEXTLY_ACCEPT_DATA_LOSS=1, or run "nextly migrate --accept-data-loss".'
    );
  });

  it("does so for a consent that leaves a deletion out", async () => {
    const message = await refused(
      [{ kind: "column", table: "posts", column: "summary" }],
      {
        ...NO_CONSENT,
        given: {
          from: "env",
          targets: { tables: new Set(["drafts"]), columns: new Set() },
        },
      }
    );

    expect(refusalForStart(message)).toContain(
      'To delete this too: start with NEXTLY_ACCEPT_DATA_LOSS=drafts,posts.summary, or run "nextly migrate --accept-data-loss=drafts,posts.summary".'
    );
  });

  /**
   * The consent a start's refusal ends on, read back as the start and the
   * command would be given it: the variable's value, and the flag's (`true`
   * for the flag alone).
   */
  function consentNamed(message: string): {
    env: string;
    flag: string | true;
  } {
    const named =
      /start with NEXTLY_ACCEPT_DATA_LOSS=(.*), or run "nextly migrate --accept-data-loss(?:=(.*))?"\.$/.exec(
        message
      );
    if (named === null) throw new Error("the message names no consent");
    return { env: named[1], flag: named[2] ?? true };
  }

  it.each([
    ["a plain name", "notes", "summary", "notes.summary"],
    ["a closing parenthesis", "notes(old)", "summary", "notes(old).summary"],
    ["a space in the table's name", "old notes", "summary", undefined],
    ["a space in the column's name", "notes", "old summary", undefined],
    ["the words between the two spellings", "a (or b)", "summary", undefined],
    ["a comma", "notes,drafts", "summary", undefined],
    ["a dot in the column's name", "notes", "a.b", undefined],
  ])(
    "ends on a consent that, given back, covers the deletion: %s",
    async (_what, table, column, target) => {
      const deletion = { kind: "column", table, column } as const;
      const message = refusalForStart(await refused([deletion]));
      const named = consentNamed(message);

      // A name a list of targets can spell is named; any other is covered
      // only by the consent without targets, which is then what is asked for.
      expect(named).toEqual(
        target === undefined
          ? { env: "1", flag: true }
          : { env: target, flag: target }
      );
      const fromEnv = resolveDataLossConsent({
        env: { NEXTLY_ACCEPT_DATA_LOSS: named.env },
      });
      const fromFlag = resolveDataLossConsent({ flag: named.flag, env: {} });
      expect(consentCovers(fromEnv, deletion)).toBe(true);
      expect(consentCovers(fromFlag, deletion)).toBe(true);
    }
  );

  it.each(["false", "0", "true", "1", "FALSE", "True"])(
    "asks for the consent without targets for a table named %s, which the consent reads as yes or no",
    async table => {
      const deletion = { kind: "table", table } as const;
      const message = await refused([deletion]);
      // Never the name as a target: `=false` and `=0` give no consent, and
      // `=true` and `=1` consent to every deletion without saying so.
      expect(message).toContain(
        "To consent: --accept-data-loss (or NEXTLY_ACCEPT_DATA_LOSS=1)."
      );

      const named = consentNamed(refusalForStart(message));
      expect(named).toEqual({ env: "1", flag: true });
      expect(
        consentCovers(
          resolveDataLossConsent({
            env: { NEXTLY_ACCEPT_DATA_LOSS: named.env },
          }),
          deletion
        )
      ).toBe(true);
      // A list naming it beside another table does not cover it either, so
      // what the refusal asks for is the one consent that does.
      expect(
        consentCovers(
          resolveDataLossConsent({ flag: `drafts,${table}`, env: {} }),
          deletion
        )
      ).toBe(false);
    }
  );

  it("says that only the consent without targets covers a name a list cannot spell, to a consent that names others", async () => {
    const message = await refused(
      [{ kind: "column", table: "old notes", column: "summary" }],
      {
        ...NO_CONSENT,
        given: {
          from: "env",
          targets: { tables: new Set(["drafts"]), columns: new Set() },
        },
      }
    );

    expect(message).toContain(
      "whose table or column name holds a space, a comma or a dot"
    );
    expect(refusalForStart(message)).toContain(
      'To delete this too: start with NEXTLY_ACCEPT_DATA_LOSS=1, or run "nextly migrate --accept-data-loss".'
    );
  });

  it("keeps a message that names the variable alone, or no consent, as it is", async () => {
    const variableOnly = await refused(
      [{ kind: "table", table: "drafts" }],
      NO_CONSENT,
      false
    );

    expect(refusalForStart(variableOnly)).toBe(variableOnly);
    expect(refusalForStart("Refused, in other words.")).toBe(
      "Refused, in other words."
    );
  });
});
