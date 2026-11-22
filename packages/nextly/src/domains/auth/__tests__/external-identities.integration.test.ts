/**
 * Core's external identities' table, live on each configured dialect: what
 * the reconcile created, the uniqueness it enforces, the removal with the
 * account, and the absence of anything shaped like a provider token.
 *
 * Rows are planted straight through the adapter, as the media detach test
 * plants media: no writer of identities exists yet — the sign-in hand-off
 * that will write them is later work — so the row is the fixture and the
 * table's own constraints are the behaviour under test.
 */

// Sessions sign with keys derived from this; set before any module reads env.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { liveColumnsOf } from "../../../init/retired-auth-tables";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  EXTERNAL_IDENTITIES_TABLE,
  externalIdentityKeyDigest,
} from "../../../schemas/external-identities";
import { isUniqueViolation } from "../../../shared/lib/unique-violation";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** One identity row, written straight to the table. */
async function insertIdentity(
  handle: TestNextly,
  row: {
    providerKey: string;
    issuer: string;
    subject: string;
    userId: string;
    address?: string;
  }
): Promise<void> {
  await handle.adapter.insert(EXTERNAL_IDENTITIES_TABLE, {
    id: randomUUID(),
    providerKey: row.providerKey,
    issuer: row.issuer,
    subject: row.subject,
    // The digest the unique index holds, derived exactly as the writer that
    // hands sign-ins to core will derive it: the row and its key arrive
    // together or the index refuses both.
    keyDigest: externalIdentityKeyDigest(
      row.providerKey,
      row.issuer,
      row.subject
    ),
    ...(row.address !== undefined ? { address: row.address } : {}),
    userId: row.userId,
    createdAt: new Date("2020-01-01T00:00:00Z"),
  });
}

/** The identity rows a user holds, read straight from the table. */
async function identitiesOf(
  handle: TestNextly,
  userId: string
): Promise<Array<Record<string, unknown>>> {
  // The adapter's filter names columns by their FIELD, as its rows map them
  // back — `userId`, not `user_id` — for the reason the media detach test
  // records: reading the column spelling yields "not found", which reads as
  // "no rows" and is not.
  return (await handle.adapter.select(EXTERNAL_IDENTITIES_TABLE, {
    where: { and: [{ column: "userId", op: "=", value: userId }] },
  })) as Array<Record<string, unknown>>;
}

/**
 * The dialect's own duplicate-key code off a refused write, or none.
 *
 * A driver's code sits NESTED — the adapter's `DatabaseError` wraps a query
 * error wrapping the driver's error — so every level's `code` is collected,
 * and the first one that names a duplicate names it. An errno of 1062 is
 * MySQL's spelling and arrives as a number, so it is translated to the code
 * it is, keeping the assertion one string per dialect.
 */
function duplicateCodeOf(refusal: unknown): string | undefined {
  const seen = new Set<string>();
  let level: unknown = refusal;
  for (let depth = 0; depth < 5 && level; depth += 1) {
    if (typeof level === "object") {
      const record = level as {
        code?: unknown;
        errno?: unknown;
        cause?: unknown;
      };
      if (typeof record.code === "string") seen.add(record.code);
      if (record.errno === 1062) seen.add("ER_DUP_ENTRY");
      level = record.cause;
    } else {
      break;
    }
  }
  for (const code of seen) {
    if (
      code === "ER_DUP_ENTRY" ||
      code === "23505" ||
      code === "SQLITE_CONSTRAINT_UNIQUE"
    ) {
      return code;
    }
  }
  return undefined;
}

/**
 * Whether a value is shaped like a provider token: a JWT (three
 * base64url-legged segments, header starting `eyJ`), a `Bearer` credential, a
 * known provider token prefix, or a long opaque base64url run. What a token
 * IS, rather than where it sits: the table must have nowhere to put one and
 * no row carrying one, and both are asked separately.
 */
function looksLikeToken(value: string): boolean {
  return (
    /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(value) ||
    /^Bearer\s+\S/i.test(value) ||
    /^(sk|pk|rk)-[A-Za-z0-9_-]{8,}$/.test(value) ||
    /^(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}$/.test(value) ||
    /^ya29\.[A-Za-z0-9_-]+$/.test(value) ||
    /^[A-Za-z0-9_-]{60,}$/.test(value)
  );
}

