/**
 * A code-first collection or Single cannot give a field that stores no column of its own the
 * exact name of a system field (`title`, `slug`).
 *
 * `define*` adds its own text `title` and `slug` wherever no field holds their columns, and a
 * component, a many-to-many or a virtual field holds none, so one named `slug` would stand
 * beside the added text `slug` and the two would read and write one document key. The start
 * refuses such a configuration, naming the field, before the adapter connects, so nothing is
 * created. The same field under another name is written and read through the Direct API and
 * REST, the system `slug` beside it keeping its own value.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { runWithRequestCaller } from "../../../auth/caller-scope";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  text,
} from "../../../config";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { seedLiveAuthor } from "../../../domains/releases/__tests__/helpers/live-author";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";

const POSTS = "sfnposts";
const TAGS = "sfntags";
const HOME = "sfnhome";
const SEO = "sfnseo";

const seo = defineFieldGroup({
  slug: SEO,
  fields: [text({ name: "metaTitle" })],
});
const tags = defineCollection({
  slug: TAGS,
  fields: [text({ name: "label" })],
});

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The problems a refused start names, as `path code message` lines. */
async function refusedStart(
  dialect: TestDialect,
  config: Parameters<typeof createTestNextly>[0]
): Promise<string[]> {
  let refusal: unknown;
  try {
    current = await createTestNextly({ dialect, ...config });
  } catch (error) {
    refusal = error;
  }
  expect(refusal, "the start was not refused").toBeDefined();
  expect((refusal as { code?: unknown }).code).toBe("VALIDATION_ERROR");
  const errors = (refusal as { publicData?: { errors?: unknown } }).publicData
    ?.errors;
  expect(Array.isArray(errors), String(refusal)).toBe(true);
  return (errors as Array<{ path: string; code: string; message: string }>).map(
    e => `${e.path} ${e.code} ${e.message}`
  );
}

/** A REST call through the dispatcher the route handler calls, as the founder, as JSON. */
async function rest(
  t: TestNextly,
  founder: string,
  method: string,
  params: Record<string, unknown>,
  body?: unknown
): Promise<Record<string, unknown>> {
  const result = await runWithRequestCaller(
    {
      userId: founder,
      actor: { type: "user", id: founder },
      roles: ["super-admin"],
    },
    () =>
      dispatchCollections(
        new ServiceContainer(t.adapter),
        method,
        params as never,
        body
      )
  );
  const json = (
    result instanceof Response ? await result.json() : result
  ) as Record<string, unknown>;
  return (json.item ?? json.data ?? json) as Record<string, unknown>;
}

describe.each(getConfiguredTestDialects())(
  "a column-less field named as a system field (%s)",
  (dialect: TestDialect) => {
    it("refuses the start for a collection's component named 'slug', naming it", async () => {
      const lines = await refusedStart(dialect, {
        fieldGroups: [seo],
        collections: [
          defineCollection({
            slug: POSTS,
            fields: [
              text({ name: "body" }),
              { name: "slug", type: "component", component: SEO } as never,
            ],
          }),
        ],
      });

      expect(lines).toEqual([
        expect.stringMatching(
          /^collections\[0\]\.fields\[3\]\.name FIELD_NAME_RESERVED Field 'slug' stores no column/
        ),
      ]);
    });

    it("refuses the start for a collection's many-to-many named 'title', naming it", async () => {
      const lines = await refusedStart(dialect, {
        collections: [
          tags,
          defineCollection({
            slug: POSTS,
            fields: [
              text({ name: "body" }),
              {
                name: "title",
                type: "relationship",
                relationTo: TAGS,
                options: { relationType: "manyToMany" },
              } as never,
            ],
          }),
        ],
      });

      expect(lines).toEqual([
        expect.stringMatching(
          /^collections\[1\]\.fields\[3\]\.name FIELD_NAME_RESERVED Field 'title' stores no column/
        ),
      ]);
    });

    it("refuses the start for a Single's virtual field named 'slug', naming it", async () => {
      const lines = await refusedStart(dialect, {
        singles: [
          defineSingle({
            slug: HOME,
            fields: [
              text({ name: "headline" }),
              { name: "slug", type: "text", virtual: true } as never,
            ],
          }),
        ],
      });

      expect(lines).toEqual([
        expect.stringMatching(
          /^singles\[0\]\.fields\[3\]\.name FIELD_NAME_RESERVED Field 'slug' stores no column/
        ),
      ]);
    });

    it("writes and reads the field under another name through the Direct API and REST", async () => {
      current = await createTestNextly({
        dialect,
        fieldGroups: [seo],
        collections: [
          defineCollection({
            slug: POSTS,
            fields: [
              text({ name: "body" }),
              { name: "slugSeo", type: "component", component: SEO } as never,
            ],
          }),
        ],
      });
      const t = current;

      const written = await t.nextly.create({
        collection: POSTS,
        data: {
          title: "Direct",
          slug: "direct",
          slugSeo: { metaTitle: "Direct meta" },
        },
      });
      const directId = (written.item as { id: string }).id;
      const direct = (await t.nextly.findByID({
        collection: POSTS,
        id: directId,
        depth: 1,
      })) as Record<string, unknown>;
      expect(direct.slug).toBe("direct");
      expect((direct.slugSeo as { metaTitle?: string }).metaTitle).toBe(
        "Direct meta"
      );

      const founder = await seedLiveAuthor(t);
      const created = await rest(
        t,
        founder,
        "createEntry",
        { collectionName: POSTS },
        {
          title: "Rest",
          slug: "rest",
          slugSeo: { metaTitle: "Rest meta" },
        }
      );
      const read = await rest(t, founder, "getEntry", {
        collectionName: POSTS,
        entryId: created.id,
        depth: 1,
      });
      expect(read.slug).toBe("rest");
      expect((read.slugSeo as { metaTitle?: string }).metaTitle).toBe(
        "Rest meta"
      );
    });
  }
);
