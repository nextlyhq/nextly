/**
 * What one reader is sent of the declared contributions and filters: in each
 * place's order, without what the reader may not see. A contribution behind
 * a permission the reader lacks is not sent, and a replacement left out gives
 * the built-in part back. A rule or an option naming a field the reader may
 * not filter on is not offered on that collection. The public metadata gets
 * the login page's contributions alone.
 */
import { describe, expect, it, vi } from "vitest";

import type {
  AdminContribution,
  PluginListFilterDeclaration,
} from "../admin-contributions";
import {
  contributionsForReader,
  listFiltersForReader,
  readerFilterVerdict,
  type ContributionAudience,
} from "../admin-contributions-offer";
import type { PluginDefinition } from "../plugin-context";

const SUPPORT: PluginDefinition = {
  name: "@acme/support",
  version: "1.0.0",
  nextly: "*",
  collections: [{ slug: "tickets", fields: [] }],
  renameMap: { tickets: "helpdesk-tickets" },
  contributes: {
    admin: {
      contributions: [
        {
          id: "acme-support.totals",
          kind: "block",
          place: "dashboard",
          component: "x#Totals",
        },
        {
          id: "acme-support.audit",
          kind: "block",
          place: "dashboard",
          component: "x#Audit",
          requiredPermission: "read-audit",
        },
        {
          id: "acme-support.status",
          kind: "sidebarSection",
          place: "collection.edit",
          label: "Status",
          component: "x#Status",
          replaces: "status",
          requiredPermission: "read-audit",
        },
        {
          id: "acme-support.sla",
          kind: "sidebarSection",
          place: "collection.edit",
          label: "SLA",
          component: "x#Sla",
          after: "details",
          collections: ["tickets"],
        },
        {
          id: "acme-support.secret",
          kind: "tab",
          place: "collection.edit",
          label: "Secret",
          component: "x#Secret",
          visibleWhen: { field: "codename", exists: true },
        },
        {
          id: "acme-support.hello",
          kind: "block",
          place: "login",
          component: "x#Hello",
        },
      ] as AdminContribution[],
    },
  },
};

/** A reader holding `held`, who may filter on every field but `codename`. */
/**
 * A reader holding `held`, who may read `collections` (by the slugs the
 * registry lists, a renamed one's served slug among them) and filter on every
 * field but `codename`.
 */
function reader(
  held: string[] = [],
  collections = ["helpdesk-tickets", "posts"]
) {
  const mayFilter = vi.fn(
    async (_collection: string, where: Record<string, unknown>) =>
      !JSON.stringify(where).includes("codename")
  );
  const audience: ContributionAudience = {
    holds: gate => typeof gate === "string" && held.includes(gate),
    mayFilter,
    collections,
  };
  return { audience, mayFilter };
}

