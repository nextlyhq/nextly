import {
  col,
  type ColumnBuilder,
  defineTable,
  type TableDefinition,
} from "@nextlyhq/plugin-sdk/schema";

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
export const SCHEMA_VERSION = 3;

/** The columns of {@link carts}, as `defineTable` checks and publishes them. */
type CartsColumns = {
  readonly createdAt: ColumnBuilder<Date, false, true>;
  readonly updatedAt: ColumnBuilder<Date, false, true>;
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly tokenHash: ColumnBuilder<string, false, false>;
  readonly currency: ColumnBuilder<string, false, false>;
  readonly version: ColumnBuilder<number, false, true>;
  readonly expiresAt: ColumnBuilder<Date, false, false>;
  readonly checkedOutAt: ColumnBuilder<Date, true, false>;
  readonly accountKind: ColumnBuilder<string, true, false>;
  readonly accountId: ColumnBuilder<string, true, false>;
};

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
export const carts: TableDefinition<"carts", CartsColumns> = defineTable<
  "carts",
  CartsColumns
>(
  "carts",
  {
    id: col.id(),
    tokenHash: col.char(64),
    currency: col.char(3),
    version: col.integer({ default: 0 }),
    expiresAt: col.timestamp(),
    // When the cart became an order. A checked-out cart takes no more changes
    // (the next one starts a new cart) and shows empty, while its cookie still
    // finds the order a repeated completion answers with.
    checkedOutAt: col.timestamp({ nullable: true }),
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

/** The columns of {@link cartLines}, as `defineTable` checks and publishes them. */
type CartLinesColumns = {
  readonly createdAt: ColumnBuilder<Date, false, true>;
  readonly updatedAt: ColumnBuilder<Date, false, true>;
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly cartId: ColumnBuilder<string, false, false>;
  readonly reference: ColumnBuilder<string, false, false>;
  readonly referenceKey: ColumnBuilder<string, false, false>;
  readonly quantity: ColumnBuilder<number, false, false>;
  readonly seenUnitPriceAmount: ColumnBuilder<number, false, false>;
  readonly seenUnitPriceCurrency: ColumnBuilder<string, false, false>;
};

/**
 * One line of a cart: a catalogue reference, a quantity, and the unit price
 * the shopper saw when the line was last added to or changed. That price is
 * shown, and lets
 * checkout say a price changed since, but nothing is ever charged from it:
 * every total is priced again from the catalogue source.
 */
export const cartLines: TableDefinition<"cart_lines", CartLinesColumns> =
  defineTable<"cart_lines", CartLinesColumns>(
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

/** The columns of {@link orderNumbers}, as `defineTable` checks and publishes them. */
type OrderNumbersColumns = {
  readonly createdAt: ColumnBuilder<Date, false, true>;
  readonly updatedAt: ColumnBuilder<Date, false, true>;
  readonly number: ColumnBuilder<number, false, true> & {
    readonly kind: "serial";
  };
  readonly checkoutKey: ColumnBuilder<string, false, false>;
};

/**
 * Order numbers: one row per number handed out, keyed by a serial the
 * database assigns, so two checkouts committing at once can never take the
 * same one.
 *
 * A serial can only be its table's primary key on all three dialects, which
 * is why the number has a table of its own rather than a column on the order.
 * The row names the cart it was taken for, unique, so the first statement of
 * a second completion of the same cart already fails, before any other write.
 * A number taken by a transaction that then rolls back is not reused on
 * PostgreSQL or MySQL, so numbers rise but may skip.
 */
export const orderNumbers: TableDefinition<
  "order_numbers",
  OrderNumbersColumns
> = defineTable<"order_numbers", OrderNumbersColumns>(
  "order_numbers",
  {
    number: col.serial(),
    checkoutKey: col.varchar(36),
    ...col.timestamps(),
  },
  { indexes: [{ columns: ["checkoutKey"], unique: true }] }
);

/** The columns of {@link orders}, as `defineTable` checks and publishes them. */
type OrdersColumns = {
  readonly createdAt: ColumnBuilder<Date, false, true>;
  readonly updatedAt: ColumnBuilder<Date, false, true>;
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly number: ColumnBuilder<number, false, false>;
  readonly checkoutKey: ColumnBuilder<string, false, false>;
  readonly status: ColumnBuilder<
    "awaiting_payment" | "placed" | "completed" | "cancelled" | "expired",
    boolean,
    false
  >;
  readonly currency: ColumnBuilder<string, false, false>;
  readonly subtotalAmount: ColumnBuilder<number, false, false>;
  readonly subtotalCurrency: ColumnBuilder<string, false, false>;
  readonly totalAmount: ColumnBuilder<number, false, false>;
  readonly totalCurrency: ColumnBuilder<string, false, false>;
  readonly email: ColumnBuilder<string, false, false>;
  readonly addresses: ColumnBuilder<unknown, false, false>;
  readonly customerKind: ColumnBuilder<string, true, false>;
  readonly customerId: ColumnBuilder<string, true, false>;
  readonly version: ColumnBuilder<number, false, true>;
  readonly expiresAt: ColumnBuilder<Date, false, false>;
};

/**
 * An order: what the buyer agreed to pay for, frozen at checkout.
 *
 * `checkoutKey` is the id of the cart it was made from, unique, so a cart
 * becomes at most one order however often its checkout is completed. Every
 * figure is the server's own, priced from the catalogue source at
 * completion. `version` moves with every change of state, for the same
 * compare-and-set the cart uses. `expiresAt` is when an order still unpaid is
 * given up and its stock released.
 */
export const orders: TableDefinition<"orders", OrdersColumns> = defineTable<
  "orders",
  OrdersColumns
>(
  "orders",
  {
    id: col.id(),
    number: col.integer(),
    checkoutKey: col.varchar(36),
    status: col.enum([
      "awaiting_payment",
      "placed",
      "completed",
      "cancelled",
      "expired",
    ]),
    currency: col.char(3),
    subtotalAmount: col.bigint(),
    subtotalCurrency: col.char(3),
    totalAmount: col.bigint(),
    totalCurrency: col.char(3),
    email: col.varchar(320),
    // The addresses the buyer gave, as given, checked at the boundary.
    addresses: col.json(),
    // Laid down now and empty until signed-in customers can check out.
    customerKind: col.varchar(64, { nullable: true }),
    customerId: col.varchar(255, { nullable: true }),
    version: col.integer({ default: 0 }),
    expiresAt: col.timestamp(),
    ...col.timestamps(),
  },
  {
    indexes: [
      { columns: ["checkoutKey"], unique: true },
      { columns: ["number"], unique: true },
      // Expiry reads unpaid orders by their deadline.
      { columns: ["status", "expiresAt"] },
    ],
  }
);

/** The columns of {@link orderLines}, as `defineTable` checks and publishes them. */
type OrderLinesColumns = {
  readonly createdAt: ColumnBuilder<Date, false, true>;
  readonly updatedAt: ColumnBuilder<Date, false, true>;
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly orderId: ColumnBuilder<string, false, false>;
  readonly position: ColumnBuilder<number, false, false>;
  readonly reference: ColumnBuilder<string, false, false>;
  readonly referenceKey: ColumnBuilder<string, false, false>;
  readonly name: ColumnBuilder<string, false, false>;
  readonly sku: ColumnBuilder<string, true, false>;
  readonly quantity: ColumnBuilder<number, false, false>;
  readonly unitPriceAmount: ColumnBuilder<number, false, false>;
  readonly unitPriceCurrency: ColumnBuilder<string, false, false>;
  readonly lineTotalAmount: ColumnBuilder<number, false, false>;
  readonly lineTotalCurrency: ColumnBuilder<string, false, false>;
};

/** One line of an order, with the name, SKU and price at the time of sale. */
export const orderLines: TableDefinition<"order_lines", OrderLinesColumns> =
  defineTable<"order_lines", OrderLinesColumns>(
    "order_lines",
    {
      id: col.id(),
      orderId: col.varchar(36),
      position: col.integer(),
      reference: col.varchar(255),
      // Found and kept unique by this, not the reference itself, so references
      // differing only in case stay apart on every dialect (see
      // `referenceKey`).
      referenceKey: col.char(64),
      // Unbounded on every dialect, as the catalogue contract leaves them: a
      // `text` column is `varchar(255)` on MySQL alone, where a longer name
      // would fail an order the other dialects take.
      name: col.longText(),
      sku: col.longText({ nullable: true }),
      quantity: col.integer(),
      unitPriceAmount: col.bigint(),
      unitPriceCurrency: col.char(3),
      lineTotalAmount: col.bigint(),
      lineTotalCurrency: col.char(3),
      ...col.timestamps(),
    },
    {
      indexes: [{ columns: ["orderId", "referenceKey"], unique: true }],
      foreignKeys: [
        {
          columns: ["orderId"],
          references: { table: `${SCHEMA_PREFIX}__orders`, columns: ["id"] },
          onDelete: "cascade",
        },
      ],
      checks: [{ name: "order_line_quantity_positive", sql: "quantity > 0" }],
    }
  );

/** The columns of {@link payments}, as `defineTable` checks and publishes them. */
type PaymentsColumns = {
  readonly createdAt: ColumnBuilder<Date, false, true>;
  readonly updatedAt: ColumnBuilder<Date, false, true>;
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly orderId: ColumnBuilder<string, false, false>;
  readonly reference: ColumnBuilder<string, false, false>;
  readonly provider: ColumnBuilder<string, false, false>;
  readonly providerAccount: ColumnBuilder<string, false, true>;
  readonly providerReference: ColumnBuilder<string, true, false>;
  readonly providerReferenceKey: ColumnBuilder<string, true, false>;
  readonly status: ColumnBuilder<
    | "cancelled"
    | "pending"
    | "requires_action"
    | "processing"
    | "authorised"
    | "paid"
    | "failed",
    boolean,
    false
  >;
  readonly chargeAmount: ColumnBuilder<number, false, false>;
  readonly chargeCurrency: ColumnBuilder<string, false, false>;
  readonly startOperationId: ColumnBuilder<string, false, false>;
  readonly failureCode: ColumnBuilder<string, true, false>;
  readonly version: ColumnBuilder<number, false, true>;
};

/**
 * One payment on an order. A failed or cancelled payment stays on record, and
 * a new attempt is a new row with its own reference.
 *
 * `reference` is commerce's own, sent to the provider with the payment, so a
 * payment whose answer was lost can be found there by it. `startOperationId`
 * is the idempotency key the start is sent under, saved before the first call
 * and reused on every retry; the work row carrying the start records when the
 * first call was made, which decides whether a retry may repeat the key or
 * must look the payment up instead. The provider's own reference is unique
 * per provider once known.
 */
export const payments: TableDefinition<"payments", PaymentsColumns> =
  defineTable<"payments", PaymentsColumns>(
    "payments",
    {
      id: col.id(),
      orderId: col.varchar(36),
      reference: col.varchar(64),
      provider: col.varchar(64),
      // Which account at the provider the payment was begun with (empty for a
      // provider that names none): its later steps go to that account alone,
      // and its reference is keyed within it.
      providerAccount: col.varchar(255, { default: "" }),
      providerReference: col.varchar(255, { nullable: true }),
      // What the provider's reference is kept unique by, with the account it
      // was issued in: ids and accounts can differ only in case, which MySQL's
      // default collation would take as one (see `providerReferenceKey`).
      providerReferenceKey: col.char(64, { nullable: true }),
      status: col.enum([
        "pending",
        "requires_action",
        "processing",
        "authorised",
        "paid",
        "failed",
        "cancelled",
      ]),
      chargeAmount: col.bigint(),
      chargeCurrency: col.char(3),
      startOperationId: col.varchar(255),
      failureCode: col.varchar(255, { nullable: true }),
      version: col.integer({ default: 0 }),
      ...col.timestamps(),
    },
    {
      indexes: [
        { columns: ["reference"], unique: true },
        { columns: ["startOperationId"], unique: true },
        { columns: ["provider", "providerReferenceKey"], unique: true },
        { columns: ["orderId"] },
      ],
      foreignKeys: [
        {
          columns: ["orderId"],
          references: { table: `${SCHEMA_PREFIX}__orders`, columns: ["id"] },
          onDelete: "cascade",
        },
      ],
    }
  );

/** The columns of {@link work}, as `defineTable` checks and publishes them. */
type WorkColumns = {
  readonly createdAt: ColumnBuilder<Date, false, true>;
  readonly updatedAt: ColumnBuilder<Date, false, true>;
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly kind: ColumnBuilder<string, false, false>;
  readonly subjectId: ColumnBuilder<string, false, false>;
  readonly operationId: ColumnBuilder<string, false, false>;
  readonly state: ColumnBuilder<
    "pending" | "done" | "abandoned",
    boolean,
    false
  >;
  readonly attempts: ColumnBuilder<number, false, true>;
  readonly nextAttemptAt: ColumnBuilder<Date, false, false>;
  readonly firstAttemptAt: ColumnBuilder<Date, true, false>;
  readonly lastError: ColumnBuilder<string, true, false>;
  readonly version: ColumnBuilder<number, false, true>;
};

/**
 * Work that must follow a committed change: start a payment, report a hold to
 * a catalogue source. Written in the same transaction as the change, so a
 * process that stops right after the commit leaves the work recorded, and the
 * work job finishes it.
 *
 * `operationId` is the work's own identifier, unique, sent to the outside
 * service as the operation's key. `firstAttemptAt` is when the first attempt
 * was made, against which the service's key lifetime is measured.
 */
export const work: TableDefinition<"work", WorkColumns> = defineTable<
  "work",
  WorkColumns
>(
  "work",
  {
    id: col.id(),
    kind: col.varchar(64),
    subjectId: col.varchar(36),
    operationId: col.varchar(255),
    state: col.enum(["pending", "done", "abandoned"]),
    attempts: col.integer({ default: 0 }),
    nextAttemptAt: col.timestamp(),
    firstAttemptAt: col.timestamp({ nullable: true }),
    lastError: col.text({ nullable: true }),
    version: col.integer({ default: 0 }),
    ...col.timestamps(),
  },
  {
    indexes: [
      { columns: ["operationId"], unique: true },
      // The work job reads what is due, oldest first.
      { columns: ["state", "nextAttemptAt"] },
      { columns: ["subjectId"] },
    ],
  }
);

/** The columns of {@link stockItems}, as `defineTable` checks and publishes them. */
type StockItemsColumns = {
  readonly createdAt: ColumnBuilder<Date, false, true>;
  readonly updatedAt: ColumnBuilder<Date, false, true>;
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly reference: ColumnBuilder<string, false, false>;
  readonly referenceKey: ColumnBuilder<string, false, false>;
  readonly onHand: ColumnBuilder<number, true, false>;
  readonly held: ColumnBuilder<number, false, true>;
  readonly countedAt: ColumnBuilder<Date, true, false>;
  readonly version: ColumnBuilder<number, false, true>;
};

/**
 * Stock commerce keeps per catalogue reference, for items that are counted or
 * one-off; an item sold to order or untracked has none and is never held.
 *
 * The row is also the point every hold on the item is serialized through:
 * each hold moves `version` by compare-and-set, so two checkouts taking the
 * last unit at once cannot both succeed.
 *
 * - `onHand` is commerce's own figure, once it keeps one: recorded when staff
 *   count the item, then lowered by each sale. Until then it is empty, and the
 *   catalogue source's figure is the item's stock.
 * - `held` is every unit active holds take. It always comes off: a source
 *   that hears reports may or may not count a hold in its own figure, and
 *   taking it off either way can understate stock while an order is unpaid,
 *   but never sells a unit twice.
 */
export const stockItems: TableDefinition<"stock_items", StockItemsColumns> =
  defineTable<"stock_items", StockItemsColumns>(
    "stock_items",
    {
      id: col.id(),
      reference: col.varchar(255),
      // Found and kept unique by this, not the reference itself, so references
      // differing only in case stay apart on every dialect (see
      // `referenceKey`).
      referenceKey: col.char(64),
      onHand: col.integer({ nullable: true }),
      held: col.integer({ default: 0 }),
      countedAt: col.timestamp({ nullable: true }),
      version: col.integer({ default: 0 }),
      ...col.timestamps(),
    },
    {
      indexes: [{ columns: ["referenceKey"], unique: true }],
      checks: [{ name: "stock_held_not_negative", sql: "held >= 0" }],
    }
  );

/** The columns of {@link stockHolds}, as `defineTable` checks and publishes them. */
type StockHoldsColumns = {
  readonly createdAt: ColumnBuilder<Date, false, true>;
  readonly updatedAt: ColumnBuilder<Date, false, true>;
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly orderId: ColumnBuilder<string, false, false>;
  readonly reference: ColumnBuilder<string, false, false>;
  readonly referenceKey: ColumnBuilder<string, false, false>;
  readonly quantity: ColumnBuilder<number, false, false>;
  readonly state: ColumnBuilder<"active" | "released" | "sold", boolean, false>;
  readonly expiresAt: ColumnBuilder<Date, false, false>;
  readonly confirmedAt: ColumnBuilder<Date, true, false>;
};

/**
 * A hold an order takes on an item's stock while it is paid for: released if
 * it is not paid by `expiresAt`, made a sale if it is. One per order and item.
 * `confirmedAt` is when a source that hears reports confirmed recording it.
 */
export const stockHolds: TableDefinition<"stock_holds", StockHoldsColumns> =
  defineTable<"stock_holds", StockHoldsColumns>(
    "stock_holds",
    {
      id: col.id(),
      orderId: col.varchar(36),
      reference: col.varchar(255),
      // Found and kept unique by this, not the reference itself, so references
      // differing only in case stay apart on every dialect (see
      // `referenceKey`).
      referenceKey: col.char(64),
      quantity: col.integer(),
      state: col.enum(["active", "released", "sold"]),
      expiresAt: col.timestamp(),
      confirmedAt: col.timestamp({ nullable: true }),
      ...col.timestamps(),
    },
    {
      indexes: [
        { columns: ["orderId", "referenceKey"], unique: true },
        { columns: ["referenceKey", "state"] },
      ],
      foreignKeys: [
        {
          columns: ["orderId"],
          references: { table: `${SCHEMA_PREFIX}__orders`, columns: ["id"] },
          onDelete: "cascade",
        },
      ],
      checks: [{ name: "hold_quantity_positive", sql: "quantity > 0" }],
    }
  );

/** The columns of {@link jobHealth}, as `defineTable` checks and publishes them. */
type JobHealthColumns = {
  readonly createdAt: ColumnBuilder<Date, false, true>;
  readonly updatedAt: ColumnBuilder<Date, false, true>;
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly job: ColumnBuilder<string, false, false>;
  readonly lastRunAt: ColumnBuilder<Date, false, false>;
};

/**
 * When each of commerce's jobs last ran. Checkout reads it, and refuses to
 * take money while the jobs that finish its work are not running.
 */
export const jobHealth: TableDefinition<"job_health", JobHealthColumns> =
  defineTable<"job_health", JobHealthColumns>(
    "job_health",
    {
      id: col.id(),
      job: col.varchar(128),
      lastRunAt: col.timestamp(),
      ...col.timestamps(),
    },
    { indexes: [{ columns: ["job"], unique: true }] }
  );

/** Every table commerce declares, in the order they are created. */
export const COMMERCE_TABLES: readonly [
  typeof carts,
  typeof cartLines,
  typeof orderNumbers,
  typeof orders,
  typeof orderLines,
  typeof payments,
  typeof stockItems,
  typeof stockHolds,
  typeof work,
  typeof jobHealth,
] = [
  carts,
  cartLines,
  orderNumbers,
  orders,
  orderLines,
  payments,
  stockItems,
  stockHolds,
  work,
  jobHealth,
] as const;
