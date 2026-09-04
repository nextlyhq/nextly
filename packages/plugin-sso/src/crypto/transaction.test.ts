import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { derivePurposeKey, TRANSACTION_KEY_LABEL } from "./keys";
import {
  InvalidTransactionError,
  mintTransaction,
  readTransactionCookie,
  serializeClearTransactionCookie,
  serializeTransactionCookie,
  transactionCookieName,
  verifyTransaction,
  type TransactionRecord,
} from "./transaction";

const SECRET = "test-secret-value-long-enough-to-be-realistic";

const record: TransactionRecord = {
  provider: "google",
  state: "state-0123456789abcdef",
  nonce: "nonce-value",
  verifier: "verifier-value",
  next: "/admin/collections/posts",
};

function requestWithCookie(header: string): Request {
  return new Request("https://cms.example/admin/api", {
    headers: { cookie: header },
  });
}

describe("mintTransaction / verifyTransaction", () => {
  it("round-trips every field", async () => {
    const token = await mintTransaction(record, SECRET);
    await expect(
      verifyTransaction(token, SECRET, record.state)
    ).resolves.toEqual(record);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await mintTransaction(record, SECRET);
    await expect(
      verifyTransaction(token, "another-secret", record.state)
    ).rejects.toBeInstanceOf(InvalidTransactionError);
  });

  it("rejects an expired transaction", async () => {
    const token = await mintTransaction(record, SECRET, -1);
    await expect(
      verifyTransaction(token, SECRET, record.state)
    ).rejects.toBeInstanceOf(InvalidTransactionError);
  });

  it("rejects a tampered payload", async () => {
    const token = await mintTransaction(record, SECRET);
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...record, typ: "sso-transaction", next: "//evil" })
    ).toString("base64url");
    await expect(
      verifyTransaction(
        `${header}.${forged}.${signature}`,
        SECRET,
        record.state
      )
    ).rejects.toBeInstanceOf(InvalidTransactionError);
  });

  it("rejects a token carrying the wrong typ", async () => {
    const key = derivePurposeKey(SECRET, TRANSACTION_KEY_LABEL);
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ ...record, typ: "not-a-transaction" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(key);
    await expect(
      verifyTransaction(token, SECRET, record.state)
    ).rejects.toThrow(/wrong-type/);
  });

  it("rejects a token missing required fields", async () => {
    const key = derivePurposeKey(SECRET, TRANSACTION_KEY_LABEL);
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      typ: "sso-transaction",
      state: record.state,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(key);
    await expect(
      verifyTransaction(token, SECRET, record.state)
    ).rejects.toThrow(/malformed/);
  });

  it("rejects an unsigned token", async () => {
    const payload = Buffer.from(
      JSON.stringify({ ...record, typ: "sso-transaction" })
    ).toString("base64url");
    const header = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" })
    ).toString("base64url");
    await expect(
      verifyTransaction(`${header}.${payload}.`, SECRET, record.state)
    ).rejects.toBeInstanceOf(InvalidTransactionError);
  });
});

describe("state binding", () => {
  /**
   * A transaction that verifies cryptographically but belongs to a different
   * authorization request is exactly what the CSRF `state` exists to catch, so
   * the comparison lives inside verification rather than at the call site.
   */
  it("rejects a valid transaction whose state is not the one echoed back", async () => {
    const token = await mintTransaction(record, SECRET);
    await expect(
      verifyTransaction(token, SECRET, "a-different-state-value")
    ).rejects.toThrow(/state-mismatch/);
  });

  it("rejects a state of the right length but the wrong value", async () => {
    const token = await mintTransaction(record, SECRET);
    const sameLength = "X".repeat(record.state.length);
    await expect(verifyTransaction(token, SECRET, sameLength)).rejects.toThrow(
      /state-mismatch/
    );
  });
});

describe("transactionCookieName", () => {
  it("derives a distinct name per transaction", () => {
    expect(transactionCookieName("aaaaaaaabbbb")).not.toBe(
      transactionCookieName("ccccccccdddd")
    );
  });

  it("is stable for one state", () => {
    expect(transactionCookieName(record.state)).toBe(
      transactionCookieName(record.state)
    );
  });
});

describe("serializeTransactionCookie", () => {
  it("marks the cookie HttpOnly, Lax and scoped to /admin", () => {
    const header = serializeTransactionCookie(record.state, "value", false);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/admin");
    expect(header).toContain("Max-Age=600");
  });

  it("omits Secure outside production so local http development works", () => {
    expect(serializeTransactionCookie(record.state, "v", false)).not.toContain(
      "Secure"
    );
  });

  it("sets Secure in production", () => {
    expect(serializeTransactionCookie(record.state, "v", true)).toContain(
      "Secure"
    );
  });

  it("expires the cookie when clearing it", () => {
    expect(serializeClearTransactionCookie(record.state)).toContain(
      "Max-Age=0"
    );
  });
});

describe("readTransactionCookie", () => {
  it("returns null when the request carries no cookies", () => {
    const req = new Request("https://cms.example/admin/api");
    expect(readTransactionCookie(req, record.state)).toBeNull();
  });

  it("finds this transaction among several cookies", () => {
    const name = transactionCookieName(record.state);
    const req = requestWithCookie(
      `nextly_session=abc; ${name}=the-value; other=1`
    );
    expect(readTransactionCookie(req, record.state)).toBe("the-value");
  });

  it("does not match a cookie whose name merely ends with ours", () => {
    const name = transactionCookieName(record.state);
    const req = requestWithCookie(`prefix_${name}=wrong`);
    expect(readTransactionCookie(req, record.state)).toBeNull();
  });

  it("keeps two concurrent transactions separate", () => {
    const first = { ...record, state: "aaaaaaaa-first" };
    const second = { ...record, state: "bbbbbbbb-second" };
    const req = requestWithCookie(
      `${transactionCookieName(first.state)}=one; ` +
        `${transactionCookieName(second.state)}=two`
    );
    expect(readTransactionCookie(req, first.state)).toBe("one");
    expect(readTransactionCookie(req, second.state)).toBe("two");
  });

  it("round-trips a percent-encoded value", () => {
    const name = transactionCookieName(record.state);
    const req = requestWithCookie(`${name}=${encodeURIComponent("a b+c")}`);
    expect(readTransactionCookie(req, record.state)).toBe("a b+c");
  });
});
