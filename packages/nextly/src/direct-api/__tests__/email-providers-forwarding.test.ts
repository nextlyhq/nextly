/**
 * What `nextly.emailProviders.*` forwards to the service.
 *
 * The create path builds an explicit object rather than passing `data`
 * through, so every property the argument type offers has to be named there
 * too. A property the type accepts and the object omits is silently dropped:
 * the call succeeds, the service applies its own default, and the caller is
 * handed back a provider that contradicts what they asked for.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import type { NextlyContext } from "../namespaces/context";
import { createEmailProvidersNamespace } from "../namespaces/email";

function build() {
  const createProvider = vi.fn().mockResolvedValue({ id: "ep_1" });
  const updateProvider = vi.fn().mockResolvedValue({ id: "ep_1" });
  const ctx = {
    emailProviderService: { createProvider, updateProvider },
    defaultConfig: {},
  } as unknown as NextlyContext;

  return {
    providers: createEmailProvidersNamespace(ctx),
    createProvider,
    updateProvider,
  };
}

const DATA = {
  name: "Transactional",
  type: "resend" as const,
  fromEmail: "hello@example.com",
  configuration: { apiKey: "k" },
};

describe("Direct API - email providers namespace", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards isActive on a create", async () => {
    // `createProvider` reads `data.isActive ?? true`, so an omitted key and an
    // explicit `false` are the same request as far as the service can tell —
    // and the provider a caller asked to create deactivated starts sending.
    const { providers, createProvider } = build();

    await providers.create({ data: { ...DATA, isActive: false } });

    expect(createProvider.mock.calls[0][0]).toMatchObject({
      isActive: false,
    });
  });

  it("forwards isDefault on a create", async () => {
    // The control for the assertion above: a property that IS named in the
    // forwarded object, so the test fails for a namespace that had stopped
    // forwarding anything rather than only for the one key.
    const { providers, createProvider } = build();

    await providers.create({ data: { ...DATA, isDefault: true } });

    expect(createProvider.mock.calls[0][0]).toMatchObject({ isDefault: true });
  });

  it("leaves isActive absent when the caller says nothing", async () => {
    // The other control. Forwarding a literal `undefined` is fine, but
    // forwarding `false` for an unstated key would deactivate every provider
    // created without one.
    const { providers, createProvider } = build();

    await providers.create({ data: DATA });

    expect(createProvider.mock.calls[0][0].isActive).toBeUndefined();
  });
});
