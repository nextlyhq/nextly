/**
 * The digester asks the app's hasher first, whatever a stored value looks
 * like, and falls back to core's bcrypt for a value from before the hasher.
 */
import { describe, expect, it, vi } from "vitest";

import { passwordDigester } from "./digester";
import { hashPassword, verifyPassword } from "./index";
import type { PasswordHasher } from "./policy";

describe("passwordDigester with an app's hasher", () => {
  it("verifies a hasher's own bcrypt-shaped output with the hasher, though it declares no isHash", async () => {
    // A peppered bcrypt: its values look exactly like core's.
    const peppered: PasswordHasher = {
      hash: password => hashPassword(`pepper:${password}`, 4),
      verify: (password, stored) =>
        verifyPassword(`pepper:${password}`, stored),
      reach: 64,
    };
    const digester = passwordDigester(peppered);
    const stored = await digester.hash("Str0ng-P@ssw0rd!");
    expect(await digester.verify("Str0ng-P@ssw0rd!", stored)).toEqual({
      ok: true,
      rehash: false,
    });
    expect(await digester.verify("wrong-password", stored)).toEqual({
      ok: false,
    });
  });

  it("verifies core's bcrypt from before the hasher, and asks for it to be stored again", async () => {
    const own: PasswordHasher = {
      hash: password => Promise.resolve(`own$${password}`),
      verify: (password, stored) =>
        Promise.resolve(stored === `own$${password}`),
      reach: "unbounded",
      isHash: stored => stored.startsWith("own$"),
    };
    const digester = passwordDigester(own);
    const coreEra = await hashPassword("Str0ng-P@ssw0rd!", 4);
    expect(await digester.verify("Str0ng-P@ssw0rd!", coreEra)).toEqual({
      ok: true,
      rehash: true,
    });
  });

  it("asks the hasher once on every refusal, as on a value it holds", async () => {
    const verify = vi.fn((password: string, stored: string) =>
      Promise.resolve(stored === `own$${password}`)
    );
    const digester = passwordDigester({
      hash: password => Promise.resolve(`own$${password}`),
      verify,
      reach: "unbounded",
      isHash: stored => stored.startsWith("own$"),
    });
    await digester.verify("wrong", "own$right");
    await digester.verify("anything", "stored as given");
    await digester.decoy("anything");
    expect(verify).toHaveBeenCalledTimes(3);
  });
});
