/**
 * Where a standalone plugin's rail item lands: the landing it names, else the
 * first collection its panel lists for the reader, else the first menu item
 * the panel lists, else nowhere (`#`, which opens the panel).
 *
 * The property that separates it from the rule it replaced is a plugin whose
 * first DECLARED collection is not the panel's first: hidden, unreadable, or
 * ordered further down. Landing on the declared first sends the reader to a
 * list the panel does not offer them.
 */
import { describe, expect, it } from "vitest";

import { buildCapabilities } from "@admin/hooks/useCurrentUserPermissions";
import type { PluginMetadata } from "@admin/types/branding";
import type { CapabilitiesResponse } from "@admin/types/permissions";

import {
  type StandalonePanelCollection,
  standalonePluginCollections,
} from "../lib/standalone-plugin-collections";
import {
  type StandaloneLandingReader,
  standalonePluginLanding,
} from "../lib/standalone-plugin-landing";

/**
 * The server's answer: the reader may read exactly `readable`, and create
 * entries in exactly `creatable`.
 */
function answering(
  slugs: readonly string[],
  readable: readonly string[],
  creatable: readonly string[] = []
): CapabilitiesResponse {
  return {
    isSuperAdmin: false,
    validUntil: null,
    entities: Object.fromEntries(
      slugs.map(slug => [
        slug,
        {
          kind: "collection" as const,
          read: readable.includes(slug),
          create: creatable.includes(slug),
          // The create the admin sends, with no language, which the create
          // page's guard asks.
          createInDefaultLanguage: creatable.includes(slug),
          update: false,
          delete: false,
          publish: false,
          unpublish: false,
        },
      ])
    ),
  };
}

/** A plugin collection as the collections query returns one. */
function collection(
  name: string,
  admin: { hidden?: boolean; order?: number } = {}
): StandalonePanelCollection {
  return { name, label: name, admin: { isPlugin: true, ...admin } };
}

const COLLECTIONS = [
  collection("forms"),
  collection("submissions"),
  collection("archive", { hidden: true }),
];

function reader(
  readable: readonly string[],
  permissions: readonly string[] = [],
  creatable: readonly string[] = []
): StandaloneLandingReader {
  return {
    collections: COLLECTIONS,
    capabilities: buildCapabilities(
      [],
      false,
      answering(
        COLLECTIONS.map(c => c.name),
        readable,
        creatable
      )
    ),
    can: permission => permissions.includes(permission),
  };
}

const MENU: PluginMetadata["menu"] = [
  { label: "Reports", to: "/admin/plugins/forms/reports", order: 20 },
  {
    label: "Settings",
    to: "/admin/plugins/forms/settings",
    order: 10,
    requiredPermission: "manage-forms",
  },
];

function plugin(overrides: Partial<PluginMetadata> = {}): PluginMetadata {
  return {
    name: "Forms",
    placement: "standalone",
    collections: ["forms", "submissions"],
    menu: MENU,
    pages: [
      { path: "reports", component: "@acme/forms/admin#Reports" },
      {
        path: "settings",
        component: "@acme/forms/admin#Settings",
        requiredPermission: "manage-forms",
      },
    ],
    ...overrides,
  };
}

