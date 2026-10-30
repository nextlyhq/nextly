import { describe, expect, it, vi } from "vitest";

import {
  consentCovers,
  countDeletions,
  deprecationNotices,
  describeDeletion,
  judgeDataLoss,
  NO_CONSENT,
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
    extra: { flag?: boolean; approved?: Deletion[] } = {}
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
