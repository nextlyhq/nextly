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

/** The instance's own field names. */
const OWN = new Set(["title", "content"]);

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
      instanceWriteOf(write, OWN).readStored("blocks", {
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
      instanceWriteOf(write, OWN).readStored("blocks", {
        single: "homeblock",
        field: "content",
        form: "published",
      })
    ).resolves.toEqual({ kind: "absent" });
    expect(write.readStored).not.toHaveBeenCalled();

    // CONTROL: another single is a different document.
    await expect(
      instanceWriteOf(write, OWN).readStored("blocks", {
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
      instanceWriteOf(write, OWN).readStored("blocks", target)
    ).resolves.toEqual({ kind: "value", value: "stored" });
    expect(write.readStored).toHaveBeenCalledWith("blocks", target);
    // Another entry of the host's own collection is a different document.
    await instanceWriteOf(write, OWN).readStored("blocks", {
      ...target,
      collection: "landings",
      id: "l2",
    });
    expect(write.readStored).toHaveBeenCalledTimes(2);
  });

  it("answers a read of a field nested in one of the instance's own as nothing stored", async () => {
    const write = host();
    for (const field of ["title.content", "content[0].body"]) {
      await expect(
        instanceWriteOf(write, OWN).readStored("blocks", {
          collection: "landings",
          id: "l1",
          field,
          form: "published",
        })
      ).resolves.toEqual({ kind: "absent" });
    }
    expect(write.readStored).not.toHaveBeenCalled();
  });

  it("reads another field of the host through the host's own read", async () => {
    const write = host();
    const target = {
      collection: "landings",
      id: "l1",
      field: "sidebar",
      form: "published" as const,
    };

    await expect(
      instanceWriteOf(write, OWN).readStored("blocks", target)
    ).resolves.toEqual({ kind: "value", value: "stored" });
    expect(write.readStored).toHaveBeenCalledWith("blocks", target);
  });

  it("keeps the host's entry, operation, language, payload and connection", () => {
    const payload = { status: "published" };
    const view = instanceWriteOf(
      host({ locale: "de", defaultLocale: "en", payload }),
      OWN
    );

    expect(view).toMatchObject({
      kind: "collection",
      slug: "landings",
      id: "l1",
      locale: "de",
      defaultLocale: "en",
      payload,
      inTransaction: true,
    });
  });
});
