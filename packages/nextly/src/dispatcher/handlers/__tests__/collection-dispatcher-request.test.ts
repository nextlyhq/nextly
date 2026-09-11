/**
 * Both HTTP doors into a collection hand the request down to the write.
 *
 * There is more than one. `POST /api/forms/:slug/submit` is the door a form
 * plugin knows about, and the generic collection create is a second one, public
 * whenever a collection grants public create -- which the submissions
 * collection does, on purpose. A rule that reads the request cannot apply at a
 * door that never passed one on, so a rule attached at the write seam and
 * tested only through the form route would leave the other door open.
 *
 * @module dispatcher/handlers/__tests__/collection-dispatcher-request
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../helpers/di", () => ({
  getCollectionsHandlerFromDI: vi.fn(),
}));

import type { ServiceContainer } from "../../../services";
import { getCollectionsHandlerFromDI } from "../../helpers/di";
import { dispatchCollections } from "../collection-dispatcher";

const request = new Request("https://example.test/api/collections/notes", {
  method: "POST",
  headers: { "x-forwarded-for": "203.0.113.7" },
});

const ok = { success: true, statusCode: 200, message: "ok", data: { id: "1" } };

function wire(handler: Record<string, unknown>): ServiceContainer {
  vi.mocked(getCollectionsHandlerFromDI).mockReturnValue(
    handler as unknown as ReturnType<typeof getCollectionsHandlerFromDI>
  );
  return { collections: handler } as unknown as ServiceContainer;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the generic collection door", () => {
  it("hands the request to the create it performs", async () => {
    const createEntry = vi.fn().mockResolvedValue(ok);
    await dispatchCollections(
      wire({ createEntry }),
      "createEntry",
      { collectionName: "notes" },
      { title: "hi" },
      request
    );
    // Identity, not `toMatchObject({ request })`. A `Request` keeps everything
    // on its prototype, so it has no own enumerable properties and matching
    // one structurally succeeds against `undefined`: the assertion would pass
    // for the very defect it is here to catch.
    const passed = createEntry.mock.calls[0]![0] as { request?: unknown };
    expect(passed.request).toBe(request);
  });

  it("says there was none when the caller passed none", async () => {
    // The control. A dispatcher that reached for an ambient request would pass
    // the case above while telling a hook that a background job was a visitor.
    const createEntry = vi.fn().mockResolvedValue(ok);
    await dispatchCollections(
      wire({ createEntry }),
      "createEntry",
      { collectionName: "notes" },
      { title: "hi" }
    );
    const passed = createEntry.mock.calls[0]![0] as { request?: unknown };
    expect(passed.request).toBeUndefined();
  });
});
