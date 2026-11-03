/**
 * The host write's context as a field inside one of its field-group instances
 * sees it: everything the host's own fields see, except a read of the host
 * entry itself, which would hand the instance the host's own field of that
 * name as though it were the instance's. That read answers that nothing is
 * stored, since the instance has no stored value at that address.
 */
import { describe, expect, it, vi } from "vitest";

import type { EntryWriteContext } from "../../../shared/lib/entry-validation";
import { instanceWriteOf } from "../services/field-group-mutation-service";

function host(over: Partial<EntryWriteContext> = {}): EntryWriteContext {
  return {
    kind: "collection",
    slug: "landings",
    id: "l1",
    inTransaction: true,
    readStored: vi.fn(() =>
      Promise.resolve({ kind: "value" as const, value: "stored" })
    ),
    ...over,
  };
}

describe("an instance's view of its host write", () => {
  it("answers a read of the host entry itself as nothing stored", async () => {
    const write = host();

    await expect(
      instanceWriteOf(write).readStored("blocks", {
        collection: "landings",
        id: "l1",
        field: "content",
        form: "published",
      })
    ).resolves.toEqual({ kind: "absent" });
    expect(write.readStored).not.toHaveBeenCalled();
  });

  it("answers a read of a host single itself as nothing stored, and reads another single", async () => {
    const write = host({ kind: "single", slug: "homeblock", id: undefined });

    await expect(
      instanceWriteOf(write).readStored("blocks", {
        single: "homeblock",
        field: "content",
        form: "published",
      })
    ).resolves.toEqual({ kind: "absent" });
    expect(write.readStored).not.toHaveBeenCalled();

    // CONTROL: another single is a different document.
    await expect(
      instanceWriteOf(write).readStored("blocks", {
        single: "footer",
        field: "content",
        form: "published",
      })
    ).resolves.toEqual({ kind: "value", value: "stored" });
  });

  it("reads anything else through the host's own read", async () => {
    const write = host();
    const target = {
      collection: "pb-components",
      id: "c1",
      field: "content",
      form: "draft" as const,
    };

    await expect(
      instanceWriteOf(write).readStored("blocks", target)
    ).resolves.toEqual({ kind: "value", value: "stored" });
    expect(write.readStored).toHaveBeenCalledWith("blocks", target);
    // Another entry of the host's own collection is a different document.
    await instanceWriteOf(write).readStored("blocks", {
      ...target,
      collection: "landings",
      id: "l2",
    });
    expect(write.readStored).toHaveBeenCalledTimes(2);
  });

  it("keeps the host's entry, operation and connection", () => {
    const view = instanceWriteOf(host());

    expect(view).toMatchObject({
      kind: "collection",
      slug: "landings",
      id: "l1",
      inTransaction: true,
    });
  });
});
