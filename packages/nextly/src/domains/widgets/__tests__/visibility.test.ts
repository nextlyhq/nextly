/**
 * Which widgets a reader may be told exist, and how the answer is split for
 * the workspace payload.
 *
 * `callerHoldsPermission` and `readableEntities` are the seams a caller is put
 * on either side of; everything between them -- the canonical merge, the
 * generated cards, the gate -- is real, because the property under test is
 * what the two surfaces built on this decision are told, not how a verdict is
 * reached.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReadAccessCaller } from "../../../auth/entity-read-access";
import { setContributedWidgets } from "../canonical";
import { generatedWidgets, setGeneratedWidgets } from "../collection-widgets";
import { clearWidgets, registerWidget } from "../registry";
import { clearSources, registerSource } from "../sources";
import { widgetAudience } from "../visibility";

/** The cards the one decision admits, which is what the layout endpoint places. */
const visibleWidgets = async (caller: Parameters<typeof widgetAudience>[0]) =>
  (await widgetAudience(caller)).visible;

const { callerHoldsPermission, readableEntities } = vi.hoisted(() => ({
  callerHoldsPermission: vi.fn(),
  readableEntities: vi.fn(),
}));
vi.mock("../../../auth/entity-read-access", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../../../auth/entity-read-access")>();
  return { ...actual, callerHoldsPermission, readableEntities };
});

const CALLER: ReadAccessCaller = {
  userId: "user-1",
  authMethod: "session",
  permissions: [],
  roles: ["editor"],
};

/** A reader who holds exactly `held`, and may read exactly `readable`. */
function reader(held: string[], readable: string[] = []): void {
  callerHoldsPermission.mockImplementation(async (slug: string) =>
    held.includes(slug)
  );
  readableEntities.mockImplementation(
    async (slugs: string[]) =>
      new Set(slugs.filter(slug => readable.includes(slug)))
  );
}

function register(id: string, patch: Record<string, unknown> = {}): void {
  const definition = {
    id,
    title: id,
    archetype: "text",
    defaultSize: "md",
    content: `notes for ${id}`,
    ...patch,
  };
  // A key set to `undefined` is one JSON drops, and a registration carrying
  // one is not one the admin may receive -- so a patch that unsets the base
  // fixture's `content` removes the key rather than voiding it.
  registerWidget(
    withoutUndefined(definition) as Parameters<typeof registerWidget>[0]
  );
}

/** `value` less every key set to `undefined`. */
function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as Partial<T>;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearWidgets();
  clearSources();
  setContributedWidgets([]);
  reader([]);
});

afterEach(() => {
  clearWidgets();
  clearSources();
  setContributedWidgets([]);
});

const ids = (widgets: readonly { id: string }[]) =>
  widgets.map(widget => widget.id);

