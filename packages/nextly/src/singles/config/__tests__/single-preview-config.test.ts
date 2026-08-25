/**
 * Where a Single is served.
 *
 * A Single has a Draft / Published lifecycle, so it has drafts worth sharing —
 * and until now no way to say where a reviewer should open one. A collection
 * declares this through `admin.preview`; a Single needs the same, and for the
 * same reason: nothing outside the application knows whether the homepage
 * Single is served at `/`, at `/home`, or under a locale segment.
 *
 * The declaration is a function of the Single's own document rather than a bare
 * path, so a Single whose address depends on its content can express that —
 * matching the collection shape rather than inventing a second one.
 */
import { describe, expect, it } from "vitest";

import { text } from "../../../collections/fields/helpers";
import { defineSingle } from "../define-single";

describe("a Single's preview declaration", () => {
  it("survives defineSingle", () => {
    const single = defineSingle({
      slug: "homepage",
      fields: [text({ name: "title" })],
      status: true,
      admin: { preview: { url: () => "/" } },
    });

    expect(typeof single.admin?.preview?.url).toBe("function");
  });

  it("can answer a fixed path, which is the common case", () => {
    const single = defineSingle({
      slug: "homepage",
      fields: [text({ name: "title" })],
      admin: { preview: { url: () => "/" } },
    });

    expect(single.admin?.preview?.url({})).toBe("/");
  });

  it("can derive the path from the Single's own document", () => {
    const single = defineSingle({
      slug: "landing",
      fields: [text({ name: "title" })],
      admin: {
        preview: {
          url: doc => (typeof doc.path === "string" ? `/${doc.path}` : null),
        },
      },
    });

    expect(single.admin?.preview?.url({ path: "welcome" })).toBe("/welcome");
  });

  // `null` is how a declaration says "not previewable right now", which is a
  // different state from a Single that declares no preview at all: the first
  // can become previewable, the second never does.
  it("can decline for a document that is not previewable yet", () => {
    const single = defineSingle({
      slug: "landing",
      fields: [text({ name: "title" })],
      admin: {
        preview: {
          url: doc => (typeof doc.path === "string" ? `/${doc.path}` : null),
        },
      },
    });

    expect(single.admin?.preview?.url({})).toBeNull();
  });

  it("is optional, so every existing Single keeps compiling", () => {
    const single = defineSingle({ slug: "contact-details", fields: [] });

    expect(single.admin?.preview).toBeUndefined();
  });
});
