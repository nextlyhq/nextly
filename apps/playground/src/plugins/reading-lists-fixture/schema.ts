/**
 * The reading-lists fixture's schema: two tables of its own and one hidden
 * column on the site's posts.
 *
 * Each declaration here is what a plugin author writes, imported only from
 * `@nextlyhq/plugin-sdk/schema`, and it is the one statement of the schema:
 * the plugin contributes these objects, `nextly migrate:create --plugin`
 * generates the migration modules from them, and `ctx.db` is typed from them.
 */
import { col, defineTable } from "@nextlyhq/plugin-sdk/schema";

/**
 * The prefix on every table the plugin owns, so `lists` is created as
 * `reading__lists`. A relation or key naming one of the plugin's own tables
 * names it by that full name.
 */
export const PREFIX = "reading";

/** A table's full SQL name, as relations and foreign keys name it. */
const own = (name: string): string => `${PREFIX}__${name}`;

/**
 * The site's posts collection, by its table. A collection's table is
 * `dc_<slug>`, and this fixture adds to the playground's `posts`.
 */
export const POSTS_TABLE = "dc_posts";

/**
 * A person's reading list. Its owner is a core user, held by a foreign key that
 * removes the list with its owner; `items` is the reverse of `list_items`'
 * `listId`, so a list reads with its items in one query.
 */
export const lists = defineTable(
  "lists",
  {
    id: col.id(),
    ownerId: col.ref("users"),
    name: col.shortText(),
    ...col.timestamps(),
  },
  {
    indexes: [{ columns: ["ownerId"] }],
    foreignKeys: [
      {
        columns: ["ownerId"],
        references: { table: "users", columns: ["id"] },
        onDelete: "cascade",
      },
    ],
    relations: [
      {
        name: "items",
        kind: "many",
        targetTable: own("list_items"),
        toColumn: "listId",
      },
    ],
  }
);

/**
 * One post saved to one list, at most once. `listId` is a `ref()`, so the row
 * carries a `list` relation as well as the key; the key removes the item with
 * its list.
 *
 * `postId` holds a post's id with no foreign key: the app's migrations create
 * the posts table after every plugin's, so a key to it could not be made when
 * this table is.
 */
export const listItems = defineTable(
  "list_items",
  {
    id: col.id(),
    listId: col.ref(own("lists")),
    postId: col.varchar(36),
    ...col.timestamps(),
  },
  {
    indexes: [
      { columns: ["listId", "postId"], unique: true },
      { columns: ["postId"] },
    ],
    foreignKeys: [
      {
        columns: ["listId"],
        references: { table: own("lists"), columns: ["id"] },
        onDelete: "cascade",
      },
    ],
  }
);

/**
 * The hidden column the plugin adds to the posts table: how many lists hold the
 * post. A default, because the table already has rows when the column arrives.
 * Hidden means no entry read returns it and no entry write sets it; the plugin
 * reads and writes it through `ctx.db.contributed`, by passing this object.
 */
export const postColumns = {
  savedCount: col.integer({ default: 0 }),
};
