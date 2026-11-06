/**
 * The filters plugins declare for the entry list, checked at start: each is
 * named in its plugin's namespace, offers options with a value and a label,
 * and narrows by a `where` the list read can evaluate. A malformed one stops
 * the app from starting, naming the plugin and the filter; one that passes is
 * what the admin is given, exactly as declared.
 */
import { describe, expect, it } from "vitest";

import { toCliError } from "../../cli/errors";
import type { PluginListFilterDeclaration } from "../admin-contributions";
import { contributedListFilters } from "../admin-filters";
import { buildPluginAdminMeta } from "../admin-meta";
import type { PluginDefinition } from "../plugin-context";
import { resolveDeclaredPlugins } from "../resolve";

const OPEN: PluginListFilterDeclaration = {
  name: "acme-support.state",
  label: "Ticket state",
  collections: ["tickets"],
  options: [
    { value: "open", label: "Open", where: { state: { equals: "open" } } },
    {
      value: "closed",
      label: "Closed",
      where: {
        or: [{ state: { equals: "closed" } }, { state: { equals: "done" } }],
      },
    },
  ],
};

/** A plugin declaring `filters`, as an author writes them. */
function plugin(
  name: string,
  filters: unknown[],
  over: Partial<PluginDefinition> = {}
): PluginDefinition {
  return {
    name,
    version: "1.0.0",
    nextly: "*",
    contributes: {
      admin: { filters: filters as PluginListFilterDeclaration[] },
    },
    ...over,
  };
}

interface Refusal {
  code?: string;
  reason?: string;
  logMessage?: string;
  logContext?: Record<string, unknown>;
}

/** What `fn` refused with, or "not refused". */
function refusalOf(fn: () => unknown): Refusal | "not refused" {
  try {
    fn();
  } catch (error) {
    const { code, logMessage, logContext } = error as {
      code?: string;
      logMessage?: string;
      logContext?: Record<string, unknown>;
    };
    return {
      code,
      reason: logContext?.reason as string | undefined,
      logMessage,
      logContext,
    };
  }
  return "not refused";
}

