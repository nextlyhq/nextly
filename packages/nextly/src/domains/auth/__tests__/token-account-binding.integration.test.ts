/**
 * A password-reset or email-verification link acts only on the account it was
 * issued for, and only while that account holds the address it went to.
 *
 * Addresses change hands: an account moves to another address, or is deleted,
 * and the address is later given to someone else. A link keyed by the address
 * alone would then reset or verify whoever holds it now. Each case below is
 * run for both kinds of link, on every configured dialect, because the row
 * locks that order the races are each dialect's own.
 *
 * The races are driven both ways round. A one-shot hook runs while a flow
 * holds the account's row (`afterLock`), and starts the competing write
 * there, so the flow commits first and the write lands after it. The reverse
 * order holds the competing write open in a transaction of the test's own
 * (`holdWrite`) while the flow starts, and commits it before the flow can
 * read the account.
 *
 * Each competing operation starts in the test's own async context, never
 * inside the flow's transaction: SQLite's adapter would otherwise run it as a
 * savepoint of that transaction rather than queue it behind, which is a
 * different thing from two requests racing.
 */
import { AsyncResource } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/** Run once, while the next account lock is held, then cleared. */
const afterLock = vi.hoisted(() => ({
  run: undefined as (() => void) | undefined,
}));

/** Run once, when the next flow asks for the account's row, then cleared. */
const beforeLock = vi.hoisted(() => ({
  run: undefined as (() => void) | undefined,
}));

vi.mock("../services/token-account-binding", async importOriginal => {
  const real =
    await importOriginal<typeof import("../services/token-account-binding")>();
  return {
    ...real,
    lockAccount: async (...args: Parameters<typeof real.lockAccount>) => {
      const reached = beforeLock.run;
      beforeLock.run = undefined;
      reached?.();
      const account = await real.lockAccount(...args);
      const hook = afterLock.run;
      afterLock.run = undefined;
      hook?.();
      return account;
    },
  };
});

import { getDialectTables } from "../../../database/index";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { BaseService } from "../../../services/base-service";
import { consoleLogger } from "../../../services/shared";
import type { AuthService } from "../services/auth-service";

/** The slice of the Drizzle instance and of a transaction this suite drives. */
interface TestDb {
  insert: (table: unknown) => { values: (data: unknown) => Promise<unknown> };
  update: (table: unknown) => {
    set: (data: unknown) => { where: (cond: unknown) => Promise<unknown> };
  };
  delete: (table: unknown) => { where: (cond: unknown) => Promise<unknown> };
  select: () => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Record<string, unknown>[]>;
    };
  };
}

/** A transaction of the test's own, through the route every service takes. */
class TestTransactions extends BaseService {
  run<T>(work: (tx: TestDb) => Promise<T>): Promise<T> {
    return this.withTransaction(tx => work(tx as TestDb));
  }
}

const NEW_PASSWORD = "Str0ngPassw0rd!";
const OLD_HASH = "$2a$10$abcdefghijklmnopqrstuuJ7rOq0r9rUuJ1yYb1E5vZ3QhJcI2xyK";

type Tables = ReturnType<typeof getDialectTables>;

/** What differs between the two kinds of link. */
interface Kind {
  name: "password reset" | "email verification";
  table: (tables: Tables) => Tables["passwordResetTokens"];
  issue: (auth: AuthService, email: string) => Promise<{ token?: string }>;
  redeem: (auth: AuthService, token: string) => Promise<unknown>;
  /** The address the limiter charges a request carrying the token to. */
  owner: (auth: AuthService, token: string) => Promise<string | null>;
  /** Whether the link's effect is on the account: a new password, or a verified address. */
  applied: (row: Record<string, unknown>) => boolean;
}

const KINDS: Kind[] = [
  {
    name: "password reset",
    table: tables => tables.passwordResetTokens,
    issue: (auth, email) =>
      auth.generatePasswordResetToken(email, { disableEmail: true }),
    redeem: (auth, token) => auth.resetPasswordWithToken(token, NEW_PASSWORD),
    owner: (auth, token) => auth.resetTokenOwner(token),
    applied: row => row.passwordHash !== OLD_HASH,
  },
  {
    name: "email verification",
    // Both tables carry the columns these cases read; one type serves both.
    table: tables =>
      tables.emailVerificationTokens as unknown as Tables["passwordResetTokens"],
    issue: (auth, email) =>
      auth.generateEmailVerificationToken(email, { disableEmail: true }),
    redeem: (auth, token) => auth.verifyEmail(token),
    owner: (auth, token) => auth.verificationTokenOwner(token),
    applied: row =>
      row.emailVerified !== null && row.emailVerified !== undefined,
  },
];

