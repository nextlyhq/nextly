/**
 * The workspace payload tells a reader about exactly the widgets the layout
 * endpoint would place for them, through the real catch-all handler and the
 * real permission decision.
 *
 * A widget declaration is its whole content: a `text` widget carries its
 * prose. Filtering the payload in the browser is not a control -- the JSON is
 * what a signed-in caller can fetch -- so this asserts the WIRE: a caller
 * lacking a widget's gate never receives its declaration, from either channel,
 * and a caller holding it does. The caller is an API key rather than a session
 * because a key is judged on its own stamped grants, which makes "holds" and
 * "lacks" two keys minted from the same role table rather than two mocks.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../config";
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

/** A second collection, so a key can hold a grant that says nothing about notes. */
const events = defineCollection({
  slug: EVENTS,
  fields: [text({ name: "title" })],
});

/** The prose the gated cards carry -- what must never reach the wrong reader. */
const RUNBOOK = "## Runbook\n\nRotate the keys before a release.";
const EDITORS_ONLY = "Editors: the queue drains at midnight.";
/** Prose a LATER plugin attaches to an id the first plugin already claimed. */
const IMPOSTOR = "The vault code is 4-8-15-16.";

const contributor = definePlugin({
  name: "@test/notes-widgets",
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    collections: [notes, events],
    admin: {
      widgets: [
        // Ungated: any authenticated reader. The population control -- a
        // filter that withholds everything satisfies every absence below.
        {
          id: "notes/welcome",
          title: "Welcome",
          archetype: "text",
          defaultSize: "md",
          content: "Welcome to the notes desk.",
        },
        // Gated on a grant the read-only key HOLDS.
        {
          id: "notes/runbook",
          title: "Runbook",
          archetype: "text",
          defaultSize: "md",
          requiredPermission: `read-${NOTES}`,
          content: RUNBOOK,
        },
        // Gated on a grant it LACKS.
        {
          id: "notes/editors",
          title: "For editors",
          archetype: "text",
          defaultSize: "md",
          requiredPermission: `create-${NOTES}`,
          content: EDITORS_ONLY,
        },
        // Shortcuts, each with its own gate or none.
        {
          id: "notes/shortcuts",
          title: "Shortcuts",
          archetype: "actions",
          defaultSize: "sm",
          actions: [
            { label: "All notes", href: "/admin/collections/notes" },
            {
              label: "Publish queue",
              href: "/admin/collections/notes?status=draft",
              requiredPermission: `publish-${NOTES}`,
            },
          ],
        },
      ],
    },
  },
});

/**
 * A second plugin claiming an id the first already declared, gated, with
 * prose of its own. The canonical set and the admin's resolver both keep the
 * FIRST declaration, so this one is never the card -- and it must never be
 * the payload either.
 */
const impostor = definePlugin({
  name: "@test/notes-impostor",
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    admin: {
      widgets: [
        {
          id: "notes/welcome",
          title: "Welcome (again)",
          archetype: "text",
          defaultSize: "md",
          requiredPermission: `create-${NOTES}`,
          content: IMPOSTOR,
        },
      ],
    },
  },
});

interface WorkspaceDeclaration {
  id: string;
  content?: string;
  actions?: { label: string; requiredPermission?: string }[];
}

interface WorkspaceBody {
  widgets?: WorkspaceDeclaration[];
  plugins?: { name: string; widgets?: WorkspaceDeclaration[] }[];
  widgetAudience?: string;
}

