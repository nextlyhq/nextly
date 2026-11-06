/**
 * The records outside content that keep a media item by its address, as the
 * library's `unused` view asks them (`MediaAddressHolder`): every user's
 * avatar, the email brand's logo, and the site's logos.
 *
 * Each is chosen from the library, or pasted, and stored as the item's
 * address rather than its id, and none is a document the usage record
 * covers, so the view asks the tables themselves, in the statement that
 * reads the items. Asking at read time rather than recording them keeps
 * every way these are written covered, a user's own profile, an import and
 * a direct write included.
 *
 * A table `nextly migrate` has not created yet keeps nothing and is left
 * out: asked once per database as a catalogue read and remembered once
 * found, as the usage table is, so the view never names a missing table.
 *
 * @module domains/media/media-address-holders
 */

import type { AnyColumn, Table } from "drizzle-orm";

import { EMAIL_BRAND_TABLE } from "../../schemas/email-brand/table-name";
import { tablePresence, type TableProbe } from "../dashboard/table-presence";

import type { MediaAddressHolder } from "./media-library-query";

/** The tables the holders are read from, as the running dialect has them. */
export interface AddressHolderTables {
  users: Table & { image: AnyColumn };
  nextlyEmailBrand: Table & { logoUrl: AnyColumn };
  siteSettings: Table & { logoUrl: AnyColumn; logoUrlDark: AnyColumn };
}

const SITE_SETTINGS_TABLE = "site_settings";

const presenceByDb = new WeakMap<
  TableProbe,
  Map<string, () => Promise<boolean>>
>();

/** Whether `table` exists in `db`, remembered once it does. */
function present(db: TableProbe, table: string): Promise<boolean> {
  let byTable = presenceByDb.get(db);
  if (byTable === undefined) {
    byTable = new Map();
    presenceByDb.set(db, byTable);
  }
  let check = byTable.get(table);
  if (check === undefined) {
    check = tablePresence(
      db,
      table,
      "The Unused media view cannot see the logos kept here"
    );
    byTable.set(table, check);
  }
  return check();
}

/**
 * The holders the `unused` view asks on `db`. Users always: their table is
 * the first a site has. An avatar keeps the address the library gave it, so
 * it is matched whole; a logo may keep it made absolute, so it is matched by
 * its end.
 */
export async function mediaAddressHolders(
  db: TableProbe,
  tables: AddressHolderTables
): Promise<MediaAddressHolder[]> {
  const { users, nextlyEmailBrand, siteSettings } = tables;
  const holders: MediaAddressHolder[] = [
    { table: users, columns: [users.image], match: "exact" },
  ];
  if (await present(db, EMAIL_BRAND_TABLE)) {
    holders.push({
      table: nextlyEmailBrand,
      columns: [nextlyEmailBrand.logoUrl],
      match: "suffix",
    });
  }
  if (await present(db, SITE_SETTINGS_TABLE)) {
    holders.push({
      table: siteSettings,
      columns: [siteSettings.logoUrl, siteSettings.logoUrlDark],
      match: "suffix",
    });
  }
  return holders;
}
