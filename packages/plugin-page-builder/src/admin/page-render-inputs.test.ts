import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { pageRenderInputs } from "./page-render-inputs";

/** A site style declaring one bounded tier, so a container is worth naming. */
const WITH_TIERS = {
  breakpoints: {
    viewport: [{ id: "tablet", label: "Tablet", maxWidth: 1024 }],
    container: [],
  },
} as never;

/** A site style declaring none, which is the shape a container cannot serve. */
const NO_TIERS = {
  breakpoints: { viewport: [], container: [] },
} as never;

const base = {
  clientConfig: undefined,
  previewContainer: undefined,
  limits: DEFAULT_LIMITS,
};

describe("pageRenderInputs", () => {
  it("always states the site's breakpoints, which is what lets a page sheet compile at all", () => {
    const inputs = pageRenderInputs({ ...base, siteStyle: WITH_TIERS });

    expect(inputs.styleContext?.breakpoints).toBeDefined();
  });

  it("names the container when the site has tiers to simulate", () => {
    const inputs = pageRenderInputs({
      ...base,
      siteStyle: WITH_TIERS,
      previewContainer: "nx-preview-a",
    });

    expect(inputs.styleContext?.previewContainer).toBe("nx-preview-a");
  });

  /*
   * A site with no tiers has no width-dependent rules, so a named container
   * would compile nothing while the element still carried a name answering for
   * nothing.
   */
  it("names no container when the site defines no tiers", () => {
    const inputs = pageRenderInputs({
      ...base,
      siteStyle: NO_TIERS,
      previewContainer: "nx-preview-a",
    });

    expect(inputs.styleContext?.previewContainer).toBeUndefined();
  });

  it("names no container when the surface asks for none", () => {
    const inputs = pageRenderInputs({ ...base, siteStyle: WITH_TIERS });

    expect(inputs.styleContext?.previewContainer).toBeUndefined();
  });

  /*
   * The editor needs a class alternative beside each pseudo-class rule so it
   * can show an author the state they are editing. A surface showing the page
   * as PUBLISHED must not have one, or it can paint a hover nobody is causing.
   */
  it("emits state alternatives only for a surface that asks", () => {
    expect(
      pageRenderInputs({ ...base, siteStyle: WITH_TIERS, previewStates: true })
        .styleContext?.previewStates
    ).toBe(true);

    expect(
      pageRenderInputs({ ...base, siteStyle: WITH_TIERS }).styleContext
        ?.previewStates
    ).toBeUndefined();
  });

  /*
   * The distinction `readRemotePatterns` exists to keep. An OMITTED policy
   * leaves remote fetching open; an EMPTY allowlist refuses every host. A
   * surface that renders with no policy can therefore fetch from a host the
   * published page refuses, and `inert` does not stop a resource load.
   */
  it("states no host policy when the site configured no patterns", () => {
    const inputs = pageRenderInputs({ ...base, siteStyle: WITH_TIERS });

    expect(inputs.hostPolicy).toBeUndefined();
  });

  it("carries the site's remote patterns when it configured some", () => {
    const inputs = pageRenderInputs({
      ...base,
      siteStyle: WITH_TIERS,
      clientConfig: { remotePatterns: [{ hostname: "cdn.example" }] },
    });

    expect(inputs.hostPolicy?.remotePatterns).toEqual([
      { hostname: "cdn.example" },
    ]);
  });

  it("forwards the caps the document is repaired against", () => {
    const raised = {
      ...DEFAULT_LIMITS,
      maxNodes: DEFAULT_LIMITS.maxNodes + 50,
    };
    const inputs = pageRenderInputs({
      ...base,
      siteStyle: WITH_TIERS,
      limits: raised,
    });

    expect(inputs.limits).toBe(raised);
  });
});
