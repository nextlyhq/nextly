import {
  col,
  type ColumnBuilder,
  defineTable,
  type TableDefinition,
} from "@nextlyhq/plugin-sdk/schema";

/**
 * The accounts plugin's own tables, created as `accounts__<name>` on every
 * dialect.
 *
 * The prefix is declared rather than left to default to the package's admin
 * slug, because a table's name is permanent once a migration ships it.
 */
export const SCHEMA_PREFIX = "accounts";

/**
 * The version the database must have applied before the plugin starts. It
 * moves with every migration module, and a production boot refuses a database
 * whose accounts schema is behind it.
 */
export const SCHEMA_VERSION = 3;

/** Long enough for any address RFC 5321 lets through: 64 + 1 + 255. */
const ADDRESS_LENGTH = 320;

/** The prefixed name another table's foreign key points at. */
const ACCOUNTS_TABLE = `${SCHEMA_PREFIX}__accounts`;

/** Rows that belong to an account go with it when it is deleted. */
const belongsToAccount = {
  columns: ["accountId"],
  references: { table: ACCOUNTS_TABLE, columns: ["id"] },
  onDelete: "cascade" as const,
};

/** The columns of {@link accounts}, as `defineTable` checks and publishes them. */
type AccountsColumns = {
  readonly createdAt: ColumnBuilder<Date, false, true>;
  readonly updatedAt: ColumnBuilder<Date, false, true>;
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly address: ColumnBuilder<string, false, false>;
  readonly addressNormalised: ColumnBuilder<string, false, false>;
  readonly name: ColumnBuilder<string, false, false>;
  readonly passwordHash: ColumnBuilder<string, true, false>;
  readonly verifiedAt: ColumnBuilder<Date, true, false>;
  readonly verifiedBy: ColumnBuilder<string, true, false>;
  readonly deactivatedAt: ColumnBuilder<Date, true, false>;
  readonly failuresInARow: ColumnBuilder<number, false, true>;
  readonly resetRequiredAt: ColumnBuilder<Date, true, false>;
  readonly resetRequiredEmailedAt: ColumnBuilder<Date, true, false>;
  readonly securityVersion: ColumnBuilder<number, false, true>;
  readonly lastSignedInAt: ColumnBuilder<Date, true, false>;
  readonly passwordChangedAt: ColumnBuilder<Date, true, false>;
};

/**
 * A site account: a visitor of the site, never staff.
 *
 * The address is kept as the visitor gave it, to write to, and normalised
 * (trimmed and lower-cased, as core compares staff addresses), to find and to
 * keep unique: one address has at most one account, even when two sign-ups
 * race, because the database refuses the second. The password hash is
 * core's, and empty for an account without a password. `securityVersion`
 * moves, in the same transaction, with every change that ends the account's
 * sessions, so a session start, a reset or an address confirmation that began
 * before such a change sees it and writes nothing.
 */
export const accounts: TableDefinition<"accounts", AccountsColumns> =
  defineTable<"accounts", AccountsColumns>(
    "accounts",
    {
      id: col.id(),
      address: col.varchar(ADDRESS_LENGTH),
      addressNormalised: col.varchar(ADDRESS_LENGTH),
      name: col.varchar(255),
      // Core's password helper writes at most 255 characters.
      passwordHash: col.varchar(255, { nullable: true }),
      verifiedAt: col.timestamp({ nullable: true }),
      // How the address was proven: "link", "code" or "reset".
      verifiedBy: col.varchar(16, { nullable: true }),
      deactivatedAt: col.timestamp({ nullable: true }),
      // Failed password checks in a row, toward the reset-required state.
      failuresInARow: col.integer({ default: 0 }),
      resetRequiredAt: col.timestamp({ nullable: true }),
      // The reset-required email goes at most once a day.
      resetRequiredEmailedAt: col.timestamp({ nullable: true }),
      securityVersion: col.integer({ default: 0 }),
      lastSignedInAt: col.timestamp({ nullable: true }),
      passwordChangedAt: col.timestamp({ nullable: true }),
      ...col.timestamps(),
    },
    {
      indexes: [
        { columns: ["addressNormalised"], unique: true },
        // The sweep of accounts nobody verified reads them by age.
        { columns: ["verifiedAt", "createdAt"] },
        // Staff's list of accounts reads them newest first, then by id.
        { columns: ["createdAt", "id"] },
      ],
      checks: [
        { name: "failures_not_negative", sql: "failures_in_a_row >= 0" },
        { name: "security_version_not_negative", sql: "security_version >= 0" },
      ],
    }
  );

/** The columns of {@link sessions}, as `defineTable` checks and publishes them. */
type SessionsColumns = {
  readonly createdAt: ColumnBuilder<Date, false, true>;
  readonly updatedAt: ColumnBuilder<Date, false, true>;
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly accountId: ColumnBuilder<string, false, false>;
  readonly tokenHash: ColumnBuilder<string, false, false>;
  readonly lastUsedAt: ColumnBuilder<Date, false, false>;
  readonly idleExpiresAt: ColumnBuilder<Date, false, false>;
  readonly absoluteExpiresAt: ColumnBuilder<Date, false, false>;
};

/**
 * A signed-in session, on the server: found by the hash of the token in the
 * visitor's cookie, never by an id the browser sends, and the token itself is
 * never stored. It ends at the earlier of its idle and absolute expiries.
 */
