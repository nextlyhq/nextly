/**
 * Whether a registered provider can actually run on THIS install.
 *
 * A provider can be registered and still be unusable, because the transport
 * library it needs is an optional peer the host never installed. Without this
 * the admin can only offer the option and let the send fail, which reports the
 * problem at the worst possible moment and names no remedy.
 *
 * Evaluated per call rather than captured at module load, so installing the
 * package and restarting changes the answer with no cache to invalidate.
 */
import { describe, expect, it } from "vitest";

import { defineEmailProvider, toDescriptor } from "../provider-definition";

/** The smallest definition that registers, so each case varies one thing. */
function providerWith(
  extra: Partial<Parameters<typeof defineEmailProvider>[0]>
) {
  return defineEmailProvider({
    type: "probe",
    label: "Probe",
    configFields: [],
    parseConfig: () => ({}),
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true }),
    }),
    ...extra,
  });
}

describe("provider availability in the descriptor", () => {
  it("reports ready when a definition declares no check", () => {
    expect(toDescriptor(providerWith({})).availability).toEqual({
      status: "ready",
    });
  });

  it("carries the package and command when a dependency is missing", () => {
    const provider = providerWith({
      checkAvailability: () => ({
        status: "needs-dependency",
        packageName: "some-lib",
        installCommand: "npm install some-lib",
        docsUrl: "https://example.com/docs",
      }),
    });

    expect(toDescriptor(provider).availability).toEqual({
      status: "needs-dependency",
      packageName: "some-lib",
      installCommand: "npm install some-lib",
      docsUrl: "https://example.com/docs",
    });
  });

  it("reports ready when the check finds the dependency present", () => {
    const provider = providerWith({
      checkAvailability: () => ({ status: "ready" }),
    });

    expect(toDescriptor(provider).availability).toEqual({ status: "ready" });
  });

  it("treats a throwing check as unavailable rather than failing the catalog", () => {
    // One badly written plugin must not take the whole Settings page down, and
    // a provider that cannot answer is not one to offer.
    const provider = providerWith({
      checkAvailability: () => {
        throw new Error("boom");
      },
    });

    expect(toDescriptor(provider).availability.status).toBe("needs-dependency");
  });

  it("does not let a hand-built provider publish a foreign availability shape", () => {
    // `RegisteredEmailProvider` is structural, so a JavaScript plugin can hang
    // anything off the returned object. The descriptor is rebuilt key by key
    // for the same reason `publishableField` is.
    const provider = providerWith({
      checkAvailability: () =>
        ({
          status: "needs-dependency",
          packageName: "some-lib",
          installCommand: "npm install some-lib",
          secretHandle: "must-not-travel",
        }) as never,
    });

    expect(toDescriptor(provider).availability).not.toHaveProperty(
      "secretHandle"
    );
  });
});
