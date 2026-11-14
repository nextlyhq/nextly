/**
 * The Builder's field save refuses a name the Draft/Published lifecycle owns, on every dialect.
 *
 * While drafts are on, a collection's or a Single's table carries `status` and `first_published_at`
 * for the lifecycle, and the lifecycle emits a member under each name. A field the save adds under
 * one of them would be declared twice, so the save refuses it before anything is written: the
 * registry keeps its fields and the table its columns. With drafts off neither column exists, and
 * a field named `status` is an ordinary field whose value is kept.
 *
 * A name longer than the database keeps whole is asked here too: a field whose name passes
 * PostgreSQL's 63-character limit, alone and beside another sharing its first 63 characters, saved
 * through the Builder and read back with its value.
 *
 * Every save runs under `NODE_ENV=development`, where a Builder save applies its DDL at once, so a
 * save that failed to refuse would leave a column and a registry field behind for the readers.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";

type Field = Record<string, unknown> & { name: string; type: string };

const BODY: Field[] = [{ name: "body", type: "text" }];

describeEachDialect(
  "the Builder's field save and the names it takes",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({ dialect, collections: [] });
    });

    afterEach(async () => {
      await current.destroy();
      vi.unstubAllEnvs();
    });

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    async function query<T>(sql: string): Promise<T[]> {
      return (
        current.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(sql);
    }

    async function columnsOf(table: string): Promise<string[]> {
      const rows = await query<{ name: string }>(
        dialect === "mysql"
          ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
          : dialect === "sqlite"
            ? `SELECT name FROM pragma_table_info('${table}')`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
      );
      return rows.map(row => row.name).sort();
    }

    /** The registry row's field names and schema version for `slug` in `registry`. */
    async function registered(
      registry: string,
      slug: string
    ): Promise<{ names: string[]; version: number }> {
      const [row] = await query<{ fields: unknown; schema_version: unknown }>(
        `SELECT ${q("fields")} AS fields, ${q("schema_version")} AS schema_version FROM ${q(registry)} WHERE ${q("slug")} = '${slug}'`
      );
      const fields = (
        typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
      ) as { name: string }[];
      return {
        names: fields.map(field => field.name),
        version: Number(row?.schema_version ?? 1),
      };
    }

    /** What a save answered: its refusal's per-field entries, or "accepted". */
    async function answerOf(
      run: () => Promise<unknown>
    ): Promise<
      "accepted" | { code?: string; message?: string; path?: string }[]
    > {
      let result: unknown;
      try {
        result = await run();
      } catch (error) {
        const e = error as {
          code?: string;
          message?: string;
          publicData?: {
            errors?: { code?: string; message?: string; path?: string }[];
          };
        };
        return e.publicData?.errors ?? [{ code: e.code, message: e.message }];
      }
      const failed = result as {
        success?: boolean;
        code?: string;
        message?: string;
        data?: { errors?: { code?: string; message?: string }[] };
      } | null;
      if (failed && failed.success === false) {
        return (
          failed.data?.errors ?? [
            { code: failed.code, message: failed.message },
          ]
        );
      }
      return "accepted";
    }

    /** A Builder collection `posts` with `fields`, drafts on or off. */
    async function posts(drafts: boolean, fields: Field[] = BODY) {
      expect(
        await answerOf(() =>
          dispatchCollections(
            {} as ServiceContainer,
            "createCollection",
            {},
            { name: "posts", label: "Posts", fields, status: drafts }
          )
        )
      ).toBe("accepted");
    }

    /** The collection Builder's save: the apply its Save button sends. */
    /**
     * The collection Builder's save: the apply its Save button sends, with the pending
     * Draft/Published toggle when `status` is given, as the Builder sends it.
     */
    async function applyToPosts(fields: Field[], status?: boolean) {
      const { version } = await registered("dynamic_collections", "posts");
      return answerOf(() =>
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "posts" },
          {
            fields,
            confirmed: true,
            schemaVersion: version,
            ...(status === undefined ? {} : { status }),
          }
        )
      );
    }

    /** The one refusal for a name the lifecycle owns, naming the field. */
    const ownedByLifecycle = (name: string) => [
      expect.objectContaining({
        code: "RESERVED",
        message: expect.stringContaining(
          `Field name '${name}' is owned by the Draft/Published lifecycle`
        ),
      }),
    ];

    for (const name of ["status", "first_published_at"]) {
      it(`refuses a collection field named ${name} while drafts are on, and writes nothing`, async () => {
        await posts(true);
        const columnsBefore = await columnsOf("dc_posts");

        const answer = await applyToPosts([...BODY, { name, type: "text" }]);

        expect(answer).toEqual(ownedByLifecycle(name));
        expect(
          (await registered("dynamic_collections", "posts")).names
        ).toEqual(["body"]);
        expect(await columnsOf("dc_posts")).toEqual(columnsBefore);
      });

      it(`refuses a Single field named ${name} while drafts are on, and writes nothing`, async () => {
        expect(
          await answerOf(() =>
            dispatchSingles(
              "createSingle",
              {},
              { slug: "home", label: "Home", fields: BODY, status: true }
            )
          )
        ).toBe("accepted");
        const columnsBefore = await columnsOf("single_home");
        const { version } = await registered("dynamic_singles", "home");

        const answer = await answerOf(() =>
          dispatchSingles(
            "applySingleSchemaChanges",
            { slug: "home" },
            {
              fields: [...BODY, { name, type: "text" }],
              confirmed: true,
              schemaVersion: version,
            }
          )
        );

        expect(answer).toEqual(ownedByLifecycle(name));
        expect((await registered("dynamic_singles", "home")).names).toEqual([
          "body",
        ]);
        expect(await columnsOf("single_home")).toEqual(columnsBefore);
      });
    }

    // The Builder saves its settings after the fields, so a save turning drafts on sends the
    // pending toggle with them, and the field is refused under it before anything runs.
    it("refuses a collection field named status in the save that turns drafts on, and writes nothing", async () => {
      await posts(false);
      const columnsBefore = await columnsOf("dc_posts");

      const answer = await applyToPosts(
        [...BODY, { name: "status", type: "text" }],
        true
      );

      expect(answer).toEqual(ownedByLifecycle("status"));
      expect((await registered("dynamic_collections", "posts")).names).toEqual([
        "body",
      ]);
      expect(await columnsOf("dc_posts")).toEqual(columnsBefore);
    });

    it("refuses a Single field named status in the save that turns drafts on, and writes nothing", async () => {
      expect(
        await answerOf(() =>
          dispatchSingles(
            "createSingle",
            {},
            { slug: "home", label: "Home", fields: BODY, status: false }
          )
        )
      ).toBe("accepted");
      const columnsBefore = await columnsOf("single_home");
      const { version } = await registered("dynamic_singles", "home");

      const answer = await answerOf(() =>
        dispatchSingles(
          "applySingleSchemaChanges",
          { slug: "home" },
          {
            fields: [...BODY, { name: "status", type: "text" }],
            confirmed: true,
            schemaVersion: version,
            status: true,
          }
        )
      );

      expect(answer).toEqual(ownedByLifecycle("status"));
      expect((await registered("dynamic_singles", "home")).names).toEqual([
        "body",
      ]);
      expect(await columnsOf("single_home")).toEqual(columnsBefore);
    });

    // Turning drafts off lands after the fields, so the lifecycle's columns still stand while they
    // apply: the field is refused in that save too.
    it("refuses a collection field named status in the save that turns drafts off, and writes nothing", async () => {
      await posts(true);
      const columnsBefore = await columnsOf("dc_posts");

      const answer = await applyToPosts(
        [...BODY, { name: "status", type: "text" }],
        false
      );

      expect(answer).toEqual(ownedByLifecycle("status"));
      expect(await columnsOf("dc_posts")).toEqual(columnsBefore);
    });

    // The control: with drafts off there is no lifecycle column, so the same name is an ordinary
    // field, and the refusal above is the lifecycle's and not the name's.
    it("keeps a collection field named status while drafts are off, with its value", async () => {
      await posts(false);

      // The pending toggle off as well, as the Builder sends it for a collection without drafts.
      expect(
        await applyToPosts([...BODY, { name: "status", type: "text" }], false)
      ).toBe("accepted");
      expect((await registered("dynamic_collections", "posts")).names).toEqual([
        "body",
        "status",
      ]);
      const created = await current.nextly.create({
        collection: "posts",
        data: { body: "b", status: "kept" },
      });
      const read = await current.nextly.findByID({
        collection: "posts",
        id: String((created.item as { id: unknown }).id),
      });
      expect(read).toMatchObject({ status: "kept" });
    });

    // PostgreSQL keeps 63 characters of an identifier and MySQL 64. Past that, MySQL refuses the
    // column and PostgreSQL cuts the name, so two names sharing their first 63 characters reach one
    // column and the second cannot be added. Either way the save could never work, so it is refused.
    const LONGEST = "a".repeat(63);

    for (const [what, extra] of [
      [
        "a field whose column is longer than the database keeps",
        [`${LONGEST}_x`],
      ],
      [
        "two fields whose columns share the characters the database keeps",
        [`${LONGEST}_one`, `${LONGEST}_two`],
      ],
    ] as const) {
      it(`refuses ${what}, and writes nothing`, async () => {
        await posts(false);
        const columnsBefore = await columnsOf("dc_posts");

        const answer = await applyToPosts([
          ...BODY,
          ...extra.map(name => ({ name, type: "text" })),
        ]);

        expect(answer).toEqual([
          expect.objectContaining({
            code: "INVALID_FIELD_NAME",
            path: "1.name",
            message: expect.stringContaining("longer than 63 characters"),
          }),
        ]);
        expect(
          (await registered("dynamic_collections", "posts")).names
        ).toEqual(["body"]);
        expect(await columnsOf("dc_posts")).toEqual(columnsBefore);
      });
    }

    // The control: a name exactly as long as every database keeps saves, and its value is kept.
    it("saves a field whose column is as long as the database keeps, with its value", async () => {
      await posts(false);

      expect(
        await applyToPosts([...BODY, { name: LONGEST, type: "text" }])
      ).toBe("accepted");
      const created = await current.nextly.create({
        collection: "posts",
        data: { body: "b", [LONGEST]: "kept" },
      });
      const read = await current.nextly.findByID({
        collection: "posts",
        id: String((created.item as { id: unknown }).id),
      });
      expect(read).toMatchObject({ [LONGEST]: "kept" });
    });
  }
);
