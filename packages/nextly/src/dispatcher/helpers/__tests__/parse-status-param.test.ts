/**
 * `?status=` parsing contract: absent resolves to `undefined` (the query
 * service then applies its published-only default), recognized values pass
 * through, and an unrecognized value is REJECTED with a 400 rather than
 * silently widened — so a typo can never change what a read returns.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import { parseStatusParam } from "../validation";

describe("parseStatusParam", () => {
  it("returns undefined when the param is absent (service applies its default)", () => {
    expect(parseStatusParam(undefined)).toBeUndefined();
    expect(parseStatusParam(null)).toBeUndefined();
    expect(parseStatusParam("")).toBeUndefined();
  });

  it("passes recognized values through", () => {
    expect(parseStatusParam("all")).toBe("all");
    expect(parseStatusParam("draft")).toBe("draft");
    expect(parseStatusParam("published")).toBe("published");
  });

  it("rejects an unrecognized value with a 400 validation error", () => {
    let thrown: unknown;
    try {
      parseStatusParam("lol-injection");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NextlyError);
    expect((thrown as NextlyError).statusCode).toBe(400);
  });

  it("rejects a near-miss typo rather than silently defaulting", () => {
    expect(() => parseStatusParam("pubished")).toThrow(NextlyError);
    expect(() => parseStatusParam("PUBLISHED")).toThrow(NextlyError);
  });
});
