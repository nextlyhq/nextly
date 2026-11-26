/**
 * A code-first collection or Single cannot give a field that stores no column of its own the
 * exact name of a system field (`title`, `slug`).
 *
 * The table keeps the system column wherever no field holds it, and a component, a many-to-many
 * or a virtual field holds none, so one named `slug` answers to that column's name. With a
 * component there, no entry could be created and a stored value read as nothing; a virtual
 * field's type was applied to the column's value. The start refuses such a configuration, naming
 * the field, before the adapter connects, so nothing is created: as the author declares it, and
 * as a plugin's setup leaves it, whatever became of the field `define*` added. The same field
 * under another name is written and read through the Direct API and REST, the system `slug`
 * beside it keeping its own value.
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
import { MemoryPrivateStorage } from "../../../domains/files/__tests__/memory-private-storage";
import { seedLiveAuthor } from "../../../domains/releases/__tests__/helpers/live-author";
import { definePlugin } from "../../../plugins/plugin-context";
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

type Fields = Array<Record<string, unknown>>;

/** A plugin whose setup changes the fields of the app's one entity of `kind` named `slug`. */
function reshaping(
  kind: "collections" | "singles",
  slug: string,
  change: (fields: Fields) => Fields
) {
  return definePlugin({
    name: "@test/reshape",
    version: "1.0.0",
    nextly: ">=0.0.0",
    setup(config) {
      const entities = (config[kind] ?? []) as unknown as Array<{
        slug: string;
        fields: Fields;
      }>;
      return {
        ...config,
        [kind]: entities.map(entity =>
          entity.slug === slug
            ? { ...entity, fields: change(entity.fields) }
            : entity
        ),
      } as typeof config;
    },
  });
}

const componentNamed = (name: string) => ({
  name,
  type: "component",
  component: SEO,
});

const without = (fields: Fields, name: string) =>
  fields.filter(field => field.name !== name);

const DOCS = "sfndocs";

/** An app with a collection of files, and the private storage such a collection needs. */
const filesApp = () => ({
  collections: [
    defineCollection({
      slug: DOCS,
      files: {
        visibility: "private",
        accept: ["application/pdf"],
        maxSize: 1000,
      },
      fields: [text({ name: "note" })],
    }),
  ],
  storagePlugins: [new MemoryPrivateStorage().plugin([DOCS])],
});

