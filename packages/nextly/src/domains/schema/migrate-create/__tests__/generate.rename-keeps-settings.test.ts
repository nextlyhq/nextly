/**
 * A rename that keeps the column's type keeps the other change made with it, in the file
 * `migrate:create` writes, on every dialect.
 *
 * A rename is the collapsed pair of a dropped column and an added one, and the added one carried
 * the column's new nullability and default. Collapsing the pair used to keep only the type: a field
 * renamed and made required in one change wrote the RENAME and nothing else, so the column stayed
 * nullable while the snapshot written beside the file said it was not.
 *
 * Read from the file, both halves: the UP must make the change, and the DOWN must put it back
 * before the column returns to its old name.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TableSpec } from "../../pipeline/diff/types";
import type { AppStreamTables } from "../app-stream";
import { parseSqlSections } from "../../../../cli/commands/migrate";
import { generateMigration, type MinimalConfigEntity } from "../generate";

const posts = (fields: MinimalConfigEntity["fields"]): MinimalConfigEntity => ({
  slug: "posts",
  tableName: "dc_posts",
  fields,
});

/** A table the app declares, whose `label` column carries a default the schema states. */
function notes(
  dialect: SupportedDialect,
  column: string,
  columnDefault: string,
  index?: { name: string; unique: boolean }
): AppStreamTables {
  const spec: TableSpec = {
    name: "app_notes",
    columns: [
      { name: "id", type: "text", nullable: false, primaryKey: true },
      {
        name: column,
        type: dialect === "mysql" ? "varchar(64)" : "text",
        nullable: true,
        default: columnDefault,
      },
    ],
    indexes: index === undefined ? [] : [{ ...index, columns: [column] }],
  };
  return { owned: [spec], contributed: new Map(), baselines: new Map() };
}

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

