/**
 * The email brand settings table, per dialect.
 *
 * @module schemas/email-brand
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

export { EMAIL_BRAND_ROW_ID, EMAIL_BRAND_TABLE } from "./table-name";

export function emailBrandTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyEmailBrand } = loadedDialect(dialect).tables;
  return { nextlyEmailBrand };
}
