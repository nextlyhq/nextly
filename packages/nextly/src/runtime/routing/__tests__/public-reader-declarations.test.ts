/**
 * Which fields are hidden is never guessed. With no Nextly registered in the
 * process, a public read is refused rather than returned unstripped, and a
 * route reading elsewhere says which fields are hidden through the reader's
 * declarations, which are asked only once the read has run.
 */
import { describe, expect, it, vi } from "vitest";

import { isServicesRegistered } from "../../../di/service-access";
import { NextlyError } from "../../../errors/nextly-error";
import {
  createPublicReader,
  type PublicReaderDeclarations,
  type PublicReaderSource,
  type PublicSource,
} from "../public-reader";

const row = () => ({ id: "1", title: "Hello", secret: "s", internal: "i" });

function source(order: string[] = []) {
  return {
    find: vi.fn(async () => {
      order.push("read");
      return { items: [row()], meta: { total: 1 } };
    }),
    findSingle: vi.fn(async () => {
      order.push("read");
      return row();
    }),
  } as unknown as PublicReaderSource;
}

const isConfiguration = (error: unknown) =>
  NextlyError.isCode(error, "CONFIGURATION_ERROR");

describe("a public read whose schema cannot be read", () => {
  it("is refused, returning nothing it read", async () => {
    // The control: no Nextly is registered in this process.
    expect(isServicesRegistered()).toBe(false);
    const reader = createPublicReader(source());
    for (const read of [
      () => reader.find({ collection: "posts" }),
      () => reader.count({ collection: "posts" }),
      () => reader.findSingle({ slug: "banner" }),
    ]) {
      const outcome = await read().then(
        value => ({ value }),
        (error: unknown) => ({ error })
      );
      expect(outcome).not.toHaveProperty("value");
      expect(isConfiguration((outcome as { error: unknown }).error)).toBe(true);
    }
  });
});

describe("a reader given its declarations", () => {
  it("strips what they name for each source it reads", async () => {
    const asked: PublicSource[] = [];
    const declarations: PublicReaderDeclarations = {
      hiddenFields: source => {
        asked.push(source);
        return source.kind === "collection" ? ["secret"] : ["internal"];
      },
    };
    const reader = createPublicReader(source(), { declarations });
    await expect(reader.find({ collection: "posts" })).resolves.toMatchObject({
      items: [{ id: "1", title: "Hello", internal: "i" }],
    });
    const single = await reader.findSingle({ slug: "banner" });
    expect(single).toEqual({ id: "1", title: "Hello", secret: "s" });
    expect(asked).toEqual([
      { kind: "collection", slug: "posts" },
      { kind: "single", slug: "banner" },
    ]);
  });

  it("asks them only once the read has run", async () => {
    const order: string[] = [];
    const reader = createPublicReader(source(order), {
      declarations: {
        hiddenFields: async () => {
          order.push("declarations");
          return [];
        },
      },
    });
    await reader.find({ collection: "posts" });
    await reader.count({ collection: "posts" });
    await reader.findSingle({ slug: "banner" });
    expect(order).toEqual([
      "read",
      "declarations",
      "read",
      "declarations",
      "read",
      "declarations",
    ]);
  });

  // A failure that reads like a miss, from the declarations rather than the
  // read: a schema service refusing access, or not finding the source.
  it.each([
    ["refused", NextlyError.forbidden()],
    ["not found", NextlyError.notFound()],
  ])(
    "lets declarations that fail as %s through from every read, a Single's too",
    async (_, failure) => {
      const reader = createPublicReader(source(), {
        declarations: {
          hiddenFields: async () => {
            throw failure;
          },
        },
      });
      await expect(reader.find({ collection: "posts" })).rejects.toBe(failure);
      await expect(reader.count({ collection: "posts" })).rejects.toBe(failure);
      await expect(reader.findSingle({ slug: "banner" })).rejects.toBe(failure);
    }
  );

  it("CONTROL: still answers null for a Single the read itself misses", async () => {
    const hiddenFields = vi.fn(() => []);
    const reader = createPublicReader(
      {
        find: vi.fn(),
        findSingle: vi.fn(async () => {
          throw NextlyError.notFound();
        }),
      } as unknown as PublicReaderSource,
      { declarations: { hiddenFields } }
    );
    await expect(reader.findSingle({ slug: "banner" })).resolves.toBeNull();
    // Nothing was read, so nothing was asked of the declarations.
    expect(hiddenFields).not.toHaveBeenCalled();
  });

  it("refuses declarations that are not field paths", async () => {
    const reader = createPublicReader(source(), {
      declarations: {
        hiddenFields: () => [5] as unknown as readonly string[],
      },
    });
    await expect(reader.find({ collection: "posts" })).rejects.toSatisfy(
      isConfiguration
    );
  });
});
