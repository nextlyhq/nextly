/**
 * `definePlugin` refuses a name that is not well-formed Unicode: the name keys what the plugin
 * stores, and two names differing only in lone surrogates would key alike.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import { definePlugin } from "../plugin-context";

const plugin = (name: string) =>
  definePlugin({ name, version: "1.0.0", nextly: ">=0.0.0" });

describe("a plugin's name", () => {
  it("is refused when it holds a lone surrogate", () => {
    for (const name of ["\ud800", "@acme/\udc00-tools"]) {
      let refused: unknown;
      try {
        plugin(name);
      } catch (error) {
        refused = error;
      }
      expect(NextlyError.isCode(refused, "CONFIGURATION_ERROR")).toBe(true);
    }
  });

  it("is kept when it is well-formed, astral characters included", () => {
    expect(plugin("@acme/tools").name).toBe("@acme/tools");
    expect(plugin("@acme/\u{1F600}").name).toBe("@acme/\u{1F600}");
  });
});
