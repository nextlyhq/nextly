import { describe, expect, it } from "vitest";

import { presetGrantsStanding } from "../preset-grants-release";

/**
 * How a running release stands against the recorded one: only an older
 * release leaves the preset grants, and the record only ever moves to a
 * newer release. Versions order by semantic version, so the cases below
 * include ones where text order says the opposite.
 */
describe("presetGrantsStanding", () => {
  it("sets the grants and records the running release where none is recorded", () => {
    expect(presetGrantsStanding(undefined, "0.9.0")).toEqual({
      kind: "set",
      record: "0.9.0",
    });
  });

  it("records a newer release, ordered by version rather than as text", () => {
    expect(presetGrantsStanding("0.9.0", "0.10.0")).toEqual({
      kind: "set",
      record: "0.10.0",
    });
    expect(presetGrantsStanding("0.0.2-alpha.9", "0.0.2-alpha.10")).toEqual({
      kind: "set",
      record: "0.0.2-alpha.10",
    });
    // A release is newer than its own prereleases.
    expect(presetGrantsStanding("1.0.0-alpha.3", "1.0.0")).toEqual({
      kind: "set",
      record: "1.0.0",
    });
  });

  it("sets the grants and records nothing new from the recorded release itself", () => {
    expect(presetGrantsStanding("0.10.0", "0.10.0")).toEqual({
      kind: "set",
      record: undefined,
    });
  });

  it("leaves the grants to a newer recorded release", () => {
    expect(presetGrantsStanding("0.10.0", "0.9.0")).toEqual({
      kind: "leave",
      recorded: "0.10.0",
    });
    expect(presetGrantsStanding("0.0.2-alpha.10", "0.0.2-alpha.9")).toEqual({
      kind: "leave",
      recorded: "0.0.2-alpha.10",
    });
  });

  it("leaves the grants where the running release cannot be placed against a record", () => {
    expect(presetGrantsStanding("0.10.0", "unknown")).toEqual({
      kind: "leave",
      recorded: "0.10.0",
    });
    // With nothing recorded it sets them, and records nothing it cannot order.
    expect(presetGrantsStanding(undefined, "unknown")).toEqual({
      kind: "set",
      record: undefined,
    });
  });
});
