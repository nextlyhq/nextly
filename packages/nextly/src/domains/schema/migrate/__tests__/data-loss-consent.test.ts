import { describe, expect, it, vi } from "vitest";

import {
  consentCovers,
  countDeletions,
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

  it("covers a translations table's deletions by the table it translates", () => {
    // `posts_locales` holds the translations of `posts`' entries: naming `posts` loses both.
    const consent = flag("posts");
    expect(consentCovers(consent, table("posts_locales"))).toBe(true);
    expect(consentCovers(consent, column("posts_locales", "title"))).toBe(true);
    expect(consentCovers(consent, rows("posts_locales"))).toBe(true);
    // Not the other way round, and not another table's.
    expect(consentCovers(flag("posts_locales"), table("posts"))).toBe(false);
    expect(consentCovers(consent, table("pages_locales"))).toBe(false);
    expect(consentCovers(flag("posts.title"), table("posts_locales"))).toBe(
      false
    );
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
    const notesLocales = table("notes_locales");
    const pagesLocales = table("pages_locales");
    const notes = table("notes");
    const pages = table("pages");
    const otherLocales = table("other_locales");
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
