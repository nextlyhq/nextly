/**
 * How the users list is laid out, named once for the list and for its
 * outline: the list's name, and its columns with their heads and widths.
 *
 * The table is laid out by these widths alone (`table-layout: fixed`), never
 * by the rows in it, so its columns stand where they will stand before the
 * rows arrive, in the outline the frame draws and in the list's own, and do
 * not move when the rows land. Each width holds its column's widest value at
 * the table's own text size: an avatar and a name, an id cut to eight
 * characters, a role's badge, and a date with its time.
 *
 * Imports nothing, so an outline drawn in the admin's first frame reads these
 * without pulling the list's code in with them.
 *
 * @module components/features/users/users-list-layout
 */

/** The users list's name: its `registryKey`, and what its row count is kept under. */
export const USERS_LIST = "users";

/** One of the users list's own columns: its name, its head and its width in pixels. */
interface UsersListColumn {
  name: "name" | "id" | "roles" | "createdAt";
  header: string;
  width: number;
}

/** The users list's own columns, in order: a site's custom fields go before Created. */
export const USERS_LIST_COLUMNS = {
  name: { name: "name", header: "NAME", width: 280 },
  id: { name: "id", header: "ID", width: 128 },
  roles: { name: "roles", header: "ROLE", width: 160 },
  createdAt: { name: "createdAt", header: "CREATED", width: 208 },
} as const satisfies Record<UsersListColumn["name"], UsersListColumn>;

/** The width of a column a site adds from its own user fields. */
export const USERS_CUSTOM_COLUMN_WIDTH = 176;
