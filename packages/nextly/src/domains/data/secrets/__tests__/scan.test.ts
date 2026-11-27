/**
 * The seeded-secret scan finds a value wherever an archive is likely to put
 * it, and reports nothing where it is absent.
 */

import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { findSeededSecrets } from "../scan";

const SEED = {
  label: "webhook signing secret",
  value: "seeded-secret-0f3a9c2b7d",
};
const raw = Buffer.from(SEED.value, "utf8");

describe("findSeededSecrets", () => {
  it("finds a value as written, in text and in bytes", () => {
    expect(
      findSeededSecrets(
        [
          { where: "content/posts.json", content: `{"note":"${SEED.value}"}` },
          {
            where: "media/files/x",
            content: new Uint8Array(Buffer.concat([Buffer.from([0, 1]), raw])),
          },
        ],
        [SEED]
      )
    ).toEqual([
      { label: SEED.label, where: "content/posts.json", form: "as written" },
      { label: SEED.label, where: "media/files/x", form: "as written" },
    ]);
  });

  it.each([
    ["base64", raw.toString("base64")],
    ["base64url", raw.toString("base64url")],
    ["hex", raw.toString("hex")],
    ["hex", raw.toString("hex").toUpperCase()],
  ] as const)("finds a value encoded as %s", (form, encoded) => {
    expect(
      findSeededSecrets(
        [{ where: "settings/site.json", content: `x${encoded}x` }],
        [SEED]
      )
    ).toContainEqual({ label: SEED.label, where: "settings/site.json", form });
  });

  it("reports nothing for output that does not hold the value", () => {
    // A near miss, so a scan that matched on a prefix would report it.
    const near = SEED.value.slice(0, -1);
    expect(
      findSeededSecrets(
        [{ where: "manifest.json", content: `{"a":"${near}"}` }],
        [SEED]
      )
    ).toEqual([]);
  });

  it("refuses a seed short enough to match by chance", () => {
    expect(() =>
      findSeededSecrets(
        [{ where: "a", content: "" }],
        [{ label: "short", value: "abc" }]
      )
    ).toThrow(NextlyError);
  });
});
