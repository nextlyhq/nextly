/**
 * A Builder save's drift refusal is told with the way on that works for a save, whose refusal leaves
 * its files withdrawn; a refusal that kept files, or that is not drift, is answered as it is.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { migrationDriftError } from "../../migrate/drift-error";
import { asBuilderSaveDrift } from "../builder-save-drift";

const drift = () =>
  migrationDriftError({
    migration: "20261119_notes_update",
    file: "src/db/migrations/20261119_notes_update.sql",
    driftItems: [{ kind: "+", detail: "dc_notes.legacy_note present in DB" }],
  });

/** `error` as the writer passes it on, read as text. */
const told = (error: unknown): string =>
  NextlyError.is(error) ? error.publicMessage : String(error);

describe("asBuilderSaveDrift", () => {
  it("tells a refusal that withdrew everything the Builder's way on", () => {
    const answered = asBuilderSaveDrift(drift());

    expect(NextlyError.is(answered) && answered.code).toBe(
      "NEXTLY_MIGRATION_DRIFT"
    );
    expect(told(answered)).toContain(
      "put the table back as the history records it"
    );
    expect(told(answered)).toContain("+ dc_notes.legacy_note present in DB");
    expect(told(answered)).not.toContain("migrate:resolve");
  });

  // A save whose earlier file applied before a later one was refused keeps its files, and the
  // refusal names them with how to record them (`partlyAppliedChange`): saying the save changed
  // nothing would send the person away from the files the database already partly holds.
  it("leaves a refusal that kept the save's files as it is", () => {
    const original = drift();
    const kept = new NextlyError({
      code: original.code,
      statusCode: original.statusCode,
      publicMessage: `${original.publicMessage} The database now holds part of this change, so its migration file 20261119_notes_update.sql was kept and not recorded as applied.`,
      logContext: {
        ...original.logContext,
        keptFiles: ["20261119_notes_update.sql"],
      },
      cause: original,
    });

    expect(asBuilderSaveDrift(kept)).toBe(kept);
  });

  it("leaves a database never adopted, and any other error, as they are", () => {
    const unadopted = migrationDriftError({
      migration: "20261119_notes_create",
      file: "src/db/migrations/20261119_notes_create.sql",
      driftItems: [{ kind: "+", detail: "table 'dc_notes' present in DB" }],
      unadoptedDatabase: true,
    });
    const other = NextlyError.validation({ errors: [] });

    expect(asBuilderSaveDrift(unadopted)).toBe(unadopted);
    expect(asBuilderSaveDrift(other)).toBe(other);
  });
});
