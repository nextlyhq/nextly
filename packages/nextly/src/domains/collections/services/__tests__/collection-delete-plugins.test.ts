/**
 * What the collection delete asks of plugins, against a real hook registry
 * holding stand-in handlers: the impact grouped by plugin and checked at the
 * boundary, the removal run for every slug in order and its failure passed
 * on as thrown, and a suspended plugin left out of both.
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import { HookRegistry } from "../../../../hooks/hook-registry";
import type { CollectionDeleteRunner } from "../../../../hooks/types";
import {
  collectionDeleteImpact,
  runCollectionDeleteHandlers,
} from "../collection-delete-plugins";

const TX = {} as TransactionContext;

describe("collectionDeleteImpact", () => {
  it("groups each plugin's items under its name, in registration order, leaving out one that names nothing", async () => {
    const registry = new HookRegistry();
    registry.registerCollectionDelete(
      {
        impact: async slug => [{ label: `${slug} template`, kind: "template" }],
      },
      "plugin:@a/designs"
    );
    registry.registerCollectionDelete(
      { impact: async () => [] },
      "plugin:@b/empty"
    );
    registry.registerCollectionDelete(
      { inTransaction: async () => undefined },
      "plugin:@c/no-impact"
    );
    registry.registerCollectionDelete(
      { impact: async () => [{ label: "Index", kind: "index" }] },
      "app"
    );

    expect(await collectionDeleteImpact(registry, ["posts", "news"])).toEqual([
      {
        plugin: "@a/designs",
        items: [
          { label: "posts template", kind: "template" },
          { label: "news template", kind: "template" },
        ],
      },
      {
        plugin: "app",
        items: [
          { label: "Index", kind: "index" },
          { label: "Index", kind: "index" },
        ],
      },
    ]);
  });

  it("refuses an answer that is not a list of labelled items, naming the plugin", async () => {
    const registry = new HookRegistry();
    registry.registerCollectionDelete(
      {
        // An empty label names nothing a person could recognise.
        impact: async () => [{ label: "", kind: "x" }],
      },
      "plugin:@a/broken"
    );

    await expect(
      collectionDeleteImpact(registry, ["posts"])
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      logContext: {
        reason: "collection-delete-impact-failed",
        owner: "plugin:@a/broken",
        collection: "posts",
      },
    });
  });

  it("names the plugin whose impact threw", async () => {
    const registry = new HookRegistry();
    registry.registerCollectionDelete(
      {
        impact: async () => {
          throw new Error("down");
        },
      },
      "plugin:@a/throws"
    );

    await expect(
      collectionDeleteImpact(registry, ["posts"])
    ).rejects.toMatchObject({
      logContext: { owner: "plugin:@a/throws" },
    });
  });
});

describe("runCollectionDeleteHandlers", () => {
  it("runs each plugin's removal for every slug, in order, on the delete's transaction", async () => {
    const registry = new HookRegistry();
    const ran: string[] = [];
    const runner = (name: string): CollectionDeleteRunner => ({
      inTransaction: async (slug, tx) => {
        expect(tx).toBe(TX);
        ran.push(`${name}:${slug}`);
      },
    });
    registry.registerCollectionDelete(runner("a"), "plugin:@a/one");
    registry.registerCollectionDelete(
      { impact: async () => [] },
      "plugin:@b/impact-only"
    );
    registry.registerCollectionDelete(runner("c"), "plugin:@c/two");

    await runCollectionDeleteHandlers(registry, ["posts", "news"], TX);

    expect(ran).toEqual(["a:posts", "a:news", "c:posts", "c:news"]);
  });

  it("passes a handler's failure on as thrown, running nothing after it", async () => {
    const registry = new HookRegistry();
    const refusal = new Error("refused");
    const ran: string[] = [];
    registry.registerCollectionDelete(
      {
        inTransaction: async () => {
          throw refusal;
        },
      },
      "plugin:@a/refuses"
    );
    registry.registerCollectionDelete(
      { inTransaction: async slug => void ran.push(slug) },
      "plugin:@b/after"
    );

    await expect(
      runCollectionDeleteHandlers(registry, ["posts"], TX)
    ).rejects.toBe(refusal);
    expect(ran).toEqual([]);
  });

  it("leaves out a suspended plugin's handlers, and an unregistered one's", async () => {
    const registry = new HookRegistry();
    const ran: string[] = [];
    const kept: CollectionDeleteRunner = {
      inTransaction: async slug => void ran.push(`kept:${slug}`),
    };
    const removed: CollectionDeleteRunner = {
      inTransaction: async slug => void ran.push(`removed:${slug}`),
    };
    registry.registerCollectionDelete(kept, "plugin:@a/kept");
    registry.registerCollectionDelete(
      { inTransaction: async slug => void ran.push(`suspended:${slug}`) },
      "plugin:@b/suspended"
    );
    registry.registerCollectionDelete(removed, "plugin:@c/removed");
    registry.unregisterCollectionDelete(removed, "plugin:@c/removed");
    registry.setSuspendedOwners(["plugin:@b/suspended"]);

    await runCollectionDeleteHandlers(registry, ["posts"], TX);

    expect(ran).toEqual(["kept:posts"]);
    // A deleted plugin that registered only these is still an owner, so a
    // reload can suspend it.
    expect(registry.registeredOwners()).toContain("plugin:@b/suspended");
  });
});