describe.each(DIALECTS)(
  "a same-type rename in a generated file (%s)",
  dialect => {
    let dir: string;
    let made = 0;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "nextly-rename-settings-"));
      made = 0;
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    async function create(input: {
      collections?: MinimalConfigEntity[];
      appStream?: AppStreamTables;
    }): Promise<{ up: string; down: string }> {
      made += 1;
      const result = await generateMigration({
        name: `step_${made}`,
        dialect,
        migrationsDir: dir,
        collections: input.collections ?? [],
        singles: [],
        components: [],
        ...(input.appStream ? { appStream: input.appStream } : {}),
        nonInteractive: true,
        autoAcceptRenames: true,
        now: new Date(Date.UTC(2026, 9, 28, 12, made)),
      });
      if (result === null) throw new Error("no migration was written");
      const sections = parseSqlSections(
        await readFile(result.sqlPath, "utf-8")
      );
      return { up: sections.upSql, down: sections.downSql };
    }

    /** The position of `pattern` in `sql`, failing when it is not there. */
    function at(sql: string, pattern: RegExp): number {
      const found = pattern.exec(sql);
      expect(found, `${pattern} in:\n${sql}`).not.toBeNull();
      return found?.index ?? -1;
    }

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    /** How the dialect's file makes `column` NOT NULL (or nullable again). */
    function nullability(column: string, required: boolean): RegExp {
      if (dialect === "postgresql") {
        return new RegExp(
          `ALTER TABLE "dc_posts" ALTER COLUMN "${column}" ${required ? "SET" : "DROP"} NOT NULL`
        );
      }
      if (dialect === "mysql") {
        // Restated from the column as the database has it when the file runs, so the comment,
        // character set and collation the snapshot does not record travel with it.
        return new RegExp(
          `MODIFY COLUMN \`${column}\` ', COLUMN_TYPE[\\s\\S]*' ${required ? "NOT NULL" : "NULL"}'[\\s\\S]*TABLE_NAME = 'dc_posts' AND COLUMN_NAME = '${column}'`
        );
      }
      // SQLite has no statement that changes nullability: the table is rebuilt to its target.
      return new RegExp(
        `CREATE TABLE "__new_dc_posts" \\([\\s\\S]*"${column}" text${required ? " NOT NULL" : "(,|\\n)"}`
      );
    }

    function rename(table: string, from: string, to: string): RegExp {
      return dialect === "mysql"
        ? new RegExp(
            `RENAME COLUMN \\\`${from}\\\` TO \\\`${to}\\\`[\\s\\S]*TABLE_NAME = '${table}'`
          )
        : new RegExp(
            `ALTER TABLE "${table}" RENAME COLUMN "${from}" TO "${to}"`
          );
    }

    it("makes the renamed column NOT NULL when the field became required", async () => {
      await create({
        collections: [posts([{ name: "description", type: "text" }])],
      });
      const { up, down } = await create({
        collections: [
          posts([{ name: "summary", type: "text", required: true }]),
        ],
      });

      expect(at(up, rename("dc_posts", "description", "summary"))).toBeLessThan(
        at(up, nullability("summary", true))
      );
      // Undone under the new name, then the name goes back. On SQLite the DOWN's rebuild targets the
      // table as it was, old name included, so it runs once the name is back.
      if (dialect === "sqlite") {
        expect(
          at(down, rename("dc_posts", "summary", "description"))
        ).toBeLessThan(at(down, nullability("description", false)));
      } else {
        expect(at(down, nullability("summary", false))).toBeLessThan(
          at(down, rename("dc_posts", "summary", "description"))
        );
      }
    });

    it("makes the renamed column nullable when the field stopped being required", async () => {
      await create({
        collections: [
          posts([{ name: "description", type: "text", required: true }]),
        ],
      });
      const { up } = await create({
        collections: [posts([{ name: "summary", type: "text" }])],
      });

      expect(at(up, rename("dc_posts", "description", "summary"))).toBeLessThan(
        at(up, nullability("summary", false))
      );
    });

    it("gives the renamed column the default its schema now states", async () => {
      await create({ appStream: notes(dialect, "label", "'draft'") });
      const { up, down } = await create({
        appStream: notes(dialect, "caption", "'final'"),
      });

      const setDefault =
        dialect === "sqlite"
          ? /CREATE TABLE "__new_app_notes" \([\s\S]*"caption" text DEFAULT 'final'/
          : new RegExp(
              `ALTER TABLE ${q("app_notes")} ALTER COLUMN ${q("caption")} SET DEFAULT 'final'`
            );
      const restoreDefault =
        dialect === "sqlite"
          ? /CREATE TABLE "__new_app_notes" \([\s\S]*"label" text DEFAULT 'draft'/
          : new RegExp(
              `ALTER TABLE ${q("app_notes")} ALTER COLUMN ${q("caption")} SET DEFAULT 'draft'`
            );
      expect(at(up, rename("app_notes", "label", "caption"))).toBeLessThan(
        at(up, setDefault)
      );
      if (dialect === "sqlite") {
        // The DOWN's rebuild targets the table as it was, so it runs once the name is back.
        expect(at(down, rename("app_notes", "caption", "label"))).toBeLessThan(
          at(down, restoreDefault)
        );
      } else {
        expect(at(down, restoreDefault)).toBeLessThan(
          at(down, rename("app_notes", "caption", "label"))
        );
      }
    });

    it.each([
      { name: "uq_app_notes_lookup", unique: true },
      { name: "idx_app_notes_lookup", unique: false },
    ])(
      "keeps the index $name on the renamed column, neither dropping nor recreating it",
      async index => {
        await create({ appStream: notes(dialect, "label", "'draft'", index) });
        const { up, down } = await create({
          appStream: notes(dialect, "caption", "'draft'", index),
        });

        at(up, rename("app_notes", "label", "caption"));
        // The rename moves the column inside the index on every dialect; a drop here with no
        // create after it would leave the table without the index, or without its uniqueness.
        for (const sql of [up, down]) {
          expect(sql).not.toMatch(
            new RegExp(`(DROP|CREATE)( UNIQUE)? INDEX[^;]*${index.name}`)
          );
        }
      }
    );

    it("writes only the rename when nothing else about the column changed", async () => {
      await create({
        collections: [posts([{ name: "description", type: "text" }])],
      });
      const { up } = await create({
        collections: [posts([{ name: "summary", type: "text" }])],
      });

      at(up, rename("dc_posts", "description", "summary"));
      expect(up).not.toMatch(
        /NOT NULL|DROP NOT NULL|SET DEFAULT|MODIFY COLUMN|__new_dc_posts/
      );
    });
  }
);
