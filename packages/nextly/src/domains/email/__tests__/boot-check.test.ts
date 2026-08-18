/**
 * Telling the operator at boot when a stored provider cannot run here.
 *
 * An optional peer dependency fails at runtime rather than at install time, so
 * without this the first evidence is a failed password reset in production.
 * Boot is the earliest moment both facts are known: which providers this
 * install has stored, and which transports this machine can load.
 */
import { describe, expect, it, vi } from "vitest";

import { warnAboutUnusableProviders } from "../boot-check";

describe("the unusable-provider boot check", () => {
  it("warns once, naming the provider, when a stored provider is unusable", async () => {
    const warn = vi.fn();

    await warnAboutUnusableProviders({
      listProviderTypes: () => Promise.resolve(["smtp"]),
      isAvailable: () => false,
      warn,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("smtp");
  });

  it("warns once per transport, not once per stored row", async () => {
    const warn = vi.fn();

    await warnAboutUnusableProviders({
      listProviderTypes: () => Promise.resolve(["smtp", "smtp", "smtp"]),
      isAvailable: () => false,
      warn,
    });

    // Three rows can share one type, and an operator needs to be told about
    // the missing transport, not about each row that happens to use it.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stays silent when every stored provider is usable", async () => {
    const warn = vi.fn();

    await warnAboutUnusableProviders({
      listProviderTypes: () => Promise.resolve(["smtp", "resend"]),
      isAvailable: () => true,
      warn,
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent when nothing is stored", async () => {
    const warn = vi.fn();

    await warnAboutUnusableProviders({
      listProviderTypes: () => Promise.resolve([]),
      isAvailable: () => false,
      warn,
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it("names only the unusable ones when some are fine", async () => {
    const warn = vi.fn();

    await warnAboutUnusableProviders({
      listProviderTypes: () => Promise.resolve(["smtp", "resend"]),
      isAvailable: type => type !== "smtp",
      warn,
    });

    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain("smtp");
    // Naming a working provider in a warning about broken ones sends an
    // operator to check something that is not wrong.
    expect(message).not.toContain("resend");
  });

  it("does not throw when the provider list cannot be read", async () => {
    const warn = vi.fn();

    // A diagnostic must never be the reason a server fails to start.
    await expect(
      warnAboutUnusableProviders({
        listProviderTypes: () => Promise.reject(new Error("db not ready")),
        isAvailable: () => false,
        warn,
      })
    ).resolves.toBeUndefined();

    expect(warn).not.toHaveBeenCalled();
  });
});
