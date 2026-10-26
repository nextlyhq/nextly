/**
 * What a code rule's answer means, and how a misused filter is reported.
 *
 * The property that separates the classifier from a plausible broken one is
 * that only `true` allows every entry and only a well-formed plain object is
 * a filter: a list, a class instance, a truthy string and a filter with an
 * unknown operator or an empty `in` all refuse.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { consoleLogger } from "../../shared/types";

import {
  clearRuleFilterReports,
  mayAnswerFilter,
  reportRuleFilterMisuse,
  ruleAnswer,
} from "./rule-answer";

const OWN = { author: { equals: "u1" } };

describe("ruleAnswer", () => {
  it("allows on true alone", () => {
    expect(ruleAnswer(true)).toEqual({ kind: "allow" });
    for (const value of [false, null, undefined, 1, "yes", [OWN], new Date()]) {
      expect(ruleAnswer(value), String(value)).toEqual({ kind: "refuse" });
    }
  });

  it("reads a well-formed plain object as a filter", () => {
    expect(ruleAnswer(OWN)).toEqual({ kind: "filter", filter: OWN });
    expect(ruleAnswer({ or: [OWN, { team: { in: ["t1"] } }] }).kind).toBe(
      "filter"
    );
  });

  it.each([
    ["an unknown operator", { slug: { resembles: "x" } }],
    ["an empty in", { slug: { in: [] } }],
    ["an and that is not a list", { and: OWN }],
    ["an object given to equals", { slug: { equals: { a: 1 } } }],
  ])("reads a filter that is not well formed as such: %s", (_name, value) => {
    const answer = ruleAnswer(value);
    expect(answer.kind).toBe("malformed-filter");
    expect(
      answer.kind === "malformed-filter" ? answer.problems.length : 0
    ).toBeGreaterThan(0);
  });

  it.each([
    ["near", { place: { near: "-74.006,40.7128,10000" } }],
    ["within", { place: { within: "-74.006,40.7128,5000" } }],
    [
      "near inside an or",
      { or: [OWN, { place: { near: "-74.006,40.7128,10000" } }] },
    ],
  ])(
    "reads a filter using a geo operator as not well formed: %s",
    (_name, value) => {
      // No read can apply one: it is not expressed in SQL, and a count has no
      // rows to test it on.
      const answer = ruleAnswer(value);
      expect(answer.kind).toBe("malformed-filter");
      expect(
        answer.kind === "malformed-filter"
          ? answer.problems.map(p => p.code)
          : []
      ).toContain("geo-in-rule-filter");
    }
  );

  it("does not mistake a field named like a geo operator for one", () => {
    expect(ruleAnswer({ near: { equals: "x" } }).kind).toBe("filter");
  });
});

describe("mayAnswerFilter", () => {
  it("is a collection's read, update, delete, publish and unpublish only", () => {
    for (const action of ["read", "update", "delete", "publish", "unpublish"]) {
      expect(mayAnswerFilter("collection", action), action).toBe(true);
      expect(mayAnswerFilter("single", action), action).toBe(false);
    }
    expect(mayAnswerFilter("collection", "create")).toBe(false);
  });
});

describe("reportRuleFilterMisuse", () => {
  let logged: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearRuleFilterReports();
    logged = vi.spyOn(consoleLogger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reports a malformed filter once, naming the collection and operation but not the filter", () => {
    const answer = ruleAnswer({ secret: { resembles: "token-123" } });
    reportRuleFilterMisuse("posts", "read", "collection", answer);
    reportRuleFilterMisuse("posts", "read", "collection", answer);

    expect(logged).toHaveBeenCalledTimes(1);
    const message = String(logged.mock.calls[0]?.[0]);
    expect(message).toContain('read rule of "posts"');
    expect(message).not.toContain("token-123");
  });

  it("reports a filter from a create rule or a Single", () => {
    reportRuleFilterMisuse("posts", "create", "collection", ruleAnswer(OWN));
    reportRuleFilterMisuse("settings", "read", "single", ruleAnswer(OWN));
    expect(logged).toHaveBeenCalledTimes(2);
  });

  it("reports nothing for a filter where one belongs, or for a plain answer", () => {
    reportRuleFilterMisuse("posts", "read", "collection", ruleAnswer(OWN));
    reportRuleFilterMisuse("posts", "read", "collection", ruleAnswer(false));
    reportRuleFilterMisuse("posts", "read", "collection", ruleAnswer(true));
    expect(logged).not.toHaveBeenCalled();
  });

  it("raises the misuse as an error in development, and only there", () => {
    const answer = ruleAnswer({ slug: { in: [] } });
    vi.stubEnv("NODE_ENV", "development");
    expect(() =>
      reportRuleFilterMisuse("posts", "read", "collection", answer)
    ).toThrow();
    vi.stubEnv("NODE_ENV", "production");
    expect(() =>
      reportRuleFilterMisuse("posts", "read", "collection", answer)
    ).not.toThrow();
  });
});
