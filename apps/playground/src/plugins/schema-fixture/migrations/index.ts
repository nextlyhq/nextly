/**
 * The fixture plugin's migrations.
 *
 * Hand-written rather than generated, because the generator is not in place
 * yet and the runner needs something real to run. They are otherwise exactly
 * what `migrate:create --plugin` will emit: per-dialect SQL, a checksum over
 * it, and the owner's tables either side of each module.
 *
 * The checksums are computed at module load rather than pasted, so this file
 * cannot drift into the state the checksum exists to detect. A GENERATED
 * module pastes them — there the literal IS the claim being checked.
 */
import { migrationChecksum } from "nextly/schema-extension";
import type { PluginMigration } from "nextly/schema-extension";

const NOTES = {
  name: "fx__notes",
  columns: [
    { name: "id", type: "varchar(36)", nullable: false, primaryKey: true },
    { name: "author_id", type: "varchar(255)", nullable: false },
    { name: "title", type: "varchar(255)", nullable: false },
  ],
  indexes: [
    {
      name: "uq_fx__notes_author_id_title_0",
      columns: ["author_id", "title"],
      unique: true,
    },
  ],
};

const createNotes = {
  postgresql: {
    up: [
      `CREATE TABLE IF NOT EXISTS fx__notes (id VARCHAR(36) PRIMARY KEY, author_id VARCHAR(255) NOT NULL, title VARCHAR(255) NOT NULL)`,
    ],
    down: [`DROP TABLE IF EXISTS fx__notes`],
  },
  mysql: {
    up: [
      `CREATE TABLE IF NOT EXISTS fx__notes (id VARCHAR(36) PRIMARY KEY, author_id VARCHAR(255) NOT NULL, title VARCHAR(255) NOT NULL)`,
    ],
    down: [`DROP TABLE IF EXISTS fx__notes`],
  },
  sqlite: {
    up: [
      `CREATE TABLE IF NOT EXISTS fx__notes (id TEXT PRIMARY KEY NOT NULL, author_id TEXT NOT NULL, title TEXT NOT NULL)`,
    ],
    down: [`DROP TABLE IF EXISTS fx__notes`],
  },
};

const empty = { tables: [] };
const withNotes = { tables: [NOTES] };

const initial: PluginMigration = {
  name: "20260101_000000_create_notes",
  schemaVersion: 1,
  checksum: migrationChecksum(createNotes),
  dialects: createNotes,
  before: { postgresql: empty, mysql: empty, sqlite: empty },
  snapshot: {
    postgresql: withNotes,
    mysql: withNotes,
    sqlite: withNotes,
  },
};

const addPinned = {
  postgresql: {
    up: [`ALTER TABLE fx__notes ADD COLUMN pinned BOOLEAN DEFAULT false`],
    down: [`ALTER TABLE fx__notes DROP COLUMN pinned`],
  },
  mysql: {
    up: [`ALTER TABLE fx__notes ADD COLUMN pinned TINYINT(1) DEFAULT 0`],
    down: [`ALTER TABLE fx__notes DROP COLUMN pinned`],
  },
  sqlite: {
    up: [`ALTER TABLE fx__notes ADD COLUMN pinned INTEGER DEFAULT 0`],
    down: [`ALTER TABLE fx__notes DROP COLUMN pinned`],
  },
};

const withPinned = {
  tables: [
    {
      ...NOTES,
      columns: [
        ...NOTES.columns,
        { name: "pinned", type: "boolean", nullable: true },
      ],
    },
  ],
};

const pinned: PluginMigration = {
  name: "20260201_000000_add_pinned",
  schemaVersion: 2,
  checksum: migrationChecksum(addPinned),
  dialects: addPinned,
  before: {
    postgresql: withNotes,
    mysql: withNotes,
    sqlite: withNotes,
  },
  snapshot: {
    postgresql: withPinned,
    mysql: withPinned,
    sqlite: withPinned,
  },
};

// Order matters and is asserted by the runner, which sorts by name — but the
// list is kept in apply order so a reader sees the sequence.
export const migrations: PluginMigration[] = [initial, pinned];
