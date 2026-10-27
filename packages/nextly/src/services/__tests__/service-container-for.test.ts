/**
 * `serviceContainerFor` builds the barrel's own `ServiceContainer`, from the
 * adapter it is handed, once per call.
 *
 * The role seeders and the user services used to write
 * `new ServiceContainer(adapter)` against a static import. They now load the
 * container when they build one, so what must not change is which class is
 * built and with what. A path to a different module, or a second copy of the
 * class, would construct something the barrel never exports; a lookup of the
 * registered services, or an adapter of its own, would answer for a database
 * the caller did not name. The barrel's class is replaced here by one that
 * records its construction, so each of those reads as a failure.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it, vi } from "vitest";

const built = vi.hoisted(() => [] as unknown[]);

vi.mock("../index", () => ({
  ServiceContainer: class {
    constructor(readonly adapter: unknown) {
      built.push(adapter);
    }
  },
}));

import { ServiceContainer } from "../index";
import { serviceContainerFor } from "../service-container-for";

const adapter = { dialect: "sqlite" } as unknown as DrizzleAdapter;

describe("serviceContainerFor", () => {
  it("builds the barrel's ServiceContainer from the adapter it is handed", async () => {
    built.length = 0;

    const container = await serviceContainerFor(adapter);

    expect(container).toBeInstanceOf(ServiceContainer);
    expect(built).toEqual([adapter]);
    expect(built[0]).toBe(adapter);
  });

  it("builds a new one on every call, as the call sites did", async () => {
    built.length = 0;

    const first = await serviceContainerFor(adapter);
    const second = await serviceContainerFor(adapter);

    expect(first).not.toBe(second);
    expect(built).toHaveLength(2);
  });
});