describe.each(getConfiguredTestDialects())(
  "core's external identities (%s)",
  (dialect: TestDialect) => {
    it("creates the table with the identity's own facts", async () => {
      current = await createTestNextly({ dialect });
      const handle = current;

      // The reconcile, not the fixture, is what put the table there: asked
      // of the live database rather than asserted of the declaration.
      expect(await handle.adapter.tableExists(EXTERNAL_IDENTITIES_TABLE)).toBe(
        true
      );

      // The live column set, read from the catalogue: a column beyond the
      // identity's own facts would have to be one this change did not
      // declare, and the exact list names it before anything writes it.
      const columns = await liveColumnsOf(
        handle.adapter.getDrizzle(),
        dialect
      )(EXTERNAL_IDENTITIES_TABLE);
      expect(new Set(columns)).toEqual(
        new Set([
          "id",
          "provider_key",
          "issuer",
          "subject",
          "key_digest",
          "address",
          "user_id",
          "created_at",
        ])
      );
    });

    it("holds one subject from two issuers of one key as two identities", async () => {
      current = await createTestNextly({ dialect });
      const handle = current;

      await handle.adapter.insert("users", {
        id: "staff-one",
        email: "one@test.local",
      });
      await handle.adapter.insert("users", {
        id: "staff-two",
        email: "two@test.local",
      });

      // The same provider key and the same subject, asserted by two
      // issuers: two rows, because which issuer said it is part of who the
      // identity is.
      await insertIdentity(handle, {
        providerKey: "sso/oidc",
        issuer: "https://issuer-one.example",
        subject: "same-subject",
        userId: "staff-one",
        address: "one@example.com",
      });
      await insertIdentity(handle, {
        providerKey: "sso/oidc",
        issuer: "https://issuer-two.example",
        subject: "same-subject",
        userId: "staff-two",
        address: "two@example.com",
      });

      const first = await identitiesOf(handle, "staff-one");
      const second = await identitiesOf(handle, "staff-two");
      // A row each, and the control that the fixture reached the table.
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(first[0]?.issuer).toBe("https://issuer-one.example");
      expect(second[0]?.issuer).toBe("https://issuer-two.example");
    });

    it("holds subjects that differ only by case as two identities", async () => {
      current = await createTestNextly({ dialect });
      const handle = current;

      await handle.adapter.insert("users", {
        id: "staff-one",
        email: "one@test.local",
      });
      await handle.adapter.insert("users", {
        id: "staff-two",
        email: "two@test.local",
      });

      // The same key and the same issuer, subjects differing only by case:
      // two rows. Uniqueness holds by the digest, so a collation cannot
      // fold `Alice` into `alice` — an install's MySQL compares TEXT
      // case-insensitively by default, and a provider's subject is
      // case-sensitive (PostgreSQL and SQLite compare text exactly
      // already, so MySQL is the dialect that would break the promise).
      await insertIdentity(handle, {
        providerKey: "sso/oidc",
        issuer: "https://issuer.example",
        subject: "Alice",
        userId: "staff-one",
      });
      await insertIdentity(handle, {
        providerKey: "sso/oidc",
        issuer: "https://issuer.example",
        subject: "alice",
        userId: "staff-two",
      });

      const first = await identitiesOf(handle, "staff-one");
      const second = await identitiesOf(handle, "staff-two");
      // Both identities stand, each spelled as its provider spelled it.
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(first[0]?.subject).toBe("Alice");
      expect(second[0]?.subject).toBe("alice");
    });

    it("holds subjects that differ only by a trailing space as two identities", async () => {
      current = await createTestNextly({ dialect });
      const handle = current;

      await handle.adapter.insert("users", {
        id: "staff-one",
        email: "one@test.local",
      });
      await handle.adapter.insert("users", {
        id: "staff-two",
        email: "two@test.local",
      });

      // `Alice` and `Alice `: one byte apart at the end. Every MySQL
      // collation — the `_bin` ones included — compares TEXT under PAD
      // SPACE, where trailing spaces are stripped before comparison and
      // these two are THE SAME VALUE; an index over the columns themselves
      // would refuse one of them as a duplicate. The digests differ, and
      // the index reads only the digest, so both stand.
      await insertIdentity(handle, {
        providerKey: "sso/oidc",
        issuer: "https://issuer.example",
        subject: "Alice",
        userId: "staff-one",
      });
      await insertIdentity(handle, {
        providerKey: "sso/oidc",
        issuer: "https://issuer.example",
        subject: "Alice ",
        userId: "staff-two",
      });

      const first = await identitiesOf(handle, "staff-one");
      const second = await identitiesOf(handle, "staff-two");
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(first[0]?.subject).toBe("Alice");
      // Spelled back exactly as asserted in, space and all: PAD SPACE is a
      // comparison rule, not storage, so the row keeps the byte.
      expect(second[0]?.subject).toBe("Alice ");
    });

    it("holds an issuer and a subject longer than any bounded column", async () => {
      current = await createTestNextly({ dialect });
      const handle = current;

      await handle.adapter.insert("users", {
        id: "staff-one",
        email: "one@test.local",
      });

      // An issuer is a URL whose length the provider chooses, and OIDC
      // permits a subject of up to 255 ASCII characters: both longer than
      // the 255 a bounded column would have asked MySQL to accept, and
      // PostgreSQL and SQLite hold unbounded text. With nothing indexed
      // over the columns themselves, no width this table picked refuses a
      // valid identity on one dialect alone.
      const longIssuer = `https://${"i".repeat(300)}.example`;
      const longSubject = "s".repeat(300);
      await insertIdentity(handle, {
        providerKey: "sso/oidc",
        issuer: longIssuer,
        subject: longSubject,
        userId: "staff-one",
      });

      const rows = await identitiesOf(handle, "staff-one");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.issuer).toBe(longIssuer);
      expect(rows[0]?.subject).toBe(longSubject);
    });

    it("refuses a second identity for the same issuerless key and subject", async () => {
      current = await createTestNextly({ dialect });
      const handle = current;

      await handle.adapter.insert("users", {
        id: "staff-one",
        email: "one@test.local",
      });
      await handle.adapter.insert("users", {
        id: "staff-two",
        email: "two@test.local",
      });

      // No issuer: the row carries "" in its place, the one spelling of
      // "no issuer" every writer digests the same way.
      await insertIdentity(handle, {
        providerKey: "sso/oauth",
        issuer: "",
        subject: "issuerless-subject",
        userId: "staff-one",
      });

      // The same key and subject again, for another account and row id:
      // refused BY THE UNIQUE DIGEST, and named as such — any error would
      // satisfy a bare rejects.toThrow, and a width or FK failure is not
      // the uniqueness this test exists to prove. The classifier and the
      // dialect's own code both say duplicate.
      let refusal: unknown;
      try {
        await insertIdentity(handle, {
          providerKey: "sso/oauth",
          issuer: "",
          subject: "issuerless-subject",
          userId: "staff-two",
        });
      } catch (err) {
        refusal = err;
      }
      expect(refusal, "the duplicate insert is refused").toBeDefined();
      expect(isUniqueViolation(refusal)).toBe(true);
      expect(duplicateCodeOf(refusal)).toBe(
        dialect === "mysql"
          ? "ER_DUP_ENTRY"
          : dialect === "postgresql"
            ? "23505"
            : "SQLITE_CONSTRAINT_UNIQUE"
      );

      // The control: a DIFFERENT subject under the same issuerless key is a
      // different identity, so the refusal above was the uniqueness and not
      // the empty issuer itself.
      await insertIdentity(handle, {
        providerKey: "sso/oauth",
        issuer: "",
        subject: "another-subject",
        userId: "staff-two",
      });
      expect(await identitiesOf(handle, "staff-two")).toHaveLength(1);
    });

    it("deletes a user's identities with the account", async () => {
      current = await createTestNextly({ dialect });
      const handle = current;

      await handle.adapter.insert("users", {
        id: "departing",
        email: "departing@test.local",
      });
      await handle.adapter.insert("users", {
        id: "staying",
        email: "staying@test.local",
      });
      await insertIdentity(handle, {
        providerKey: "sso/oidc",
        issuer: "https://issuer.example",
        subject: "departing-subject",
        userId: "departing",
        address: "departing@example.com",
      });
      await insertIdentity(handle, {
        providerKey: "sso/oauth",
        issuer: "",
        subject: "departing-issuerless",
        userId: "departing",
      });
      await insertIdentity(handle, {
        providerKey: "sso/oidc",
        issuer: "https://issuer.example",
        subject: "staying-subject",
        userId: "staying",
      });

      // The fixture control: both of the departing account's identities are
      // stored against it before anything is deleted.
      expect(await identitiesOf(handle, "departing")).toHaveLength(2);

      await handle.nextly.users.delete({ id: "departing" });

      // The account is gone, its identities went with it, and the other
      // account's identity — the control — stayed.
      const remainingUsers = await handle.adapter.select("users", {
        where: { and: [{ column: "id", op: "=", value: "departing" }] },
      });
      expect(remainingUsers).toHaveLength(0);
      expect(await identitiesOf(handle, "departing")).toHaveLength(0);
      expect(await identitiesOf(handle, "staying")).toHaveLength(1);
    });

    it("keeps no value shaped like a provider token", async () => {
      current = await createTestNextly({ dialect });
      const handle = current;

      // The scanner's positive control, and it carries the test: a matcher
      // that flagged nothing would pass over any table, however many tokens
      // it held. Each shape a provider mints is fed to it first.
      const tokens = [
        // A JWT, as an ID token is.
        `eyJ${"a".repeat(40)}.eyJ${"b".repeat(40)}.${"c".repeat(43)}`,
        "Bearer eyJhbGciOiJIUzI1NiJ9.e30.signature",
        `sk-${"k".repeat(48)}`,
        `ghp_${"p".repeat(36)}`,
        `ya29.${"y".repeat(60)}`,
        // An opaque access token: long and base64url, nothing else.
        "t".repeat(64),
      ];
      for (const token of tokens) {
        expect(looksLikeToken(token), token).toBe(true);
      }
      // And the negative control beside it: the values an identity's own
      // facts take are not tokens, or the scan below would cry wolf and say
      // nothing about the table.
      for (const honest of [
        "sso/oidc",
        "https://issuer.example",
        "same-subject",
        "person@example.com",
        randomUUID(),
        String(Date.now()),
      ]) {
        expect(looksLikeToken(honest), honest).toBe(false);
      }

      // Rows shaped as a real hand-off would write them, then every value
      // of every row read back and scanned.
      await handle.adapter.insert("users", {
        id: "token-scan",
        email: "token-scan@test.local",
      });
      await insertIdentity(handle, {
        providerKey: "sso/oidc",
        issuer: "https://issuer.example",
        subject: "1082719283756102937102",
        userId: "token-scan",
        address: "person@example.com",
      });
      await insertIdentity(handle, {
        providerKey: "sso/oauth",
        issuer: "",
        subject: "auth0|655f2a0ee4b0a1c2d3e4f5a6",
        userId: "token-scan",
      });

      const rows = (await handle.adapter.select(
        EXTERNAL_IDENTITIES_TABLE
      )) as Array<Record<string, unknown>>;
      // The control that the scan has rows to scan: an empty read would
      // satisfy it by absence.
      expect(rows.length).toBeGreaterThanOrEqual(2);

      // `keyDigest` is scanned by SHAPE rather than by token likeness: 64
      // lowercase hex is exactly what an opaque 64-character token looks
      // like, so the matcher below cannot tell them apart — but it does not
      // have to. The digest is COMPUTED from the identity's own facts by
      // `externalIdentityKeyDigest`, never received from a provider, and
      // its shape is the proof it holds nothing else.
      for (const row of rows) {
        expect(String(row.keyDigest)).toMatch(/^[0-9a-f]{64}$/);
      }

      const offenders: string[] = [];
      for (const row of rows) {
        for (const [column, value] of Object.entries(row)) {
          if (column === "keyDigest") continue;
          if (typeof value === "string" && looksLikeToken(value)) {
            offenders.push(`${column}=${value.slice(0, 24)}…`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  }
);
