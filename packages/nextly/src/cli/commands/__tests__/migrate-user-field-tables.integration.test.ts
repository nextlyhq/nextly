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
 *   that field's column and keeps the existing ones.
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
  }
);
