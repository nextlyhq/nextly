/**
 * The contributions plugins add to admin places, checked at start: each is in
 * its plugin's namespace, at a place that exists and takes its kind, well
 * formed for its kind, and orderable with the others there. A faulty one stops
 * the app from starting, naming the plugin and the contribution; the ones that
 * pass come out with each place's lists in order.
 */
import { describe, expect, it } from "vitest";

import { toCliError } from "../../cli/errors";
import type { AdminContribution } from "../admin-contributions";
import { contributedAdminContributions } from "../admin-place-contributions";
import type { PluginDefinition } from "../plugin-context";
import { resolveDeclaredPlugins } from "../resolve";

/** A plugin declaring `contributions`, as an author writes them. */
function plugin(
  name: string,
  contributions: unknown[],
  over: Partial<PluginDefinition> = {}
): PluginDefinition {
  return {
    name,
    version: "1.0.0",
    nextly: "*",
    contributes: {
      admin: { contributions: contributions as AdminContribution[] },
      routes: [
        { method: "POST", path: "/escalate", handler: () => new Response() },
      ],
    },
    ...over,
  };
}

const SECTION = {
  id: "acme-support.sla",
  kind: "sidebarSection",
  place: "collection.edit",
  label: "SLA",
  component: "@acme/support/admin#Sla",
  after: "status",
  collections: ["tickets"],
};

const EACH_KIND: unknown[] = [
  {
    id: "acme-support.totals",
    kind: "block",
    place: "dashboard",
    component: "@acme/support/admin#Totals",
  },
  {
    id: "acme-support.history",
    kind: "tab",
    place: "collection.edit",
    label: "History",
    component: "@acme/support/admin#History",
  },
  SECTION,
  {
    id: "acme-support.owner",
    kind: "column",
    place: "collection.list",
    label: "Owner",
    field: "owner.name",
  },
  {
    id: "acme-support.badge",
    kind: "column",
    place: "collection.list",
    label: "Badge",
    component: "@acme/support/admin#Badge",
  },
  {
    id: "acme-support.escalate",
    kind: "rowAction",
    place: "collection.list",
    label: "Escalate",
    action: { run: { method: "POST", path: "/escalate" } },
    visibleWhen: { field: "status", notEquals: "closed" },
    requiredPermission: "update-tickets",
  },
  {
    id: "acme-support.assign",
    kind: "bulkAction",
    place: "collection.list",
    label: "Assign",
    action: { open: "@acme/support/admin#Assign" },
  },
];

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
    const { code, logMessage, logContext } = error as Refusal;
    return {
      code,
      reason: logContext?.reason as string | undefined,
      logMessage,
      logContext,
    };
  }
  return "not refused";
}

