/**
 * Reaching a layout service's own rows from a test: what a suite writing layouts on a server
 * database needs to leave the table as it found it.
 *
 * PostgreSQL and MySQL keep a slot's test database between runs, so a suite that saves layouts
 * there names each scope with a suffix fresh for its run, deletes that run's rows when it ends,
 * and checks the table is back to the rows it started with. Shared, so every suite doing that
 * deletes and counts the same way.
 */
import type { WidgetLayoutService } from "../widget-layout-service";

/** The service's own database handle and table, for writing what it never would. */
export function layoutInternals(service: WidgetLayoutService) {
  return service as unknown as {
    db: {
      update: (t: unknown) => {
        set: (v: unknown) => { where: (w: unknown) => Promise<unknown> };
      };
      select: (fields: unknown) => {
        from: (t: unknown) => Promise<Array<Record<string, unknown>>> & {
          where: (w: unknown) => Promise<Array<Record<string, unknown>>>;
        };
      };
      delete: (t: unknown) => { where: (w: unknown) => Promise<unknown> };
    };
    table: { id: unknown; scopeId: unknown; layout: unknown; version: unknown };
  };
}

/**
 * Deletes every row whose scope id carries `run`. Row ids are hashes of the scope, so the match is
 * on `scope_id`. `run` must be a whole UUID: it is hex and hyphens, so it holds no `LIKE` wildcard,
 * and long enough that no other run's or lane's scope on a shared database carries it.
 */
export async function deleteRunRows(
  service: WidgetLayoutService,
  run: string
): Promise<void> {
  const internals = layoutInternals(service);
  const { like } = await import("drizzle-orm");
  await internals.db
    .delete(internals.table)
    .where(like(internals.table.scopeId as never, `%${run}%`));
}

/** How many rows the table holds: all of them, or those whose scope id carries `run`. */
export async function countLayoutRows(
  service: WidgetLayoutService,
  run?: string
): Promise<number> {
  const internals = layoutInternals(service);
  const { count, like } = await import("drizzle-orm");
  const all = internals.db.select({ rows: count() }).from(internals.table);
  const rows =
    run === undefined
      ? await all
      : await all.where(like(internals.table.scopeId as never, `%${run}%`));
  return Number(rows[0]?.rows ?? 0);
}
