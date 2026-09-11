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
      ],
    },
  },
});

interface WorkspaceBody {
  widgets?: { id: string; content?: string }[];
  plugins?: { name: string; widgets?: { id: string; content?: string }[] }[];
}

async function workspace(headers: Record<string, string>): Promise<Response> {
  // The route reads the plugin list from the config the route module stored,
  // overlaid with what boot produced; without the stored half there is no
  // plugin projection at all, whatever booted.
  const handlers = createDynamicHandlers({
    config: sanitizeConfig({ collections: [], plugins: [contributor] }),
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

let handle: TestNextly | undefined;

beforeEach(async () => {
  handle = await createTestNextly({
    collections: [],
    plugins: [contributor],
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
});

afterEach(async () => {
  clearWidgets();
  await handle?.destroy();
  handle = undefined;
});

/**
 * A key holding exactly the grants named, minted by the super-admin first
 * user through the same role table the product reads.
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

  const owner = await nextly.users.create({
    data: {
      email: `owner-${slugs.join("-")}@example.com`,
      password: "Password123!",
      name: "Owner",
      isActive: true,
    },
  });

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
  const { key } = await apiKeys.createApiKey(owner.item.id, {
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
    ]);
    expect(ids(body.widgets)).toEqual(
      expect.arrayContaining(["app/board", "collection/notes-count"])
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

  it("still refuses an unauthenticated caller", async () => {
    const res = await workspace({});
    expect(res.status).toBe(401);
  });
});
