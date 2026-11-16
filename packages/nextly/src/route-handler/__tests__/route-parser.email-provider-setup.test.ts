import { describe, expect, it } from "vitest";

import { getActionFromMethod, parseRestRoute } from "../route-parser";

describe("the email provider setup's routes", () => {
  it("reads the sending settings, gated as a read", () => {
    expect(
      parseRestRoute(["email-providers", "settings"], "GET")
    ).toMatchObject({
      service: "emailProviders",
      method: "getSendingSettings",
    });
    expect(getActionFromMethod("GET")).toBe("read");
  });

  it("checks unsaved settings, gated as a create", () => {
    expect(parseRestRoute(["email-providers", "check"], "POST")).toMatchObject({
      service: "emailProviders",
      method: "checkProvider",
    });
    expect(getActionFromMethod("POST")).toBe("create");
  });

  it("checks a saved provider's changed settings at its own address", () => {
    expect(
      parseRestRoute(["email-providers", "p1", "check"], "POST")
    ).toMatchObject({
      service: "emailProviders",
      method: "checkSavedProvider",
      operation: "update",
      routeParams: { providerId: "p1" },
    });
  });

  it("does not read either word as a provider id", () => {
    // Matched before the by-id branch: otherwise "settings" would be fetched
    // as a provider and answer 404.
    expect(
      parseRestRoute(["email-providers", "settings"], "GET")?.method
    ).not.toBe("getProvider");
    expect(
      parseRestRoute(["email-providers", "check"], "POST")?.method
    ).not.toBe("createProvider");
  });

  it("leaves the other verbs and a real id where they were", () => {
    expect(
      parseRestRoute(["email-providers", "settings"], "PATCH")?.method
    ).not.toBe("getSendingSettings");
    expect(
      parseRestRoute(["email-providers", "check"], "GET")?.method
    ).not.toBe("checkProvider");
    expect(
      parseRestRoute(
        ["email-providers", "3f6c1d2e-8a4b-4c5d-9e6f-7a8b9c0d1e2f"],
        "GET"
      )
    ).toMatchObject({ method: "getProvider" });
  });
});