describe("contributionsForReader", () => {
  it("sends a reader holding every permission each place's lists in order, login's left out", async () => {
    const { audience } = reader(["read-audit"]);
    const meta = await contributionsForReader([SUPPORT], audience, "workspace");
    expect(Object.keys(meta).sort()).toEqual(["collection.edit", "dashboard"]);
    expect(
      meta.dashboard?.block?.map(e => ("id" in e ? e.id : e.builtIn))
    ).toEqual([
      "welcome",
      "widgets",
      "acme-support.audit",
      "acme-support.totals",
    ]);
    expect(meta["collection.edit"]?.sidebarSection).toEqual([
      expect.objectContaining({
        id: "acme-support.status",
        replaces: "status",
      }),
      { builtIn: "publishing" },
      { builtIn: "language" },
      { builtIn: "details" },
      // Named by the slug the admin serves the renamed collection as.
      expect.objectContaining({
        id: "acme-support.sla",
        collections: ["helpdesk-tickets"],
      }),
    ]);
    // Placed already: what ordered it and who may see it are not sent.
    const sent = JSON.stringify(meta);
    expect(sent).not.toContain("requiredPermission");
    expect(sent).not.toContain('"after"');
  });

  it("leaves out what a reader without the permission may not see, giving a replaced part back", async () => {
    const { audience } = reader([]);
    const meta = await contributionsForReader([SUPPORT], audience, "workspace");
    const sent = JSON.stringify(meta);
    expect(sent).not.toContain("acme-support.audit");
    expect(sent).not.toContain("x#Audit");
    expect(meta["collection.edit"]?.sidebarSection?.[0]).toEqual({
      builtIn: "status",
    });
  });

  it("offers a rule only where the reader may filter on every field it names", async () => {
    const { audience, mayFilter } = reader(["read-audit"]);
    const meta = await contributionsForReader([SUPPORT], audience, "workspace");
    // The tab's rule names `codename`, which this reader may not filter on.
    expect(JSON.stringify(meta)).not.toContain("acme-support.secret");
    expect(mayFilter).toHaveBeenCalledWith("helpdesk-tickets", {
      and: [{ codename: { exists: true } }],
    });

    const open = {
      ...audience,
      mayFilter: vi.fn(async (collection: string) => collection === "posts"),
    };
    const offered = await contributionsForReader([SUPPORT], open, "workspace");
    expect(offered["collection.edit"]?.tab).toEqual([
      expect.objectContaining({
        id: "acme-support.secret",
        collections: ["posts"],
      }),
    ]);
  });

  it("sends a contribution named for collections only where the reader may read them", async () => {
    // The reader may not read the tickets collection, so the section named
    // for it is not sent at all.
    const { audience } = reader(["read-audit"], ["posts"]);
    const meta = await contributionsForReader([SUPPORT], audience, "workspace");
    expect(JSON.stringify(meta)).not.toContain("acme-support.sla");
  });

  it("asks a permission named through the plugin's renamed collection", async () => {
    const ops: PluginDefinition = {
      ...SUPPORT,
      contributes: {
        admin: {
          contributions: [
            {
              id: "acme-support.ops",
              kind: "block",
              place: "dashboard",
              component: "x#Ops",
              requiredPermission: ({ collection }) =>
                collection("tickets", "update"),
            },
          ],
        },
      },
    };
    const sentTo = async (held: string[]) =>
      JSON.stringify(
        await contributionsForReader([ops], reader(held).audience, "workspace")
      ).includes("acme-support.ops");
    expect(await sentTo(["update-helpdesk-tickets"])).toBe(true);
    // The declared spelling names no grant once the collection is renamed.
    expect(await sentTo(["update-tickets"])).toBe(false);
  });

  it("sends an action that runs a route only to a reader the route would let run it", async () => {
    const escalating: PluginDefinition = {
      ...SUPPORT,
      contributes: {
        routes: [
          {
            method: "POST",
            path: "/escalate",
            handler: () => new Response(),
            // Named through the renamed collection, as the dispatcher resolves it.
            requiredPermission: ({ collection }) =>
              collection("tickets", "update"),
          },
          {
            method: "POST",
            path: "/ping",
            handler: () => new Response(),
          },
        ],
        admin: {
          contributions: [
            {
              id: "acme-support.escalate",
              kind: "rowAction",
              place: "collection.list",
              label: "Escalate",
              action: { run: { method: "POST", path: "/escalate" } },
            },
            {
              id: "acme-support.ping",
              kind: "rowAction",
              place: "collection.list",
              label: "Ping",
              action: { run: { method: "POST", path: "/ping" } },
            },
          ],
        },
      },
    };
    const sent = async (held: string[]) =>
      JSON.stringify(
        await contributionsForReader(
          [escalating],
          reader(held).audience,
          "workspace"
        )
      );
    // The action declares no permission of its own; its route's still holds.
    expect(await sent([])).not.toContain("acme-support.escalate");
    expect(await sent(["update-helpdesk-tickets"])).toContain(
      "acme-support.escalate"
    );
    // A route with no permission of its own asks only the action's.
    expect(await sent([])).toContain("acme-support.ping");
  });

  it("sends no reader a contribution whose permission cannot be computed", async () => {
    const broken: PluginDefinition = {
      ...SUPPORT,
      contributes: {
        admin: {
          contributions: [
            {
              id: "acme-support.broken",
              kind: "block",
              place: "dashboard",
              component: "x#Broken",
              requiredPermission: () => {
                throw new Error("no names");
              },
            },
          ],
        },
      },
    };
    const everything: ContributionAudience = {
      ...reader().audience,
      holds: () => true,
    };
    const meta = await contributionsForReader(
      [broken],
      everything,
      "workspace"
    );
    expect(JSON.stringify(meta)).not.toContain("acme-support.broken");
  });

  it("sends the public metadata the login page's contributions alone", async () => {
    const { audience } = reader(["read-audit"]);
    const meta = await contributionsForReader([SUPPORT], audience, "login");
    expect(Object.keys(meta)).toEqual(["login"]);
    // The sign-in form is the login page's built-in block, so the list
    // places the contribution after it.
    expect(meta.login?.block).toEqual([
      { builtIn: "form" },
      expect.objectContaining({ id: "acme-support.hello" }),
    ]);
  });

  it("snapshots what each reader receives", async () => {
    const restricted = await contributionsForReader(
      [SUPPORT],
      reader([]).audience,
      "workspace"
    );
    const full = await contributionsForReader(
      [SUPPORT],
      reader(["read-audit"]).audience,
      "workspace"
    );
    expect({ restricted, full }).toMatchSnapshot();
  });
});

