/**
 * The Direct API's collection gate in a boot that registers no access-control
 * service. The route gate (`requireCollectionAccess`) and a relationship's gate
 * both fall back to the caller's database grants there, so this gate must too:
 * otherwise one caller is refused a row by REST and through a relationship,
 * and served it by the Direct API.
 */

import { beforeEach, describe, expect, it, vi, beforeAll } from "vitest";

import { hasPermission } from "../../../services/lib/permissions";

import { CollectionAccessService } from "./collection-access-service";

import {
  createMockAdapter,
  createMockDb,
  silentLogger,
} from "../__tests__/collection-test-helpers";
import { loadDialectTables } from "../../../database/dialect-tables";

// The postgresql tables this file reads; the unit setup loads only
// the run's own dialect, as an app's adapter would.
beforeAll(async () => {
  await Promise.all(["postgresql"].map(d => loadDialectTables(d)));
});

vi.mock("../../../services/lib/permissions", () => ({
  hasPermission: vi.fn(),
}));

const grants = vi.mocked(hasPermission);

// The service's own database. The check must read the grants there, not
// through the global container, which such a setup may not have filled, or
// may have filled for another instance.
const serviceDb = createMockDb({ rows: [] });

function buildServiceWithoutAccessControl() {
  return new CollectionAccessService(
    createMockAdapter(serviceDb) as never,
    silentLogger as never
  );
}

const user = { id: "user-1", roles: ["editor"] };

describe("checkCollectionAccess with no access-control service", () => {
  beforeEach(() => {
    grants.mockReset();
  });

  it("refuses a signed-in caller the database grants refuse", async () => {
    grants.mockResolvedValue(false);

    const result =
      await buildServiceWithoutAccessControl().checkCollectionAccess({
        collectionName: "pages",
        operation: "read",
        user,
        overrideAccess: false,
      });

    expect(result?.statusCode).toBe(403);
    expect(grants).toHaveBeenCalledWith(
      "user-1",
      "read",
      "pages",
      serviceDb,
      "postgresql"
    );
  });

  it("reads the grants inside the caller's transaction when it is in one", async () => {
    grants.mockResolvedValue(true);
    const tx = { transaction: "handle" };

    await buildServiceWithoutAccessControl().checkCollectionAccess({
      collectionName: "pages",
      operation: "update",
      user,
      overrideAccess: false,
      executor: tx,
    });

    expect(grants).toHaveBeenCalledWith(
      "user-1",
      "update",
      "pages",
      tx,
      "postgresql"
    );
  });

  it("admits a signed-in caller the database grants admit", async () => {
    // The control: the same call, with the grant held, is served.
    grants.mockResolvedValue(true);

    const result =
      await buildServiceWithoutAccessControl().checkCollectionAccess({
        collectionName: "pages",
        operation: "read",
        user,
        overrideAccess: false,
      });

    expect(result).toBeNull();
    expect(grants).toHaveBeenCalledTimes(1);
  });

  it("leaves a route-authorized caller to the route, which already asked", async () => {
    grants.mockResolvedValue(false);

    const result =
      await buildServiceWithoutAccessControl().checkCollectionAccess({
        collectionName: "pages",
        operation: "read",
        user,
        overrideAccess: false,
        routeAuthorized: true,
      });

    expect(result).toBeNull();
    expect(grants).not.toHaveBeenCalled();
  });
});
