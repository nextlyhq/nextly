/**
 * `/api/dashboard/diagnostics`: the plain-text report System health's "Copy
 * diagnostics" copies, built on the server for the signed-in super-admin.
 *
 *   GET /api/dashboard/diagnostics   `{ report }`
 *
 * The reader is the signed-in person: an API key is refused, as the report is
 * copied from the admin by a person. Anyone but a super-admin is refused
 * before anything is read, by the same decision the System health card is
 * answered by (`callerIsSuperAdmin`), and the card's own read asks it again.
 *
 * The report holds only the allow-listed facts `buildDiagnosticsReport`
 * writes: the card's facts, read through the card's own read so the two never
 * disagree, how much content the site holds, and how many server errors this
 * process answered in the last 24 hours.
 *
 * Internal to the admin, not published API.
 *
 * @module api/dashboard-diagnostics
 * @experimental
 */
import {
  callerIsSuperAdmin,
  readAccessCaller,
} from "../auth/entity-read-access";
import { container } from "../di/container";
import { readContentCounts } from "../domains/health/content-counts";
import { buildDiagnosticsReport } from "../domains/health/diagnostics-report";
import { serverErrorsInLastDay } from "../domains/health/server-errors";
import { readSystemHealth } from "../domains/widgets/core-widgets/system-health";
import { bindReadServices } from "../domains/widgets/declaration/read-services";
import { NextlyError } from "../errors/nextly-error";

import { PRIVATE_NO_STORE_HEADERS, readCaller } from "./authenticated-read";
import { respondDoc } from "./response-shapes";
import { signedInPerson } from "./signed-in-person";
import { withErrorHandler } from "./with-error-handler";

/** The adapter handle the counts are read through. */
interface CountingAdapter {
  dialect: "postgresql" | "mysql" | "sqlite";
  getDrizzle: () => unknown;
}

/** The answer: the report, exactly as it is copied. */
interface DiagnosticsAnswer {
  report: string;
}

export const getDashboardDiagnostics = withErrorHandler(
  async (req: Request) => {
    const auth = await signedInPerson(req, "copy diagnostics");
    const caller = await readCaller(auth);
    if (!(await callerIsSuperAdmin(readAccessCaller(caller)))) {
      throw NextlyError.forbidden({
        logContext: { reason: "diagnostics-super-admin-required" },
      });
    }
    const now = new Date();
    const signal = req.signal;
    const health = await readSystemHealth(
      bindReadServices({
        caller,
        // The card's read takes no collection query; one asked of it is a
        // fault, never a read made on the caller's behalf.
        prepare: () =>
          Promise.reject(
            NextlyError.internal({
              logContext: { reason: "diagnostics-reads-no-collection" },
            })
          ),
        signal,
        now,
      }),
      { signal }
    );
    const adapter = container.get<CountingAdapter>("adapter");
    const content = await readContentCounts(
      adapter.getDrizzle(),
      adapter.dialect
    );
    const report = buildDiagnosticsReport({
      at: now,
      health,
      content,
      errors: serverErrorsInLastDay(now.getTime()),
    });
    return respondDoc<DiagnosticsAnswer>(
      { report },
      { headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
);
