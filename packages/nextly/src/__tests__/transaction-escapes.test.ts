/**
 * The key an escape is listed under: its file and function, without the line,
 * so an accepted entry survives ordinary edits to the file it names.
 */
import { describe, expect, it } from "vitest";

import { siteKeyOf, UNKNOWN_SITE } from "./transaction-escapes";

describe("siteKeyOf", () => {
  it("keys a named frame by its file from packages/ on and its function", () => {
    expect(
      siteKeyOf(
        "NoticesService.tablePresent (/home/runner/work/nextly/nextly/packages/nextly/src/domains/notices/notices-service.ts:212:7)"
      )
    ).toBe(
      "packages/nextly/src/domains/notices/notices-service.ts#NoticesService.tablePresent"
    );
  });

  it("drops the line and column, so the same function at another line keys the same", () => {
    const at = (line: number) =>
      siteKeyOf(
        `reportPrincipalDeleted (/repo/packages/nextly/src/domains/audit/erase-principal.ts:${String(line)}:3)`
      );
    expect(at(40)).toBe(at(97));
  });

  it("keys a frame with no function name as anonymous, from a file URL too", () => {
    expect(
      siteKeyOf("file:///repo/packages/nextly/src/init/boot.ts:10:5")
    ).toBe("packages/nextly/src/init/boot.ts#<anonymous>");
  });

  it("keys a report that named no call site as unknown", () => {
    expect(siteKeyOf(undefined)).toBe(UNKNOWN_SITE);
  });
});
