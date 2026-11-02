/**
 * Which widgets a reader may be told exist, and how the answer is split for
 * the workspace payload.
 *
 * `callerHoldsPermission` and `readableEntities` are the seams a caller is put
 * on either side of; everything between them -- the canonical merge, the
 * content sources, the gate -- is real, because the property under test is
 * what the two surfaces built on this decision are told, not how a verdict is
 * reached.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReadAccessCaller } from "../../../auth/entity-read-access";
import { clearWidgets, registerWidget } from "../registry";
import { setSiteDashboardRules } from "../site-rules";
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
    archetype: "metric",
    size: { default: { w: 4, h: 3 } },
    ...patch,
  };
  // A key set to `undefined` is one JSON drops, and a registration carrying
  // one is not one the admin may receive -- so a patch that unsets a key
  // removes it rather than voiding it.
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
  reader([]);
});

afterEach(() => {
  clearWidgets();
  clearSources();
  setSiteDashboardRules(NO_SITE_RULES);
});

const NO_SITE_RULES = {
  hidden: new Set<string>(),
  replaced: new Map<string, string>(),
  alternatives: new Set<string>(),
  overrides: new Map(),
};

const ids = (widgets: readonly { id: string }[]) =>
  widgets.map(widget => widget.id);

describe("visibleWidgets", () => {
  it("withholds a declared widget whose gate this reader fails", async () => {
    // 🔴 The disclosure. A declaration ships whole, so a reader the gate
    // refuses must not be told the card exists. The ungated card and the one
    // whose gate holds are the controls: without them a filter that returns
    // nothing satisfies the refusal.
    register("acme/runbook", { requiredPermission: "manage-settings" });
    register("acme/welcome");
    register("app/secrets", { requiredPermission: "read-secrets" });
    register("app/notes", { requiredPermission: "read-notes" });
    reader(["read-notes"]);

    expect(ids(await visibleWidgets(CALLER))).toEqual([
      "acme/welcome",
      "app/notes",
    ]);
  });

  it("denies when the permission decision itself rejects", async () => {
    register("app/secrets", { requiredPermission: "read-secrets" });
    callerHoldsPermission.mockRejectedValue(new Error("rbac down"));

    // Fail closed: a check that threw has told us nothing, and "nothing" must
    // not read as "allowed".
    expect(ids(await visibleWidgets(CALLER))).toEqual([]);
  });

  it("makes no card from a collection the install has", async () => {
    // 🔴 A card about one collection is a core widget set to it, never a
    // widget of its own: a sourced collection the reader may read adds no
    // id. The registered card is the control, so an empty answer is not what
    // satisfies this.
    register("app/notes");
    registerSource(source("posts"));
    registerSource(source("secret"));
    reader([], ["posts"]);

    expect(ids(await visibleWidgets(CALLER))).toEqual(["app/notes"]);
  });
});

describe("what the site config keeps off the dashboard", () => {
  it("is visible to nobody: a hidden widget, a built-in an alternative replaces, and an alternative no replace names", async () => {
    for (const id of [
      "core/team",
      "core/continue",
      "acme/recent-orders",
      "acme/other-alternative",
      "acme/kept",
    ]) {
      register(id);
    }
    setSiteDashboardRules({
      ...NO_SITE_RULES,
      hidden: new Set(["core/team"]),
      replaced: new Map([["core/continue", "acme/recent-orders"]]),
      alternatives: new Set(["acme/recent-orders", "acme/other-alternative"]),
    });

    // The alternative put in a built-in's place, and the untouched widget,
    // are the controls: a filter that keeps nothing would pass the rest.
    expect(ids(await visibleWidgets(CALLER))).toEqual([
      "acme/recent-orders",
      "acme/kept",
    ]);
  });
});

describe("widgetAudience", () => {
  it("holds the readable collections from the reader's verdict on each sourced collection", async () => {
    registerSource(source("posts"));
    registerSource(source("pages"));
    reader([], ["posts", "orphan"]);
    const audience = await widgetAudience(CALLER);
    // 🔴 Asked of the collections themselves: only those with a source, and
    // only those the reader may read.
    expect([...audience.readableCollections]).toEqual(["posts"]);
    expect(readableEntities).toHaveBeenCalledWith(
      expect.arrayContaining(["posts", "pages"]),
      CALLER
    );
  });

  it("moves its token when only a Collection setting changes", async () => {
    // 🔴 The workspace payload ships the setting, so a payload held from
    // before must read as stale when the setting is renamed, though every id
    // and gate stays as it was.
    const pinned = (name: string) =>
      register("acme/pinned", {
        settings: [{ name, type: "collection", label: "Collection" }],
      });
    registerSource(source("posts"));
    reader([], ["posts"]);
    pinned("collection");
    const before = (await widgetAudience(CALLER)).token;
    expect((await widgetAudience(CALLER)).token).toBe(before);
    clearWidgets();
    pinned("source");
    expect((await widgetAudience(CALLER)).token).not.toBe(before);
  });

  it("declares every visible widget, and nothing beside them", async () => {
    // The workspace payload matches the published widgets against
    // `declared`; a sourced collection adds nothing for it to ship.
    register("acme/welcome");
    register("app/notes");
    registerSource(source("posts"));
    reader([], ["posts"]);

    const audience = await widgetAudience(CALLER);

    expect([...audience.declared]).toEqual(["acme/welcome", "app/notes"]);
    expect(ids(audience.visible)).toEqual(["acme/welcome", "app/notes"]);
    expect(audience).not.toHaveProperty("generated");
  });

  it("answers for the gates INSIDE a visible declaration", async () => {
    // 🔴 A declared widget's empty-state action carries a gate of its own,
    // and the action is a label and a link. The card's gate alone would let
    // it ship and leave the browser to hide it -- readable from the payload
    // regardless. The verdicts here are what the payload withholds it with,
    // resolved for the action each declares.
    const emptyAction = (requiredPermission: string) => ({
      empty: {
        message: "Nothing yet",
        action: { label: "Act", link: "/admin/act", requiredPermission },
      },
    });
    register("app/publish", emptyAction("publish-notes"));
    register("app/purge", emptyAction("purge-notes"));
    register("acme/export", emptyAction("export-notes"));
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
    // A withheld card ships no action to gate, and asking about its inner
    // gate would be a permission check for a decision nobody will take.
    register("app/secrets", {
      requiredPermission: "read-secrets",
      empty: {
        action: {
          label: "Rotate",
          link: "/x",
          requiredPermission: "rotate-secrets",
        },
      },
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
