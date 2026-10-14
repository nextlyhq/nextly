import { PasswordTooLongError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { FakePasswordHelper } from "./fake-passwords";

describe("the fake password helper", () => {
  it("verifies the password it hashed, NFC-normalised, and nothing else", async () => {
    const passwords = new FakePasswordHelper();
    const hash = await passwords.hash("café au lait");

    expect(hash.length).toBeLessThanOrEqual(255);
    expect(await passwords.verify("café au lait", hash)).toBe(true);
    expect(await passwords.verify("cafe au lait", hash)).toBe(false);
    expect(await passwords.verify("cafe au lait", "$2b$10$notours")).toBe(
      false
    );
  });

  it("spends a decoy verification on a missing hash", async () => {
    const passwords = new FakePasswordHelper();
    expect(await passwords.verify("anything", null)).toBe(false);
    expect(passwords.decoyVerifications).toBe(1);
  });

  it("asks for a rehash once the scheme moves on", async () => {
    const passwords = new FakePasswordHelper();
    const hash = await passwords.hash("correct horse");
    expect(passwords.needsRehash(hash)).toBe(false);
    passwords.scheme = "fake2";
    expect(passwords.needsRehash(hash)).toBe(true);
    expect(await passwords.verify("correct horse", hash)).toBe(true);
  });

  it("checks length in code points, common passwords, and the breached source", async () => {
    const passwords = new FakePasswordHelper();
    passwords.breached.add("hunter2hunter2");

    expect(await passwords.check("\u{1F600}".repeat(7))).toEqual({
      ok: false,
      reason: "too-short",
    });
    expect(await passwords.check("Password")).toEqual({
      ok: false,
      reason: "common",
    });
    expect(await passwords.check("hunter2hunter2")).toEqual({
      ok: true,
      breachedCheck: "skipped",
    });
    expect(await passwords.check("hunter2hunter2", { breached: true })).toEqual(
      { ok: false, reason: "breached" }
    );
    passwords.breachedSourceUp = false;
    expect(await passwords.check("hunter2hunter2", { breached: true })).toEqual(
      {
        ok: true,
        breachedCheck: "unavailable",
      }
    );
  });

  it("refuses to hash past the ceiling", async () => {
    const passwords = new FakePasswordHelper();
    await expect(passwords.hash("x".repeat(257))).rejects.toBeInstanceOf(
      PasswordTooLongError
    );
    await expect(passwords.hash("x".repeat(256))).resolves.toBeTypeOf("string");
  });
});
