/**
 * The probes that decide whether a Single's draft may be handed to a bearer.
 *
 * Two gates ask this — version history and draft preview — and both give out a
 * view the caller cannot otherwise reach, so each must authorize the view it
 * actually gives rather than a weaker one that is easier to ask for.
 *
 * What these cover is the two ways that goes wrong silently: authorizing a
 * DIFFERENT DOCUMENT from the one handed over, and claiming a permission check
 * has already run when it has not.
 */
import { describe, expect, it, vi } from "vitest";

const { get, getSingleBySlug, selectOne, checkSingleAccess } = vi.hoisted(
  () => ({
    get: vi.fn(),
    getSingleBySlug: vi.fn(),
    selectOne: vi.fn(),
    checkSingleAccess: vi.fn(),
  })
);

vi.mock("../../../../di", () => ({
  getService: (name: string) => {
    if (name === "singleEntryService") return { get };
    if (name === "singleRegistryService") return { getSingleBySlug };
    if (name === "adapter") return { selectOne };
    return {};
  },
}));
vi.mock("../single-query-service", () => ({ checkSingleAccess }));
vi.mock("../../../../services/access/access-control-service", () => ({
  AccessControlService: class {},
}));

const { singleDocumentReadable, singleDocumentEditable } = await import(
  "../single-document-access"
);

const USER = { id: "u1", roles: ["editor"] } as never;

describe("authorizing a read of a Single's draft", () => {
  // The view the token hands out is the WORKING DRAFT. Authorizing the live
  // document instead leaves a custom rule that allows the published values and
  // denies the pending ones bypassed: the probe says yes about a document the
  // bearer never receives, and consumption reads the draft trusted without
  // re-running that rule.
  it("authorizes the working draft, not the live document", async () => {
    get.mockResolvedValue({ success: true, statusCode: 200 });

    await singleDocumentReadable("homepage", {
      user: USER,
      routeAuthorized: false,
    });

    expect(get).toHaveBeenCalledWith(
      "homepage",
      expect.objectContaining({ includeWorkingDraft: true, status: "all" })
    );
  });

  // `routeAuthorized` skips the coarse RBAC check for the operation being
  // probed. Whether that is honest depends on which gate the CALLER's route
  // ran, so it is passed through rather than decided here — a route that gated
  // `update` has authorized nothing about `read`.
  it("passes the caller's own claim about its route gate", async () => {
    get.mockResolvedValue({ success: true, statusCode: 200 });

    await singleDocumentReadable("homepage", {
      user: USER,
      routeAuthorized: false,
    });
    expect(get).toHaveBeenCalledWith(
      "homepage",
      expect.objectContaining({ routeAuthorized: false })
    );

    get.mockClear();
    await singleDocumentReadable("homepage", {
      user: USER,
      routeAuthorized: true,
    });
    expect(get).toHaveBeenCalledWith(
      "homepage",
      expect.objectContaining({ routeAuthorized: true })
    );
  });

  // A denial and a miss are both answers and are deliberately collapsed;
  // anything else is the read FAILING, and reporting that as "not allowed"
  // would turn an outage into a permission decision that looks deliberate.
  it.each([
    [403, false],
    [404, false],
  ])("treats %i as a refusal", async (statusCode, expected) => {
    get.mockResolvedValue({ success: false, statusCode });

    await expect(
      singleDocumentReadable("homepage", { user: USER, routeAuthorized: false })
    ).resolves.toBe(expected);
  });

  it("throws rather than denying when the read could not be made", async () => {
    get.mockResolvedValue({ success: false, statusCode: 500 });

    await expect(
      singleDocumentReadable("homepage", { user: USER, routeAuthorized: false })
    ).rejects.toThrow();
  });
});

describe("authorizing an edit of a Single", () => {
  // Reading proves nothing about editing: where a Single allows broad reads and
  // restricts updates, a caller reads the published document and would
  // otherwise be handed the author's unpublished edits.
  it("asks the update question against the stored document", async () => {
    getSingleBySlug.mockResolvedValue({ tableName: "t", accessRules: {} });
    selectOne.mockResolvedValue({ id: "s1" });
    checkSingleAccess.mockResolvedValue(null);

    await expect(
      singleDocumentEditable("homepage", { user: USER, routeAuthorized: true })
    ).resolves.toBe(true);

    expect(checkSingleAccess).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "update", document: { id: "s1" } })
    );
  });

  // `checkSingleAccess` refuses outright when an owner-only rule has no
  // document, so a Single with no row cannot be authorized either way.
  it("refuses when there is no document to judge", async () => {
    getSingleBySlug.mockResolvedValue({ tableName: "t", accessRules: {} });
    selectOne.mockResolvedValue(null);

    await expect(
      singleDocumentEditable("homepage", { user: USER, routeAuthorized: true })
    ).resolves.toBe(false);
  });
});