describe("the filters plugins declare for the entry list", () => {
  it("gives back a plugin's filter as declared, with its owner", () => {
    expect(contributedListFilters([plugin("@acme/support", [OPEN])])).toEqual([
      { ...OPEN, plugin: "@acme/support" },
    ]);
  });

  it("gives back none for a disabled plugin or one that declares none", () => {
    expect(
      contributedListFilters([
        plugin("@acme/support", [OPEN], { enabled: false }),
        { name: "@acme/quiet", version: "1.0.0", nextly: "*" },
      ])
    ).toEqual([]);
  });

  it("refuses a filter outside the plugin's namespace, naming the prefix", () => {
    expect(
      refusalOf(() =>
        contributedListFilters([
          plugin("@acme/support", [{ ...OPEN, name: "other.state" }]),
        ])
      )
    ).toMatchObject({
      code: "PLUGIN_RESOLUTION_ERROR",
      reason: "list-filter-outside-namespace",
      logContext: {
        plugin: "@acme/support",
        filter: "other.state",
        expectedPrefix: "acme-support.",
      },
    });
  });

  it("refuses a filter two plugins or one plugin twice declare", () => {
    expect(
      refusalOf(() =>
        contributedListFilters([plugin("@acme/support", [OPEN, OPEN])])
      )
    ).toMatchObject({
      reason: "list-filter-duplicate",
      logMessage: expect.stringContaining('"acme-support.state" twice'),
      logContext: { plugin: "@acme/support", filter: "acme-support.state" },
    });
  });

  it.each<[string, unknown]>([
    ["a name that is not one", { ...OPEN, name: "acme-support.State" }],
    ["a name that is not a string", { ...OPEN, name: 7 }],
    ["no label", { ...OPEN, label: "  " }],
    ["no options", { ...OPEN, options: [] }],
    ["options that are not a list", { ...OPEN, options: { open: {} } }],
    [
      "an option value a URL can't carry",
      { ...OPEN, options: [{ ...OPEN.options[0], value: "Open now" }] },
    ],
    [
      "an option value with a dot",
      { ...OPEN, options: [{ ...OPEN.options[0], value: "open.now" }] },
    ],
    [
      "two options with one value",
      { ...OPEN, options: [OPEN.options[0], OPEN.options[0]] },
    ],
    [
      "an option with no label",
      { ...OPEN, options: [{ ...OPEN.options[0], label: "" }] },
    ],
    [
      "a where the list read can't evaluate",
      {
        ...OPEN,
        options: [
          { ...OPEN.options[0], where: { state: { sounds_like: "x" } } },
        ],
      },
    ],
    [
      "a where that is not an object",
      { ...OPEN, options: [{ ...OPEN.options[0], where: "state = open" }] },
    ],
    [
      "collections that are not a list of slugs",
      { ...OPEN, collections: "tickets" },
    ],
    ["a declaration that is not an object", "acme-support.state"],
  ])("refuses %s, naming the plugin", (_case, declared) => {
    expect(
      refusalOf(() =>
        contributedListFilters([plugin("@acme/support", [declared])])
      )
    ).toMatchObject({
      code: "PLUGIN_RESOLUTION_ERROR",
      reason: "list-filter-invalid",
      logContext: { plugin: "@acme/support" },
    });
  });

  it("refuses filters that are not a list", () => {
    expect(
      refusalOf(() =>
        contributedListFilters([
          {
            name: "@acme/support",
            version: "1.0.0",
            nextly: "*",
            contributes: { admin: { filters: OPEN as never } },
          },
        ])
      )
    ).toMatchObject({
      reason: "list-filter-invalid",
      logContext: { plugin: "@acme/support" },
    });
  });

  it("refuses to start on a malformed filter", () => {
    expect(
      refusalOf(() =>
        resolveDeclaredPlugins(
          [plugin("@acme/support", [{ ...OPEN, options: [] }])],
          { coreVersion: "1.0.0" }
        )
      )
    ).toMatchObject({
      code: "PLUGIN_RESOLUTION_ERROR",
      reason: "list-filter-invalid",
    });
  });

  it("gives the admin exactly the filters that passed, on an enabled plugin only", () => {
    const [enabled] = buildPluginAdminMeta(
      [plugin("@acme/support", [OPEN])],
      undefined
    );
    expect(enabled?.listFilters).toEqual([
      {
        name: OPEN.name,
        label: OPEN.label,
        collections: OPEN.collections,
        options: OPEN.options,
      },
    ]);
    // A collection the host renamed is named as the admin serves it.
    const [renamed] = buildPluginAdminMeta(
      [
        plugin("@acme/support", [OPEN], {
          renameMap: { tickets: "helpdesk-tickets" },
        }),
      ],
      undefined
    );
    expect(renamed?.listFilters?.[0]?.collections).toEqual([
      "helpdesk-tickets",
    ]);
    const [disabled] = buildPluginAdminMeta(
      [plugin("@acme/support", [OPEN], { enabled: false })],
      undefined
    );
    expect(disabled?.listFilters).toBeUndefined();
  });

  it.each<[string, unknown]>([
    ["list-filter-outside-namespace", { ...OPEN, name: "other.state" }],
    ["list-filter-invalid", { ...OPEN, options: [] }],
  ])(
    "reads %s in the CLI as a plugin resolution error, saying what to do",
    (reason, declared) => {
      let thrown: unknown;
      try {
        contributedListFilters([plugin("@acme/support", [declared])]);
      } catch (error) {
        thrown = error;
      }
      expect(
        (thrown as { logContext?: { reason?: string } }).logContext?.reason
      ).toBe(reason);
      const cli = toCliError(thrown);
      expect(cli.code).toBe("PLUGIN_RESOLUTION_ERROR");
      expect(cli.what).toBe((thrown as { logMessage?: string }).logMessage);
      expect(cli.next.trim()).not.toBe("");
    }
  );

  it("reads list-filter-duplicate in the CLI as a plugin resolution error, saying what to do", () => {
    let thrown: unknown;
    try {
      contributedListFilters([plugin("@acme/support", [OPEN, OPEN])]);
    } catch (error) {
      thrown = error;
    }
    const cli = toCliError(thrown);
    expect(cli.code).toBe("PLUGIN_RESOLUTION_ERROR");
    expect(cli.next.trim()).not.toBe("");
  });
});
