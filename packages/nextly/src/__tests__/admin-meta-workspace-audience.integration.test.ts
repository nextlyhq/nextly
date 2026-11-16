/**
 * The workspace payload tells a reader about exactly the widgets the layout
 * endpoint would place for them, through the real catch-all handler and the
 * real permission decision.
 *
 * A widget declaration is its whole content: its description is prose a
 * reader is told. Filtering the payload in the browser is not a control -- the JSON is
 * what a signed-in caller can fetch -- so this asserts the WIRE: a caller
 * lacking a widget's gate never receives its declaration, and a caller holding
 * it does. The caller is an API key rather than a session
 * because a key is judged on its own stamped grants, which makes "holds" and
 * "lacks" two keys minted from the same role table rather than two mocks.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, text } from "../config";
import type { WidgetDefinition } from "../domains/widgets/definition";
import { clearWidgets, registerWidget } from "../domains/widgets/registry";
import { definePlugin } from "../plugins/plugin-context";
import { createTestNextly, type TestNextly } from "../plugins/test-nextly";
import { createDynamicHandlers } from "../routeHandler";
import { sanitizeConfig } from "../shared/types/config";

const NOTES = "notes";
const EVENTS = "events";

const notes = defineCollection({
  slug: NOTES,
  fields: [text({ name: "title" })],
});

/**
 * A second collection, so a key can hold a grant that says nothing about notes.
 * Two of its fields carry a read rule: one that lets every reader read it and
 * one that lets nobody. A card's settings may offer neither, whoever asks.
 */
const events = defineCollection({
  slug: EVENTS,
  fields: [
    text({ name: "title" }),
    text({ name: "budget", access: { read: () => true } }),
    text({ name: "secret", access: { read: () => false } }),
  ],
});

/** A Collection setting defaulting to events. */
const PINNED_TO_EVENTS: NonNullable<WidgetDefinition["settings"]>[number] = {
  name: "source",
  label: "Collection",
  type: "collection",
  defaultValue: EVENTS,
};

/** The prose the gated cards describe themselves with -- what must never reach the wrong reader. */
const RUNBOOK = "## Runbook\n\nRotate the keys before a release.";
const EDITORS_ONLY = "Editors: the queue drains at midnight.";

/** The plugin whose collections the widgets below read and are gated on. */
const contributor = definePlugin({
  name: "@test/notes-widgets",
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    collections: [notes, events],
  },
});

/**
 * Widgets over those collections, each gated its own way, registered after
 * boot as core's own cards are.
 */
const NOTES_WIDGETS: WidgetDefinition[] = [
  // Ungated: any authenticated reader. The population control -- a
  // filter that withholds everything satisfies every absence below.
  {
    id: "notes/welcome",
    title: "Welcome",
    archetype: "metric",
    size: { default: { w: 4, h: 3 } },
    description: "Welcome to the notes desk.",
  },
  // Gated on a grant the read-only key HOLDS.
  {
    id: "notes/runbook",
    title: "Runbook",
    archetype: "metric",
    size: { default: { w: 4, h: 3 } },
    requiredPermission: `read-${NOTES}`,
    description: RUNBOOK,
  },
  // Gated on a grant it LACKS.
  {
    id: "notes/editors",
    title: "For editors",
    archetype: "metric",
    size: { default: { w: 4, h: 3 } },
    requiredPermission: `create-${NOTES}`,
    description: EDITORS_ONLY,
  },
  // An empty state whose action carries a gate of its own.
  {
    id: "notes/shortcuts",
    title: "Shortcuts",
    archetype: "list",
    size: { default: { w: 3, h: 2 } },
    empty: {
      message: "No drafts waiting",
      action: {
        label: "Publish queue",
        link: "/admin/collections/notes?status=draft",
        requiredPermission: `publish-${NOTES}`,
      },
    },
  },
  // Its Collection setting defaults to events, which a key holding only
  // read on notes may not read.
  {
    id: "notes/pinned",
    title: "Pinned",
    archetype: "metric",
    size: { default: { w: 3, h: 2 } },
    settings: [PINNED_TO_EVENTS],
  },
];

interface WorkspaceDeclaration {
  id: string;
  description?: string;
  settings?: { name: string; defaultValue?: unknown }[];
  empty?: { message?: string; action?: { label: string } };
}

interface WorkspaceBody {
  widgets?: WorkspaceDeclaration[];
  widgetSources?: { collection: string; fields: { name: string }[] }[];
  plugins?: { name: string; widgets?: WorkspaceDeclaration[] }[];
  widgetAudience?: string;
  /** The running server's dev-reload answer — the emission pinned below. */
  devReload?: boolean;
}

