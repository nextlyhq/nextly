/**
 * Whether an account's own grants let it lock the tables of the database it is on, and what a hold
 * on MySQL answers where it cannot be had.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it } from "vitest";

import { grantsLock, tableHold } from "../retirement-hold";

const ON_SITE = (privileges: string, on: string) =>
  `GRANT ${privileges} ON ${on} TO \`site\`@\`%\``;

describe("grantsLock", () => {
  it.each([
    ["every privilege everywhere", ON_SITE("ALL PRIVILEGES", "*.*")],
    ["the lock everywhere", ON_SITE("SELECT, LOCK TABLES, EXECUTE", "*.*")],
    ["the lock here", ON_SITE("SELECT, LOCK TABLES", "`site_db`.*")],
    [
      "a name with its wildcard escaped",
      ON_SITE("LOCK TABLES", "`site\\_db`.*"),
    ],
    ["a pattern", ON_SITE("ALL PRIVILEGES", "`site%`.*")],
    ["names in double quotes", ON_SITE("LOCK TABLES", '"site_db".*')],
    [
      "it with the grant option",
      `${ON_SITE("LOCK TABLES", "`site_db`.*")} WITH GRANT OPTION`,
    ],
  ])("is so with %s", (_what, grant) => {
    expect(
      grantsLock(["GRANT USAGE ON *.* TO `site`@`%`", grant], "site_db")
    ).toBe(true);
  });

  it.each([
    ["nothing", ON_SITE("USAGE", "*.*")],
    ["other privileges here", ON_SITE("SELECT, INSERT, DROP", "`site_db`.*")],
    ["the lock on another database", ON_SITE("LOCK TABLES", "`other`.*")],
    ["a pattern that names another", ON_SITE("LOCK TABLES", "`site\\_d`.*")],
    [
      "an escaped wildcard where another letter is",
      ON_SITE("LOCK TABLES", "`sit\\_\\_db`.*"),
    ],
    ["one table alone", ON_SITE("ALL PRIVILEGES", "`site_db`.`posts`")],
    ["a role alone", "GRANT `deployer`@`%` TO `site`@`%`"],
  ])("is not with %s", (_what, grant) => {
    expect(grantsLock([grant], "site_db")).toBe(false);
  });

  it("reads a dot in a name as itself", () => {
    expect(grantsLock([ON_SITE("LOCK TABLES", "`site.db`.*")], "sitexdb")).toBe(
      false
    );
  });
});

describe("a hold on MySQL", () => {
  /** A hold of `posts`, the account granted everything: what was sent, and what it answered. */
  async function held(how: {
    beside: "opens" | "is refused";
    lock?: Error;
  }): Promise<{ answer: string | undefined; sent: string[]; worked: boolean }> {
    const adapter = {
      withSession: async (work: (session: unknown) => Promise<unknown>) => {
        if (how.beside === "is refused")
          throw new Error("too many connections");
        return work({ execute: async () => [] });
      },
    } as unknown as DrizzleAdapter;
    const sent: string[] = [];
    let worked = false;
    const answer = await tableHold(adapter, "mysql").holding(
      {
        db: {
          // One row answers both questions: its first value is the grant, `name` the database.
          execute: async () => [
            [{ grant: "GRANT ALL PRIVILEGES ON *.* TO `s`@`%`", name: "site" }],
            [],
          ],
        },
        send: async statement => {
          sent.push(statement);
          if (how.lock !== undefined && statement.startsWith("LOCK")) {
            throw how.lock;
          }
        },
        sending: () => undefined,
        idle: async () => undefined,
      },
      ["posts"],
      async () => {
        worked = true;
      }
    );
    return { answer, sent, worked };
  }

  it("locks the tables, works, and lets them go", async () => {
    expect(await held({ beside: "opens" })).toEqual({
      answer: undefined,
      sent: ["LOCK TABLES `posts` WRITE", "UNLOCK TABLES"],
      worked: true,
    });
  });

  it.each([1044, 1142])(
    "says so where the database refuses the lock all the same (%i)",
    async errno => {
      const refused = Object.assign(new Error("denied"), { errno });
      expect(await held({ beside: "opens", lock: refused })).toEqual({
        answer: "the database refused this account the lock",
        sent: ["LOCK TABLES `posts` WRITE"],
        worked: false,
      });
    }
  );

  it("throws what else the lock fails with, as a wait that ended", async () => {
    const waited = Object.assign(new Error("lock wait"), { errno: 1205 });
    await expect(held({ beside: "opens", lock: waited })).rejects.toBe(waited);
  });

  it("says so where no second connection opens, with nothing locked", async () => {
    expect(await held({ beside: "is refused" })).toEqual({
      answer: "no connection could be opened beside the run's own",
      sent: [],
      worked: false,
    });
  });
});