export const sessions: TableDefinition<"sessions", SessionsColumns> =
  defineTable<"sessions", SessionsColumns>(
    "sessions",
    {
      id: col.id(),
      accountId: col.varchar(36),
      tokenHash: col.char(64),
      lastUsedAt: col.timestamp(),
      idleExpiresAt: col.timestamp(),
      absoluteExpiresAt: col.timestamp(),
      ...col.timestamps(),
    },
    {
      indexes: [
        { columns: ["tokenHash"], unique: true },
        { columns: ["accountId"] },
        // The sweep removes sessions past either expiry.
        { columns: ["idleExpiresAt"] },
        { columns: ["absoluteExpiresAt"] },
      ],
      foreignKeys: [belongsToAccount],
    }
  );

/** The columns of {@link knownBrowsers}, as `defineTable` checks and publishes them. */
type KnownBrowsersColumns = {
  readonly createdAt: ColumnBuilder<Date, false, true>;
  readonly updatedAt: ColumnBuilder<Date, false, true>;
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly accountId: ColumnBuilder<string, false, false>;
  readonly tokenHash: ColumnBuilder<string, false, false>;
  readonly knownAt: ColumnBuilder<Date, false, false>;
  readonly failuresInARow: ColumnBuilder<number, false, true>;
  readonly cappedAt: ColumnBuilder<Date, true, false>;
  readonly lastFailedCheckAt: ColumnBuilder<Date, true, false>;
};

/**
 * A browser known to an account: one row per account and browser, found by
 * the hash of that account's token in the browser's cookie. Its failure count
 * is kept here rather than in the limit store, so it survives the store's
 * restart; so do the moment it reached its cap and its last failed password
 * check, which a capped token's own wait runs from.
 */
export const knownBrowsers: TableDefinition<
  "known_browsers",
  KnownBrowsersColumns
> = defineTable<"known_browsers", KnownBrowsersColumns>(
  "known_browsers",
  {
    id: col.id(),
    accountId: col.varchar(36),
    tokenHash: col.char(64),
    // Last signed in, or made known by a reset: the expiry runs from it.
    knownAt: col.timestamp(),
    failuresInARow: col.integer({ default: 0 }),
    cappedAt: col.timestamp({ nullable: true }),
    lastFailedCheckAt: col.timestamp({ nullable: true }),
    ...col.timestamps(),
  },
  {
    indexes: [
      { columns: ["tokenHash"], unique: true },
      { columns: ["accountId"] },
      // The sweep forgets browsers by when they were last known.
      { columns: ["knownAt"] },
    ],
    foreignKeys: [belongsToAccount],
    checks: [{ name: "failures_not_negative", sql: "failures_in_a_row >= 0" }],
  }
);

/** The columns of {@link pendingAddressChanges}, as `defineTable` checks and publishes them. */
type PendingAddressChangesColumns = {
  readonly createdAt: ColumnBuilder<Date, false, true>;
  readonly updatedAt: ColumnBuilder<Date, false, true>;
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly accountId: ColumnBuilder<string, false, false>;
  readonly newAddress: ColumnBuilder<string, false, false>;
  readonly newAddressNormalised: ColumnBuilder<string, false, false>;
  readonly expiresAt: ColumnBuilder<Date, false, false>;
};

/**
 * An address change waiting for its confirmation: at most one per account,
 * kept as given and normalised like the account's own, until it expires.
 */
export const pendingAddressChanges: TableDefinition<
  "pending_address_changes",
  PendingAddressChangesColumns
> = defineTable<"pending_address_changes", PendingAddressChangesColumns>(
  "pending_address_changes",
  {
    id: col.id(),
    accountId: col.varchar(36),
    newAddress: col.varchar(ADDRESS_LENGTH),
    newAddressNormalised: col.varchar(ADDRESS_LENGTH),
    expiresAt: col.timestamp(),
    ...col.timestamps(),
  },
  {
    indexes: [
      { columns: ["accountId"], unique: true },
      // The sweep removes changes past their expiry.
      { columns: ["expiresAt"] },
    ],
    foreignKeys: [belongsToAccount],
  }
);

/** The columns of {@link sentEmails}, as `defineTable` checks and publishes them. */
type SentEmailsColumns = {
  readonly createdAt: ColumnBuilder<Date, false, true>;
  readonly updatedAt: ColumnBuilder<Date, false, true>;
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly jobId: ColumnBuilder<string, false, false>;
  readonly sentAt: ColumnBuilder<Date, false, false>;
};

/**
 * An email job that has sent its email, by the job's id, which is the same
 * on every attempt at the job: a retried job finds its email sent and sends
 * nothing more. Core's email service takes no key to deduplicate on, so
 * this is the plugin's own record; kept a week, long past a job's last
 * retry.
 */
export const sentEmails: TableDefinition<"sent_emails", SentEmailsColumns> =
  defineTable<"sent_emails", SentEmailsColumns>(
    "sent_emails",
    {
      id: col.id(),
      jobId: col.varchar(64),
      sentAt: col.timestamp(),
      ...col.timestamps(),
    },
    {
      indexes: [
        { columns: ["jobId"], unique: true },
        // The sweep forgets sends by when they went.
        { columns: ["sentAt"] },
      ],
    }
  );

/** Every table the plugin declares, in the order they are created. */
export const ACCOUNTS_TABLES: readonly [
  typeof accounts,
  typeof sessions,
  typeof knownBrowsers,
  typeof pendingAddressChanges,
  typeof sentEmails,
] = [
  accounts,
  sessions,
  knownBrowsers,
  pendingAddressChanges,
  sentEmails,
] as const;