async function workspace(headers: Record<string, string>): Promise<Response> {
  // The route reads the plugin list from the config the route module stored,
  // overlaid with what boot produced; without the stored half there is no
  // plugin projection at all, whatever booted.
  const handlers = createDynamicHandlers({
    config: sanitizeConfig({
      collections: [],
      plugins: [contributor, impostor],
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
      plugins: [contributor, impostor],
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
    plugins: [contributor, impostor],
  });
  // A registration is the OTHER declared channel, and it happens in code after
  // boot exactly as a plugin's `registerWidget` call does.
  registerWidget(
    {
      id: "app/ops-notes",
      title: "Ops notes",
      archetype: "text",
      defaultSize: "md",
      requiredPermission: `create-${NOTES}`,
      content: EDITORS_ONLY,
    },
    { source: "@test/app" }
  );
  registerWidget(
    {
      id: "app/board",
      title: "Board",
      archetype: "text",
      defaultSize: "md",
      content: "The board meets on Mondays.",
    },
    { source: "@test/app" }
  );
  registerWidget(
    {
      id: "app/tools",
      title: "Tools",
      archetype: "actions",
      defaultSize: "sm",
      actions: [
        { label: "Search", href: "/admin/search" },
        {
          label: "Bulk publish",
          href: "/admin/bulk",
          requiredPermission: `publish-${NOTES}`,
        },
      ],
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

/** Every widget declaration the payload carries, from both channels. */
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
    // authenticated caller and the one whose gate they hold, from BOTH
    // channels. Without this, an empty payload passes every absence below.
    const contributed = body.plugins?.find(
      plugin => plugin.name === "@test/notes-widgets"
    );
    expect(ids(contributed?.widgets)).toEqual([
      "notes/welcome",
      "notes/runbook",
      "notes/shortcuts",
    ]);
    expect(ids(body.widgets)).toEqual(
      expect.arrayContaining([
        "app/board",
        "app/tools",
        "collection/notes-count",
      ])
    );

    // Then the absences, and on the CONTENT rather than only the id: the whole
    // declaration is what must not ship.
    const declarations = everyDeclaration(body);
    expect(ids(declarations)).not.toContain("notes/editors");
    expect(ids(declarations)).not.toContain("app/ops-notes");
    expect(declarations.map(widget => widget.content)).not.toContain(
      EDITORS_ONLY
    );
    // And the prose they MAY read is there, which is what separates a gate
    // from a projection that dropped `content` on the way out.
    expect(declarations.map(widget => widget.content)).toContain(RUNBOOK);
  });

  it("ships only the declaration that won its id, not a later duplicate", async () => {
    // 🔴 Two plugins contribute `notes/welcome`. The first, ungated, is the
    // card -- the canonical set and the admin's resolver both keep the first
    // -- so the id is visible to every reader. Filtered by id alone, the
    // later duplicate shipped under the winner's clearance, prose and all,
    // to a reader lacking the grant it declared.
    const body = await workspaceFor(await keyHolding([`read-${NOTES}`]));

    const copies = everyDeclaration(body).filter(
      widget => widget.id === "notes/welcome"
    );
    expect(copies).toHaveLength(1);
    expect(copies[0]?.content).toBe("Welcome to the notes desk.");
    const later = body.plugins?.find(
      plugin => plugin.name === "@test/notes-impostor"
    );
    expect(later).toBeDefined();
    expect(later?.widgets).toBeUndefined();
    expect(everyDeclaration(body).map(widget => widget.content)).not.toContain(
      IMPOSTOR
    );
  });

  it("keeps a gated contribution gated when an ungated registration the admin cannot receive collides with it", async () => {
    // 🔴 The registry is the override channel, and a registration stating no
    // permission un-gates a colliding contribution -- for the card the admin
    // DRAWS. A registration JSON cannot carry is skipped by this payload, so
    // the admin never receives it and draws the contribution instead; judged
    // on the raw registry, the verdict was still the registration's, and the
    // contribution's prose shipped to a reader lacking the grant it declared.
    registerWidget(
      {
        id: "notes/editors",
        title: "Editors (registered)",
        archetype: "metric",
        defaultSize: "sm",
        query: {
          source: `collection:${NOTES}`,
          op: "count",
          where: { views: { greater_than: 10n } },
        },
      },
      { source: "@test/app" }
    );

    const lacking = await workspaceFor(await keyHolding([`read-${NOTES}`]));
    const declarations = everyDeclaration(lacking);
    expect(ids(declarations)).not.toContain("notes/editors");
    expect(declarations.map(widget => widget.content)).not.toContain(
      EDITORS_ONLY
    );

    // The control: the contribution still ships, as itself, to a reader
    // holding ITS gate -- the collision cost it nothing but the override.
    const holding = await workspaceFor(
      await keyHolding([`read-${NOTES}`, `create-${NOTES}`])
    );
    const copies = everyDeclaration(holding).filter(
      widget => widget.id === "notes/editors"
    );
    expect(copies).toHaveLength(1);
    expect(copies[0]?.content).toBe(EDITORS_ONLY);
  });

  it("withholds an action whose own gate the reader lacks, on both channels", async () => {
    // 🔴 A shortcut is a label and an href. The card's gate held, so the
    // whole list shipped and the browser hid the protected entry afterwards
    // -- readable from the payload regardless.
    const lacking = await workspaceFor(await keyHolding([`read-${NOTES}`]));
    const labels = (body: WorkspaceBody, id: string) =>
      everyDeclaration(body)
        .find(widget => widget.id === id)
        ?.actions?.map(action => action.label);
    expect(labels(lacking, "notes/shortcuts")).toEqual(["All notes"]);
    expect(labels(lacking, "app/tools")).toEqual(["Search"]);

    // The control: the grant held, the same lists are whole.
    const holding = await workspaceFor(
      await keyHolding([`read-${NOTES}`, `publish-${NOTES}`])
    );
    expect(labels(holding, "notes/shortcuts")).toEqual([
      "All notes",
      "Publish queue",
    ]);
    expect(labels(holding, "app/tools")).toEqual(["Search", "Bulk publish"]);
  });

  it("ships the same declarations to a reader holding the grant", async () => {
    const body = await workspaceFor(
      await keyHolding([`read-${NOTES}`, `create-${NOTES}`])
    );

    const contributed = body.plugins?.find(
      plugin => plugin.name === "@test/notes-widgets"
    );
    expect(ids(contributed?.widgets)).toEqual([
      "notes/welcome",
      "notes/runbook",
      "notes/editors",
      "notes/shortcuts",
    ]);
    expect(ids(body.widgets)).toEqual(
      expect.arrayContaining(["app/board", "app/ops-notes"])
    );
    expect(everyDeclaration(body).map(widget => widget.content)).toContain(
      EDITORS_ONLY
    );
  });

  it("withholds a generated card for a collection the reader may not read", async () => {
    // A key stamped with nothing about `notes` -- the generated cards name the
    // collection in their id, title and query, and the layout endpoint would
    // never offer them to this key. It holds a read on `events` instead, so
    // the cards for THAT collection are the population: the absence below is
    // a gate on one collection, not a payload with no generated cards at all.
    const body = await workspaceFor(await keyHolding([`read-${EVENTS}`]));

    const generated = ids(body.widgets).filter(id =>
      id.startsWith("collection/")
    );
    expect(generated).toContain(`collection/${EVENTS}-count`);
    expect(generated.some(id => id.startsWith(`collection/${NOTES}-`))).toBe(
      false
    );
    // And the ungated declarations still arrive.
    expect(ids(everyDeclaration(body))).toEqual(
      expect.arrayContaining(["notes/welcome", "app/board"])
    );
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

  it("carries a different token for a reader told about different cards, or only different shortcuts", async () => {
    // The must-differ controls: a token that never moved would satisfy the
    // equality above. The second key differs from the first only in a
    // SHORTCUT's grant -- the same cards -- which is the change a token of the
    // cards alone could not report.
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
