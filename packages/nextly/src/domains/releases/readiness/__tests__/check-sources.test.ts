/**
 * The registry release checks come from.
 *
 * A source is refused at declaration when its key, severity or codes would
 * make its findings ambiguous to a client, and registering a key again
 * replaces it in place: a reload runs each source once, in the order it was
 * first registered.
 */
import { afterEach, describe, expect, it } from "vitest";

import { stopReleasesHolding } from "../../early-stop";
import {
  clearReleaseCheckSourcesForTests,
  defineReleaseCheckSource,
  registerReleaseCheckSource,
  releaseCheckSources,
  type ReleaseCheckSource,
} from "../check-sources";

afterEach(() => clearReleaseCheckSourcesForTests());

function source(
  over: Partial<ReleaseCheckSource<string>> = {}
): ReleaseCheckSource<string> {
  return {
    key: "core.example",
    severity: "hard",
    codes: ["SOMETHING_WRONG"],
    check: async () => [],
    ...over,
  };
}

describe("defineReleaseCheckSource", () => {
  it("accepts a well-formed source and returns it unchanged", () => {
    const declared = source();
    expect(defineReleaseCheckSource(declared)).toBe(declared);
  });

  it.each([
    ["no namespace", "author"],
    ["uppercase", "Core.author"],
    ["an empty name", "core."],
    ["three parts", "core.author.extra"],
  ])("refuses a key with %s", (_case, key) => {
    expect(() => defineReleaseCheckSource(source({ key }))).toThrow(
      expect.objectContaining({ code: "INTERNAL_ERROR" })
    );
  });

  it("refuses a severity outside hard and soft", () => {
    expect(() =>
      defineReleaseCheckSource(
        source({ severity: "fatal" as ReleaseCheckSource["severity"] })
      )
    ).toThrow(expect.objectContaining({ code: "INTERNAL_ERROR" }));
  });

  it.each([
    ["no codes", []],
    ["a code twice", ["SAME", "SAME"]],
    ["a code in lower case", ["not_shouting"]],
  ])("refuses %s", (_case, codes) => {
    expect(() => defineReleaseCheckSource(source({ codes }))).toThrow(
      expect.objectContaining({ code: "INTERNAL_ERROR" })
    );
  });

  it("refuses a hard source outside core that declares no signal", () => {
    // It could add a hard problem no event reports, which a scheduled release
    // would then meet only at its instant.
    expect(() =>
      defineReleaseCheckSource(source({ key: "workflows.approval" }))
    ).toThrow(expect.objectContaining({ code: "INTERNAL_ERROR" }));
  });

  it("accepts a hard source outside core with a signal, and a soft one without", () => {
    const signalled = source({ key: "workflows.approval", signal: () => {} });
    const soft = source({ key: "workflows.note", severity: "soft" });
    expect(defineReleaseCheckSource(signalled)).toBe(signalled);
    expect(defineReleaseCheckSource(soft)).toBe(soft);
  });
});

describe("the registry", () => {
  it("lists sources in the order they were first registered", () => {
    registerReleaseCheckSource(source({ key: "core.first" }));
    registerReleaseCheckSource(source({ key: "core.second" }));
    expect(releaseCheckSources().map(s => s.key)).toEqual([
      "core.first",
      "core.second",
    ]);
  });

  it("replaces a key registered again, keeping its place", () => {
    registerReleaseCheckSource(source({ key: "core.first" }));
    registerReleaseCheckSource(source({ key: "core.second" }));
    const replacement = source({ key: "core.first", severity: "soft" });
    registerReleaseCheckSource(replacement);

    const registered = releaseCheckSources();
    expect(registered.map(s => s.key)).toEqual(["core.first", "core.second"]);
    expect(registered[0]).toBe(replacement);
  });

  it("refuses to register a malformed source", () => {
    expect(() => registerReleaseCheckSource(source({ key: "bad" }))).toThrow(
      expect.objectContaining({ code: "INTERNAL_ERROR" })
    );
    expect(releaseCheckSources()).toEqual([]);
  });

  it("hands a source's signal the early stop when it is registered", () => {
    const handed: unknown[] = [];
    registerReleaseCheckSource(
      source({ key: "workflows.approval", signal: fn => handed.push(fn) })
    );
    expect(handed).toEqual([stopReleasesHolding]);
  });

  it("forgets every source when cleared", () => {
    registerReleaseCheckSource(source());
    clearReleaseCheckSourcesForTests();
    expect(releaseCheckSources()).toEqual([]);
  });
});
