/**
 * How `nextly plugins add` learns what to register from a package: its
 * `nextly.plugin` declaration when it has one, or else the one plugin
 * definition its entry exports; and the options a declaration asks for,
 * given as flags or answered at a prompt.
 */
import { describe, expect, it } from "vitest";

import { CliError } from "../../errors/cli-error";

import {
  entryText,
  pluginFrom,
  readDeclaration,
  registrationFromExports,
  settleOptions,
  type Registration,
} from "./registration";

const PKG = "@acme/seo";

/** A plugin definition, as `definePlugin` returns one. */
const definition = (name = PKG) => ({
  name,
  version: "1.0.0",
  nextly: ">=0.0.0",
});

/** The code of the CLI error `run` throws, or the value it returns. */
async function codeOf(run: () => unknown): Promise<string | unknown> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CliError) return error.code;
    throw error;
  }
}

describe("a package's nextly.plugin declaration", () => {
  it("is absent from a package that declares nothing", () => {
    expect(readDeclaration({ name: PKG })).toEqual({ kind: "none" });
  });

  it("names the export, whether it is called, and the options it asks for", () => {
    expect(
      readDeclaration({
        name: PKG,
        nextly: {
          plugin: {
            export: "seoPlugin",
            call: true,
            options: {
              siteUrl: {
                description: "The site's production address",
                format: "url",
              },
            },
          },
        },
      })
    ).toEqual({
      kind: "declared",
      registration: {
        exportName: "seoPlugin",
        localName: "seoPlugin",
        call: true,
        options: {
          siteUrl: {
            description: "The site's production address",
            format: "url",
          },
        },
      },
    });
  });

  it("binds a default export to a name made from the package's", () => {
    const answer = readDeclaration({
      name: "@acme/nextly-plugin-forms",
      nextly: { plugin: { export: "default" } },
    });
    expect(answer).toMatchObject({
      kind: "declared",
      registration: { exportName: "default", localName: "forms", call: false },
    });
  });

  it.each([
    ["no export", { plugin: {} }],
    ["an export that is not a name", { plugin: { export: "a-b" } }],
    [
      "options without a call",
      { plugin: { export: "a", options: { x: { description: "X" } } } },
    ],
    [
      "an option with no description",
      { plugin: { export: "a", call: true, options: { x: {} } } },
    ],
    [
      "a format it does not know",
      {
        plugin: {
          export: "a",
          call: true,
          options: { x: { description: "X", format: "email" } },
        },
      },
    ],
    ["a key it does not know", { plugin: { export: "a", calls: true } }],
  ])("is invalid with %s", (_, nextly) => {
    expect(readDeclaration({ name: PKG, nextly })).toMatchObject({
      kind: "invalid",
    });
  });
});

describe("a package that declares nothing", () => {
  it("is registered by the one plugin definition it exports", () => {
    expect(
      registrationFromExports(PKG, {
        seoPlugin: definition(),
        helper: () => 1,
        SEO_ID: "seo",
      })
    ).toEqual({
      exportName: "seoPlugin",
      localName: "seoPlugin",
      call: false,
      options: {},
    });
  });

  it("takes the named export over a default export of the same definition", () => {
    const plugin = definition();
    expect(
      registrationFromExports(PKG, { default: plugin, seoPlugin: plugin })
    ).toMatchObject({ exportName: "seoPlugin" });
  });

  it("is not registered when it exports no definition, or several", async () => {
    expect(
      await codeOf(() =>
        registrationFromExports(PKG, { seoPlugin: () => definition() })
      )
    ).toBe("PLUGIN_REGISTRATION_UNKNOWN");
    expect(
      await codeOf(() =>
        registrationFromExports(PKG, { a: definition("a"), b: definition("b") })
      )
    ).toBe("PLUGIN_REGISTRATION_UNKNOWN");
  });
});

const SEO: Registration = {
  exportName: "seoPlugin",
  localName: "seoPlugin",
  call: true,
  options: {
    siteUrl: { description: "The site's production address", format: "url" },
  },
};

describe("the options a declaration asks for", () => {
  it("are taken from --option", async () => {
    expect(
      await settleOptions(PKG, SEO.options, ["siteUrl=https://example.com"])
    ).toEqual({ siteUrl: "https://example.com" });
  });

  it("are asked for when not given, where someone can answer", async () => {
    const asked: string[] = [];
    expect(
      await settleOptions(PKG, SEO.options, [], async name => {
        asked.push(name);
        return "https://example.com";
      })
    ).toEqual({ siteUrl: "https://example.com" });
    expect(asked).toEqual(["siteUrl"]);
  });

  it("refuse a run that leaves one out with no one to ask", async () => {
    expect(await codeOf(() => settleOptions(PKG, SEO.options, []))).toBe(
      "PLUGIN_OPTION_MISSING"
    );
  });

  it.each([
    ["an address with no scheme", "siteUrl=example.com"],
    ["an address that is not on the web", "siteUrl=ftp://example.com"],
    [
      "an option the plugin does not ask for",
      "siteUrl=https://a.test",
      "colour=red",
    ],
    ["a flag with no value", "siteUrl"],
    [
      "one option given twice",
      "siteUrl=https://a.test",
      "siteUrl=https://b.test",
    ],
  ])("refuse %s", async (_, ...given) => {
    expect(await codeOf(() => settleOptions(PKG, SEO.options, given))).toBe(
      "PLUGIN_OPTION_INVALID"
    );
  });

  it("are written into the entry as a literal", () => {
    expect(entryText(SEO, "seo", { siteUrl: 'https://a.test/"x"' })).toBe(
      'seo({ siteUrl: "https://a.test/\\"x\\"" })'
    );
    expect(entryText({ ...SEO, options: {} }, "seo", {})).toBe("seo()");
    expect(entryText({ ...SEO, call: false, options: {} }, "seo", {})).toBe(
      "seo"
    );
  });
});

describe("the plugin a registration makes", () => {
  it("is the export itself, or what calling it with the options returns", async () => {
    expect(
      await pluginFrom(
        PKG,
        { seoPlugin: definition() },
        { ...SEO, call: false, options: {} },
        {}
      )
    ).toMatchObject({ name: PKG });
    const given: unknown[] = [];
    const factory = (options: unknown) => {
      given.push(options);
      return definition();
    };
    expect(
      await pluginFrom(PKG, { seoPlugin: factory }, SEO, {
        siteUrl: "https://a.test",
      })
    ).toMatchObject({ name: PKG });
    expect(given).toEqual([{ siteUrl: "https://a.test" }]);
  });

  it("is refused when the declaration names something that makes no plugin", async () => {
    expect(
      await codeOf(() =>
        pluginFrom(PKG, {}, { ...SEO, call: false, options: {} }, {})
      )
    ).toBe("PLUGIN_DECLARATION_INVALID");
    expect(
      await codeOf(() =>
        pluginFrom(PKG, { seoPlugin: () => ({}) }, SEO, {
          siteUrl: "https://a.test",
        })
      )
    ).toBe("PLUGIN_DECLARATION_INVALID");
  });

  it("is refused, in the plugin's words, when the plugin refuses its options", async () => {
    const refusing = () => {
      throw new Error("siteUrl must use https");
    };
    const error = await pluginFrom(PKG, { seoPlugin: refusing }, SEO, {
      siteUrl: "http://a.test",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe("PLUGIN_OPTION_INVALID");
    expect((error as CliError).why).toContain("siteUrl must use https");
  });
});
