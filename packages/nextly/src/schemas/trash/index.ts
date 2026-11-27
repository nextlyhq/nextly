/**
 * `nextly_trash`: deleted items, kept until they are restored or removed for
 * good.
 *
 * @module schemas/trash
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

export { TRASH_TABLE } from "./table-name";
export type {
  KeptLinks,
  KeptRow,
  KeptTableRows,
  KeptValue,
  TrashedEntry,
  TrashKind,
} from "./types";

export function trashTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyTrash } = loadedDialect(dialect).tables;
  return { nextlyTrash };
}
