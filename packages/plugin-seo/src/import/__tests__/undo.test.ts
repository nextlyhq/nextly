/**
 * What an import refused part-way says once its Singles were put back: the
 * refusal as it came where every one was, so the screen can say nothing was
 * imported; that part of it may be in place where one could not be.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { IMPORT_PARTLY_APPLIED } from "../contract";
import {
  publishRefusalAbout,
  refusalAfterUndo,
  refusedBeforeStoring,
} from "../plan";

describe("a refusal after the Singles are put back", () => {
  const refused = NextlyError.conflict({ reason: "version" });

  it("is the refusal itself where every Single was put back", () => {
    expect(refusalAfterUndo(refused, true)).toBe(refused);
  });

  it("says part of the import may be in place where one could not be", () => {
    const said = refusalAfterUndo(refused, false);
    expect(said).toBeInstanceOf(NextlyError);
    expect((said as NextlyError).code).toBe(IMPORT_PARTLY_APPLIED);
    expect((said as NextlyError).cause).toBe(refused);
  });
});

describe("a save's refusal, before or after it stored anything", () => {
  it("is before storing for a stale version or a refused write", () => {
    expect(
      refusedBeforeStoring(
        new NextlyError({ code: "STALE_VERSION", statusCode: 409 })
      )
    ).toBe(true);
    expect(refusedBeforeStoring(NextlyError.forbidden())).toBe(true);
    expect(
      refusedBeforeStoring(NextlyError.conflict({ reason: "version" }))
    ).toBe(true);
  });

  it("may be after storing for anything else, such as an answer that failed", () => {
    expect(refusedBeforeStoring(NextlyError.internal())).toBe(false);
    expect(refusedBeforeStoring(new Error("the answer failed"))).toBe(false);
  });
});

describe("a published version's write refused", () => {
  const publish = new NextlyError({
    code: "FORBIDDEN",
    statusCode: 403,
    publicMessage: "You can't publish this note.",
  });
  const live = { write: "live" as const, label: "Pricing" };

  it("says publishing is needed where the publish gate refused it", () => {
    const said = publishRefusalAbout(publish, live);
    expect(said).toBeInstanceOf(NextlyError);
    expect((said as NextlyError).code).toBe("FORBIDDEN");
    expect((said as NextlyError).publicMessage).toBe(
      "Importing into the published version of “Pricing” needs permission to publish it. Nothing was imported."
    );
    expect((said as NextlyError).cause).toBe(publish);
  });

  it("keeps any other refusal as it was, a value kept out by a field rule among them", () => {
    const notYours = new NextlyError({
      code: "FORBIDDEN",
      statusCode: 403,
      publicMessage: "A value you may not change was left out.",
      logContext: { reason: "seo-value-not-yours" },
    });
    expect(publishRefusalAbout(notYours, live)).toBe(notYours);
    const generic = NextlyError.forbidden();
    expect(publishRefusalAbout(generic, live)).toBe(generic);
  });

  it("keeps a draft's refusal as it was", () => {
    expect(
      publishRefusalAbout(publish, { write: "held", label: "Pricing" })
    ).toBe(publish);
  });
});
