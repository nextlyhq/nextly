import { describe, expect, it, vi } from "vitest";

import { noticeDeprecation } from "../deprecation-notice";

/** A surface no other test names, so the process-wide record cannot carry over. */
let counter = 0;
const surface = () => `oldThing${++counter}()`;

describe("noticeDeprecation", () => {
  it("says the first use, naming the surface and its replacement", () => {
    const sink = vi.fn();
    const old = surface();

    noticeDeprecation({ surface: old, replacement: "newThing()" }, sink);

    expect(sink.mock.calls).toEqual([
      [`[nextly] ${old} is deprecated: use newThing() instead.`],
    ]);
  });

  it("says nothing on a later use of the same surface", () => {
    const sink = vi.fn();
    const old = surface();

    noticeDeprecation({ surface: old, replacement: "newThing()" }, sink);
    noticeDeprecation({ surface: old, replacement: "newThing()" }, sink);
    noticeDeprecation(
      {
        surface: old,
        replacement: "newThing()",
        message: "Said differently, still the same surface.",
      },
      sink
    );

    expect(sink).toHaveBeenCalledTimes(1);
  });

  it("says nothing on a later use through another sink", () => {
    // Once per process, not once per sink: a surface used from two places is
    // still one deprecation to be told about.
    const first = vi.fn();
    const second = vi.fn();
    const old = surface();

    noticeDeprecation({ surface: old, replacement: "newThing()" }, first);
    noticeDeprecation({ surface: old, replacement: "newThing()" }, second);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("says each surface once, so a second surface is told too", () => {
    const sink = vi.fn();
    const first = surface();
    const second = surface();

    noticeDeprecation({ surface: first, replacement: "a()" }, sink);
    noticeDeprecation({ surface: second, replacement: "b()" }, sink);
    noticeDeprecation({ surface: first, replacement: "a()" }, sink);

    expect(sink.mock.calls).toEqual([
      [`[nextly] ${first} is deprecated: use a() instead.`],
      [`[nextly] ${second} is deprecated: use b() instead.`],
    ]);
  });

  it("names the release it is removed in, when given", () => {
    const sink = vi.fn();
    const old = surface();

    noticeDeprecation(
      { surface: old, replacement: "newThing()", removedIn: "1.0" },
      sink
    );

    expect(sink).toHaveBeenCalledWith(
      `[nextly] ${old} is deprecated: use newThing() instead. It is removed in 1.0.`
    );
  });

  it("says the caller's own words in place of the sentence, once for its surface", () => {
    const sink = vi.fn();
    const old = surface();
    const words = `${old} cannot be carried over, so it does nothing: use newThing() instead.`;

    noticeDeprecation(
      { surface: old, replacement: "newThing()", message: words },
      sink
    );
    noticeDeprecation(
      { surface: old, replacement: "newThing()", message: words },
      sink
    );

    expect(sink.mock.calls).toEqual([[`[nextly] ${words}`]]);
  });

  it("says it once across two copies of this module", async () => {
    // A bundle can carry two copies of one module. A record kept in the module
    // would be one per copy, and each copy would say the notice again.
    const sink = vi.fn();
    const old = surface();

    vi.resetModules();
    const one = await import("../deprecation-notice");
    vi.resetModules();
    const other = await import("../deprecation-notice");
    expect(other.noticeDeprecation).not.toBe(one.noticeDeprecation);

    one.noticeDeprecation({ surface: old, replacement: "newThing()" }, sink);
    other.noticeDeprecation({ surface: old, replacement: "newThing()" }, sink);

    expect(sink).toHaveBeenCalledTimes(1);
  });
});
