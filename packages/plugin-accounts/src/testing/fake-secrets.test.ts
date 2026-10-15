import { describe, expect, it } from "vitest";

import { fakeAccountsCore } from "./fake-core";

const MINUTE = 60_000;
const subject = "account-1";

describe("the fake one-purpose tokens", () => {
  it("spends a token once, and a peek spends nothing", async () => {
    const { secrets } = fakeAccountsCore();
    const { token } = await secrets.mintToken({
      purpose: "verify",
      subject,
      expiresInMs: MINUTE,
      data: { n: 1 },
    });

    expect(await secrets.peekToken({ purpose: "verify", token })).toMatchObject(
      { ok: true, subject }
    );
    expect(await secrets.consumeToken({ purpose: "verify", token })).toEqual({
      ok: true,
      subject,
      data: { n: 1 },
    });
    expect(await secrets.consumeToken({ purpose: "verify", token })).toEqual({
      ok: false,
      reason: "spent",
    });
  });

  it("knows a token only for its own purpose, and not past its expiry", async () => {
    const core = fakeAccountsCore();
    const { token } = await core.secrets.mintToken({
      purpose: "verify",
      subject,
      expiresInMs: MINUTE,
    });

    expect(
      await core.secrets.consumeToken({ purpose: "reset", token })
    ).toEqual({ ok: false, reason: "invalid" });
    core.clock.advance(MINUTE);
    expect(
      await core.secrets.consumeToken({ purpose: "verify", token })
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("voids the earlier tokens of a purpose when asked, and voidFor voids the rest", async () => {
    const { secrets } = fakeAccountsCore();
    const first = await secrets.mintToken({
      purpose: "verify",
      subject,
      expiresInMs: MINUTE,
    });
    const second = await secrets.mintToken({
      purpose: "verify",
      subject,
      expiresInMs: MINUTE,
      voidEarlier: true,
    });
    const other = await secrets.mintToken({
      purpose: "reset",
      subject,
      expiresInMs: MINUTE,
    });

    // A voided token is no token at all, as core answers it.
    expect(
      await secrets.consumeToken({ purpose: "verify", token: first.token })
    ).toEqual({ ok: false, reason: "invalid" });
    expect(await secrets.voidFor({ subject })).toEqual({ voided: 2 });
    expect(
      await secrets.consumeToken({ purpose: "verify", token: second.token })
    ).toMatchObject({ ok: false });
    expect(
      await secrets.consumeToken({ purpose: "reset", token: other.token })
    ).toMatchObject({ ok: false });
  });
});

describe("the fake codes", () => {
  it("counts wrong tries down to a void code, then answers none, and spends a right one once", async () => {
    const { secrets } = fakeAccountsCore();
    const { code } = await secrets.mintCode({
      purpose: "verify",
      subject,
      expiresInMs: 10 * MINUTE,
      maxWrongTries: 2,
    });
    const wrong = code === "000000" ? "000001" : "000000";

    expect(
      await secrets.consumeCode({ purpose: "verify", subject, code: wrong })
    ).toEqual({
      ok: false,
      reason: "wrong",
      triesLeft: 1,
    });
    expect(
      await secrets.consumeCode({ purpose: "verify", subject, code })
    ).toEqual({ ok: true, data: null });
    expect(
      await secrets.consumeCode({ purpose: "verify", subject, code })
    ).toEqual({ ok: false, reason: "spent" });

    const again = await secrets.mintCode({
      purpose: "verify",
      subject,
      expiresInMs: 10 * MINUTE,
      maxWrongTries: 1,
    });
    const miss = again.code === "000000" ? "000001" : "000000";
    expect(
      await secrets.consumeCode({ purpose: "verify", subject, code: miss })
    ).toMatchObject({ triesLeft: 0 });
    expect(
      await secrets.consumeCode({
        purpose: "verify",
        subject,
        code: again.code,
      })
    ).toEqual({
      // Its tries run out, the code is void and there is none to try, as
      // core answers it.
      ok: false,
      reason: "none",
    });
  });

  it("never mints a code that repeats the live one it replaces, as core does", async () => {
    const { secrets } = fakeAccountsCore();
    const draws = ["123456", "123456", "123456", "654321"];
    secrets.drawCode = () => draws.shift() ?? "000000";
    const code = { purpose: "verify", subject, expiresInMs: 10 * MINUTE };

    const first = await secrets.mintCode({ ...code, maxWrongTries: 3 });
    const second = await secrets.mintCode({ ...code, maxWrongTries: 3 });

    expect(first.code).toBe("123456");
    expect(second.code).toBe("654321");
  });

  it("voids the earlier code when a new one is minted", async () => {
    const { secrets } = fakeAccountsCore();
    const first = await secrets.mintCode({
      purpose: "verify",
      subject,
      expiresInMs: 10 * MINUTE,
      maxWrongTries: 5,
    });
    const second = await secrets.mintCode({
      purpose: "verify",
      subject,
      expiresInMs: 10 * MINUTE,
      maxWrongTries: 5,
    });

    if (first.code !== second.code) {
      expect(
        await secrets.consumeCode({
          purpose: "verify",
          subject,
          code: first.code,
        })
      ).toMatchObject({
        reason: "wrong",
      });
    }
    expect(
      await secrets.consumeCode({
        purpose: "verify",
        subject,
        code: second.code,
      })
    ).toMatchObject({ ok: true });
  });

  it("answers none for a subject with no code, and expired past its time", async () => {
    const core = fakeAccountsCore();
    expect(
      await core.secrets.consumeCode({
        purpose: "verify",
        subject,
        code: "123456",
      })
    ).toEqual({
      ok: false,
      reason: "none",
    });
    const { code } = await core.secrets.mintCode({
      purpose: "verify",
      subject,
      expiresInMs: 5 * MINUTE,
      maxWrongTries: 5,
    });
    core.clock.advance(5 * MINUTE);
    expect(
      await core.secrets.consumeCode({ purpose: "verify", subject, code })
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses what core refuses: a bad purpose, a long expiry, too many tries", async () => {
    const { secrets } = fakeAccountsCore();
    await expect(
      secrets.mintToken({ purpose: "Verify", subject, expiresInMs: MINUTE })
    ).rejects.toThrow(/purpose/);
    await expect(
      secrets.mintCode({
        purpose: "verify",
        subject,
        expiresInMs: 61 * MINUTE,
        maxWrongTries: 5,
      })
    ).rejects.toThrow(/expiresInMs/);
    await expect(
      secrets.mintCode({
        purpose: "verify",
        subject,
        expiresInMs: MINUTE,
        maxWrongTries: 11,
      })
    ).rejects.toThrow(/maxWrongTries/);
  });
});
