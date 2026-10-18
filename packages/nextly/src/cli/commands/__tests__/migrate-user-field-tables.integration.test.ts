/**
 * `nextly migrate` provisions the table a project's user fields are stored in,
 * on every configured dialect.
 *
 * A production database is set up by `nextly migrate` alone, and a production
 * boot never changes the schema. So when only the boot's background tasks
 * created `user_ext`, a database that never ran `next dev` lacked it, and a
 * read of a user field failed with "no such table".
 *
 * - With user fields configured, migrate creates `user_ext` with a column for
 *   each field;
 * - with none configured, it creates no table;
 * - on a database whose `user_ext` predates a newly configured field, it adds
 *   that field's column and keeps the existing ones;
 * - a unique field gets its unique index;
 * - a statement that fails for a reason other than "already exists" fails the
 *   step, rather than letting migrate report storage it never made;
 * - with no config file loaded, it changes nothing: syncing the defaults'
 *   empty field list would delete every code-defined field's definition.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { text } from "../../../collections/fields/helpers";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createLogger } from "../../utils/logger";
import { provisionUserFieldTables } from "../migrate";

const logger = createLogger({ quiet: true });

describe.each(getConfiguredTestDialects())(
  "migrate provisions the user fields' table (%s)",
  dialect => {
    let handle: TestNextly;
    const q = dialect === "mysql" ? "`" : '"';

    /** Whether `user_ext` has a column of this name: a read of it fails otherwise. */
    async function hasColumn(name: string): Promise<boolean> {
      try {
        await handle.adapter.executeQuery(
          `SELECT ${q}${name}${q} FROM ${q}user_ext${q} WHERE 1 = 0`
        );
        return true;
      } catch {
        return false;
      }
    }

    /** The names of the indexes on `user_ext`, read from the dialect's catalog. */
    async function indexNames(): Promise<string[]> {
      const sql =
        dialect === "postgresql"
          ? `SELECT indexname AS name FROM pg_indexes WHERE tablename = 'user_ext'`
          : dialect === "mysql"
            ? `SELECT INDEX_NAME AS name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_ext'`
            : `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'user_ext'`;
      const rows = await handle.adapter.executeQuery<{ name: unknown }>(sql);
      return rows.map(r => String(r.name));
    }

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      await handle.adapter.executeQuery(
        `DROP TABLE IF EXISTS ${q}user_ext${q}`
      );
    });

    afterEach(async () => {
      await handle?.adapter.executeQuery(
        `DROP TABLE IF EXISTS ${q}user_ext${q}`
      );
      await handle?.destroy();
    });

    it("creates user_ext with a column for each configured field", async () => {
      expect(await handle.adapter.tableExists("user_ext")).toBe(false);

      await provisionUserFieldTables(
        { fields: [text({ name: "bio" }), text({ name: "company" })] },
        handle.adapter,
        logger
      );

      expect(await handle.adapter.tableExists("user_ext")).toBe(true);
      expect(await hasColumn("bio")).toBe(true);
      expect(await hasColumn("company")).toBe(true);
    });

    it("creates no table when no user fields are configured", async () => {
      await provisionUserFieldTables({ fields: [] }, handle.adapter, logger);

      expect(await handle.adapter.tableExists("user_ext")).toBe(false);
    });

    it("adds a newly configured field's column to an existing user_ext", async () => {
      await provisionUserFieldTables(
        { fields: [text({ name: "bio" })] },
        handle.adapter,
        logger
      );
      expect(await hasColumn("company")).toBe(false);

      await provisionUserFieldTables(
        { fields: [text({ name: "bio" }), text({ name: "company" })] },
        handle.adapter,
        logger
      );

      expect(await hasColumn("bio")).toBe(true);
      expect(await hasColumn("company")).toBe(true);
    });

    it("gives a unique field its unique index", async () => {
      await provisionUserFieldTables(
        { fields: [text({ name: "employeeId", unique: true })] },
        handle.adapter,
        logger
      );

      expect(await indexNames()).toContain("uq_user_ext_employee_id");
    });

    it("fails, rather than reporting storage ready, when a statement fails", async () => {
      // A user_ext of the wrong shape, with no user_id column: the index on
      // user_id cannot be made, which is not the "already exists" a re-run
      // expects.
      await handle.adapter.executeQuery(
        `CREATE TABLE ${q}user_ext${q} (${q}id${q} VARCHAR(36) PRIMARY KEY)`
      );

      await expect(
        provisionUserFieldTables(
          { fields: [text({ name: "bio" })] },
          handle.adapter,
          logger
        )
      ).rejects.toThrow();
    });

    it("leaves the field definitions alone when no config file was loaded", async () => {
      await provisionUserFieldTables(
        { fields: [text({ name: "bio" })] },
        handle.adapter,
        logger
      );

      expect(await provisionUserFieldTables(null, handle.adapter, logger)).toBe(
        0
      );

      const rows = await handle.adapter.executeQuery<{ name: unknown }>(
        `SELECT ${q}name${q} AS name FROM ${q}user_field_definitions${q}`
      );
      expect(rows.map(r => String(r.name))).toEqual(["bio"]);
    });
  }
);