async function workspace(headers: Record<string, string>): Promise<Response> {
  // The route reads the plugin list from the config the route module stored,
  // overlaid with what boot produced; without the stored half there is no
  // plugin projection at all, whatever booted.
  const handlers = createDynamicHandlers({
    config: sanitizeConfig({
      collections: [],
      plugins: [contributor],
    }),
  });
  return handlers.GET(
    new Request("http://localhost/api/admin-meta/workspace", {
      method: "GET",
      headers,
    }),
    { params: Promise.resolve({ params: ["admin-meta", "workspace"] }) }
  );
}

async function workspaceFor(key: string): Promise<WorkspaceBody> {
  const res = await workspace({ authorization: `Bearer ${key}` });
  expect(res.status).toBe(200);
  return (await res.json()) as WorkspaceBody;
}

/** The layout read, through the same catch-all and the same stored config. */
async function layoutFor(key: string): Promise<{ audience?: string }> {
  const handlers = createDynamicHandlers({
    config: sanitizeConfig({
      collections: [],
      plugins: [contributor],
    }),
  });
  const res = await handlers.GET(
    new Request("http://localhost/api/dashboard/layout", {
      method: "GET",
      headers: { authorization: `Bearer ${key}` },
    }),
    { params: Promise.resolve({ params: ["dashboard", "layout"] }) }
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { audience?: string };
}

let handle: TestNextly | undefined;
/** The instance's first user, created once: the super admin every key is minted by. */
let ownerId: string | undefined;

beforeEach(async () => {
  handle = await createTestNextly({
    collections: [],
    plugins: [contributor],
  });
  // Registered after boot, as core's own cards are registered.
  for (const widget of NOTES_WIDGETS) {
    registerWidget(widget, { source: "@test/notes-widgets" });
  }
  registerWidget(
    {
      id: "app/ops-notes",
      title: "Ops notes",
      archetype: "metric",
      size: { default: { w: 4, h: 3 } },
      requiredPermission: `create-${NOTES}`,
      description: EDITORS_ONLY,
    },
    { source: "@test/app" }
  );
  registerWidget(
    {
      id: "app/board",
      title: "Board",
      archetype: "metric",
      size: { default: { w: 4, h: 3 } },
      description: "The board meets on Mondays.",
    },
    { source: "@test/app" }
  );
  registerWidget(
    {
      id: "app/tools",
      title: "Tools",
      archetype: "list",
      size: { default: { w: 3, h: 2 } },
      empty: {
        message: "Nothing to publish",
        action: {
          label: "Bulk publish",
          link: "/admin/bulk",
          requiredPermission: `publish-${NOTES}`,
        },
      },
    },
    { source: "@test/app" }
  );
});

afterEach(async () => {
  clearWidgets();
  await handle?.destroy();
  handle = undefined;
  ownerId = undefined;
});

/**
 * A key holding exactly the grants named, minted by the super-admin first
 * user through the same role table the product reads.
 *
 * One owner per instance, because a key may not hold more than its owner
 * does and only the FIRST user of an instance is the super admin: a second
 * owner would be refused any grant, and the case minting two keys would be
 * refused for a reason it is not about.
 */
async function keyHolding(slugs: string[]): Promise<string> {
  const nextly = handle!.nextly as unknown as {
    users: {
      create: (a: { data: Record<string, unknown> }) => Promise<{
        item: { id: string };
      }>;
    };
    permissions: {
      find: (a: { limit: number }) => Promise<{
        items: { id: string; slug: string }[];
      }>;
    };
    roles: {
      create: (a: { data: Record<string, unknown> }) => Promise<{
        item: { id: string };
      }>;
    };
  };

  if (ownerId === undefined) {
    const owner = await nextly.users.create({
      data: {
        email: "owner@example.com",
        password: "Password123!",
        name: "Owner",
        isActive: true,
      },
    });
    ownerId = owner.item.id;
  }

  const permissions = await nextly.permissions.find({ limit: 300 });
  const ids = slugs.map(slug => {
    const found = permissions.items.find(p => p.slug === slug);
    expect(
      found,
      `\`${slug}\` must be seeded, or the role below grants nothing and every ` +
        "absence here is for the wrong reason"
    ).toBeDefined();
    return found!.id;
  });

  const role = await nextly.roles.create({
    data: {
      name: `Role ${slugs.join(" ")}`,
      slug: `r-${slugs.join("-")}`,
      permissionIds: ids,
    },
  });

  const apiKeys = handle!.getService("apiKeyService") as unknown as {
    createApiKey: (
      userId: string,
      input: {
        name: string;
        tokenType: string;
        roleId?: string;
        expiresIn: string;
      }
    ) => Promise<{ key: string }>;
  };
  const { key } = await apiKeys.createApiKey(ownerId, {
    name: `key ${slugs.join(" ")}`,
    tokenType: "role-based",
    roleId: role.item.id,
    expiresIn: "never",
  });
  return key;
}

const ids = (widgets: readonly { id: string }[] | undefined) =>
  (widgets ?? []).map(widget => widget.id);

/** Every widget declaration the payload carries, core's and each plugin's. */
function everyDeclaration(body: WorkspaceBody) {
  return [
    ...(body.widgets ?? []),
    ...(body.plugins ?? []).flatMap(plugin => plugin.widgets ?? []),
  ];
}

describe("GET /api/admin-meta/workspace, per reader", () => {
  it("withholds a gated declaration, and its prose, from a reader lacking the grant", async () => {
    const body = await workspaceFor(await keyHolding([`read-${NOTES}`]));

    // The population, first: the reader IS told about the cards open to any
    // authenticated caller and the ones whose gate they hold. Without this, an
    // empty payload passes every absence below.
    expect(ids(body.widgets)).toEqual(
      expect.arrayContaining([
        "notes/welcome",
        "notes/runbook",
        "notes/shortcuts",
        "notes/pinned",
        "app/board",
        "app/tools",
      ])
    );

    // Then the absences, and on the PROSE rather than only the id: the whole
    // declaration is what must not ship.
    const declarations = everyDeclaration(body);
    expect(ids(declarations)).not.toContain("notes/editors");
    expect(ids(declarations)).not.toContain("app/ops-notes");
    expect(declarations.map(widget => widget.description)).not.toContain(
      EDITORS_ONLY
    );
    // And the prose they MAY read is there, which is what separates a gate
    // from a projection that dropped `description` on the way out.
    expect(declarations.map(widget => widget.description)).toContain(RUNBOOK);
  });

  it("withholds a Collection setting's default naming a collection the reader may not read", async () => {
    registerWidget(
      {
        id: "app/pinned",
        title: "Pinned",
        archetype: "metric",
        size: { default: { w: 3, h: 2 } },
        settings: [
          {
            name: "source",
            label: "Collection",
            type: "collection",
            defaultValue: EVENTS,
          },
        ],
      },
      { source: "@test/app" }
    );
    const defaults = (body: WorkspaceBody) =>
      ["notes/pinned", "app/pinned"].map(
        id =>
          everyDeclaration(body)
            .find(widget => widget.id === id)
            ?.settings?.find(setting => setting.name === "source")?.defaultValue
      );

    // 🔴 The slug is a collection this key may not read: shipped as declared,
    // the payload names it whether or not the reader holds a card.
    const lacking = await workspaceFor(await keyHolding([`read-${NOTES}`]));
    expect(ids(everyDeclaration(lacking))).toEqual(
      expect.arrayContaining(["notes/pinned", "app/pinned"])
    );
    expect(defaults(lacking)).toEqual([undefined, undefined]);
    expect(
      JSON.stringify(
        everyDeclaration(lacking).filter(widget =>
          ["notes/pinned", "app/pinned"].includes(widget.id)
        )
      )
    ).not.toContain(`"${EVENTS}"`);

    // The control: a key that may read events is shipped both defaults.
    const holding = await workspaceFor(
      await keyHolding([`read-${NOTES}`, `read-${EVENTS}`])
    );
    expect(defaults(holding)).toEqual([EVENTS, EVENTS]);
  });

  it("withholds an empty-state action whose own gate the reader lacks", async () => {
    // 🔴 The action is a label and a link. The card's gate held, so the
    // whole empty state shipped and the browser hid the protected action
    // afterwards -- readable from the payload regardless.
    const lacking = await workspaceFor(await keyHolding([`read-${NOTES}`]));
    const empty = (body: WorkspaceBody, id: string) =>
      everyDeclaration(body).find(widget => widget.id === id)?.empty;
    // The card itself ships, its message with it; only the action is withheld.
    expect(empty(lacking, "notes/shortcuts")).toEqual({
      message: "No drafts waiting",
    });
    expect(empty(lacking, "app/tools")).toEqual({
      message: "Nothing to publish",
    });

    // The control: the grant held, the same empty states are whole.
    const holding = await workspaceFor(
      await keyHolding([`read-${NOTES}`, `publish-${NOTES}`])
    );
    expect(empty(holding, "notes/shortcuts")?.action?.label).toBe(
      "Publish queue"
    );
    expect(empty(holding, "app/tools")?.action?.label).toBe("Bulk publish");
  });

  it("ships the same declarations to a reader holding the grant", async () => {
    const body = await workspaceFor(
      await keyHolding([`read-${NOTES}`, `create-${NOTES}`])
    );

    expect(ids(body.widgets)).toEqual(
      expect.arrayContaining([
        "notes/welcome",
        "notes/runbook",
        "notes/editors",
        "notes/shortcuts",
        "notes/pinned",
        "app/board",
        "app/ops-notes",
      ])
    );
    expect(everyDeclaration(body).map(widget => widget.description)).toContain(
      EDITORS_ONLY
    );
  });

  it("ships no widget per collection, to a reader who may read every collection", async () => {
    // 🔴 A card about one collection is a core widget set to it, so the
    // payload names no widget after a collection: none in the per-collection
    // or per-Single namespaces, whichever collections the reader may read.
    const body = await workspaceFor(
      await keyHolding([`read-${NOTES}`, `read-${EVENTS}`])
    );

    const shipped = ids(everyDeclaration(body));
    expect(
      shipped.filter(
        id => id.startsWith("collection/") || id.startsWith("single/")
      )
    ).toEqual([]);
    // The control: the Content widget a collection is reached through ships,
    // with the ungated declarations, so the absence above is not an empty
    // payload.
    expect(shipped).toEqual(
      expect.arrayContaining(["core/count", "notes/welcome", "app/board"])
    );
  });

  it("offers a card's content settings only the collections the reader may read", async () => {
    // A reader who may read `events` alone. The collection it may read is
    // offered, which is the population: the absence of the other is a gate on
    // one collection, not a payload that offers none.
    const body = await workspaceFor(await keyHolding([`read-${EVENTS}`]));

    const offered = (body.widgetSources ?? []).map(source => source.collection);
    expect(offered).toContain(EVENTS);
    expect(offered).not.toContain(NOTES);
  });

  it("never offers a card's settings a field with a read rule, even one that lets this reader read it", async () => {
    const body = await workspaceFor(await keyHolding([`read-${EVENTS}`]));
    const fields = (body.widgetSources ?? [])
      .find(source => source.collection === EVENTS)
      ?.fields.map(field => field.name);
    // The population: the collection is offered, and so is its plain field, so
    // the absences below are the read rules' and not an empty field list.
    expect(fields).toContain("title");
    expect(fields).not.toContain("budget");
    expect(fields).not.toContain("secret");
  });

  it("carries the audience token the layout read reports for the same reader", async () => {
    // 🔴 The admin holds this payload for minutes, and compares its token
    // with the layout's to learn the payload was built for a different
    // audience -- a grant landed, a role changed. That only works if the two
    // responses report ONE token for one reader.
    const reader = await keyHolding([`read-${NOTES}`]);
    const [body, layout] = [
      await workspaceFor(reader),
      await layoutFor(reader),
    ];
    expect(body.widgetAudience).toEqual(expect.any(String));
    expect(body.widgetAudience).toBe(layout.audience);
  });

  it("carries a different token for a reader told about different cards, or only a different empty-state action", async () => {
    // The must-differ controls: a token that never moved would satisfy the
    // equality above. The second key differs from the first only in an
    // empty-state ACTION's grant -- the same cards -- which is the change a
    // token of the cards alone could not report.
    const base = await workspaceFor(await keyHolding([`read-${NOTES}`]));
    const moreCards = await workspaceFor(
      await keyHolding([`read-${NOTES}`, `create-${NOTES}`])
    );
    const moreShortcuts = await workspaceFor(
      await keyHolding([`read-${NOTES}`, `publish-${NOTES}`])
    );
    expect(moreCards.widgetAudience).not.toBe(base.widgetAudience);
    expect(moreShortcuts.widgetAudience).not.toBe(base.widgetAudience);
  });

  it("still refuses an unauthenticated caller", async () => {
    const res = await workspace({});
    expect(res.status).toBe(401);
  });
});

describe("GET /api/admin-meta/workspace, devReload", () => {
  // The admin client dials the dev-reload stream only on an explicit
  // `devReload === true` from THIS payload, so the emission itself is the
  // wire the whole fix consumes — and deleting its one line must turn these
  // red with every other suite green. Both legs stubbed with `vi.stubEnv`:
  // `NODE_ENV` is read-only in this package's types.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers true while the runtime is development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const body = await workspaceFor(await keyHolding([`read-${NOTES}`]));
    expect(body.devReload).toBe(true);
  });

  it("answers false once the runtime leaves development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const body = await workspaceFor(await keyHolding([`read-${NOTES}`]));
    expect(body.devReload).toBe(false);
  });
});
