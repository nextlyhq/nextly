/**
 * The SEO plugin's own tables: bookkeeping only this plugin writes, kept out
 * of collections so a write is one statement rather than a whole entry save.
 *
 * A collection write keeps versions, records a content event, tracks media
 * use and runs every plugin's hooks, which is right for content and far too
 * much for a count bumped on every request. A table declared here has none of
 * that, and no admin screen, REST route or Direct API path either: only this
 * plugin reaches it, through `ctx.db`.
 *
 * Created as `seo__<name>` on every dialect. The prefix is declared rather
 * than left to default, because a table's name is permanent once a migration
 * ships it.
 *
 * @module schema/tables
 */
import {
  col,
  type ColumnBuilder,
  defineTable,
  type TableDefinition,
} from "@nextlyhq/plugin-sdk/schema";

/** The prefix every table of this plugin is created under. */
export const SCHEMA_PREFIX = "seo";

/**
 * The schema version the database must have applied before the plugin starts.
 * It moves with every migration module.
 */
export const SCHEMA_VERSION = 4;

/** The columns of {@link notFoundLog}, as `defineTable` checks and publishes them. */
type NotFoundLogColumns = {
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly pathKey: ColumnBuilder<string, false, false>;
  readonly locale: ColumnBuilder<string, false, false>;
  readonly path: ColumnBuilder<string, false, false>;
  readonly asked: ColumnBuilder<string, true, false>;
  readonly hits: ColumnBuilder<number, false, false>;
  readonly firstSeen: ColumnBuilder<Date, false, false>;
  readonly lastSeen: ColumnBuilder<Date, false, false>;
  readonly kind: ColumnBuilder<string, false, false>;
  readonly cameFrom: ColumnBuilder<string, true, false>;
  readonly ignored: ColumnBuilder<boolean, false, true>;
};

/**
 * The log of addresses asked for that did not exist: one row per address in
 * a language, with how often and when it was first and last asked for.
 *
 * `pathKey` is the SHA-256 of the language and the address, so one address is
 * one row on every dialect whatever its length, and the unique index on it is
 * what makes two first requests for one address meet on one row. `hits` is
 * added to in the statement that counts a request (`increment`), so requests
 * arriving at once each count. `kind` is `missing` for a request that found
 * nothing and `moved` for an old address a deploy moved whose redirect could
 * not be saved. `cameFrom` is the last known source of a visit, and a hit
 * with none leaves it as it was; `ignored` is a person's choice, which a hit
 * never changes.
 */
export const notFoundLog: TableDefinition<"not_found", NotFoundLogColumns> =
  defineTable<"not_found", NotFoundLogColumns>(
    "not_found",
    {
      id: col.id(),
      pathKey: col.char(64),
      locale: col.varchar(64),
      path: col.longText(),
      asked: col.longText({ nullable: true }),
      hits: col.integer(),
      firstSeen: col.timestamp(),
      lastSeen: col.timestamp(),
      kind: col.varchar(16),
      // Where the last visitor sent from another page came from: another
      // site's host, or a path on this site without its query. Empty while
      // every visitor came directly.
      cameFrom: col.longText({ nullable: true }),
      // Someone chose to ignore the address: listed only when asked for.
      ignored: col.boolean({ default: false }),
    },
    {
      indexes: [
        { columns: ["pathKey"], unique: true },
        // The admin lists the most asked for first, and the log is pruned
        // to the most recent and the most asked for.
        { columns: ["hits"] },
        { columns: ["lastSeen"] },
      ],
    }
  );

/** The columns of {@link addressClaims}, as `defineTable` checks and publishes them. */
type AddressClaimsColumns = {
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly claimKey: ColumnBuilder<string, false, false>;
  readonly kind: ColumnBuilder<string, false, false>;
  readonly locale: ColumnBuilder<string, false, false>;
  readonly path: ColumnBuilder<string, false, false>;
  readonly holderCollection: ColumnBuilder<string, true, false>;
  readonly holderId: ColumnBuilder<string, true, false>;
  readonly holderLabel: ColumnBuilder<string, true, false>;
  readonly taken: ColumnBuilder<number, false, true>;
};

/**
 * The record of who holds each public address, so no two pages are served
 * at one address in one language: one row per address a page holds
 * (`address`), per range of addresses held as one, such as a paginated
 * list's later pages (`range`), and per lock row a save takes before it reads
 * (`lock`).
 *
 * `claimKey` is the SHA-256 of what the row stands for, so one address is one
 * row on every dialect whatever its length or collation, and the unique index
 * on it is what refuses a second holder. A lock row is taken by adding one to
 * `taken`, a one-row update that holds the row's lock until the transaction
 * ends. Written only on the transaction of the save that changes it.
 */
export const addressClaims: TableDefinition<"addresses", AddressClaimsColumns> =
  defineTable<"addresses", AddressClaimsColumns>(
    "addresses",
    {
      id: col.id(),
      claimKey: col.char(64),
      kind: col.varchar(16),
      locale: col.varchar(64),
      // Long text, so an address of any length fits.
      path: col.longText(),
      holderCollection: col.varchar(255, { nullable: true }),
      holderId: col.varchar(255, { nullable: true }),
      // A title of any length.
      holderLabel: col.longText({ nullable: true }),
      taken: col.integer({ default: 0 }),
    },
    {
      indexes: [
        { columns: ["claimKey"], unique: true },
        // A save finds the rows of the page it changes by holder.
        { columns: ["holderCollection", "holderId"] },
        // A range finds the addresses below it within its language.
        { columns: ["locale"] },
      ],
    }
  );

