import { describe, expect, it } from "vitest";

import { registerLayoutComponentGuard } from "./layout-component-guard";

/** A plugin context that captures the handler, and the phase it was given. */
function context() {
  const registered: { type: string; collection: string }[] = [];
  let handler: ((context: unknown) => unknown) | undefined;
  const ctx = {
    hooks: {
      on(type: string, collection: string, h: (context: unknown) => unknown) {
        registered.push({ type, collection });
        handler = h;
      },
    },
  };
  return { ctx, registered, run: (c: unknown) => handler?.(c) };
}

/** A Direct API answering fixed pages, and recording what it was asked. */
function api(pages: Record<string, unknown[]>) {
  const asked: { collection: string; status?: string; override: boolean }[] =
    [];
  return {
    asked,
    nextly: {
      find: async (a: {
        collection: string;
        status?: string;
        overrideAccess: boolean;
      }) => {
        asked.push({
          collection: a.collection,
          status: a.status,
          override: a.overrideAccess,
        });
        return { docs: pages[a.status ?? ""] ?? [], hasNextPage: false };
      },
    },
  };
}

const deleting = (id: string, nextly: unknown) => ({
  data: { id },
  req: { nextly },
});

const layout = (id: string, title: string, componentId: string) => ({
  id,
  title,
  areas: [{ area: "header", component: componentId }],
});

const register = (ctx: ReturnType<typeof context>["ctx"]) =>
  registerLayoutComponentGuard({
    ctx,
    componentsCollection: "nx_pb_components",
    layoutsCollection: "nx_pb_layouts",
  });

describe("deleting a component a Layout still uses", () => {
  it("registers on beforeDelete, for the components collection only", () => {
    // Named rather than the wildcard: a wildcard registration would run a
    // Layout scan on every delete the site performs.
    const c = context();
    register(c.ctx);

    expect(c.registered).toEqual([
      { type: "beforeDelete", collection: "nx_pb_components" },
    ]);
  });

  it("refuses, naming the Layout the author has to go and edit", async () => {
    const c = context();
    register(c.ctx);
    const { nextly } = api({ published: [layout("l1", "Marketing", "cmp")] });

    await expect(c.run(deleting("cmp", nextly))).rejects.toThrow(
      /the Layout "Marketing" uses it/
    );
  });

  it("allows the delete when no Layout names it", async () => {
    // The control. Without it, a guard that refused everything would satisfy
    // every refusal case here.
    const c = context();
    register(c.ctx);
    const { nextly } = api({ published: [layout("l1", "Marketing", "other")] });

    await expect(c.run(deleting("cmp", nextly))).resolves.toBeUndefined();
  });

  it("counts a DRAFT Layout, and says which it is", async () => {
    const c = context();
    register(c.ctx);
    const { nextly, asked } = api({
      draft: [layout("l2", "Next season", "cmp")],
    });

    await expect(c.run(deleting("cmp", nextly))).rejects.toThrow(
      /"Next season \(draft\)"/
    );
    // Both stored forms asked for, as separate reads.
    expect(asked.map(a => a.status)).toEqual(["published", "draft"]);
  });

  it("reads as the system, or a Layout the user cannot see is invisible", async () => {
    // If the scan ran as the deleting user, a Layout they cannot read would
    // not appear, the delete would be permitted, and every page carrying that
    // Layout would break.
    const c = context();
    register(c.ctx);
    const { nextly, asked } = api({});

    await c.run(deleting("cmp", nextly));

    expect(asked.every(a => a.override)).toBe(true);
  });

  it("names one Layout once, however many of its areas use the component", async () => {
    const c = context();
    register(c.ctx);
    const { nextly } = api({
      published: [
        {
          id: "l1",
          title: "Marketing",
          areas: [
            { area: "header", component: "cmp" },
            { area: "footer", component: "cmp" },
          ],
        },
      ],
    });

    // One place to go and edit. Listing it twice reads as two problems.
    await expect(c.run(deleting("cmp", nextly))).rejects.toThrow(
      /the Layout "Marketing" uses it/
    );
  });

  it("does not refuse a delete it could not evaluate at all", async () => {
    // No Direct API on the request, so there is nothing to ask. Left alone
    // rather than refused: this is a data-integrity guard, and one that blocked
    // every delete it could not evaluate would make the collection undeletable
    // on any path shaping its context differently.
    const c = context();
    register(c.ctx);

    await expect(c.run({ data: { id: "cmp" } })).resolves.toBeUndefined();
  });
});
