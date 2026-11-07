/**
 * A document with more top-level fields than one write check names is asked
 * in several checks, each naming the same document, language and status, and
 * is allowed only where every check is.
 */
import type { PluginWriteCheck } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { FIELDS_PER_CHECK, mayWriteEveryField } from "./judge";

const FIELDS = Array.from({ length: 65 }, (_, n) => `field${n}`);

/** A write check that records what it was asked, refusing one field. */
function checks(refusing?: string) {
  const asked: PluginWriteCheck[] = [];
  const mayWrite = async (check: PluginWriteCheck) => {
    asked.push(check);
    return !(check.fields ?? []).includes(refusing ?? "");
  };
  return { asked, mayWrite };
}

describe("a write check over a document with 65 fields", () => {
  it("asks every field, at most 32 to a check, with the same document, language and status", async () => {
    const { asked, mayWrite } = checks();

    const allowed = await mayWriteEveryField(mayWrite, {
      collection: "pages",
      id: "7",
      status: "published",
      locale: "de",
      fields: FIELDS,
    });

    expect(allowed).toBe(true);
    expect(FIELDS_PER_CHECK).toBe(32);
    expect(asked.map(check => check.fields?.length)).toEqual([32, 32, 1]);
    expect(asked.flatMap(check => check.fields ?? [])).toEqual(FIELDS);
    for (const check of asked) {
      expect(check).toMatchObject({
        collection: "pages",
        id: "7",
        status: "published",
        locale: "de",
      });
    }
  });

  it("refuses when the last field alone is refused", async () => {
    const { mayWrite } = checks("field64");

    await expect(
      mayWriteEveryField(mayWrite, {
        collection: "pages",
        id: "7",
        fields: FIELDS,
      })
    ).resolves.toBe(false);
  });

  it("still asks once for a write naming no field", async () => {
    const { asked, mayWrite } = checks();

    await expect(
      mayWriteEveryField(mayWrite, { single: "home", fields: [] })
    ).resolves.toBe(true);
    expect(asked).toHaveLength(1);
  });
});
