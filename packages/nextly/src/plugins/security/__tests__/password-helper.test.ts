/**
 * The password helper a plugin receives as `ctx.security.passwords`.
 *
 * It hashes every character of a password, NFC-normalised, with scrypt in a
 * format that names its algorithm and setting; it verifies only hashes it
 * wrote, spending a real verification's time when there is none; and it
 * checks a new password by length and lists, never by kinds of characters.
 */
import { randomBytes, scryptSync } from "node:crypto";
import { cpus } from "node:os";

import { describe, expect, it, vi } from "vitest";

import { COMMON_PASSWORDS } from "../common-passwords";
import {
  createPasswordHelper,
  PasswordTooLongError,
  type PasswordHelper,
} from "../password-helper";

function helper(warn = vi.fn()): PasswordHelper {
  return createPasswordHelper({ logger: { warn } });
}

/** The parts of a hash in the helper's documented format. */
function parts(hash: string) {
  const match = /^\$scrypt\$ln=(\d+),r=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(
    hash
  );
  if (!match) throw new Error(`not in the documented format: ${hash}`);
  return {
    ln: Number(match[1]),
    r: Number(match[2]),
    p: Number(match[3]),
    salt: Buffer.from(match[4] ?? "", "base64"),
    key: Buffer.from(match[5] ?? "", "base64"),
  };
}

/** A hash in the helper's format at another of its settings, as an earlier release would have written. */
function hashAtSetting(
  password: string,
  setting: { ln: number; r: number; p: number }
): string {
  const salt = randomBytes(16);
  const N = 2 ** setting.ln;
  const key = scryptSync(Buffer.from(password.normalize("NFC")), salt, 32, {
    N,
    r: setting.r,
    p: setting.p,
    maxmem: 128 * N * setting.r + 1024 * 1024,
  });
  const b64 = (bytes: Buffer) => bytes.toString("base64").replace(/=+$/, "");
  return `$scrypt$ln=${setting.ln},r=${setting.r},p=${setting.p}$${b64(salt)}$${b64(key)}`;
}

/** A staff password hash, as core's own bcrypt writes it. */
const BCRYPT_HASH =
  "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";

describe("hashing and verifying", () => {
  it("verifies the password it hashed, and no other", async () => {
    const passwords = helper();
    const hash = await passwords.hash("correct horse battery staple");
    expect(await passwords.verify("correct horse battery staple", hash)).toBe(
      true
    );
    expect(await passwords.verify("correct horse battery stapler", hash)).toBe(
      false
    );
    expect(passwords.needsRehash(hash)).toBe(false);
  });

  it("uses every character: two passwords differing only past the 72nd byte never verify against each other", async () => {
    const passwords = helper();
    const shared = "a".repeat(80);
    const hash = await passwords.hash(`${shared}x`);
    expect(await passwords.verify(`${shared}y`, hash)).toBe(false);
    expect(await passwords.verify(`${shared}x`, hash)).toBe(true);
  });

  it("hashes a password at the 256-code-point ceiling, refuses one past it, and never cuts one to fit", async () => {
    const passwords = helper();
    expect(passwords.ceiling).toBe(256);
    const atCeiling = "b".repeat(256);
    const hash = await passwords.hash(atCeiling);
    expect(await passwords.verify(atCeiling, hash)).toBe(true);

    const pastCeiling = `${atCeiling}c`;
    await expect(passwords.hash(pastCeiling)).rejects.toBeInstanceOf(
      PasswordTooLongError
    );
    await expect(passwords.hash(pastCeiling)).rejects.toThrow(/too long/);
    // Cut to the ceiling it would match the hash above; it must not.
    expect(await passwords.verify(pastCeiling, hash)).toBe(false);
  });

  it("writes scrypt at an OWASP setting within 64 MiB, deriving 32 bytes, as at most 255 ASCII characters naming both", async () => {
    const hash = await helper().hash("correct horse battery staple");
    const { ln, r, p, key } = parts(hash);
    // OWASP's Password Storage Cheat Sheet: N = 2^15, r = 8, p = 3.
    expect({ ln, r, p }).toEqual({ ln: 15, r: 8, p: 3 });
    expect(128 * 2 ** ln * r).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(key.length).toBeGreaterThanOrEqual(32);
    expect(hash.length).toBeLessThanOrEqual(255);
    expect(hash).toMatch(/^[\x21-\x7e]+$/);
  });

  it("hashes within a second on this machine, and says how long it took", async () => {
    const passwords = helper();
    const times: number[] = [];
    for (let round = 0; round < 5; round++) {
      const start = performance.now();
      await passwords.hash("correct horse battery staple");
      times.push(performance.now() - start);
    }
    const median = [...times].sort((a, b) => a - b)[2] ?? 0;
    // Printed so a CI run records the setting's cost on its runners.
    console.info(
      `[password-helper] scrypt N=2^15 r=8 p=3: median ${median.toFixed(0)} ms a hash on ${cpus()[0]?.model ?? "an unknown CPU"}, Node ${process.version}`
    );
    // A guard against a setting far heavier than intended, not a benchmark.
    expect(median).toBeLessThan(1000);
  });

  it("salts every hash with 16 or more fresh bytes, so equal passwords never share a hash", async () => {
    const passwords = helper();
    const first = await passwords.hash("correct horse battery staple");
    const second = await passwords.hash("correct horse battery staple");
    expect(first).not.toBe(second);
    expect(parts(first).salt.length).toBeGreaterThanOrEqual(16);
    expect(parts(first).salt.equals(parts(second).salt)).toBe(false);
    expect(await passwords.verify("correct horse battery staple", first)).toBe(
      true
    );
    expect(await passwords.verify("correct horse battery staple", second)).toBe(
      true
    );
  });
});

