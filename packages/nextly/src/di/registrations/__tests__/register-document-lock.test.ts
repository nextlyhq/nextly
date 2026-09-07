import { describe, expect, it, vi, beforeEach } from "vitest";

import type { DocumentLockService } from "../../../domains/document-lock";
import { container } from "../../container";
import { registerDocumentLockServices } from "../register-document-lock";

import type { RegistrationContext } from "../types";

/** Enough of a context for a registration that reads only the adapter. */
function context(adapter: unknown): RegistrationContext {
  return { adapter } as RegistrationContext;
}

const adapter = {
  getCapabilities: () => ({ dialect: "postgres" }),
  transaction: vi.fn(),
};

beforeEach(() => {
  container.clear();
});

describe("registerDocumentLockServices", () => {
  it("registers a service the container can resolve", () => {
    // The gap this closes: the domain, its schemas and its tests all existed
    // and nothing could reach them, so the engine shipped as three unused
    // tables.
    registerDocumentLockServices(context(adapter));

    const service = container.get<DocumentLockService>("documentLockService");

    expect(service).toBeDefined();
    for (const method of [
      "read",
      "acquire",
      "renew",
      "release",
      "sweepExpired",
    ]) {
      expect(
        typeof (service as unknown as Record<string, unknown>)[method]
      ).toBe("function");
    }
  });

  it("hands every call the adapter it was registered with", async () => {
    // The binding is the whole job of the service, so a registration that
    // constructed it with the wrong adapter would resolve and then read
    // another database.
    registerDocumentLockServices(context(adapter));
    const service = container.get<DocumentLockService>("documentLockService");

    const capabilities = vi.spyOn(adapter, "getCapabilities");
    await service
      .read({ scopeKind: "collection", slug: "posts", entryId: "1" })
      .catch(() => undefined);

    expect(capabilities).toHaveBeenCalled();
    capabilities.mockRestore();
  });

  it("is a singleton, so two editors share one view of a claim", () => {
    // Two instances would each be correct and the second would not see a claim
    // taken through the first until it hit the database, which is the kind of
    // difference that only shows under load.
    registerDocumentLockServices(context(adapter));

    expect(container.get("documentLockService")).toBe(
      container.get("documentLockService")
    );
  });
});
