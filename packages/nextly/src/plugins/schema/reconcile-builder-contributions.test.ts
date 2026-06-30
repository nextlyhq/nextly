import { describe, expect, it } from "vitest";

import {
  type DeferredExtend,
  resolveBuilderExtends,
} from "./apply-contributions";
import {
  reconcileBuilderContributions,
  tagPluginFields,
} from "./reconcile-builder-contributions";

describe("tagPluginFields", () => {
  it("stamps source/owner/locked on each field, non-mutating", () => {
    const input = [{ name: "meta_title", type: "text" }];
    const out = tagPluginFields(input as never, "@acme/seo");
    expect(out[0]).toMatchObject({
      name: "meta_title",
      source: "plugin",
      owner: "@acme/seo",
      locked: true,
    });
    // input untouched
    expect((input[0] as Record<string, unknown>).source).toBeUndefined();
  });
});

// A Builder collection with a user field + a STALE plugin field (left over from
// a previously-active plugin) — the reconciler must strip the stale one.
const builder = () => ({
  collections: [
    {
      slug: "articles",
      fields: [
        { name: "title", type: "text", source: "ui" },
        {
          name: "meta_title",
          type: "text",
          source: "plugin",
          owner: "@old/seo",
          locked: true,
        },
      ],
    },
  ],
  singles: [],
  components: [],
});

const fieldsOf = (r: ReturnType<typeof reconcileBuilderContributions>) =>
  r.entities.collections[0].fields as Array<{
    name: string;
    source?: string;
    owner?: string;
    locked?: boolean;
  }>;

describe("reconcileBuilderContributions", () => {
  it("strips stale plugin fields, then re-merges active plugins' fields (idempotent)", () => {
    const deferred: DeferredExtend[] = [
      {
        target: "articles",
        fields: [{ name: "meta_title", type: "text" }] as never,
        owner: "@acme/seo",
      },
    ];
    const r = reconcileBuilderContributions(deferred, builder());
    const fields = fieldsOf(r);
    const metas = fields.filter(f => f.name === "meta_title");
    expect(metas).toHaveLength(1); // not duplicated
    expect(metas[0]).toMatchObject({
      source: "plugin",
      owner: "@acme/seo",
      locked: true,
    });
    expect(fields.find(f => f.name === "title")?.source).toBe("ui"); // user field kept
    expect(r.unresolved).toHaveLength(0);
  });

  it("drops a plugin field whose plugin is no longer active", () => {
    const r = reconcileBuilderContributions([], builder()); // no active plugins
    expect(fieldsOf(r).map(f => f.name)).toEqual(["title"]); // stale meta_title removed
  });

  it("collects an unresolvable target instead of throwing", () => {
    const r = reconcileBuilderContributions(
      [
        {
          target: "ghost",
          fields: [{ name: "x", type: "text" }] as never,
          owner: "@acme/seo",
        },
      ],
      builder()
    );
    expect(r.unresolved).toEqual([{ target: "ghost", owner: "@acme/seo" }]);
  });
});

describe("migrate ⇄ dev-push parity", () => {
  // The CLI/migrate path (resolveBuilderExtends) and the runtime/dev-push path
  // (reconcileBuilderContributions) must materialise the SAME tagged field, so a
  // dev-push DB converges with a migrated DB.
  const cleanBuilder = () => ({
    collections: [
      {
        slug: "articles",
        fields: [{ name: "title", type: "text", source: "ui" }],
      },
    ],
    singles: [],
    components: [],
  });

  it("tags the merged Builder field identically on both paths", () => {
    const deferred: DeferredExtend[] = [
      {
        target: "articles",
        fields: [{ name: "meta_title", type: "text" }] as never,
        owner: "@acme/seo",
      },
    ];

    const cliMeta = resolveBuilderExtends(
      deferred,
      cleanBuilder()
    ).collections?.[0].fields?.find(
      (f: { name?: string }) => f.name === "meta_title"
    );
    const rtMeta = reconcileBuilderContributions(
      deferred,
      cleanBuilder()
    ).entities.collections[0].fields?.find(
      (f: { name?: string }) => f.name === "meta_title"
    );

    expect(cliMeta).toMatchObject({
      source: "plugin",
      owner: "@acme/seo",
      locked: true,
    });
    expect(rtMeta).toEqual(cliMeta); // byte-identical tagging → converged DBs
  });
});