/** The columns of {@link addressNotes}, as `defineTable` checks and publishes them. */
type AddressNotesColumns = {
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly noteKey: ColumnBuilder<string, false, false>;
  readonly kind: ColumnBuilder<string, false, false>;
  readonly value: ColumnBuilder<string, true, false>;
  readonly taken: ColumnBuilder<number, false, true>;
};

/**
 * What the plugin notes beside the address record, one row per note: the
 * fingerprint and site types of the last catch-up, when the Proxy last ran,
 * the site's standing (`meta`), and each redirect a deploy's move still owes
 * (`pending`, its value the page and the address as JSON). `noteKey` is the
 * SHA-256 of the note's name, unique. `taken` is added to where a note row is
 * held as a lock, as the record's own lock rows are.
 */
export const addressNotes: TableDefinition<"notes", AddressNotesColumns> =
  defineTable<"notes", AddressNotesColumns>(
    "notes",
    {
      id: col.id(),
      noteKey: col.char(64),
      kind: col.varchar(16),
      value: col.longText({ nullable: true }),
      taken: col.integer({ default: 0 }),
    },
    {
      indexes: [{ columns: ["noteKey"], unique: true }, { columns: ["kind"] }],
    }
  );

/** The columns of {@link contentDates}, as `defineTable` checks and publishes them. */
type ContentDatesColumns = {
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly pageKey: ColumnBuilder<string, false, false>;
  readonly holderCollection: ColumnBuilder<string, false, false>;
  readonly holderId: ColumnBuilder<string, false, false>;
  readonly locale: ColumnBuilder<string, false, false>;
  readonly fingerprint: ColumnBuilder<string, false, false>;
  readonly changedAt: ColumnBuilder<Date, false, false>;
};

/**
 * When each page's published content last changed, by language: the date
 * the sitemap gives the page. One row per page and language, holding the
 * fingerprint of the page's published content (every field but its `seo`
 * group and Nextly's bookkeeping) and when that fingerprint last changed,
 * so a save that changes only the page's SEO, or nothing, leaves the date.
 *
 * `pageKey` is the SHA-256 of the page and the language, unique, so two
 * saves recording one page at once meet on one row. Written only after a
 * save commits, never while a sitemap is read.
 */
export const contentDates: TableDefinition<
  "content_dates",
  ContentDatesColumns
> = defineTable<"content_dates", ContentDatesColumns>(
  "content_dates",
  {
    id: col.id(),
    pageKey: col.char(64),
    holderCollection: col.varchar(255),
    holderId: col.varchar(255),
    locale: col.varchar(64),
    fingerprint: col.char(64),
    changedAt: col.timestamp(),
  },
  {
    indexes: [
      { columns: ["pageKey"], unique: true },
      // A listing reads a batch of one type's pages, and a deleted page's
      // rows go together.
      { columns: ["holderCollection", "holderId"] },
    ],
  }
);

/** The columns of {@link codeAddresses}, as `defineTable` checks and publishes them. */
type CodeAddressesColumns = {
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly addressKey: ColumnBuilder<string, false, false>;
  readonly buildId: ColumnBuilder<string, false, false>;
  readonly path: ColumnBuilder<string, false, false>;
  readonly route: ColumnBuilder<string, true, false>;
  readonly declared: ColumnBuilder<boolean, false, true>;
  readonly recordedAt: ColumnBuilder<Date, false, false>;
};

/**
 * The pages built in code each production build of the site served, as
 * `next build` recorded them: one row per address and build, so the running
 * site lists the pages its own build made without reading Next.js's build
 * files, which a host may not ship with the server.
 *
 * A row is written while `next build` renders the site: for each page whose
 * route answered its head through `seoMetadata` (`declared` false), and for
 * each address a route wrapped in `seoStaticParams` declared (`declared`
 * true, with the route as Next.js names it). `buildId` is the build's own
 * id, from `.next/BUILD_ID`, which the running server reads to find its
 * rows. `addressKey` is the SHA-256 of the build id and the address, unique,
 * so build workers recording one page at once meet on one row. Never
 * written while the site is served, and never changed once written.
 */
export const codeAddresses: TableDefinition<
  "code_addresses",
  CodeAddressesColumns
> = defineTable<"code_addresses", CodeAddressesColumns>(
  "code_addresses",
  {
    id: col.id(),
    addressKey: col.char(64),
    buildId: col.varchar(255),
    // Long text, so an address of any length fits.
    path: col.longText(),
    route: col.longText({ nullable: true }),
    declared: col.boolean({ default: false }),
    recordedAt: col.timestamp(),
  },
  {
    indexes: [
      { columns: ["addressKey"], unique: true },
      // The running site reads its own build's rows.
      { columns: ["buildId"] },
      // Rows of builds long replaced are dropped by when they were recorded.
      { columns: ["recordedAt"] },
    ],
  }
);

/** Every table this plugin declares, in the order its migrations create them. */
export const SEO_TABLES: readonly [
  typeof notFoundLog,
  typeof addressClaims,
  typeof addressNotes,
  typeof contentDates,
  typeof codeAddresses,
] = [notFoundLog, addressClaims, addressNotes, contentDates, codeAddresses];