describe("hashes from other settings and formats", () => {
  it("verifies a hash at an earlier setting, and answers that it needs rehashing", async () => {
    const passwords = helper();
    const earlier = hashAtSetting("correct horse battery staple", {
      ln: 14,
      r: 8,
      p: 5,
    });
    expect(
      await passwords.verify("correct horse battery staple", earlier)
    ).toBe(true);
    expect(passwords.needsRehash(earlier)).toBe(true);
  });

  it("answers that a bcrypt hash needs rehashing, and never verifies against it", async () => {
    const passwords = helper();
    expect(passwords.needsRehash(BCRYPT_HASH)).toBe(true);
    expect(await passwords.verify("password", BCRYPT_HASH)).toBe(false);
  });

  it("answers false without throwing for a malformed hash or a setting it would not run, and logs neither hash nor password", async () => {
    const warn = vi.fn();
    const passwords = helper(warn);
    const password = "correct horse battery staple";
    const unbounded = hashAtSetting(password, { ln: 10, r: 8, p: 1 }).replace(
      "ln=10",
      "ln=30"
    );
    for (const stored of [BCRYPT_HASH, "", "$scrypt$ln=15", unbounded]) {
      await expect(passwords.verify(password, stored)).resolves.toBe(false);
    }
    expect(warn).toHaveBeenCalledTimes(4);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(password);
    // Every stored value, not only the bcrypt one, so a log that redacts one
    // kind of hash and prints the others is caught.
    for (const stored of [BCRYPT_HASH, "$scrypt$ln=15", unbounded]) {
      expect(logged).not.toContain(stored);
    }
    expect(logged).not.toContain("R9h/cIPz0gi");
  });

  it("spends a real verification's time when there is no stored hash, and answers false", async () => {
    const passwords = helper();
    const hash = await passwords.hash("correct horse battery staple");
    const time = async (stored: string | null) => {
      const start = performance.now();
      await passwords.verify("a guess at a password", stored);
      return performance.now() - start;
    };
    const real: number[] = [];
    const decoy: number[] = [];
    for (let round = 0; round < 7; round++) {
      real.push(await time(hash));
      decoy.push(await time(null));
    }
    // Each side's fastest run, not its median. Other test files share the
    // machine's CPU, which only ever adds time to a run, so the fastest of
    // several is the closest to what each derivation costs, while a decoy that
    // skipped the derivation would still be far faster on every run. Stated
    // tolerance: the two fastest runs within 35% of each other.
    const fastestReal = Math.min(...real);
    expect(Math.abs(Math.min(...decoy) - fastestReal)).toBeLessThanOrEqual(
      0.35 * fastestReal
    );
    expect(await passwords.verify("a guess at a password", null)).toBe(false);
  });
});

describe("ill-formed Unicode", () => {
  // JSON can carry a lone surrogate as an escape. UTF-8 encoding replaces each
  // with U+FFFD, so two different passwords would hash alike.
  const lone = `${"x".repeat(10)}\ud800`;
  const replaced = `${"x".repeat(10)}\ufffd`;

  it("is refused by hash and check with a validation error", async () => {
    const passwords = helper();
    for (const attempt of [passwords.hash(lone), passwords.check(lone)]) {
      const error = await attempt.catch((caught: unknown) => caught);
      expect(JSON.stringify(error)).toMatch(/not well-formed Unicode/);
    }
  });

  it("never verifies against the hash of the character it would collapse to", async () => {
    const passwords = helper();
    const hash = await passwords.hash(replaced);
    expect(await passwords.verify(replaced, hash)).toBe(true);
    expect(await passwords.verify(lone, hash)).toBe(false);
  });
});

