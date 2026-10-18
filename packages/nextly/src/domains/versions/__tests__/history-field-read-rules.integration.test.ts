/**
 * Every field read rule applies to history: a version read, a comparison and a
 * restore show a reader only what the rules let them read, including a rule
 * declared on a field inside a component, which is judged by that component's
 * own registration.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import {
  getVersionDiffForDocument,
  getVersionForDocument,
} from "../../../dispatcher/handlers/versions-methods";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { restoreVersion } from "../restore-version";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const BOSS = { id: "boss", email: "boss@x.test" };
const CLERK = { id: "clerk", email: "clerk@x.test" };

/** The hidden-field nodes a comparison carries, at any depth. */
function hiddenNodes(value: unknown): { name?: unknown }[] {
  if (Array.isArray(value)) return value.flatMap(hiddenNodes);
  if (value === null || typeof value !== "object") return [];
  const node = value as Record<string, unknown>;
  return [
    ...(node.kind === "hidden" ? [node] : []),
    ...Object.values(node).flatMap(hiddenNodes),
  ];
}

/** Every secret value the response carries, wherever it sits. */
function secretsIn(value: unknown): string[] {
  return (JSON.stringify(value).match(/S-\d/g) ?? []).sort();
}

/**
 * A collection whose component holds a field only BOSS may read, saved twice
 * so it has two versions.
 */
async function documentWithGuardedComponent(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    fieldGroups: [
      defineFieldGroup({
        slug: "banner",
        fields: [
          text({ name: "heading" }),
          text({
            name: "secret",
            access: { read: ({ req }) => req.user?.email === BOSS.email },
          }),
          // A rule that cannot be evaluated at all.
          text({
            name: "fragile",
            access: {
              read: () => {
                throw new Error("rule unavailable");
              },
            },
          }),
        ],
      }),
    ],
    collections: [
      defineCollection({
        slug: "posts",
        versions: true,
        access: { read: () => true, update: () => true, create: () => true },
        fields: [
          text({ name: "title" }),
          // Readable with the rule-facing `posts:read` permission only.
          text({
            name: "keyed",
            access: {
              read: ({ permissions }) => permissions.includes("posts:read"),
            },
          }),
          fieldGroup({ name: "banner", component: "banner" }),
        ],
      }),
    ],
  });
  const handler = current.getService("collectionsHandler");
  const created = await handler.createEntry(
    { collectionName: "posts", overrideAccess: true },
    {
      title: "T1",
      keyed: "K-1",
      banner: { heading: "H1", secret: "S-1", fragile: "F-1" },
    }
  );
  const id = (created.data as { id: string }).id;
  await handler.updateEntry(
    { collectionName: "posts", entryId: id, overrideAccess: true },
    {
      title: "T2",
      keyed: "K-2",
      banner: { heading: "H2", secret: "S-2", fragile: "F-2" },
    }
  );
  return id;
}

const at = (id: string) => ({
  scopeKind: "collection" as const,
  slug: "posts",
  entryId: id,
});

describe.each(getConfiguredTestDialects())(
  "field read rules in history (integration, %s)",
  dialect => {
    it("withholds a component field from a version a reader may not read it in", async () => {
      const id = await documentWithGuardedComponent(dialect);

      const clerk = await getVersionForDocument({
        ...at(id),
        user: CLERK,
        versionNo: 1,
      });
      expect(secretsIn(clerk)).toEqual([]);
      // Named, so the reader is told a value is held back.
      expect(clerk.withheld).toContain("banner.secret");
      // The rest of the component is still there, and the reader the rule
      // allows still sees the field.
      expect(JSON.stringify(clerk)).toContain("H1");
      const boss = await getVersionForDocument({
        ...at(id),
        user: BOSS,
        versionNo: 1,
      });
      expect(secretsIn(boss)).toEqual(["S-1"]);
    });

    it("withholds it from a comparison, and says so", async () => {
      const id = await documentWithGuardedComponent(dialect);

      const diff = await getVersionDiffForDocument({
        ...at(id),
        user: CLERK,
        from: 1,
        to: 2,
      });
      expect(secretsIn(diff)).toEqual([]);
      // Named in its place inside the component, not left out unexplained.
      expect(hiddenNodes(diff).map(node => node.name)).toContain("secret");
    });

    it("withholds a value whose read rule cannot be evaluated, and says so", async () => {
      const id = await documentWithGuardedComponent(dialect);

      const read = await getVersionForDocument({
        ...at(id),
        user: BOSS,
        versionNo: 1,
      });
      expect(JSON.stringify(read)).not.toContain("F-1");
      expect(read.withheld).toContain("banner.fragile");
      // A rule that fails withholds only its own field.
      expect(secretsIn(read)).toEqual(["S-1"]);
    });

    it("judges an API key on its own grants, as the document read does", async () => {
      const id = await documentWithGuardedComponent(dialect);

      const asKey = await getVersionForDocument({
        ...at(id),
        user: CLERK,
        // As authentication stamps a key: the stored slug and what it grants.
        authenticatedScope: {
          actorType: "apiKey",
          permissions: ["read-posts"],
          grants: [{ slug: "read-posts", action: "read", resource: "posts" }],
        },
        versionNo: 1,
      });
      expect(JSON.stringify(asKey)).toContain("K-1");
      // The same user without the key's scope has no such permission.
      const asSession = await getVersionForDocument({
        ...at(id),
        user: CLERK,
        versionNo: 1,
      });
      expect(JSON.stringify(asSession)).not.toContain("K-1");
      expect(asSession.withheld).toContain("keyed");
    });

    it("does not restore a component field the restorer may not read", async () => {
      const id = await documentWithGuardedComponent(dialect);

      const result = await restoreVersion({
        ...at(id),
        user: CLERK,
        versionNo: 1,
      });
      expect(JSON.stringify(result)).toContain("banner");
      const live = await current!.getService("collectionsHandler").getEntry({
        collectionName: "posts",
        entryId: id,
        overrideAccess: true,
        depth: 0,
      });
      // The guarded value the restorer never saw is not written back, nor one
      // whose rule could not be evaluated.
      expect(secretsIn(live.data)).toEqual(["S-2"]);
      expect(JSON.stringify(live.data)).toContain("F-2");
    });
  }
);
