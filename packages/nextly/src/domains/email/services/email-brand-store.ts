/**
 * Where the site's email brand settings are kept: the one row of
 * `email_brand`.
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
import {
  SNAPSHOT_MAX_AGE_MS,
  transactionOpenInFlow,
} from "../transaction-flow";

type EmailBrandTable = ReturnType<typeof emailBrandTables>["nextlyEmailBrand"];

export class EmailBrandStore extends BaseService {
  private readonly table: EmailBrandTable;
  /**
   * The settings as this instance last read or wrote them, which every render
   * answers from: a send makes no read of the table, and none on another
   * connection inside a caller's open transaction. Read at the end of each
   * boot, replaced by this instance's own saves, and read again outside a
   * transaction once older than SNAPSHOT_MAX_AGE_MS, which is how long a save
   * another instance made can go unseen here.
   */
  private snapshot: { settings: BrandSettings; readAt: number } | null = null;
  /**
   * Moved by every save, when it starts and when its read-back lands. A read
   * keeps what it read only if no save moved this while it ran, so a read that
   * began before a save can never replace the save's settings with older ones,
   * and a save keeps its read-back only if no later save has started.
   */
  private generation = 0;
  /** The read of the table in flight, which every caller arriving meanwhile joins. */
  private refreshing: Promise<BrandSettings> | null = null;
  /**
   * The end of the last save queued. Saves on one instance run one after
   * another, so the order they write in is the order they started in, and the
   * copy always holds what the table last received from this instance.
   */
  private saving: Promise<unknown> = Promise.resolve();

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
    this.table = emailBrandTables(this.dialect).nextlyEmailBrand;
  }

  /** The settings as a render reads them, each resolved to its starting value where unset. */
  async read(): Promise<BrandSettings> {
    const copy = this.snapshot;
    if (
      copy &&
      (transactionOpenInFlow(this.adapter) ||
        Date.now() - copy.readAt <= SNAPSHOT_MAX_AGE_MS)
    ) {
      return copy.settings;
    }
    return this.refresh();
  }

  /** Read the settings into the snapshot (at the end of a boot). */
  async load(): Promise<void> {
    await this.refresh();
  }

  /**
   * The settings as the table holds them now, for an editor: never answered
   * from the copy, so a save another instance made is seen at once.
   */
  async readCurrent(): Promise<BrandSettings> {
    return this.refresh();
  }

  /**
   * Read the table, keeping the result as the snapshot unless a save overtook
   * the read. Callers arriving while a read is in flight share it, so a burst
   * of sends after the copy expires makes one read, not one each.
   */
  private refresh(): Promise<BrandSettings> {
    if (this.refreshing) return this.refreshing;
    const started = this.generation;
    const readAt = Date.now();
    const read = this.readTable()
      .then(settings => {
        if (this.generation === started) this.snapshot = { settings, readAt };
        return settings;
      })
      .finally(() => {
        if (this.refreshing === read) this.refreshing = null;
      });
    this.refreshing = read;
    return read;
  }

  private async readTable(): Promise<BrandSettings> {
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
    const run = this.saving.then(() => this.write(change));
    // The queue moves on whether this save succeeds or fails.
    this.saving = run.catch(() => undefined);
    return run;
  }

  private async write(change: BrandSettingsUpdate): Promise<BrandSettings> {
    const mine = ++this.generation;
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
    // Read back from the table whatever the flow, so what is returned, and
    // what this instance renders with from now on, is what was written.
    const readAt = Date.now();
    const saved = await this.readTable();
    // Kept only if no later save started meanwhile: of two saves at once,
    // the later one's read-back is the one that stays.
    if (this.generation === mine) {
      this.snapshot = { settings: saved, readAt };
      this.generation++;
    }
    return saved;
  }
}