describe("visibleWidgets", () => {
  it("withholds a declared widget whose gate this reader fails, from either channel", async () => {
    // 🔴 The disclosure. A declaration is its whole content -- a text widget's
    // prose travels with it -- so a reader the gate refuses must not be told
    // the card exists, whether a plugin contributed it or an app registered
    // it. The ungated card and the one whose gate holds are the controls:
    // without them a filter that returns nothing satisfies the refusal.
    setContributedWidgets([
      { id: "acme/runbook", requiredPermission: "manage-settings" },
      { id: "acme/welcome" },
    ]);
    register("app/secrets", { requiredPermission: "read-secrets" });
    register("app/notes", { requiredPermission: "read-notes" });
    reader(["read-notes"]);

    expect(ids(await visibleWidgets(CALLER))).toEqual([
      "acme/welcome",
      "app/notes",
    ]);
  });

  it("gates a colliding pair on the one gate the canonical merge keeps", async () => {
    // A registration that TIGHTENED the permission on a contributed id gates
    // both copies. The contribution carries no gate of its own, and shipping
    // it on that basis would hand the reader the prose the registration was
    // written to withhold.
    setContributedWidgets([{ id: "acme/runbook" }]);
    register("acme/runbook", { requiredPermission: "manage-settings" });
    reader([]);

    expect(ids(await visibleWidgets(CALLER))).toEqual([]);

    reader(["manage-settings"]);
    expect(ids(await visibleWidgets(CALLER))).toEqual(["acme/runbook"]);
  });

  it("denies when the permission decision itself rejects", async () => {
    register("app/secrets", { requiredPermission: "read-secrets" });
    callerHoldsPermission.mockRejectedValue(new Error("rbac down"));

    // Fail closed: a check that threw has told us nothing, and "nothing" must
    // not read as "allowed".
    expect(ids(await visibleWidgets(CALLER))).toEqual([]);
  });

  it("gates a generated card on its collection, not on a declared permission", async () => {
    // A generated card's id, title and query all name a COLLECTION, so the
    // question is whether this reader may read that collection -- asked of
    // `readableEntities`, the same answer the query endpoint gives, rather
    // than of the flat permission list, which cannot see a code-defined
    // `access.read`.
    registerSource(source("posts"));
    registerSource(source("secret"));
    reader([], ["posts"]);

    const visible = await visibleWidgets(CALLER);

    expect(ids(visible)).toContain("collection/posts-count");
    expect(ids(visible)).not.toContain("collection/secret-count");
    expect(visible.every(widget => widget.generated === true)).toBe(true);
    // Never asked the permission question about a generated card: it declares
    // no permission, and a decision nobody declared is not one to take.
    expect(callerHoldsPermission).not.toHaveBeenCalled();
  });

  it("publishes a health card, whose collection is named by its cells", async () => {
    // 🔴 A stats card has no `query` of its own, so a collection read from
    // that field alone answered `undefined` for every health card -- and a
    // card whose subject cannot be identified is withheld. Every health card
    // was generated, registered, and then silently never published.
    registerSource(source("posts", { lifecycleStatus: true }));
    reader([], ["posts"]);

    expect(ids(await visibleWidgets(CALLER))).toContain(
      "collection/posts-stats"
    );
  });
});

