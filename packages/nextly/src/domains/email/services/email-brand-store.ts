/**
 * Where the site's email brand settings are kept: the one row of
 * `nextly_email_brand`.
 *
 * Read on every render that uses a layout, so a read never fails for want of
 * the row or the table: a site that never saved settings, or whose database
 * does not have the table yet, reads the starting values, which render core's
 * default layout exactly as it was before brand settings.
 *
 * @module domains/email/services/email-brand-store
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { eq } from "drizzle-orm";

import { toDbError } from "../../../database/errors";
import { NextlyError } from "../../../errors";
import {
  EMAIL_BRAND_ROW_ID,
  emailBrandTables,
} from "../../../schemas/email-brand";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import { isUniqueViolation } from "../../../shared/lib/unique-violation";
import { isMissingTable } from "../../field-groups/migration/session";
import {
  resolveBrand,
  type BrandSettings,
  type BrandSettingsUpdate,
} from "../brand-settings";

type EmailBrandTable = ReturnType<typeof emailBrandTables>["nextlyEmailBrand"];

export class EmailBrandStore extends BaseService {
  private readonly table: EmailBrandTable;

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
    this.table = emailBrandTables(this.dialect).nextlyEmailBrand;
  }

  /** The settings as a render reads them, each resolved to its starting value where unset. */
  async read(): Promise<BrandSettings> {
    let rows: unknown[];
    try {
      rows = await this.db
        .select()
        .from(this.table)
        .where(eq(this.table.id, EMAIL_BRAND_ROW_ID))
        .limit(1);
    } catch (error) {
      // An upgraded site whose database has not had the table created yet
      // sends as it did before brand settings. Any other failure is raised:
      // reading it as "no settings" would quietly undo a site's brand.
      if (isMissingTable(error, this.dialect)) return resolveBrand(null);
      throw error;
    }
    return resolveBrand(
      (rows[0] as Parameters<typeof resolveBrand>[0] | undefined) ?? null
    );
  }

  /**
   * Save a change, already parsed, and return the settings as they now are.
   * A setting the change leaves out stays as it was; one it sets to null
   * returns to its starting value.
   */
  async update(change: BrandSettingsUpdate): Promise<BrandSettings> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const [key, value] of Object.entries(change)) {
      if (value !== undefined) set[key] = value;
    }
    try {
      // The row first, so the update below always has one to write. Two first
      // saves at once both try it; the one that loses finds the row there.
      try {
        await this.db.insert(this.table).values({ id: EMAIL_BRAND_ROW_ID });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
      await this.db
        .update(this.table)
        .set(set)
        .where(eq(this.table.id, EMAIL_BRAND_ROW_ID));
    } catch (error) {
      if (error instanceof NextlyError) throw error;
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
    return this.read();
  }
}