describe("standalonePluginLanding", () => {
  it("goes to the landing the plugin names, ahead of its collections", () => {
    const landing = "/admin/plugins/forms/reports";
    expect(
      standalonePluginLanding(
        plugin({ landing }),
        reader(["forms", "submissions"])
      )
    ).toBe(landing);
  });

  it("goes to a landing page that needs a permission the reader holds", () => {
    const landing = "/admin/plugins/forms/settings?tab=general";
    expect(
      standalonePluginLanding(
        plugin({ landing }),
        reader(["forms", "submissions"], ["manage-forms"])
      )
    ).toBe(landing);
  });

  it("falls through a landing page whose permission the reader lacks", () => {
    expect(
      standalonePluginLanding(
        plugin({ landing: "/admin/plugins/forms/settings" }),
        reader(["submissions"])
      )
    ).toBe("/admin/collections/submissions");
    // And on to the menu with no collection to open: past the gated Settings
    // item too, to the first the reader may open.
    expect(
      standalonePluginLanding(
        plugin({ landing: "/admin/plugins/forms/settings", collections: [] }),
        reader([])
      )
    ).toBe("/admin/plugins/forms/reports");
  });

  it("goes to a landing collection the reader may read", () => {
    expect(
      standalonePluginLanding(
        plugin({ landing: "/admin/collections/submissions" }),
        reader(["forms", "submissions"])
      )
    ).toBe("/admin/collections/submissions");
  });

  it("falls through a landing collection the reader may not read", () => {
    expect(
      standalonePluginLanding(
        plugin({ landing: "/admin/collections/forms?status=draft" }),
        reader(["submissions"])
      )
    ).toBe("/admin/collections/submissions");
    expect(
      standalonePluginLanding(
        plugin({ landing: "/admin/collections/forms", collections: ["forms"] }),
        reader([])
      )
    ).toBe("/admin/plugins/forms/reports");
  });

  it("asks of a landing collection address what its route asks, not only a read", () => {
    const createForms = plugin({ landing: "/admin/collections/forms/create" });
    // A reader who may read forms but not create one is refused by the create
    // route's guard, so the rail opens the list instead.
    expect(standalonePluginLanding(createForms, reader(["forms"]))).toBe(
      "/admin/collections/forms"
    );
    expect(
      standalonePluginLanding(createForms, reader(["forms"], [], ["forms"]))
    ).toBe("/admin/collections/forms/create");
  });

  it("goes to the first collection in the panel's order, not the first declared", () => {
    const ordered = [
      collection("forms", { order: 50 }),
      collection("submissions", { order: 10 }),
    ];
    const both = reader(["forms", "submissions"]);
    // The control: the panel lists submissions first too.
    expect(
      standalonePluginCollections(plugin(), ordered, both.capabilities).map(
        c => c.name
      )
    ).toEqual(["submissions", "forms"]);
    expect(
      standalonePluginLanding(plugin(), { ...both, collections: ordered })
    ).toBe("/admin/collections/submissions");
  });

  it("skips a first-declared collection the reader may not read", () => {
    expect(standalonePluginLanding(plugin(), reader(["submissions"]))).toBe(
      "/admin/collections/submissions"
    );
  });

  it("skips a first-declared collection that is hidden", () => {
    expect(
      standalonePluginLanding(
        plugin({ collections: ["archive", "forms"] }),
        reader(["archive", "forms"])
      )
    ).toBe("/admin/collections/forms");
  });

  it("goes to the first visible menu item when every collection is hidden", () => {
    expect(
      standalonePluginLanding(
        plugin({ collections: ["archive"] }),
        reader(["archive"])
      )
    ).toBe("/admin/plugins/forms/reports");
  });

  it("goes to the first visible menu item, in the panel's order, with no collection", () => {
    const none = plugin({ collections: [] });
    // Settings sorts first, and is offered only to a reader who may manage.
    expect(standalonePluginLanding(none, reader([], ["manage-forms"]))).toBe(
      "/admin/plugins/forms/settings"
    );
    expect(standalonePluginLanding(none, reader([]))).toBe(
      "/admin/plugins/forms/reports"
    );
  });

  it("ignores a menu item listed in another section's panel", () => {
    expect(
      standalonePluginLanding(
        plugin({
          collections: [],
          menu: [
            {
              label: "Elsewhere",
              to: "/admin/plugins/forms/x",
              section: "settings",
            },
          ],
        }),
        reader([])
      )
    ).toBe("#");
  });

  it("opens the panel when there is nothing to go to", () => {
    expect(
      standalonePluginLanding(
        plugin({ collections: [], menu: undefined }),
        reader([])
      )
    ).toBe("#");
  });
});