describe("normalisation", () => {
  it("verifies a composed and a decomposed form alike, and keeps a full-width form distinct", async () => {
    const passwords = helper();
    const composed = "café au lait, s'il vous plaît";
    const decomposed = composed.normalize("NFD");
    expect(decomposed).not.toBe(composed);
    // Both ways round, so the normalisation in `hash` and in `verify` are
    // each needed: hashing the composed form alone needs only the second.
    expect(
      await passwords.verify(decomposed, await passwords.hash(composed))
    ).toBe(true);
    expect(
      await passwords.verify(composed, await passwords.hash(decomposed))
    ).toBe(true);

    const ordinary = "Password-for-the-shop";
    const fullWidth = "Ｐassword-for-the-shop";
    const ordinaryHash = await passwords.hash(ordinary);
    expect(await passwords.verify(fullWidth, ordinaryHash)).toBe(false);
  });

  it("counts length in code points, an astral character as one", async () => {
    const passwords = helper();
    // Each of these is one code point and two UTF-16 units.
    const eight = "\u{1F600}".repeat(8);
    const seven = "\u{1F600}".repeat(7);
    expect(eight.length).toBe(16);
    expect(await passwords.check(eight)).toEqual({
      ok: true,
      breachedCheck: "skipped",
    });
    expect(await passwords.check(seven)).toEqual({
      ok: false,
      reason: "too-short",
    });
    expect(
      await passwords.check("\u{1F600}".repeat(64), { maxLength: 64 })
    ).toEqual({ ok: true, breachedCheck: "skipped" });
  });

  it("checks a password's length after NFC: seven accented letters, decomposed, are seven", async () => {
    const decomposed = "é".repeat(7).normalize("NFD");
    expect([...decomposed].length).toBe(14);
    expect(await helper().check(decomposed)).toEqual({
      ok: false,
      reason: "too-short",
    });
  });
});

describe("rules for a new password", () => {
  it("goes by length and the common list, never by kinds of characters", async () => {
    const passwords = helper();
    expect(await passwords.check("short")).toEqual({
      ok: false,
      reason: "too-short",
    });
    expect(await passwords.check("x".repeat(129))).toEqual({
      ok: false,
      reason: "too-long",
    });
    expect(await passwords.check("x".repeat(20), { minLength: 21 })).toEqual({
      ok: false,
      reason: "too-short",
    });
    expect(await passwords.check("x".repeat(65), { maxLength: 64 })).toEqual({
      ok: false,
      reason: "too-long",
    });
    // Lowercase letters only, and long: accepted.
    expect(
      await passwords.check("lowercase letters only and nothing else at all")
    ).toEqual({ ok: true, breachedCheck: "skipped" });
  });

  it("refuses a listed common password in another case", async () => {
    const passwords = helper();
    expect(COMMON_PASSWORDS).toContain("password1");
    expect(await passwords.check("PassWord1")).toEqual({
      ok: false,
      reason: "common",
    });
  });

  it("ships at least 3,000 common passwords, each of 8 or more code points and lower-cased", () => {
    expect(COMMON_PASSWORDS.length).toBeGreaterThanOrEqual(3000);
    expect(new Set(COMMON_PASSWORDS).size).toBe(COMMON_PASSWORDS.length);
    for (const entry of COMMON_PASSWORDS) {
      expect([...entry].length).toBeGreaterThanOrEqual(8);
      expect(entry).toBe(entry.toLowerCase());
    }
  });

  it.each([
    [{ minLength: 7 }, /minLength must be a whole number from 8 to 64/],
    [{ minLength: 65 }, /minLength must be a whole number from 8 to 64/],
    [{ maxLength: 63 }, /maxLength must be a whole number from 64 to 256/],
    [{ maxLength: 257 }, /maxLength must be a whole number from 64 to 256/],
  ])("refuses rules outside their bounds: %j", async (rules, message) => {
    const error = await helper()
      .check("a long enough password", rules)
      .catch((caught: unknown) => caught);
    expect(JSON.stringify(error)).toMatch(message);
  });

  it.each([
    [{ minLength: 8 }],
    [{ minLength: 64, maxLength: 64 }],
    [{ maxLength: 256 }],
  ])("accepts rules at their bounds: %j", async rules => {
    await expect(helper().check("x".repeat(64), rules)).resolves.toMatchObject({
      ok: true,
    });
  });
});
