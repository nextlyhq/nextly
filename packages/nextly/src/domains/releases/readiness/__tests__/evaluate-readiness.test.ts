/**
 * Running sources over a release's members.
 *
 * The properties a reader depends on: hard findings apart from soft ones, each
 * in the order the documents were added whatever order the sources answered
 * in; and every member checked, in batches, before anything is reported — so
 * a problem in the last document of a large release is never missed.
 */
import { describe, expect, it, vi } from "vitest";

import {
  defineReleaseCheckSource,
  READINESS_BATCH_SIZE,
  type ReleaseCheckSource,
} from "../check-sources";
import { evaluateReadiness } from "../evaluate-readiness";

import { member, reads, release } from "./helpers/readiness-fixtures";

/** A source reporting `code` for the members named. */
function reporting(
  key: string,
  severity: "hard" | "soft",
  code: string,
  ids: string[]
): ReleaseCheckSource<string> {
  return defineReleaseCheckSource<string>({
    key,
    severity,
    codes: [code],
    // Answers in REVERSE, so ordering by member is the evaluator's doing.
    check: async batch =>
      batch
        .filter(m => ids.includes(m.id))
        .map(m => ({ memberId: m.id, code }))
        .reverse(),
  });
}

function evaluate(
  members: ReturnType<typeof member>[],
  sources: ReleaseCheckSource<string>[]
) {
  return evaluateReadiness({
    release: release(),
    members,
    sources,
    reads: reads(),
    now: new Date(),
  });
}

describe("evaluateReadiness", () => {
  it("separates hard from soft, each in the order the documents were added", async () => {
    const members = [member("a"), member("b"), member("c")];
    const found = await evaluate(members, [
      reporting("core.soft", "soft", "NOTE", ["c", "a"]),
      reporting("core.hard", "hard", "STOP", ["c", "b"]),
      reporting("core.other-hard", "hard", "ALSO_STOP", ["b"]),
    ]);
    expect(found.hard.map(f => [f.memberId, f.code])).toEqual([
      ["b", "STOP"],
      ["b", "ALSO_STOP"],
      ["c", "STOP"],
    ]);
    expect(found.soft.map(f => [f.memberId, f.code])).toEqual([
      ["a", "NOTE"],
      ["c", "NOTE"],
    ]);
  });

  it("names the source and the document each finding is about", async () => {
    const found = await evaluate(
      [member("a", { action: "unpublish", scopeSlug: "pages", entryId: "p1" })],
      [reporting("core.hard", "hard", "STOP", ["a"])]
    );
    expect(found.hard).toEqual([
      {
        memberId: "a",
        code: "STOP",
        source: "core.hard",
        action: "unpublish",
        scopeKind: "collection",
        scopeSlug: "pages",
        entryId: "p1",
      },
    ]);
  });

  it("checks every member of a large release in batches, and reports the last one", async () => {
    const members = Array.from({ length: 250 }, (_, i) => member(`m${i}`));
    const last = members[members.length - 1].id;
    const check = vi.fn(async (batch: readonly { id: string }[]) =>
      batch
        .filter(m => m.id === last)
        .map(m => ({ memberId: m.id, code: "STOP" as const }))
    );
    const found = await evaluate(members, [
      defineReleaseCheckSource({
        key: "core.hard",
        severity: "hard",
        codes: ["STOP"],
        check,
      }),
    ]);
    // Two batches, the first full, so no source is ever handed more than its
    // bound and none of the members is skipped.
    expect(check.mock.calls.map(([batch]) => batch.length)).toEqual([
      READINESS_BATCH_SIZE,
      250 - READINESS_BATCH_SIZE,
    ]);
    expect(found.hard.map(f => f.memberId)).toEqual([last]);
  });

  it("refuses a finding about a member the source was not handed", async () => {
    await expect(
      evaluate(
        [member("a")],
        [
          defineReleaseCheckSource({
            key: "core.stray",
            severity: "hard",
            codes: ["STOP"],
            check: async () => [{ memberId: "nobody", code: "STOP" }],
          }),
        ]
      )
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("refuses a code the source did not declare", async () => {
    // Only a source written in JavaScript can do this; the type forbids it.
    const untyped = {
      key: "core.untyped",
      severity: "hard",
      codes: ["STOP"],
      check: async () => [{ memberId: "a", code: "SOMETHING_ELSE" }],
    } as ReleaseCheckSource<string>;
    await expect(evaluate([member("a")], [untyped])).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });

  it("asks no source anything for a release with no documents", async () => {
    const check = vi.fn(async () => []);
    const found = await evaluate(
      [],
      [
        defineReleaseCheckSource({
          key: "core.hard",
          severity: "hard",
          codes: ["STOP"],
          check,
        }),
      ]
    );
    expect(found).toEqual({ hard: [], soft: [] });
    expect(check).not.toHaveBeenCalled();
  });
});
