/**
 * The visitor as a service's own database records it: the one loader every
 * service holding a database of its own reads the Public role through.
 *
 * Kept apart from `resolve-actor`, whose lookups it calls by import, so the
 * meta reader it builds pulls none of its dependencies into that module.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { MetaService } from "../../domains/meta/services/meta-service";
import type { VisitorGrantsLoader } from "../../shared/lib/field-level-registry";
import type { Logger } from "../../shared/types";

import { actorForVisitor } from "./resolve-actor";

/** A service's own database, as the Public role is read on it. */
export interface ServiceDatabase {
  readonly adapter: DrizzleAdapter;
  readonly logger: Logger;
  /**
   * The service's Drizzle handle, asked each time the visitor is read: a
   * schema change replaces it, so one captured once would go stale.
   */
  readonly db: () => unknown;
}

/**
 * The visitor as `own` records it: the Public role read there, its
 * `nextly_meta` through a reader on that database's adapter, with its dialect's
 * tables, on `executor` when the caller's work holds a transaction. Without it
 * the role is read through the global container, which a setup holding its own
 * database may not have filled, or may have filled for another instance.
 */
export function ownDatabaseVisitor(own: ServiceDatabase): VisitorGrantsLoader {
  return executor =>
    actorForVisitor({
      executor: executor ?? own.db(),
      own: {
        meta: new MetaService(own.adapter, own.logger),
        dialect: own.adapter.getCapabilities().dialect,
      },
    });
}

/**
 * Where a service's gate and field rules read a visitor's Public grants: its
 * own database without an access-control service, and `undefined` with one, so
 * they read the process's cached copy, as the gate then does (`visitorOf`).
 */
export function visitorWithoutAccessService(
  accessControl: unknown,
  own: VisitorGrantsLoader
): VisitorGrantsLoader | undefined {
  return accessControl ? undefined : own;
}
