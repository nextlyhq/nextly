/**
 * A fixture plugin that exercises the schema a plugin can declare, written the
 * way a plugin author writes one: tables of its own with the migration modules
 * that carry them to production, a foreign key and a relation between them, a
 * key to a core table, a hidden column on a collection it does not own, and
 * install and uninstall hooks. Everything comes from `@nextlyhq/plugin-sdk`,
 * never `nextly`.
 *
 * People keep reading lists of posts: `reading__lists` and
 * `reading__list_items` (see `schema.ts`), and each post carries a hidden
 * `saved_count` that the plugin keeps in step (see `lists.ts`).
 *
 * The playground registers it only when `NEXTLY_PLAYGROUND_PLUGINS` names
 * `reading-lists`, so a contributor's daily playground and the browser
 * suites never meet its tables. Its integration test installs, uses and
 * uninstalls it with the real `nextly` commands on every dialect
 * (`reading-lists.integration.test.ts`).
 *
 * To change its schema, edit `schema.ts`, bump `SCHEMA_VERSION`, and run,
 * from `apps/playground`:
 *
 *   pnpm nextly migrate:create --plugin ./src/plugins/reading-lists-fixture/plugin.ts
 *
 * which writes the next module to `./migrations` beside this file.
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";

import { clearCounts, recountAll } from "./lists";
import { migrations } from "./migrations";
import { lists, listItems, PREFIX, POSTS_TABLE, postColumns } from "./schema";

/** The name the install commands and the migration ledger know it by. */
export const READING_LISTS_PLUGIN = "reading-lists-fixture";

/**
 * The schema version the newest migration module ends at. A production start
 * refuses the plugin until the database has reached it.
 */
const SCHEMA_VERSION = 1;

export const readingListsFixturePlugin = definePlugin({
  name: READING_LISTS_PLUGIN,
  version: "0.0.0",
  nextly: "*",
  schemaVersion: SCHEMA_VERSION,
  contributes: {
    schema: {
      prefix: PREFIX,
      tables: [lists, listItems],
      migrations,
      // The hidden column and its index on the posts table. The app's own
      // migrations carry an addition to a collection's table, so
      // `nextly migrate:create` in the app writes it, not this plugin's
      // modules. Those modules are compiled from the plugin alone, where the
      // posts table does not exist, so the hook skips it there.
      extend: [
        ({ schema }) => {
          if (!schema.getTable(POSTS_TABLE)) return;
          schema.extendTable(POSTS_TABLE, {
            columns: postColumns,
            indexes: [{ columns: ["savedCount"] }],
          });
        },
      ],
    },
  },
  // Runs once per install, after the plugin's migrations, never at boot. A
  // reinstall after `nextly plugins uninstall --keep-data` finds the kept
  // items, so the counts are rebuilt from them; on a first install there are
  // none and nothing is written.
  async onInstall(ctx) {
    await recountAll(ctx.db);
  },
  // Runs before the DOWN, while the items can still be read. Without
  // `--keep-data` they are about to go, so the counts they made go first; with
  // it they stay, and the next install recounts from them.
  async onUninstall(ctx, { keepData }) {
    if (!keepData) await clearCounts(ctx.db);
  },
});
