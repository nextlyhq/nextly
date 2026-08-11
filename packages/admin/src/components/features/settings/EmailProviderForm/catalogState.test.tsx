/**
 * The two ways a catalog request can fail, and why one answer will not do.
 *
 * A request that fails with nothing cached leaves no catalog: anything built
 * from it renders an empty picker, which reads as an installation with no
 * provider types rather than a list that could not be loaded. A request that
 * fails with descriptors already in hand is a refresh that did not land, and
 * every one of them still renders and still validates.
 *
 * Collapsing the two makes each surface wrong in the state it does not name:
 * either work is discarded to fix nothing, or a control is offered against a
 * form that is not there.
 */

import { describe, expect, it } from "vitest";

import type { EmailProviderDescriptor } from "@admin/services/emailProviderApi";

import { emailCatalogState } from "./EmailProviderForm";

const DESCRIPTOR: EmailProviderDescriptor = {
  type: "resend",
  label: "Resend",
  capabilities: {},
  configFields: [],
};

describe("what the provider catalog can be used for", () => {
  it("separates a failure with a cache from one without", () => {
    expect(emailCatalogState({ failed: true, descriptors: [] })).toBe(
      "unavailable"
    );
    expect(emailCatalogState({ failed: true, descriptors: [DESCRIPTOR] })).toBe(
      "stale"
    );
  });

  it("reads a retry in flight as loading, not as the error it has not cleared", () => {
    // `isLoading` and `isError` are both set while a failed query refetches.
    // Answering "unavailable" there would replace the page with a fatal alert
    // for as long as the retry takes, then take it away again.
    expect(
      emailCatalogState({ loading: true, failed: true, descriptors: [] })
    ).toBe("loading");
  });

  it("is ready when nothing failed", () => {
    // The control for the two above: if this returned anything else, the
    // states they name would not be distinguishable from ordinary operation.
    expect(
      emailCatalogState({ failed: false, descriptors: [DESCRIPTOR] })
    ).toBe("ready");
    // An empty catalog that LOADED is a server with no provider types
    // registered, which is not a failure and has no notice to show.
    expect(emailCatalogState({ failed: false, descriptors: [] })).toBe("ready");
  });
});