describe("listFiltersForReader", () => {
  const STATE: PluginListFilterDeclaration = {
    name: "acme-support.state",
    label: "State",
    options: [
      { value: "open", label: "Open", where: { state: { equals: "open" } } },
      {
        value: "secret",
        label: "Secret",
        where: { codename: { equals: "x" } },
      },
    ],
  };

  it("offers on each collection only the options the reader may filter by", async () => {
    const { audience } = reader();
    expect(await listFiltersForReader([STATE], audience)).toEqual([
      {
        ...STATE,
        collections: ["helpdesk-tickets", "posts"],
        options: [STATE.options[0]],
      },
    ]);
  });

  it("keeps apart collections offered different options, and offers none where none pass", async () => {
    const audience: ContributionAudience = {
      holds: () => true,
      collections: ["tickets", "posts", "orders"],
      mayFilter: async (collection, where) =>
        collection === "tickets" ||
        (collection === "posts" && !JSON.stringify(where).includes("codename")),
    };
    expect(await listFiltersForReader([STATE], audience)).toEqual([
      { ...STATE, collections: ["tickets"] },
      { ...STATE, collections: ["posts"], options: [STATE.options[0]] },
    ]);
  });
});

describe("readerFilterVerdict", () => {
  it("asks each collection and where once, whatever order its keys were written in", async () => {
    const problemsOf = vi.fn(async () => []);
    const mayFilter = readerFilterVerdict(problemsOf, () => undefined);
    expect(
      await mayFilter("tickets", { a: { equals: 1 }, b: { exists: true } })
    ).toBe(true);
    expect(
      await mayFilter("tickets", { b: { exists: true }, a: { equals: 1 } })
    ).toBe(true);
    expect(
      await mayFilter("posts", { a: { equals: 1 }, b: { exists: true } })
    ).toBe(true);
    expect(problemsOf).toHaveBeenCalledTimes(2);
  });

  it("answers no to a refusal", async () => {
    const mayFilter = readerFilterVerdict(
      async () => [{ path: "where.a" }],
      () => undefined
    );
    expect(await mayFilter("tickets", { a: { equals: 1 } })).toBe(false);
  });

  it("answers no, and reports it, when the check fails rather than refuses", async () => {
    const onFailure = vi.fn();
    const mayFilter = readerFilterVerdict(async () => {
      throw new Error("adapter: connection reset");
    }, onFailure);
    expect(await mayFilter("tickets", { a: { equals: 1 } })).toBe(false);
    expect(onFailure).toHaveBeenCalledWith("tickets", expect.any(Error));
  });
});
