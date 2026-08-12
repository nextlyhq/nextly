/**
 * Relationship and upload ids in a snapshot or diff are resolved to display
 * labels through the SAME access-checked read a normal request uses, so a caller
 * never learns the label of a document they may not read. These tests pin that
 * access gate, the id-preserving fallbacks, the PII exclusion, and the shape the
 * value kit consumes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getEntrySpy, checkAccessSpy, findByIdSpy, listUsersByIdsSpy } =
  vi.hoisted(() => ({
    getEntrySpy: vi.fn(),
    checkAccessSpy: vi.fn(),
    findByIdSpy: vi.fn(),
    listUsersByIdsSpy: vi.fn(),
  }));

vi.mock("../../../di", () => ({
  getService: vi.fn((name: string) => {
    if (name === "collectionsHandler") return { getEntry: getEntrySpy };
    if (name === "rbacAccessControlService") {
      return { checkAccess: checkAccessSpy };
    }
    if (name === "mediaService") return { findById: findByIdSpy };
    if (name === "userService") return { listUsersByIds: listUsersByIdsSpy };
    return {};
  }),
}));

// The system-resource read gate resolves RBAC from the container directly, so
// that it can be reached from a leaf module without pulling in the one that
// registers every service.
vi.mock("../../../di/container", () => ({
  container: {
    has: (name: string) => name === "rbacAccessControlService",
    get: (name: string) =>
      name === "rbacAccessControlService"
        ? { checkAccess: checkAccessSpy }
        : {},
  },
}));

import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import type { UserContext } from "../../singles/types";
import {
  referenceDisplayValue,
  referenceLabelKey,
  resolveReferenceLabels,
  storedRefsOf,
  toReferenceRequest,
  type ReferenceRequest,
} from "../reference-labels";

const user = { id: "u1", roles: ["editor"] } as unknown as UserContext;

function rel(collection: string, id: string): ReferenceRequest {
  return { kind: "relationship", collection, id };
}

describe("storedRefsOf", () => {
  it("reads a bare id, an array, a polymorphic pair, and a populated object", () => {
    expect(storedRefsOf("t1")).toEqual([{ id: "t1" }]);
    expect(storedRefsOf(["a", "b"])).toEqual([{ id: "a" }, { id: "b" }]);
    expect(storedRefsOf({ relationTo: "posts", value: "p1" })).toEqual([
      { id: "p1", relationTo: "posts" },
    ]);
    expect(storedRefsOf({ relationTo: "posts", value: { id: "p1" } })).toEqual([
      { id: "p1", relationTo: "posts" },
    ]);
    expect(storedRefsOf({ id: "x" })).toEqual([{ id: "x" }]);
  });

  it("yields nothing for an empty or non-reference value", () => {
    expect(storedRefsOf(null)).toEqual([]);
    expect(storedRefsOf(undefined)).toEqual([]);
    expect(storedRefsOf("")).toEqual([]);
    expect(storedRefsOf(42)).toEqual([]);
    expect(storedRefsOf({})).toEqual([]);
  });
});

describe("toReferenceRequest", () => {
  it("uses the polymorphic target when the value names one", () => {
    expect(
      toReferenceRequest("relationship", { id: "p1", relationTo: "posts" }, [
        "tags",
      ])
    ).toEqual({ kind: "relationship", collection: "posts", id: "p1" });
  });

  it("falls back to the field's first declared target", () => {
    expect(toReferenceRequest("relationship", { id: "t1" }, ["tags"])).toEqual({
      kind: "relationship",
      collection: "tags",
      id: "t1",
    });
  });

  it("always resolves an upload against media", () => {
    expect(toReferenceRequest("upload", { id: "m1" }, [])).toEqual({
      kind: "upload",
      collection: "media",
      id: "m1",
    });
  });

  it("is null when no collection or id is known", () => {
    expect(toReferenceRequest("relationship", { id: "t1" }, [])).toBeNull();
    expect(toReferenceRequest("relationship", { id: "" }, ["tags"])).toBeNull();
  });
});

describe("referenceDisplayValue", () => {
  it("shapes a relationship as { id, label }", () => {
    expect(
      referenceDisplayValue({ id: "t1" }, { id: "t1", label: "Design" })
    ).toEqual({ id: "t1", label: "Design" });
  });

  it("keeps a polymorphic wrapper with the label inlined", () => {
    expect(
      referenceDisplayValue(
        { id: "p1", relationTo: "posts" },
        { id: "p1", label: "Hello" }
      )
    ).toEqual({ relationTo: "posts", value: "p1", label: "Hello" });
  });

  it("spreads media detail for an upload", () => {
    const media = {
      originalFilename: "pic.png",
      filename: "abc.png",
      url: "/u",
      thumbnailUrl: "/t",
      mimeType: "image/png",
    };
    expect(
      referenceDisplayValue({ id: "m1" }, { id: "m1", label: "pic.png", media })
    ).toEqual({ id: "m1", ...media });
  });

  it("keeps the stored id when the reference was not resolved", () => {
    expect(referenceDisplayValue({ id: "t1" }, undefined)).toBe("t1");
    expect(
      referenceDisplayValue({ id: "p1", relationTo: "posts" }, undefined)
    ).toEqual({ relationTo: "posts", value: "p1" });
  });
});

describe("resolveReferenceLabels — relationships", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves a target through the access-checked read path", async () => {
    getEntrySpy.mockResolvedValue({ success: true, data: { title: "Design" } });

    const labels = await resolveReferenceLabels([rel("tags", "t1")], user);

    // The read runs against THIS target with RBAC on (never route-authorized),
    // at depth 0, and sees rows of any status so a historical link resolves.
    expect(getEntrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionName: "tags",
        entryId: "t1",
        user,
        depth: 0,
        overrideAccess: false,
        routeAuthorized: false,
        status: "all",
      })
    );
    expect(labels.get(referenceLabelKey(rel("tags", "t1")))).toEqual({
      id: "t1",
      label: "Design",
    });
  });

  it("withholds the label when the target read is denied", async () => {
    getEntrySpy.mockResolvedValue({ success: false });

    const labels = await resolveReferenceLabels([rel("tags", "t1")], user);

    expect(labels.get(referenceLabelKey(rel("tags", "t1")))).toEqual({
      id: "t1",
      label: null,
    });
  });

  it("withholds the label when the read throws, never failing the caller", async () => {
    getEntrySpy.mockRejectedValue(new Error("db down"));

    const labels = await resolveReferenceLabels([rel("tags", "t1")], user);

    expect(labels.get(referenceLabelKey(rel("tags", "t1")))).toEqual({
      id: "t1",
      label: null,
    });
  });

  it("prefers title, then name, then label, then slug", async () => {
    getEntrySpy.mockResolvedValue({
      success: true,
      data: { slug: "s", label: "l", name: "n", title: "t" },
    });
    let labels = await resolveReferenceLabels([rel("c", "1")], user);
    expect(labels.get(referenceLabelKey(rel("c", "1")))?.label).toBe("t");

    getEntrySpy.mockResolvedValue({
      success: true,
      data: { slug: "s", name: "n" },
    });
    labels = await resolveReferenceLabels([rel("c", "2")], user);
    expect(labels.get(referenceLabelKey(rel("c", "2")))?.label).toBe("n");
  });

  it("never routes an email into a label", async () => {
    getEntrySpy.mockResolvedValue({
      success: true,
      data: { email: "person@example.com" },
    });

    const labels = await resolveReferenceLabels([rel("contacts", "c1")], user);

    expect(labels.get(referenceLabelKey(rel("contacts", "c1")))).toEqual({
      id: "c1",
      label: null,
    });
  });

  it("resolves each distinct reference exactly once", async () => {
    getEntrySpy.mockResolvedValue({ success: true, data: { title: "X" } });

    await resolveReferenceLabels(
      [rel("tags", "t1"), rel("tags", "t1"), rel("tags", "t2")],
      user
    );

    expect(getEntrySpy).toHaveBeenCalledTimes(2);
  });

  it("bounds resolution, leaving references past the cap as bare ids", async () => {
    getEntrySpy.mockResolvedValue({ success: true, data: { title: "X" } });
    const many = Array.from({ length: 60 }, (_, i) => rel("tags", `t${i}`));

    const labels = await resolveReferenceLabels(many, user);

    expect(getEntrySpy).toHaveBeenCalledTimes(50);
    expect(labels.has(referenceLabelKey(rel("tags", "t0")))).toBe(true);
    expect(labels.has(referenceLabelKey(rel("tags", "t59")))).toBe(false);
  });
});

describe("resolveReferenceLabels — uploads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checks media read access before projecting the file", async () => {
    checkAccessSpy.mockResolvedValue(true);
    findByIdSpy.mockResolvedValue({
      originalFilename: "pic.png",
      filename: "abc.png",
      url: "/u",
      thumbnailUrl: "/t",
      mimeType: "image/png",
    });

    const req: ReferenceRequest = {
      kind: "upload",
      collection: "media",
      id: "m1",
    };
    const labels = await resolveReferenceLabels([req], user);

    expect(checkAccessSpy).toHaveBeenCalledWith({
      userId: "u1",
      operation: "read",
      resource: "media",
    });
    expect(findByIdSpy).toHaveBeenCalledWith("m1", {});
    expect(labels.get(referenceLabelKey(req))).toEqual({
      id: "m1",
      label: "pic.png",
      media: {
        originalFilename: "pic.png",
        filename: "abc.png",
        url: "/u",
        thumbnailUrl: "/t",
        mimeType: "image/png",
      },
    });
  });

  it("withholds the file when media read is denied", async () => {
    checkAccessSpy.mockResolvedValue(false);

    const req: ReferenceRequest = {
      kind: "upload",
      collection: "media",
      id: "m1",
    };
    const labels = await resolveReferenceLabels([req], user);

    expect(findByIdSpy).not.toHaveBeenCalled();
    expect(labels.get(referenceLabelKey(req))).toEqual({
      id: "m1",
      label: null,
      media: {
        originalFilename: null,
        filename: null,
        url: null,
        thumbnailUrl: null,
        mimeType: null,
      },
    });
  });
});

describe("resolveReferenceLabels — configured label + system entities", () => {
  beforeEach(() => vi.clearAllMocks());

  it("honors a configured targetLabelField", async () => {
    getEntrySpy.mockResolvedValue({
      success: true,
      data: { headline: "Big News", title: "Ignored" },
    });

    const req: ReferenceRequest = {
      kind: "relationship",
      collection: "posts",
      id: "p1",
      labelField: "headline",
    };
    const labels = await resolveReferenceLabels([req], user);

    expect(labels.get(referenceLabelKey(req))?.label).toBe("Big News");
  });

  it("ignores a label field naming an email or secret column", async () => {
    getEntrySpy.mockResolvedValue({
      success: true,
      data: { email: "person@example.com", name: "Ada" },
    });

    const req: ReferenceRequest = {
      kind: "relationship",
      collection: "contacts",
      id: "c1",
      labelField: "email",
    };
    const labels = await resolveReferenceLabels([req], user);

    // The configured field is excluded; resolution falls back to a safe column.
    expect(labels.get(referenceLabelKey(req))?.label).toBe("Ada");
  });

  it("resolves a users target through the user service, not getEntry", async () => {
    // A session caller falls through to the role-based user-read check.
    checkAccessSpy.mockResolvedValue(true);
    listUsersByIdsSpy.mockResolvedValue([{ id: "u9", name: "Grace" }]);

    const req: ReferenceRequest = {
      kind: "relationship",
      collection: "users",
      id: "u9",
    };
    const labels = await resolveReferenceLabels([req], user);

    expect(checkAccessSpy).toHaveBeenCalledWith({
      userId: "u1",
      operation: "read",
      resource: "users",
    });
    expect(listUsersByIdsSpy).toHaveBeenCalledWith(["u9"]);
    expect(getEntrySpy).not.toHaveBeenCalled();
    expect(labels.get(referenceLabelKey(req))).toEqual({
      id: "u9",
      label: "Grace",
    });
  });

  it("withholds a user name when the session lacks user-read access", async () => {
    checkAccessSpy.mockResolvedValue(false);
    listUsersByIdsSpy.mockResolvedValue([{ id: "u9", name: "Grace" }]);

    const req: ReferenceRequest = {
      kind: "relationship",
      collection: "users",
      id: "u9",
    };
    const labels = await resolveReferenceLabels([req], user);

    // The name is never fetched once the read check denies it.
    expect(listUsersByIdsSpy).not.toHaveBeenCalled();
    expect(labels.get(referenceLabelKey(req))).toEqual({
      id: "u9",
      label: null,
    });
  });
});

describe("toReferenceRequest — upload discriminator", () => {
  it("routes a polymorphic upload to its stored target collection", () => {
    expect(
      toReferenceRequest("upload", { id: "a1", relationTo: "assets" }, [
        "media",
      ])
    ).toEqual({ kind: "upload", collection: "assets", id: "a1" });
  });

  it("defaults a plain upload to media", () => {
    expect(toReferenceRequest("upload", { id: "m1" }, ["media"])).toEqual({
      kind: "upload",
      collection: "media",
      id: "m1",
    });
  });
});

describe("resolveReferenceLabels — API-key scope", () => {
  beforeEach(() => vi.clearAllMocks());

  const apiKey = (permissions: string[]): AuthenticatedScope => ({
    actorType: "apiKey",
    permissions,
  });

  it("passes the authenticated scope to the target read", async () => {
    getEntrySpy.mockResolvedValue({ success: true, data: { title: "T" } });
    const scope = apiKey(["read-posts"]);

    await resolveReferenceLabels([rel("posts", "p1")], user, scope);

    expect(getEntrySpy).toHaveBeenCalledWith(
      expect.objectContaining({ authenticatedScope: scope })
    );
  });

  it("withholds media for a key whose scope excludes media reads", async () => {
    const req: ReferenceRequest = {
      kind: "upload",
      collection: "media",
      id: "m1",
    };

    const labels = await resolveReferenceLabels(
      [req],
      user,
      apiKey(["read-posts"])
    );

    expect(findByIdSpy).not.toHaveBeenCalled();
    expect(labels.get(referenceLabelKey(req))?.label).toBeNull();
  });

  it("resolves media for a key granted media reads, skipping the role check", async () => {
    findByIdSpy.mockResolvedValue({
      originalFilename: "pic.png",
      filename: "abc.png",
      url: "/u",
      thumbnailUrl: "/t",
      mimeType: "image/png",
    });
    const req: ReferenceRequest = {
      kind: "upload",
      collection: "media",
      id: "m1",
    };

    const labels = await resolveReferenceLabels(
      [req],
      user,
      apiKey(["read-media"])
    );

    expect(checkAccessSpy).not.toHaveBeenCalled();
    expect(findByIdSpy).toHaveBeenCalledWith("m1", {});
    expect(labels.get(referenceLabelKey(req))?.label).toBe("pic.png");
  });

  it("withholds a user name for a key whose scope excludes user reads", async () => {
    listUsersByIdsSpy.mockResolvedValue([{ id: "u9", name: "Grace" }]);
    const req: ReferenceRequest = {
      kind: "relationship",
      collection: "users",
      id: "u9",
    };

    const labels = await resolveReferenceLabels(
      [req],
      user,
      apiKey(["read-posts"])
    );

    expect(listUsersByIdsSpy).not.toHaveBeenCalled();
    expect(labels.get(referenceLabelKey(req))?.label).toBeNull();
  });

  it("resolves a user name for a key granted user reads, skipping the role check", async () => {
    listUsersByIdsSpy.mockResolvedValue([{ id: "u9", name: "Grace" }]);
    const req: ReferenceRequest = {
      kind: "relationship",
      collection: "users",
      id: "u9",
    };

    const labels = await resolveReferenceLabels(
      [req],
      user,
      apiKey(["read-users"])
    );

    expect(checkAccessSpy).not.toHaveBeenCalled();
    expect(labels.get(referenceLabelKey(req))?.label).toBe("Grace");
  });
});

describe("resolveReferenceLabels — upload target collection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads a declared upload collection through the entry path, projecting a renderable file shape", async () => {
    getEntrySpy.mockResolvedValue({
      success: true,
      data: {
        originalFilename: "report.pdf",
        filename: "abc.pdf",
        url: "/u",
        thumbnailUrl: "/t",
        mimeType: "application/pdf",
      },
    });
    const req: ReferenceRequest = {
      kind: "upload",
      collection: "documents",
      id: "d1",
    };

    const labels = await resolveReferenceLabels([req], user);

    // The custom upload reads through the access-checked entry path (not the
    // media service) and returns the value kit's file shape, so it renders a
    // name and thumbnail rather than a bare id.
    expect(getEntrySpy).toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: "documents", entryId: "d1" })
    );
    expect(findByIdSpy).not.toHaveBeenCalled();
    expect(labels.get(referenceLabelKey(req))).toEqual({
      id: "d1",
      label: "report.pdf",
      media: {
        originalFilename: "report.pdf",
        filename: "abc.pdf",
        url: "/u",
        thumbnailUrl: "/t",
        mimeType: "application/pdf",
      },
    });
  });

  it("keeps a denied custom upload as a bare id with nulled file detail", async () => {
    getEntrySpy.mockResolvedValue({ success: false });
    const req: ReferenceRequest = {
      kind: "upload",
      collection: "documents",
      id: "d1",
    };

    const labels = await resolveReferenceLabels([req], user);

    expect(labels.get(referenceLabelKey(req))).toEqual({
      id: "d1",
      label: null,
      media: {
        originalFilename: null,
        filename: null,
        url: null,
        thumbnailUrl: null,
        mimeType: null,
      },
    });
  });
});

describe("resolveReferenceLabels — configured-label identity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves the same target once per distinct label field", async () => {
    getEntrySpy.mockResolvedValue({
      success: true,
      data: { headline: "Big News", codename: "Falcon" },
    });
    const byHeadline: ReferenceRequest = {
      kind: "relationship",
      collection: "posts",
      id: "p1",
      labelField: "headline",
    };
    const byCodename: ReferenceRequest = {
      kind: "relationship",
      collection: "posts",
      id: "p1",
      labelField: "codename",
    };

    const labels = await resolveReferenceLabels([byHeadline, byCodename], user);

    // Two label fields for one id are distinct requests, so each field shows
    // its own configured column rather than sharing the first one's result.
    expect(getEntrySpy).toHaveBeenCalledTimes(2);
    expect(labels.get(referenceLabelKey(byHeadline))?.label).toBe("Big News");
    expect(labels.get(referenceLabelKey(byCodename))?.label).toBe("Falcon");
  });
});

describe("resolveReferenceLabels — locale", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the target in the version's locale", async () => {
    getEntrySpy.mockResolvedValue({ success: true, data: { title: "Titre" } });

    await resolveReferenceLabels([rel("posts", "p1")], user, undefined, "fr");

    expect(getEntrySpy).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "fr" })
    );
  });

  it("omits locale for a default-locale (null) version", async () => {
    getEntrySpy.mockResolvedValue({ success: true, data: { title: "T" } });

    await resolveReferenceLabels([rel("posts", "p1")], user, undefined, null);

    const call = getEntrySpy.mock.calls[0][0];
    expect("locale" in call).toBe(false);
  });
});
