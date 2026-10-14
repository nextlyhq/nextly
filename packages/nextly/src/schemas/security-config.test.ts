/**
 * The published security schema keeps the breached-password source a site
 * configures. A schema that left it out would strip it on parse, and the
 * check would fall back to the public service the site chose not to use.
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import type { SecurityConfig } from "../shared/types/config";

import { SecurityConfigSchema } from "./security-config";

/** True only when the two types are the same. */
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

// The schema's view of the source and the configuration type are one shape: a
// member added to either without the other fails to compile here.
const sameShape: Same<
  NonNullable<z.infer<typeof SecurityConfigSchema>["breachedPasswords"]>,
  NonNullable<SecurityConfig["breachedPasswords"]>
> = true;

describe("SecurityConfigSchema's breachedPasswords", () => {
  it("keeps a source at an address, with its timeout", () => {
    const breachedPasswords = {
      source: { url: "https://ranges.example/range" },
      timeoutMs: 500,
    };
    expect(SecurityConfigSchema.parse({ breachedPasswords })).toEqual({
      breachedPasswords,
    });
    expect(sameShape).toBe(true);
  });

  it("keeps the site's own list as the same function", () => {
    const range = async (): Promise<readonly string[]> => [];
    const parsed = SecurityConfigSchema.parse({
      breachedPasswords: { source: { range } },
    });
    const source = parsed.breachedPasswords?.source;
    expect(
      typeof source === "object" && "range" in source && source.range
    ).toBe(range);
  });

  it("keeps the public service named", () => {
    expect(
      SecurityConfigSchema.parse({
        breachedPasswords: { source: "pwned-passwords" },
      })
    ).toEqual({ breachedPasswords: { source: "pwned-passwords" } });
  });

  it("refuses a source that is none of the three", () => {
    expect(
      SecurityConfigSchema.safeParse({
        breachedPasswords: { source: "some-other-service" },
      }).success
    ).toBe(false);
  });
});