describe.each(getConfiguredTestDialects())("on %s", (dialect: TestDialect) => {
  let t: TestNextly;
  let auth: AuthService;
  let db: TestDb;
  let tables: Tables;
  let transactions: TestTransactions;
  let serial = 0;

  beforeAll(async () => {
    t = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
    auth = t.getService("authService") as unknown as AuthService;
    db = t.adapter.getDrizzle() as unknown as TestDb;
    tables = getDialectTables(dialect);
    transactions = new TestTransactions(t.adapter, consoleLogger);
  }, 120_000);

  afterAll(async () => {
    await t?.destroy();
  });

  afterEach(() => {
    afterLock.run = undefined;
    beforeLock.run = undefined;
  });

  /** A fresh address no account has used in this run. */
  function address(label: string): string {
    serial += 1;
    return `${label}-${serial}@example.com`;
  }

  /** An account as an existing install holds one: unverified, with a password. */
  async function account(
    email: string,
    createdAt: Date = new Date()
  ): Promise<string> {
    serial += 1;
    const id = `binding-user-${serial}`;
    await db.insert(tables.users).values({
      id,
      email,
      name: "Binding",
      emailVerified: null,
      isActive: true,
      passwordHash: OLD_HASH,
      createdAt,
      updatedAt: createdAt,
    });
    return id;
  }

  async function userRow(id: string): Promise<Record<string, unknown>> {
    const [row] = await db
      .select()
      .from(tables.users)
      .where(eq(tables.users.id, id));
    return row;
  }

  async function tokensFor(
    kind: Kind,
    raw: string
  ): Promise<Record<string, unknown>[]> {
    const table = kind.table(tables);
    return db
      .select()
      .from(table)
      .where(
        eq(table.tokenHash, createHash("sha256").update(raw).digest("hex"))
      );
  }

  async function issued(kind: Kind, email: string): Promise<string> {
    const { token } = await kind.issue(auth, email);
    expect(token).toBeTruthy();
    return token as string;
  }

  /** Move the account to another address, as an administrator does. */
  function moveTo(id: string, email: string): Promise<unknown> {
    return t.nextly.users.update({ id, data: { email } });
  }

  function remove(id: string): Promise<unknown> {
    return t.nextly.users.delete({ id });
  }

  /**
   * Start `competing` from the test's own context when the next account lock
   * is taken, and return a promise of it.
   */
  function whenLocked(competing: () => Promise<unknown>): {
    done: () => Promise<unknown>;
  } {
    let started: Promise<unknown> | undefined;
    const start = AsyncResource.bind(() => {
      started = competing();
    });
    afterLock.run = start;
    return {
      done: () => {
        expect(started).toBeDefined();
        return started as Promise<unknown>;
      },
    };
  }

  /**
   * Run `write` in a transaction of the test's own and keep it open while
   * `during` starts, then commit it. Returns what `during` started, which
   * is still waiting on the account when the write commits. Wrapped, so
   * awaiting this does not also await the flow.
   */
  async function holdWrite<T>(
    write: (tx: TestDb) => Promise<unknown>,
    during: () => Promise<T>
  ): Promise<{ flow: Promise<T> }> {
    let release!: () => void;
    const released = new Promise<void>(resolve => (release = resolve));
    let written!: () => void;
    const wrote = new Promise<void>(resolve => (written = resolve));
    const holding = transactions.run(async tx => {
      await write(tx);
      written();
      await released;
    });
    await wrote;
    // PostgreSQL and MySQL: the flow reaches the account's row lock and waits
    // there, behind the open write. A reset hashes the new password first,
    // which takes longer than any fixed pause, so the write is released only
    // once the flow is at the lock. SQLite queues the flow's whole
    // transaction behind the write, so it cannot reach the lock until the
    // write commits.
    let reachedLock = false;
    const atLock = new Promise<void>(resolve => {
      beforeLock.run = () => {
        reachedLock = true;
        resolve();
      };
    });
    const started = during();
    // Rejections are read by the caller; this keeps one from going unhandled
    // while the write is still open.
    started.catch(() => undefined);
    if (dialect === "sqlite") {
      await new Promise(resolve => setTimeout(resolve, 300));
    } else {
      await Promise.race([
        atLock,
        new Promise(resolve => setTimeout(resolve, 20_000)),
      ]);
      expect(reachedLock).toBe(true);
      // Long enough for the lock request to reach the database and wait.
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    beforeLock.run = undefined;
    release();
    await holding;
    return { flow: started };
  }

  describe.each(KINDS)("a $name link", kind => {
    it("records the account it was issued for, and works for it", async () => {
      const email = address("works");
      const id = await account(email);
      const token = await issued(kind, email);

      const [row] = await tokensFor(kind, token);
      expect(row.userId).toBe(id);
      expect(await kind.owner(auth, token)).toBe(email);

      await kind.redeem(auth, token);
      expect(kind.applied(await userRow(id))).toBe(true);
    });

    it("is removed with its account, and refused", async () => {
      const email = address("deleted");
      const id = await account(email);
      const token = await issued(kind, email);

      await remove(id);

      expect(await tokensFor(kind, token)).toHaveLength(0);
      await expect(kind.redeem(auth, token)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    });

    it("is revoked when the account moves to another address", async () => {
      const x = address("moves");
      const id = await account(x);
      const token = await issued(kind, x);

      await moveTo(id, address("moved"));

      expect(await tokensFor(kind, token)).toHaveLength(0);
      await expect(kind.redeem(auth, token)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expect(kind.applied(await userRow(id))).toBe(false);
    });

    it("stays dead when the account returns to the address", async () => {
      const x = address("returns");
      const id = await account(x);
      const token = await issued(kind, x);

      await moveTo(id, address("away"));
      await moveTo(id, x);

      await expect(kind.redeem(auth, token)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expect(kind.applied(await userRow(id))).toBe(false);
    });

    it("never acts on the next holder of the address", async () => {
      const x = address("reassigned");
      const first = await account(x);
      const token = await issued(kind, x);
      await moveTo(first, address("left"));
      const next = await account(x);

      await expect(kind.redeem(auth, token)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expect(kind.applied(await userRow(next))).toBe(false);
      expect(kind.applied(await userRow(first))).toBe(false);
    });

    it("is refused when its account no longer holds the address, even unrevoked", async () => {
      // The redemption's own check, apart from the revocation above: a row
      // bound to an account at another address is refused for that account.
      const x = address("unrevoked");
      const id = await account(address("elsewhere"));
      const raw = randomBytes(32).toString("hex");
      await db.insert(kind.table(tables)).values({
        identifier: x,
        userId: id,
        tokenHash: createHash("sha256").update(raw).digest("hex"),
        expires: new Date(Date.now() + 3600_000),
      });

      await expect(kind.redeem(auth, raw)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expect(kind.applied(await userRow(id))).toBe(false);
    });

    it("cannot be stored for an account that does not exist", async () => {
      // The foreign key, which also removes an account's links with it.
      await expect(
        db.insert(kind.table(tables)).values({
          identifier: address("ghost"),
          userId: "no-such-account",
          tokenHash: randomBytes(32).toString("hex"),
          expires: new Date(Date.now() + 3600_000),
        })
      ).rejects.toThrow();
    });

    describe("issued while its account is deleted", () => {
      it("is removed by a deletion that waited for the issue", async () => {
        const email = address("issue-then-delete");
        const id = await account(email);
        const deletion = whenLocked(() => remove(id));

        const token = await issued(kind, email);
        await deletion.done();

        expect(await tokensFor(kind, token)).toHaveLength(0);
        await expect(kind.redeem(auth, token)).rejects.toMatchObject({
          code: "VALIDATION_ERROR",
        });
      });

      it("is not issued once a deletion holding the account commits", async () => {
        const email = address("delete-then-issue");
        const id = await account(email);

        const { flow: issuing } = await holdWrite(
          tx => tx.delete(tables.users).where(eq(tables.users.id, id)),
          () => kind.issue(auth, email)
        );

        expect(await issuing).toEqual({});
        const table = kind.table(tables);
        expect(
          await db.select().from(table).where(eq(table.identifier, email))
        ).toHaveLength(0);
      });
    });

    describe("issued while the address changes from x to y", () => {
      it("is revoked by the change, and stays dead when the account returns to x", async () => {
        // The change cannot write the account while the issue holds its row,
        // so the token commits first and the change revokes it.
        const x = address("issue-then-move");
        const id = await account(x);
        const change = whenLocked(() =>
          moveTo(id, address("issue-then-move-y"))
        );

        const token = await issued(kind, x);
        await change.done();
        await moveTo(id, x);

        await expect(kind.redeem(auth, token)).rejects.toMatchObject({
          code: "VALIDATION_ERROR",
        });
        expect(kind.applied(await userRow(id))).toBe(false);
      });

      it("is not issued once a change holding the account commits", async () => {
        const x = address("move-then-issue");
        const id = await account(x);

        const { flow: issuing } = await holdWrite(
          tx =>
            tx
              .update(tables.users)
              .set({
                email: address("move-then-issue-y"),
                updatedAt: new Date(),
              })
              .where(eq(tables.users.id, id)),
          () => kind.issue(auth, x)
        );

        expect(await issuing).toEqual({});
        await moveTo(id, x);
        const table = kind.table(tables);
        expect(
          await db.select().from(table).where(eq(table.userId, id))
        ).toHaveLength(0);
      });
    });

    describe("redeemed while the address changes", () => {
      it("completes first when it holds the account, and the change follows", async () => {
        const x = address("redeem-then-move");
        const y = address("redeem-then-move-y");
        const id = await account(x);
        const token = await issued(kind, x);
        const change = whenLocked(() => moveTo(id, y));

        await kind.redeem(auth, token);
        await change.done();

        const row = await userRow(id);
        expect(kind.applied(row)).toBe(true);
        expect(row.email).toBe(y);
      });

      it("is refused when a change holding the account commits first", async () => {
        const x = address("move-then-redeem");
        const id = await account(x);
        const token = await issued(kind, x);

        const { flow: redeeming } = await holdWrite(
          tx =>
            tx
              .update(tables.users)
              .set({
                email: address("move-then-redeem-y"),
                updatedAt: new Date(),
              })
              .where(eq(tables.users.id, id)),
          () => kind.redeem(auth, token)
        );

        await expect(redeeming).rejects.toMatchObject({
          code: "VALIDATION_ERROR",
        });
        expect(kind.applied(await userRow(id))).toBe(false);
      });
    });

    describe("redeemed while the account is deleted", () => {
      it("completes first when it holds the account, and the deletion follows", async () => {
        const email = address("redeem-then-delete");
        const id = await account(email);
        const token = await issued(kind, email);
        const deletion = whenLocked(() => remove(id));

        await kind.redeem(auth, token);
        await deletion.done();

        const [gone] = await db
          .select()
          .from(tables.users)
          .where(eq(tables.users.id, id));
        expect(gone).toBeUndefined();
      });

      it("is refused when a deletion holding the account commits first", async () => {
        const email = address("delete-then-redeem");
        const id = await account(email);
        const token = await issued(kind, email);

        const { flow: redeeming } = await holdWrite(
          tx => tx.delete(tables.users).where(eq(tables.users.id, id)),
          () => kind.redeem(auth, token)
        );

        await expect(redeeming).rejects.toMatchObject({
          code: "VALIDATION_ERROR",
        });
      });
    });

    describe("from before links recorded their account", () => {
      /** A link as the release before this one stored it: no account. */
      async function unbound(email: string, issuedAt: Date): Promise<string> {
        const raw = randomBytes(32).toString("hex");
        await db.insert(kind.table(tables)).values({
          identifier: email,
          tokenHash: createHash("sha256").update(raw).digest("hex"),
          expires: new Date(issuedAt.getTime() + 24 * 3600_000),
          createdAt: issuedAt,
        });
        return raw;
      }

      it("is refused until the upgrade binds it, even for the account that held the address", async () => {
        // Only a bound link is redeemed; the core reconcile binds or removes
        // an unbound one the next time it runs.
        const email = address("unbound-refused");
        const id = await account(email, new Date(Date.now() - 3 * 3600_000));
        const raw = await unbound(email, new Date(Date.now() - 3600_000));

        await expect(kind.redeem(auth, raw)).rejects.toMatchObject({
          code: "VALIDATION_ERROR",
        });
        expect(kind.applied(await userRow(id))).toBe(false);
        // Nor does it name an owner for the limiter to charge.
        expect(await kind.owner(auth, raw)).toBeNull();
      });

      it("is removed when the account at its address is deleted", async () => {
        const email = address("unbound-deleted");
        const id = await account(email, new Date(Date.now() - 3 * 3600_000));
        const raw = await unbound(email, new Date(Date.now() - 3600_000));

        await remove(id);

        expect(await tokensFor(kind, raw)).toHaveLength(0);
      });
    });
  });
});