describe("widgetAudience", () => {
  it("splits the visible set by the channel each half ships through", async () => {
    setContributedWidgets([{ id: "acme/welcome" }]);
    register("app/notes");
    registerSource(source("posts"));
    reader([], ["posts"]);

    const audience = await widgetAudience(CALLER);

    expect([...audience.declared]).toEqual(["acme/welcome", "app/notes"]);
    // The generated half is the DEFINITION, not an id: the admin holds no copy
    // to match against, so this is the only route by which the card arrives.
    expect(ids(audience.generated)).toEqual(
      expect.arrayContaining(["collection/posts-count"])
    );
    expect(audience.generated[0]).toMatchObject({
      archetype: expect.any(String),
      title: expect.any(String),
    });
  });

  it("keeps a generated id a plugin also declared on the DECLARED side only", async () => {
    // 🔴 The canonical merge lets a contribution keep an id core would have
    // generated. The admin reads the generated half as the registration
    // channel, and a registration merges over a colliding contribution -- so
    // core's derived copy shipping beside the plugin's card under the same id
    // would replace that plugin's card with core's guess in the grid, while
    // the layout endpoint placed the plugin's.
    setContributedWidgets([{ id: "collection/posts-count" }]);
    registerSource(source("posts"));
    reader([], ["posts"]);

    const audience = await widgetAudience(CALLER);

    expect(audience.declared.has("collection/posts-count")).toBe(true);
    expect(ids(audience.generated)).not.toContain("collection/posts-count");
    // The control: the collection's OTHER generated card still ships, so the
    // exclusion above is by id rather than by the whole collection.
    expect(ids(audience.generated)).toContain("collection/posts-recent");
  });

  it("withholds a generated card a reader may not see from the generated half", async () => {
    registerSource(source("posts"));
    registerSource(source("secret"));
    reader([], ["posts"]);

    const audience = await widgetAudience(CALLER);

    expect(ids(audience.generated)).toContain("collection/posts-count");
    expect(ids(audience.generated)).not.toContain("collection/secret-count");
  });

  it("ships the generated definitions it AUTHORIZED, even when the set is replaced mid-decision", async () => {
    // 🔴 The generated set is a global a concurrent request's refresh
    // replaces, and the decision awaits permission reads in between. Re-read
    // afterwards, the payload shipped whatever definition held each id by
    // then -- one the entity read was never asked about. Here the
    // replacement keeps the id and reads a collection this reader may not.
    registerSource(source("posts"));
    reader([], ["posts"]);
    readableEntities.mockImplementation(async (slugs: string[]) => {
      setGeneratedWidgets(
        generatedWidgets().map(widget =>
          widget.id === "collection/posts-count" && widget.query
            ? {
                ...widget,
                title: "Secret",
                query: { ...widget.query, source: "collection:secret" },
              }
            : widget
        )
      );
      return new Set(slugs.filter(slug => slug === "posts"));
    });

    const audience = await widgetAudience(CALLER);

    const card = audience.generated.find(
      widget => widget.id === "collection/posts-count"
    );
    // The control that the card was offered at all, so the property below is
    // not satisfied by an empty half.
    expect(card).toBeDefined();
    expect(card?.query?.source).toBe("collection:posts");
  });

  it("answers for the gates INSIDE a visible declaration, from either channel", async () => {
    // 🔴 An `actions` widget's shortcuts each carry a gate of their own, and
    // a shortcut is a label and an href. The card's gate alone let the whole
    // list ship and left the browser to hide the protected ones -- readable
    // from the payload regardless. The verdicts here are what the payload
    // withholds them with, resolved for the actions a registration and a
    // contribution declare.
    register("app/shortcuts", {
      archetype: "actions",
      content: undefined,
      actions: [
        { label: "Open", href: "/admin/open" },
        {
          label: "Publish",
          href: "/admin/publish",
          requiredPermission: "publish-notes",
        },
        {
          label: "Purge",
          href: "/admin/purge",
          requiredPermission: "purge-notes",
        },
      ],
    });
    setContributedWidgets([
      { id: "acme/links", actionGates: [undefined, "export-notes"] },
    ]);
    reader(["publish-notes", "export-notes"]);

    const audience = await widgetAudience(CALLER);

    expect(audience.holds(undefined)).toBe(true);
    expect(audience.holds("publish-notes")).toBe(true);
    expect(audience.holds("export-notes")).toBe(true);
    expect(audience.holds("purge-notes")).toBe(false);
    // Unusable and unresolved gates refuse, the reading the card's own gate
    // gets: an empty slug is not "no gate", and a slug nobody resolved is not
    // a held one.
    expect(audience.holds("")).toBe(false);
    expect(audience.holds("never-asked")).toBe(false);
  });

  it("does not resolve the gates inside a card the reader cannot see", async () => {
    // A withheld card ships no actions to gate, and asking about its inner
    // gates would be a permission check for a decision nobody will take.
    register("app/secrets", {
      archetype: "actions",
      content: undefined,
      requiredPermission: "read-secrets",
      actions: [
        { label: "Rotate", href: "/x", requiredPermission: "rotate-secrets" },
      ],
    });
    reader([]);

    await widgetAudience(CALLER);

    const asked = callerHoldsPermission.mock.calls.map(call => call[0]);
    expect(asked).toContain("read-secrets");
    expect(asked).not.toContain("rotate-secrets");
  });
});

/** A `collection:` source with a title field and a timestamp, as boot derives one. */
function source(
  slug: string,
  patch: Record<string, unknown> = {}
): Parameters<typeof registerSource>[0] {
  return {
    id: `collection:${slug}`,
    label: slug,
    kind: "collection",
    requiredPermission: `read-${slug}`,
    titleField: "title",
    supports: ["count", "list"],
    fields: [
      { name: "id", type: "string" },
      { name: "title", type: "string" },
      { name: "updatedAt", type: "date" },
      ...(patch.lifecycleStatus === true
        ? [{ name: "status", type: "string" }]
        : []),
    ],
    ...patch,
  } as Parameters<typeof registerSource>[0];
}
