/**
 * The one thing that turns plugin settings into SQL.
 *
 * Separated from the service so the policy — what is a secret, what the schema
 * accepts, what the admin is shown — is testable without a database, and so
 * the code that has to be right about three dialects is this file alone.
 *
 * @module domains/plugins/settings-store
 * @since 1.0.0
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, eq } from "drizzle-orm";

import { pluginSettingsTables } from "../../schemas/plugin-settings";

import type { PluginSettingRow, PluginSettingsStore } from "./settings-service";

/** The statements this store issues, against a handle or inside a transaction. */
interface SettingsWriter {
  select: () => {
    from: (table: unknown) => {
      where: (condition: unknown) => Promise<PluginSettingRow[]>;
    };
  };
  insert: (table: unknown) => {
    values: (data: unknown) => {
      onConflictDoUpdate: (args: unknown) => Promise<unknown>;
      onDuplicateKeyUpdate: (args: unknown) => Promise<unknown>;
    };
  };
  delete: (table: unknown) => {
    where: (condition: unknown) => Promise<unknown>;
  };
  update: (table: unknown) => {
    set: (data: unknown) => {
      where: (condition: unknown) => Promise<unknown>;
    };
  };
}

/** The slice of a Drizzle instance this store drives. */
interface SettingsDb extends SettingsWriter {
  /**
   * Declared rather than feature-detected, so a handle that cannot transact is
   * refused by the compiler instead of quietly writing half a patch. A settings
   * patch is one validated object: applying some of its keys leaves stored
   * settings that the plugin's own schema may reject on the next read, while
   * the caller has been told the write failed.
   */
  transaction: <T>(run: (tx: SettingsWriter) => Promise<T>) => Promise<T>;
}

/**
 * Settings stored in `nextly_plugin_settings`.
 *
 * The write is an upsert on `(owner, key)`, the table's primary key, so two
 * concurrent writers cannot produce two rows for one setting — the last write
 * wins and both complete, rather than one failing on a duplicate.
 */
export function createPluginSettingsStore(
  db: unknown,
  dialect: SupportedDialect
): PluginSettingsStore {
  const { nextlyPluginSettings: table } = pluginSettingsTables(dialect);
  const database = db as SettingsDb;

  /**
   * This plugin's rows.
   *
   * Unlocked, deliberately. The rows this update will WRITE are already held
   * by `claim`, and locking the owner's whole set on top of that is what
   * deadlocked two concurrent patches: each held its own key and then asked
   * for every key, including the one the other was holding. A key this update
   * does not write may move underneath the read, and that is harmless — it is
   * read to validate the whole settings object, never written back.
   */
  async function rowsFor(
    reader: SettingsWriter,
    owner: string
  ): Promise<PluginSettingRow[]> {
    return reader.select().from(table).where(eq(table.owner, owner));
  }

  /**
   * Take the row for `(owner, key)`, creating it if absent, and HOLD it.
   *
   * This is the only lock the update takes. A row that does not exist cannot
   * be locked by `FOR UPDATE`, so the statement inserts one; a row that does
   * exist is locked by updating it, which is why the conflict arm assigns the
   * key to itself rather than doing nothing. `DO NOTHING` takes no lock on
   * the existing row, so it would leave exactly the concurrent merge this
   * exists to prevent.
   *
   * The placeholder never becomes visible: the transaction either overwrites
   * it with the real value and commits, or rolls back and the row goes with
   * it. `updatedAt` is still the CURRENT time rather than the epoch, because
   * MySQL's `TIMESTAMP` range begins after 1970-01-01 00:00:00 and rejects it
   * under the strict mode most installations run — which failed the first
   * write of any key before the real upsert was ever reached.
   */
  async function claim(tx: SettingsWriter, owner: string, key: string) {
    const placeholder: PluginSettingRow = {
      owner,
      key,
      value: "null",
      isSecret: false,
      updatedAt: new Date(),
      updatedBy: null,
    };
    const insert = tx.insert(table).values(placeholder);
    if (dialect === "mysql") {
      await insert.onDuplicateKeyUpdate({ set: { key } });
    } else {
      await insert.onConflictDoUpdate({
        target: [table.owner, table.key],
        set: { key },
      });
    }
  }

  /** One upsert, spelled the way this dialect accepts it. */
  async function upsert(tx: SettingsWriter, row: PluginSettingRow) {
    const update = {
      value: row.value,
      isSecret: row.isSecret,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    };
    const insert = tx.insert(table).values(row);
    // MySQL spells the same upsert differently; nothing else about the
    // statement changes, so the dialect decides only which method to call.
    if (dialect === "mysql") {
      await insert.onDuplicateKeyUpdate({ set: update });
    } else {
      await insert.onConflictDoUpdate({
        target: [table.owner, table.key],
        set: update,
      });
    }
  }

  return {
    async read(owner) {
      return rowsFor(database, owner);
    },

    async mutate(owner, keys, computeRows) {
      // ONE transaction for the whole update, and the READ is inside it.
      //
      // Two things depend on that. A patch touching several top-level keys is
      // several rows, and each upsert committing on its own left a failure
      // partway through with the earlier keys applied while the caller was
      // told the write failed. And the merge that decides those rows reads the
      // stored value first: performed outside, two callers patching different
      // nested fields under one key both read the same old row, merged
      // independently, and the second write silently restored what the first
      // had just changed — a rotated secret undone by an unrelated edit.
      //
      // Locking the rows is what makes the second caller WAIT rather than
      // read stale, so its merge sees the first one's result.
      return database.transaction(async tx => {
        // CLAIMED before the read, because `FOR UPDATE` can only lock a row
        // that already exists. Two first writes for the same plugin — or two
        // patches adding the same top-level key — both found nothing to lock,
        // both merged from an empty value, and the later upsert replaced the
        // earlier one. Inserting the key first makes the second transaction
        // block on the primary key until the first commits, so the lock below
        // has something to hold and the merge sees the committed result.
        // SORTED, so every writer takes its locks in the same order. Two
        // patches sharing keys in a different order would otherwise each hold
        // what the other is waiting for, and the database would abort one.
        for (const key of [...keys].sort()) await claim(tx, owner, key);

        const current = await rowsFor(tx, owner);
        const rows = await computeRows(current);
        for (const row of rows) await upsert(tx, row);

        // A claim the update did not go on to write would otherwise COMMIT as
        // a row holding the placeholder. Nothing should reach this — the
        // caller derives its rows from the same keys — so it removes a state
        // that must not exist rather than one that is expected.
        const written = new Set(rows.map(row => row.key));
        for (const key of keys) {
          if (written.has(key)) continue;
          await tx
            .delete(table)
            .where(and(eq(table.owner, owner), eq(table.key, key)));
        }
      });
    },
  };
}

/** Remove every setting a plugin stored. Used when it is uninstalled without keeping data. */
export async function deletePluginSettings(
  db: unknown,
  dialect: SupportedDialect,
  owner: string,
  key?: string
): Promise<void> {
  const { nextlyPluginSettings: table } = pluginSettingsTables(dialect);
  const database = db as {
    delete: (t: unknown) => { where: (c: unknown) => Promise<unknown> };
  };
  await database
    .delete(table)
    .where(
      key === undefined
        ? eq(table.owner, owner)
        : and(eq(table.owner, owner), eq(table.key, key))
    );
}
