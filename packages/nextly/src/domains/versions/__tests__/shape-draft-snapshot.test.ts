/**
 * Shaping a stored snapshot for a draft read.
 *
 * The half of an overlay with no database in it, so it is asserted directly
 * rather than through a service that would need one.
 */
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import { text } from "../../../config";
import { shapeDraftSnapshot } from "../shape-draft-snapshot";

const FIELDS = [
  text({ name: "title" }),
  text({ name: "body" }),
] as unknown as FieldConfig[];

const base = {
  fields: FIELDS,
  componentSchemas: undefined,
  hasSlug: true,
  hasTitle: true,
};

describe("shapeDraftSnapshot", () => {
  it("keeps the values the schema still declares", () => {
    const shaped = shapeDraftSnapshot({
      ...base,
      snapshot: { title: "pending", body: "also pending", status: "draft" },
    });

    expect(shaped.title).toBe("pending");
    expect(shaped.body).toBe("also pending");
  });

  it("prunes a key the schema no longer declares", () => {
    // A field dropped while the draft was pending leaves a key the snapshot
    // still carries. A live read of the same document would not return it, and
    // the redaction and hooks downstream only inspect declared fields — so an
    // obsolete value would reach the response unexamined.
    const shaped = shapeDraftSnapshot({
      ...base,
      snapshot: { title: "pending", subtitle: "removed from the schema" },
    });

    expect(shaped.title).toBe("pending");
    expect("subtitle" in shaped).toBe(false);
  });

  it("carries the identity and timestamp columns the prune holds back", () => {
    // The prune withholds these because a RESTORE must not resubmit them. A
    // read carries them, so they are copied back — and taken from the shared
    // list, which is why the first-publication marker survives.
    const shaped = shapeDraftSnapshot({
      ...base,
      snapshot: {
        id: "doc-1",
        title: "pending",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-02-02T00:00:00.000Z",
        firstPublishedAt: "2026-01-15T00:00:00.000Z",
      },
    });

    expect({
      id: shaped.id,
      createdAt: shaped.createdAt,
      updatedAt: shaped.updatedAt,
      firstPublishedAt: shaped.firstPublishedAt,
    }).toEqual({
      id: "doc-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-02T00:00:00.000Z",
      firstPublishedAt: "2026-01-15T00:00:00.000Z",
    });
  });

  it("does not invent a system column the snapshot never held", () => {
    // Absence is copied as absence: a snapshot written before the document was
    // first published carries no marker, and reporting one would date a
    // publication that never happened.
    const shaped = shapeDraftSnapshot({
      ...base,
      snapshot: { title: "pending" },
    });

    expect("firstPublishedAt" in shaped).toBe(false);
    expect("id" in shaped).toBe(false);
  });

  it("keeps a synthesized column out when the document has none", () => {
    // A plugin-contributed collection gets no synthesized slug/title pair, so
    // claiming they exist would keep an obsolete key the schema never declared.
    const shaped = shapeDraftSnapshot({
      ...base,
      hasSlug: false,
      hasTitle: false,
      fields: [text({ name: "body" })] as unknown as FieldConfig[],
      snapshot: { body: "pending", slug: "stale", title: "stale" },
    });

    expect(shaped.body).toBe("pending");
    expect({ slug: "slug" in shaped, title: "title" in shaped }).toEqual({
      slug: false,
      title: false,
    });
  });
});
