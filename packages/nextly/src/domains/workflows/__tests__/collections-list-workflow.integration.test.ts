/**
 * The collections list names the workflow that holds each collection's publishing, for a signed-in
 * reader, as the single collection read does: the admin's Content panel leads with "Waiting for my
 * review" where any workflow holds content. A list read with no signed-in caller (trusted server
 * code) carries no `workflow` key at all, on every configured dialect.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { defineCollection, text } from "../../../config";
import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";

import { bootSteps, person } from "./helpers/step-harness";
import { editorial } from "./helpers/step-workflows";

type Doc = Record<string, unknown>;

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

/** A collection no workflow holds. */
const notes = defineCollection({
  slug: "notes",
  fields: [text({ name: "title" })],
});

/** The collections list, read over REST by the signed-in person `userId`. */
async function listAs(userId: string): Promise<Doc[]> {
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: `${userId}@example.test`,
      name: userId,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  const request = new Request("http://localhost/api/collections?limit=100", {
    method: "GET",
    headers: {
      cookie: `nextly_session=${token}`,
      origin: "http://localhost",
    },
  });
  const response = await createDynamicHandlers().GET(request, {
    params: Promise.resolve({ params: ["collections"] }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: Doc[] }).items;
}

describe.each(getConfiguredTestDialects())(
  "the collections list's workflow (%s)",
  dialect => {
    it("names each collection's workflow for a signed-in reader, and null where none holds it", async () => {
      t = await bootSteps(dialect, undefined, { collections: [notes] });
      await person(t, "reader", [
        ["read", "posts"],
        ["read", "notes"],
      ]);

      const items = await listAs("reader");
      const bySlug = new Map(items.map(item => [item.slug, item]));
      expect(bySlug.get("posts")?.workflow).toEqual({
        slug: editorial.slug,
        label: editorial.label,
      });
      expect(bySlug.get("notes")).toHaveProperty("workflow", null);
    });

    it("carries no workflow key on a list read with no signed-in caller", async () => {
      t = await bootSteps(dialect, undefined, { collections: [notes] });
      const handler = t.getService("collectionsHandler") as unknown as {
        listCollections(options?: { limit?: number }): Promise<{
          data?: Doc[];
        }>;
      };

      const result = await handler.listCollections({ limit: 100 });
      const items = result.data ?? [];
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) expect(item).not.toHaveProperty("workflow");
    });
  }
);
