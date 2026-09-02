import { describe, expect, it } from "vitest";

import type { DynamicCollectionRecord } from "../../../schemas/dynamic-collections/types";
import type { DynamicSingleRecord } from "../../../schemas/dynamic-singles/types";
import {
  hasLifecycleStatus,
  lifecycleStatusMember,
  lifecycleStatusZodMember,
} from "./generated-lifecycle";
import { TypeGenerator } from "./type-generator";
import { ZodGenerator } from "./zod-generator";

const collection = (status?: boolean) =>
  ({
    slug: "posts",
    labels: { singular: "Post", plural: "Posts" },
    fields: [{ name: "title", type: "text", required: true }],
    timestamps: true,
    ...(status === undefined ? {} : { status }),
  }) as unknown as DynamicCollectionRecord;

describe("hasLifecycleStatus", () => {
  it("is true only when the record declares it", () => {
    expect(hasLifecycleStatus({ status: true })).toBe(true);
    expect(hasLifecycleStatus({ status: false })).toBe(false);
    // The DEFAULT, which is the state most likely to go untested: `status` is
    // optional and absent on most collections.
    expect(hasLifecycleStatus({})).toBe(false);
  });
});

describe("the rendered members", () => {
  it("states the union from LIFECYCLE_STATUSES rather than from memory", () => {
    // Pinned deliberately. If a status is added to `LIFECYCLE_STATUSES` this
    // test fails, which is the prompt to decide whether the new value belongs
    // in a generated entry type — not something to discover from a user report.
    expect(lifecycleStatusMember()).toBe('  status: "draft" | "published";');
    expect(lifecycleStatusZodMember()).toBe(
      '  status: z.enum(["draft", "published"]),'
    );
  });

  it("is neither optional nor nullable", () => {
    // The column is NOT NULL DEFAULT 'draft', so a read always has a value.
    // Offering `?` or `| null` would describe a state the database cannot
    // produce, which is the same error this module's neighbour fixed in the
    // opposite direction for nullable columns.
    expect(lifecycleStatusMember()).not.toContain("status?:");
    expect(lifecycleStatusMember()).not.toContain("| null");
  });
});

describe("a collection that declares the lifecycle", () => {
  it("gets it in BOTH generated artifacts", () => {
    // Both, because a payload valid against one must be valid against the
    // other — the drift that produced this file's neighbour.
    const ts = new TypeGenerator().generateTypesFile([collection(true)]).code;
    const zod = new ZodGenerator().generateSchema(collection(true)).code;

    expect(ts).toContain('  status: "draft" | "published";');
    expect(zod).toContain('  status: z.enum(["draft", "published"]),');
  });

  it("does not carry the version-history status", () => {
    // `VersionStatus` also has "unpublished", which describes a row in the
    // version history and is never written to an entry. Offering it would send
    // consumers down a branch that cannot occur.
    const ts = new TypeGenerator().generateTypesFile([collection(true)]).code;
    expect(ts).not.toContain("unpublished");
  });
});

describe("a collection that does not", () => {
  it("gets no status member in either artifact", () => {
    // The default state. A generator that emitted the lifecycle unconditionally
    // would type a column these tables do not have.
    const ts = new TypeGenerator().generateTypesFile([collection()]).code;
    const zod = new ZodGenerator().generateSchema(collection()).code;

    expect(ts).not.toContain("status:");
    expect(zod).not.toContain("status:");
  });

  it("gets none when it declares status: false either", () => {
    const ts = new TypeGenerator().generateTypesFile([collection(false)]).code;
    expect(ts).not.toContain("status:");
  });
});

describe("a Single", () => {
  it("declares the lifecycle on the same flag a collection does", () => {
    const single = {
      slug: "site-settings",
      label: "Site Settings",
      fields: [{ name: "title", type: "text", required: true }],
      status: true,
    } as unknown as DynamicSingleRecord;

    const ts = new TypeGenerator().generateTypesFile([], [single]).code;
    expect(ts).toContain('  status: "draft" | "published";');
  });
});