const plainPosts = () =>
  defineCollection({ slug: POSTS, fields: [text({ name: "body" })] });

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

    // What a plugin's setup left of the app's own, valid collection: the system columns stay,
    // so the name is refused whatever became of the field `define*` added.
    const left: Array<
      [
        string,
        ReturnType<typeof defineCollection>,
        (f: Fields) => Fields,
        string,
      ]
    > = [
      [
        "removed the system slug and added a component slug",
        plainPosts(),
        fields => [...without(fields, "slug"), componentNamed("slug")],
        "slug",
      ],
      [
        "removed both system fields and added a component slug",
        plainPosts(),
        fields => [
          ...without(without(fields, "slug"), "title"),
          componentNamed("slug"),
        ],
        "slug",
      ],
      [
        "made the system slug virtual in place",
        plainPosts(),
        fields =>
          fields.map(field =>
            field.name === "slug" ? { ...field, virtual: true } : field
          ),
        "slug",
      ],
      [
        "made the system title a virtual date in place",
        plainPosts(),
        fields =>
          fields.map(field =>
            field.name === "title"
              ? { ...field, type: "date", virtual: true }
              : field
          ),
        "title",
      ],
      [
        "swapped the author's own text slug for a component",
        defineCollection({
          slug: POSTS,
          fields: [text({ name: "title" }), text({ name: "slug" })],
        }),
        fields => [...without(fields, "slug"), componentNamed("slug")],
        "slug",
      ],
    ];
    it.each(left)(
      "refuses the start where a plugin's setup %s, naming it",
      async (_, posts, change, name) => {
        const lines = await refusedStart(dialect, {
          fieldGroups: [seo],
          collections: [posts],
          plugins: [reshaping("collections", POSTS, change)],
        });

        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(
          /^collections\[0\]\.fields\[\d\]\.name FIELD_NAME_RESERVED /
        );
        expect(lines[0]).toContain(`Field '${name}' stores no column`);
        expect(lines[0]).toContain("A plugin's setup left the field this way");
      }
    );

    it("refuses the start where the author declared the component and a setup removed the system slug, with no word of a setup", async () => {
      const lines = await refusedStart(dialect, {
        fieldGroups: [seo],
        collections: [
          defineCollection({
            slug: POSTS,
            fields: [text({ name: "body" }), componentNamed("slug") as never],
          }),
        ],
        plugins: [
          reshaping("collections", POSTS, fields =>
            fields.filter(f => !(f.name === "slug" && f.type === "text"))
          ),
        ],
      });

      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("Field 'slug' stores no column");
      expect(lines[0]).not.toContain("A plugin's setup");
    });

    it("refuses the start where a setup swapped a Single's system title for a component, naming it", async () => {
      const lines = await refusedStart(dialect, {
        fieldGroups: [seo],
        singles: [
          defineSingle({ slug: HOME, fields: [text({ name: "headline" })] }),
        ],
        plugins: [
          reshaping("singles", HOME, fields => [
            ...without(fields, "title"),
            componentNamed("title"),
          ]),
        ],
      });

      expect(lines).toEqual([
        expect.stringMatching(
          /^singles\[0\]\.fields\[2\]\.name FIELD_NAME_RESERVED Field 'title' stores no column/
        ),
      ]);
    });

    it.each([
      ["swapped for a component", () => componentNamed("storageKey")],
      [
        "made virtual",
        (field: Record<string, unknown>) => ({ ...field, virtual: true }),
      ],
    ])(
      "refuses the start where a setup's storage key was %s, with advice of its own",
      async (_, change) => {
        const lines = await refusedStart(dialect, {
          fieldGroups: [seo],
          ...filesApp(),
          plugins: [
            reshaping("collections", DOCS, fields =>
              fields.map(field =>
                field.name === "storageKey"
                  ? (change as (f: typeof field) => typeof field)(field)
                  : field
              )
            ),
          ],
        });

        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("Field 'storageKey' stores no column");
        expect(lines[0]).toContain("a collection of files keeps");
        expect(lines[0]).not.toContain("to replace Nextly's");
      }
    );

    it("starts with a collection of files a setup was handed and left as declared", async () => {
      current = await createTestNextly({
        dialect,
        ...filesApp(),
        plugins: [reshaping("collections", DOCS, fields => fields)],
      });
      expect(await current.adapter.tableExists(`dc_${DOCS}`)).toBe(true);
    });

    it("starts where a setup only removed the system slug, and writes and reads an entry's slug", async () => {
      current = await createTestNextly({
        dialect,
        collections: [plainPosts()],
        plugins: [
          reshaping("collections", POSTS, fields => without(fields, "slug")),
        ],
      });
      const written = await current.nextly.create({
        collection: POSTS,
        data: { title: "One", slug: "one" },
      });
      const read = (await current.nextly.findByID({
        collection: POSTS,
        id: (written.item as { id: string }).id,
      })) as Record<string, unknown>;
      expect(read).toMatchObject({ title: "One", slug: "one" });
    });

    it("starts with a field group that holds a column-less title, which has no system one", async () => {
      current = await createTestNextly({
        dialect,
        fieldGroups: [
          seo,
          defineFieldGroup({
            slug: "sfncard",
            fields: [text({ name: "label" }), componentNamed("title") as never],
          }),
        ],
        collections: [plainPosts()],
        plugins: [reshaping("collections", POSTS, fields => fields)],
      });
      expect(await current.adapter.tableExists("comp_sfncard")).toBe(true);
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