describe("contributedAdminContributions", () => {
  it("accepts one of each kind and orders each place's lists, built-in parts among them", () => {
    const { contributions, ordered } = contributedAdminContributions([
      plugin("@acme/support", EACH_KIND),
    ]);
    expect(contributions.map(c => c.id)).toEqual(
      EACH_KIND.map(c => (c as { id: string }).id)
    );
    expect(contributions.every(c => c.plugin === "@acme/support")).toBe(true);
    expect(ordered.get("collection.edit")?.get("sidebarSection")).toEqual([
      { builtIn: "status" },
      { contribution: "acme-support.sla" },
      { builtIn: "publishing" },
      { builtIn: "language" },
      { builtIn: "details" },
    ]);
    expect(ordered.get("collection.list")?.get("column")).toEqual([
      { contribution: "acme-support.badge" },
      { contribution: "acme-support.owner" },
    ]);
  });

  it("skips a disabled plugin's contributions", () => {
    const { contributions } = contributedAdminContributions([
      plugin("@acme/support", EACH_KIND, { enabled: false }),
    ]);
    expect(contributions).toEqual([]);
  });

  it.each<[string, unknown]>([
    ["a declaration that is not an object", "acme-support.sla"],
    ["an id that is not a name", { ...SECTION, id: "acme-support.SLA" }],
    ["an unknown kind", { ...SECTION, kind: "panel" }],
    ["a key its kind does not take", { ...SECTION, field: "status" }],
    [
      "a misspelled key",
      { ...SECTION, collection: ["tickets"], collections: undefined },
    ],
    ["no place", { ...SECTION, place: undefined }],
    ["no label", { ...SECTION, label: " " }],
    ["no component", { ...SECTION, component: "" }],
    [
      "a column with neither a field nor a component",
      {
        id: "acme-support.c",
        kind: "column",
        place: "collection.list",
        label: "C",
      },
    ],
    [
      "a column with both",
      {
        id: "acme-support.c",
        kind: "column",
        place: "collection.list",
        label: "C",
        field: "a",
        component: "x#Y",
      },
    ],
    [
      "a column on a field that is no name",
      {
        id: "acme-support.c",
        kind: "column",
        place: "collection.list",
        label: "C",
        field: "a b",
      },
    ],
    [
      "an action that is neither open nor run",
      {
        id: "acme-support.a",
        kind: "rowAction",
        place: "collection.list",
        label: "A",
        action: {},
      },
    ],
    [
      "an action that is both",
      {
        id: "acme-support.a",
        kind: "rowAction",
        place: "collection.list",
        label: "A",
        action: { open: "x#Y", run: { method: "POST", path: "/escalate" } },
      },
    ],
    [
      "an action opening nothing",
      {
        id: "acme-support.a",
        kind: "bulkAction",
        place: "collection.list",
        label: "A",
        action: { open: "" },
      },
    ],
    [
      "an action with an unknown method",
      {
        id: "acme-support.a",
        kind: "rowAction",
        place: "collection.list",
        label: "A",
        action: { run: { method: "SEND", path: "/escalate" } },
      },
    ],
    [
      "an action on a route the plugin does not have",
      {
        id: "acme-support.a",
        kind: "rowAction",
        place: "collection.list",
        label: "A",
        action: { run: { method: "POST", path: "/other" } },
      },
    ],
    ["an order that is not a number", { ...SECTION, order: "1" }],
    ["a before that names nothing", { ...SECTION, before: "" }],
    ["a permission that is not one", { ...SECTION, requiredPermission: 7 }],
    [
      "a permission on the login page",
      {
        id: "acme-support.l",
        kind: "block",
        place: "login",
        component: "x#Y",
        requiredPermission: "read-tickets",
      },
    ],
    [
      "collections where no collection is shown",
      {
        id: "acme-support.b",
        kind: "block",
        place: "dashboard",
        component: "x#Y",
        collections: ["tickets"],
      },
    ],
    [
      "a collection slug no collection can have",
      { ...SECTION, collections: ["Tickets"] },
    ],
    [
      "a rule where there is no entry",
      {
        id: "acme-support.b",
        kind: "block",
        place: "dashboard",
        component: "x#Y",
        visibleWhen: { field: "status", equals: "a" },
      },
    ],
    [
      "a rule on a column",
      {
        id: "acme-support.c",
        kind: "column",
        place: "collection.list",
        label: "C",
        field: "a",
        visibleWhen: { field: "status", equals: "a" },
      },
    ],
    [
      "a malformed rule",
      { ...SECTION, visibleWhen: { field: "status", like: "a" } },
    ],
  ])("refuses %s, naming the plugin", (_case, declared) => {
    expect(
      refusalOf(() =>
        contributedAdminContributions([plugin("@acme/support", [declared])])
      )
    ).toMatchObject({
      code: "PLUGIN_RESOLUTION_ERROR",
      reason: "admin-contribution-invalid",
      logContext: { plugin: "@acme/support" },
    });
  });

  it("refuses contributions that are not a list", () => {
    expect(
      refusalOf(() =>
        contributedAdminContributions([
          {
            name: "@acme/support",
            version: "1.0.0",
            nextly: "*",
            contributes: { admin: { contributions: SECTION as never } },
          },
        ])
      )
    ).toMatchObject({ reason: "admin-contribution-invalid" });
  });

  it("refuses a contribution outside the plugin's namespace, naming the prefix", () => {
    expect(
      refusalOf(() =>
        contributedAdminContributions([
          plugin("@acme/support", [{ ...SECTION, id: "other.sla" }]),
        ])
      )
    ).toMatchObject({
      reason: "admin-contribution-outside-namespace",
      logContext: {
        contribution: "other.sla",
        expectedPrefix: "acme-support.",
      },
    });
  });

  it("refuses a contribution one plugin declares twice", () => {
    expect(
      refusalOf(() =>
        contributedAdminContributions([
          plugin("@acme/support", [SECTION, SECTION]),
        ])
      )
    ).toMatchObject({
      reason: "admin-contribution-duplicate",
      logMessage: expect.stringContaining('"acme-support.sla" twice'),
    });
  });

  it("refuses a contribution to a place that does not exist", () => {
    expect(
      refusalOf(() =>
        contributedAdminContributions([
          plugin("@acme/support", [{ ...SECTION, place: "collection.view" }]),
        ])
      )
    ).toMatchObject({
      reason: "admin-place-unknown",
      logContext: { place: "collection.view" },
    });
  });

  it.each<[string, Record<string, unknown>]>([
    [
      "a column on the dashboard",
      {
        id: "acme-support.c",
        kind: "column",
        place: "dashboard",
        label: "C",
        field: "a",
      },
    ],
    [
      "a tab on the entry list",
      {
        id: "acme-support.t",
        kind: "tab",
        place: "collection.list",
        label: "T",
        component: "x#Y",
      },
    ],
    [
      "a side panel section on settings",
      {
        ...SECTION,
        place: "settings",
        collections: undefined,
        after: undefined,
      },
    ],
  ])("refuses %s, which the place does not take", (_case, declared) => {
    const clean = Object.fromEntries(
      Object.entries(declared).filter(([, v]) => v !== undefined)
    );
    expect(
      refusalOf(() =>
        contributedAdminContributions([plugin("@acme/support", [clean])])
      )
    ).toMatchObject({
      reason: "admin-contribution-kind-not-accepted",
      logContext: { contribution: clean.id, place: clean.place },
    });
  });

  it("takes at a plugin's own place the kinds it declares, blocks when it declares none", () => {
    const billing = (accepts?: string[]): PluginDefinition =>
      plugin(
        "@acme/billing",
        [
          {
            id: "acme-billing.lines",
            kind: "tab",
            place: "acme-billing.invoice",
            label: "Lines",
            component: "x#Y",
          },
        ],
        {
          contributes: {
            admin: {
              places: [
                {
                  name: "acme-billing.invoice",
                  ...(accepts ? { accepts } : {}),
                } as never,
              ],
              // A plugin's own place, which a real plugin types by augmenting
              // `AdminPlaces`; this test declares it as plain JavaScript would.
              contributions: [
                {
                  id: "acme-billing.lines",
                  kind: "tab",
                  place: "acme-billing.invoice",
                  label: "Lines",
                  component: "x#Y",
                },
              ] as unknown[] as AdminContribution[],
            },
          },
        }
      );
    expect(
      contributedAdminContributions([billing(["tab"])]).contributions
    ).toHaveLength(1);
    expect(
      refusalOf(() => contributedAdminContributions([billing()]))
    ).toMatchObject({ reason: "admin-contribution-kind-not-accepted" });
    expect(
      refusalOf(() => contributedAdminContributions([billing(["panel"])]))
    ).toMatchObject({ reason: "admin-place-malformed" });
  });

  it("names a route by its mount too, the plugin's own when it says none", () => {
    const routed = (
      mount?: "plugin" | "root",
      run: Record<string, unknown> = {}
    ) =>
      contributedAdminContributions([
        plugin(
          "@acme/support",
          [
            {
              id: "acme-support.a",
              kind: "rowAction",
              place: "collection.list",
              label: "A",
              action: { run: { method: "POST", path: "/escalate", ...run } },
            },
          ],
          {
            contributes: {
              admin: {
                contributions: [
                  {
                    id: "acme-support.a",
                    kind: "rowAction",
                    place: "collection.list",
                    label: "A",
                    action: {
                      run: { method: "POST", path: "/escalate", ...run },
                    },
                  },
                ] as AdminContribution[],
              },
              routes: [
                {
                  method: "POST",
                  path: "/escalate",
                  handler: () => new Response(),
                  ...(mount ? { mount } : {}),
                },
              ],
            },
          }
        ),
      ]);
    // A root-mounted route is not the plugin's own one of the same path.
    expect(refusalOf(() => routed("root"))).toMatchObject({
      reason: "admin-contribution-invalid",
    });
    expect(routed("root", { mount: "root" }).contributions).toHaveLength(1);
    expect(routed(undefined, { mount: "plugin" }).contributions).toHaveLength(
      1
    );
    expect(
      refusalOf(() => routed(undefined, { mount: "elsewhere" }))
    ).toMatchObject({
      reason: "admin-contribution-invalid",
    });
  });

  it("refuses an action that runs a route for a signed-in person rather than staff", () => {
    const action = {
      id: "acme-support.a",
      kind: "rowAction",
      place: "collection.list",
      label: "A",
      action: { run: { method: "POST", path: "/me" } },
    };
    expect(
      refusalOf(() =>
        contributedAdminContributions([
          plugin("@acme/support", [action], {
            contributes: {
              admin: { contributions: [action] as AdminContribution[] },
              routes: [
                {
                  method: "POST",
                  path: "/me",
                  handler: () => new Response(),
                  principal: { kind: "customer" },
                } as never,
              ],
            },
          }),
        ])
      )
    ).toMatchObject({
      reason: "admin-contribution-invalid",
      logMessage: expect.stringContaining("signed-in person"),
    });
  });

  it("takes a permission computed from the plugin's names", () => {
    expect(
      contributedAdminContributions([
        plugin("@acme/support", [
          {
            ...SECTION,
            requiredPermission: ({
              collection,
            }: {
              collection: (s: string, a: string) => string;
            }) => collection("tickets", "update"),
          },
        ]),
      ]).contributions
    ).toHaveLength(1);
  });

  it("refuses contributions that cannot be ordered", () => {
    expect(
      refusalOf(() =>
        contributedAdminContributions([
          plugin(
            "@acme/support",
            [
              { ...SECTION, after: undefined, before: "acme-support.other" },
              {
                ...SECTION,
                id: "acme-support.other",
                after: undefined,
                before: "acme-support.sla",
              },
            ].map(c =>
              Object.fromEntries(
                Object.entries(c).filter(([, v]) => v !== undefined)
              )
            )
          ),
        ])
      )
    ).toMatchObject({
      reason: "contribution-order-cycle",
      logContext: { contributions: ["acme-support.other", "acme-support.sla"] },
    });
  });

  it("refuses to start on a faulty contribution", () => {
    expect(
      refusalOf(() =>
        resolveDeclaredPlugins(
          [plugin("@acme/support", [{ ...SECTION, label: "" }])],
          { coreVersion: "1.0.0" }
        )
      )
    ).toMatchObject({
      code: "PLUGIN_RESOLUTION_ERROR",
      reason: "admin-contribution-invalid",
    });
  });

  it.each<[string, () => unknown]>([
    [
      "admin-contribution-invalid",
      () =>
        contributedAdminContributions([
          plugin("@acme/support", [{ ...SECTION, label: "" }]),
        ]),
    ],
    [
      "admin-contribution-outside-namespace",
      () =>
        contributedAdminContributions([
          plugin("@acme/support", [{ ...SECTION, id: "other.x" }]),
        ]),
    ],
    [
      "admin-contribution-duplicate",
      () =>
        contributedAdminContributions([
          plugin("@acme/support", [SECTION, SECTION]),
        ]),
    ],
    [
      "admin-contribution-kind-not-accepted",
      () =>
        contributedAdminContributions([
          plugin("@acme/support", [
            {
              id: "acme-support.t",
              kind: "tab",
              place: "collection.list",
              label: "T",
              component: "x#Y",
            },
          ]),
        ]),
    ],
    [
      "contribution-order-unknown",
      () =>
        contributedAdminContributions([
          plugin("@acme/support", [{ ...SECTION, after: "nothing" }]),
        ]),
    ],
    [
      "contribution-order-cycle",
      () =>
        contributedAdminContributions([
          plugin(
            "@acme/support",
            [{ ...SECTION, after: undefined, before: "acme-support.sla" }].map(
              c =>
                Object.fromEntries(
                  Object.entries(c).filter(([, v]) => v !== undefined)
                )
            )
          ),
        ]),
    ],
    [
      "contribution-replace-unknown",
      () =>
        contributedAdminContributions([
          plugin(
            "@acme/support",
            [{ ...SECTION, after: undefined, replaces: "owner" }].map(c =>
              Object.fromEntries(
                Object.entries(c).filter(([, v]) => v !== undefined)
              )
            )
          ),
        ]),
    ],
    [
      "contribution-replace-twice",
      () =>
        contributedAdminContributions([
          plugin(
            "@acme/support",
            [
              { ...SECTION, after: undefined, replaces: "status" },
              {
                ...SECTION,
                id: "acme-support.other",
                after: undefined,
                replaces: "status",
              },
            ].map(c =>
              Object.fromEntries(
                Object.entries(c).filter(([, v]) => v !== undefined)
              )
            )
          ),
        ]),
    ],
  ])(
    "reads %s in the CLI as a plugin resolution error, saying what to do",
    (reason, fn) => {
      let thrown: unknown;
      try {
        fn();
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
});
