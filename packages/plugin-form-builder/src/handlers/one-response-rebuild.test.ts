/**
 * The one-response version a form save leaves, decided from what is stored:
 * moved on by a change of mode or Email field and by nothing else, never
 * taken from the payload, with the keys behind it until the sweep says
 * otherwise; and the version a key was made under, read off the key.
 */
import { describe, expect, it } from "vitest";

import { keysBehind, keyVersionOf, responseKeyOf } from "./one-response";
import { stampOneResponseVersion } from "./one-response-rebuild";

const FORM_KEYED = Symbol.for("nextly.plugin-form-builder.form-keyed");

/** Stamp a save of `settings` over `stored`, and answer the settings saved. */
function save(
  settings: Record<string, unknown> | undefined,
  stored?: Record<string, unknown>,
  finished?: number
): Record<string, unknown> | undefined {
  const data: Record<string | symbol, unknown> =
    settings === undefined ? { name: "Meetup" } : { settings };
  if (finished !== undefined) data[FORM_KEYED] = { version: finished };
  stampOneResponseVersion({
    operation: stored === undefined ? "create" : "update",
    data,
    originalData: stored === undefined ? undefined : { settings: stored },
  });
  return data.settings as Record<string, unknown> | undefined;
}

describe("the version a form save leaves", () => {
  it("starts a new form at version 0, whatever the payload says", () => {
    expect(
      save({
        oneResponse: "email",
        oneResponseVersion: 9,
        oneResponseKeyedVersion: 3,
      })
    ).toEqual({ oneResponse: "email", oneResponseVersion: 0 });
  });

  it("keeps the stored version through a save that changes nothing it compares", () => {
    const stored = {
      oneResponse: "ip",
      oneResponseVersion: 2,
      oneResponseKeyedVersion: 2,
    };
    expect(
      save(
        {
          oneResponse: "ip",
          submitButtonText: "Go",
          oneResponseVersion: 99,
          oneResponseKeyedVersion: 99,
        },
        stored
      )
    ).toMatchObject({ oneResponseVersion: 2, oneResponseKeyedVersion: 2 });
  });

  it("moves on and leaves keys behind when the mode changes to one that compares earlier answers", () => {
    expect(
      save(
        { oneResponse: "email", oneResponseField: "email" },
        { oneResponse: "off" }
      )
    ).toMatchObject({ oneResponseVersion: 1, oneResponseKeyedVersion: 0 });
    expect(
      save(
        { oneResponse: "ip" },
        {
          oneResponse: "email",
          oneResponseField: "email",
          oneResponseVersion: 4,
          oneResponseKeyedVersion: 3,
        }
      )
    ).toMatchObject({ oneResponseVersion: 5, oneResponseKeyedVersion: 3 });
  });

  it("moves on when one per email reads another field", () => {
    expect(
      save(
        { oneResponse: "email", oneResponseField: "work" },
        {
          oneResponse: "email",
          oneResponseField: "email",
          oneResponseVersion: 1,
          oneResponseKeyedVersion: 1,
        }
      )
    ).toMatchObject({ oneResponseVersion: 2, oneResponseKeyedVersion: 1 });
  });

  it("is up to date at once for a mode that compares nothing stored", () => {
    for (const oneResponse of ["off", "browser"]) {
      expect(
        save(
          { oneResponse },
          {
            oneResponse: "ip",
            oneResponseVersion: 1,
            oneResponseKeyedVersion: 1,
          }
        )
      ).toMatchObject({ oneResponseVersion: 2, oneResponseKeyedVersion: 2 });
    }
  });

  it("takes the keys as made only from the sweep's own write, for the current version", () => {
    const stored = {
      oneResponse: "email",
      oneResponseField: "email",
      oneResponseVersion: 3,
      oneResponseKeyedVersion: 2,
    };
    const same = { oneResponse: "email", oneResponseField: "email" };
    expect(save(same, stored, 3)).toMatchObject({
      oneResponseKeyedVersion: 3,
    });
    // A sweep finishing a version the form has left changes nothing.
    expect(save(same, stored, 2)).toMatchObject({
      oneResponseKeyedVersion: 2,
    });
    expect(save(same, stored)).toMatchObject({ oneResponseKeyedVersion: 2 });
  });

  it("leaves a save that does not write settings alone", () => {
    expect(save(undefined, { oneResponse: "ip" })).toBeUndefined();
  });
});

describe("a key's version", () => {
  const digests = () => ({
    digest: async (purpose: string, value: string) => `${purpose}-${value}`,
    prepare: async () => undefined,
  });

  it("is written on the key from version 1, and absent at version 0", async () => {
    const ip = { ipAddress: "203.0.113.9" };
    const v0 = await responseKeyOf(digests, { oneResponse: "ip" }, ip);
    const v3 = await responseKeyOf(
      digests,
      { oneResponse: "ip", oneResponseVersion: 3 },
      ip
    );
    expect(v0).toBe("ip-203.0.113.9");
    expect(v3).toBe("v3:ip-203.0.113.9");
    expect(keyVersionOf(v0!)).toBe(0);
    expect(keyVersionOf(v3!)).toBe(3);
    expect(
      await responseKeyOf(
        digests,
        { oneResponse: "browser", oneResponseVersion: 2 },
        { browserToken: "t".repeat(20) }
      )
    ).toBe(`v2:browser:browser-${"t".repeat(20)}`);
  });

  it("is behind only when the keys were made for an earlier version", () => {
    expect(
      keysBehind({ oneResponseVersion: 2, oneResponseKeyedVersion: 1 })
    ).toBe(true);
    expect(
      keysBehind({ oneResponseVersion: 2, oneResponseKeyedVersion: 2 })
    ).toBe(false);
    // Saved before the keyed version was recorded: up to date.
    expect(keysBehind({ oneResponseVersion: 0 })).toBe(false);
  });
});
