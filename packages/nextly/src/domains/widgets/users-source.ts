/**
 * `system:users`: how many people have an account, and when they joined, for a
 * reader who may read users.
 *
 * A Count card set to Users reads it: the number, the people who joined in the
 * last 7 days, and the weeks before them. Two ops, shaped as a collection's
 * are, so the card reads either source the same way: `count`, every account;
 * and `timeseries`, the accounts made in each interval of a range, placed by
 * when they were made (`createdAt`).
 *
 * 🔴 The reader's permission is asked HERE, not only where the Source setting
 * is offered. A source answers whoever queries it, so a reader without
 * `read-users` who asks anyway is answered exactly as a source that does not
 * exist. Nothing about any one person leaves it: only counts.
 *
 * @module domains/widgets/users-source
 */

import { readAccessCaller } from "../../auth/entity-read-access";
import { getService } from "../../di";
import { NextlyError } from "../../errors/nextly-error";
import type { ReadCaller } from "../../services/dashboard/readable-resources";
import { intervalWindow } from "../collections/query/timeseries-interval";

import {
  isTimeseriesRange,
  openWindowEnd,
  rangeWindow,
  type TimeseriesRange,
  type WidgetQuery,
} from "./query";
import type { ResolverOptions } from "./resolved-sources";
import type { WidgetResult } from "./result";
import {
  failUnavailableSourceOrOp,
  refuseUnconsumedQueryFields,
} from "./sources";
import { USERS_SOURCE_ID } from "./system-source-ids";
import { registerSystemSource } from "./system-sources";
import { USERS_READ_PERMISSION } from "./users-gate";
import { permissionVerdicts } from "./visibility";

/** The one field a query may name: when each account was made. */
const USERS_FIELDS = [
  { name: "createdAt", type: "date" as const, label: "Joined" },
];

/**
 * What the resolver does with each field of a widget query: a count of every
 * account, or a series over a range placed by `createdAt`. Exhaustive over
 * `keyof WidgetQuery`, as the other system sources keep theirs, so a field
 * added to the query fails `check-types` here until someone decides what it
 * means.
 */
const QUERY_FIELD_USE: Record<keyof WidgetQuery, "consumed" | "refused"> = {
  source: "consumed",
  op: "consumed",
  range: "consumed",
  dateField: "consumed",
  select: "refused",
  // Every query the validator checks without a range carries a limit; a count
  // reads no rows, so it bounds nothing here, and refusing it would refuse
  // every checked count.
  limit: "consumed",
  where: "refused",
  sort: "refused",
  status: "refused",
  groupBy: "refused",
  interval: "refused",
  since: "refused",
  until: "refused",
};

/** The table every account is a row of. */
const USERS_TABLE = "users";

/**
 * The accounts made in each interval of `range`, oldest first, every interval
 * present: the window a collection's series over the same range is drawn
 * across (`rangeWindow`), its first interval counting only what falls inside
 * the range. Each interval is one count in the database, so the read is a
 * handful of numbers however many people joined, never their rows.
 */
async function joinedSeries(
  range: TimeseriesRange,
  now: Date
): Promise<Extract<WidgetResult, { op: "timeseries" }>> {
  const window = rangeWindow(range, now);
  const starts = intervalWindow(
    window.anchor,
    window.interval,
    window.intervals
  );
  const end = openWindowEnd(now);
  const adapter = getService("adapter");
  const counts = await Promise.all(
    starts.map((start, index) => {
      // Clipped to the range: the first interval opens where the range does,
      // and the last closes at the batch's instant.
      const from = start < window.start ? window.start : start;
      const to = starts[index + 1] ?? end;
      return adapter.count(USERS_TABLE, {
        where: {
          and: [
            { column: "createdAt", op: ">=", value: from },
            { column: "createdAt", op: "<", value: to },
          ],
        },
      });
    })
  );
  return {
    op: "timeseries",
    points: starts.map((start, index) => ({
      start: start.toISOString(),
      count: counts[index] ?? 0,
    })),
    interval: window.interval,
  };
}

/** Answer one query of `system:users`, for a reader who may read users. */
async function resolveUsers(
  query: WidgetQuery,
  caller: ReadCaller,
  opts?: ResolverOptions
): Promise<WidgetResult> {
  refuseUnconsumedQueryFields(query, QUERY_FIELD_USE, USERS_SOURCE_ID);
  const verdicts = await permissionVerdicts(
    [USERS_READ_PERMISSION],
    readAccessCaller(caller)
  );
  // The precondition, before anything is counted.
  if (verdicts.get(USERS_READ_PERMISSION) !== true) {
    failUnavailableSourceOrOp(`${USERS_SOURCE_ID}: not this reader's source`);
  }
  opts?.signal?.throwIfAborted();
  if (query.op === "count") {
    if (query.range !== undefined || query.dateField !== undefined) {
      failUnavailableSourceOrOp(
        `${USERS_SOURCE_ID}: a count of every account takes no range`
      );
    }
    return {
      op: "count",
      total: await getService("adapter").count(USERS_TABLE),
    };
  }
  if (query.op === "timeseries") {
    if (!isTimeseriesRange(query.range)) {
      throw NextlyError.invalidInput({
        message: `${USERS_SOURCE_ID} draws a series over a range: 7d, 30d, 90d or 12m.`,
      });
    }
    if (query.dateField !== undefined && query.dateField !== "createdAt") {
      failUnavailableSourceOrOp(
        `${USERS_SOURCE_ID}: accounts are placed by createdAt alone`
      );
    }
    return joinedSeries(query.range, opts?.now ?? new Date());
  }
  return failUnavailableSourceOrOp(
    `${USERS_SOURCE_ID}: answers count and timeseries`
  );
}

/** Publish `system:users` and its resolver, from the boot-time registry reset. */
export function registerUsersWidgetSource(): void {
  registerSystemSource(
    {
      id: USERS_SOURCE_ID,
      label: "Users",
      kind: "system",
      requiredPermission: USERS_READ_PERMISSION,
      supports: ["count", "timeseries"],
      fields: USERS_FIELDS,
    },
    resolveUsers
  );
}
