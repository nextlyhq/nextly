import { col, defineTable } from "@nextlyhq/plugin-sdk/schema";

/**
 * Commerce's own tables, created as `commerce__<name>` on every dialect.
 *
 * The prefix is declared rather than left to default to the package's admin
 * slug, because a table's name is permanent once a migration ships it.
 */
export const SCHEMA_PREFIX = "commerce";

/**
 * The version the database must have applied before commerce starts. It moves
 * with every migration module, and a production boot refuses a database whose
 * commerce schema is behind it.
 */
export const SCHEMA_VERSION = 1;

/**
 * A shopper's cart.
 *
 * Found by the hash of the token in the shopper's cookie, never by an id the
 * browser sends, so no parameter can reach another shopper's cart. The token
 * itself is never stored. `version` moves with every change, so two changes
 * racing each other cannot both apply to the cart as it was. `expiresAt` is
 * the cart's deadline, set from the cart lifetime whenever the cart is created
 * or changes and copied into the cookie, so a site that changes the lifetime
 * moves no cart's deadline until that cart next changes, and the browser and
 * the server always agree on it. The account
 * columns are laid down now and stay empty until signing in attaches a cart to
 * a customer; nothing reads them yet.
 */
export const carts = defineTable(
  "carts",
  {
    id: col.id(),
    tokenHash: col.char(64),
    currency: col.char(3),
    version: col.integer({ default: 0 }),
    expiresAt: col.timestamp(),
    accountKind: col.varchar(64, { nullable: true }),
    accountId: col.varchar(255, { nullable: true }),
    ...col.timestamps(),
  },
  {
    indexes: [
      { columns: ["tokenHash"], unique: true },
      // The expiry sweep reads carts by their deadline.
      { columns: ["expiresAt"] },
    ],
  }
);

/**
 * One line of a cart: a catalogue reference, a quantity, and the unit price
 * the shopper saw when the line was last added to or changed. That price is
 * shown, and lets
 * checkout say a price changed since, but nothing is ever charged from it:
 * every total is priced again from the catalogue source.
 */
export const cartLines = defineTable(
  "cart_lines",
  {
    id: col.id(),
    cartId: col.varchar(36),
    reference: col.varchar(255),
    // What the line is found and kept unique by, rather than the reference
    // itself, so references differing only in case are two lines on every
    // dialect (see `referenceKey`).
    referenceKey: col.char(64),
    quantity: col.integer(),
    seenUnitPriceAmount: col.bigint(),
    seenUnitPriceCurrency: col.char(3),
    ...col.timestamps(),
  },
  {
    indexes: [
      // One line per item: adding an item already in the cart changes its
      // line, and two adds racing each other cannot make two lines.
      { columns: ["cartId", "referenceKey"], unique: true },
    ],
    foreignKeys: [
      {
        columns: ["cartId"],
        references: { table: `${SCHEMA_PREFIX}__carts`, columns: ["id"] },
        onDelete: "cascade",
      },
    ],
    checks: [{ name: "quantity_positive", sql: "quantity > 0" }],
  }
);

/** Every table commerce declares, in the order they are created. */
export const COMMERCE_TABLES = [carts, cartLines] as const;
