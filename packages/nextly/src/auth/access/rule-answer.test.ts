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
});

describe("ruleAnswer, for an answer that is not plain data", () => {
  it("refuses a class instance, which is not a filter's data", () => {
    class Answer {
      slug = { equals: "x" };
    }
    for (const value of [
      new Map(),
      new URL("https://example.com"),
      new Answer(),
    ]) {
      expect(ruleAnswer(value), String(value)).toEqual({ kind: "refuse" });
    }
    // POPULATION CONTROL: a plain object, and one with no prototype at all,
    // are read as filters.
    expect(ruleAnswer({ ...OWN }).kind).toBe("filter");
    expect(ruleAnswer(Object.assign(Object.create(null), OWN)).kind).toBe(
      "filter"
    );
  });

  it("reads a filter that refers to itself, or nests without end, as not well formed rather than failing", () => {
    const cyclic: Record<string, unknown> = { slug: { equals: "x" } };
    cyclic.and = [cyclic];
    let deep: Record<string, unknown> = OWN;
    for (let i = 0; i < 5000; i++) deep = { and: [deep] };
    for (const value of [cyclic, deep]) {
      expect(ruleAnswer(value).kind).toBe("malformed-filter");
    }
  });

  it("reads an answer once, and hands on the copy it read, which no later change to the answer reaches", () => {
    let reads = 0;
    const shifting = {
      get slug() {
        reads += 1;
        return reads <= 1 ? { equals: "x" } : undefined;
      },
    };
    const meaning = ruleAnswer(shifting);
    expect(reads).toBe(1);
    expect(meaning).toEqual({
      kind: "filter",
      filter: { slug: { equals: "x" } },
    });
    const shared = { slug: { equals: "a" } };
    const read = ruleAnswer(shared);
    shared.slug.equals = "b";
    expect(read).toEqual({ kind: "filter", filter: { slug: { equals: "a" } } });
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

  it("names no key of the filter either, which a rule may have built from the caller's data", () => {
    const answer = ruleAnswer({ "someone@example.com": { resembles: "x" } });
    reportRuleFilterMisuse("posts", "read", "collection", answer);
    const message = String(logged.mock.calls[0]?.[0]);
    expect(message).toContain('read rule of "posts"');
    expect(message).not.toContain("someone@example.com");
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
