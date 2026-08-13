/**
 * A plugin's page has one URL whether or not the project has it. These cover
 * the uninstalled half: the directory links every card here, and most cards
 * are for plugins nobody has installed yet, so that is the ordinary path
 * rather than an error.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminBranding } from "@admin/types/branding";

/**
 * The install line, as a pattern shared by the assertions that require it and
 * the ones that require its absence.
 *
 * A literal `"pnpm add @nextlyhq/plugin-seo"` would match nothing now that the
 * command is pinned, so every `queryByText(...).toBeNull()` below would pass
 * on a page that rendered the install block in full. Matching the version
 * loosely keeps the absence assertions answering the question they ask, while
 * `install-command.test.ts` pins the exact strings.
 */
const INSTALL_COMMAND = /^pnpm add @nextlyhq\/plugin-seo@\d/;

/**
 * jsdom's navigator has no `clipboard` property at all, which is the same
 * shape a browser on a plain-HTTP origin presents — so the "unavailable" case
 * below is the environment's own default rather than something simulated.
 */
const ORIGINAL_CLIPBOARD = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard"
);

function setClipboard(clipboard: Clipboard | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    value: clipboard,
    configurable: true,
  });
}

/**
 * Puts back what was there, which in jsdom is no own property at all —
 * defining one with `undefined` is not the same thing, and it would outlive
 * these tests for anything else sharing this environment.
 */
function restoreClipboard() {
  if (ORIGINAL_CLIPBOARD) {
    Object.defineProperty(navigator, "clipboard", ORIGINAL_CLIPBOARD);
  } else {
    delete (navigator as { clipboard?: Clipboard }).clipboard;
  }
}

let mockBranding: AdminBranding = { plugins: [] } as unknown as AdminBranding;
let mockBrandingStatus = { isPending: false, isUnavailable: false };

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
  useBrandingStatus: () => mockBrandingStatus,
}));

import PluginDetailPage from "./[slug]";

function renderDetail(slug: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PluginDetailPage params={{ slug }} />
    </QueryClientProvider>
  );
}

afterEach(() => {
  mockBranding = { plugins: [] } as unknown as AdminBranding;
  mockBrandingStatus = { isPending: false, isUnavailable: false };
  restoreClipboard();
  vi.restoreAllMocks();
});

describe("plugin detail, not installed", () => {
  /**
   * The separating case. Before this view existed the page searched only
   * `branding.plugins`, so every catalogue entry the directory linked to
   * rendered "Plugin not found" — a dead end on the primary discovery path.
   */
  it("shows the catalogue entry instead of a not-found page", async () => {
    renderDetail("nextlyhq-plugin-seo");

    expect(
      await screen.findByRole("heading", { name: "SEO" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Plugin not found")).toBeNull();
  });

  /**
   * All three lines, because the recipe only works as a set: installing the
   * package does not introduce the binding, so an array entry shown without
   * its import names an identifier that does not exist in the file.
   */
  it("offers the install command, the import, and the array entry", async () => {
    renderDetail("nextlyhq-plugin-seo");

    expect(await screen.findByText(INSTALL_COMMAND)).toBeInTheDocument();
    expect(
      screen.getByText('import { seoPlugin } from "@nextlyhq/plugin-seo";')
    ).toBeInTheDocument();
    // The element alone, with no `plugins:` property around it. A reader who
    // already has plugins configured appends this; a property could only be
    // pasted by replacing theirs.
    expect(
      screen.getByText('seoPlugin({ collections: ["your-collection"] })')
    ).toBeInTheDocument();
  });

  /**
   * A plugin the project HAS, on a page opened cold. Until admin-meta answers
   * the installed list is empty for a reason that says nothing about the
   * project, and reading that as "not installed" tells the reader to install
   * something they already have.
   */
  it("does not offer to install while the installed list is still loading", async () => {
    mockBrandingStatus = { isPending: true, isUnavailable: false };

    renderDetail("nextlyhq-plugin-seo");

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(INSTALL_COMMAND)).toBeNull();
    expect(screen.queryByText("Plugin not found")).toBeNull();
  });

  /** Same reasoning, permanent: a failed request is not evidence of absence. */
  it("does not offer to install when the installed list could not be loaded", async () => {
    mockBrandingStatus = { isPending: false, isUnavailable: true };

    renderDetail("nextlyhq-plugin-seo");

    expect(
      await screen.findByText("Could not load your installed plugins")
    ).toBeInTheDocument();
    expect(screen.queryByText(INSTALL_COMMAND)).toBeNull();
  });

  /**
   * The admin-module step, which only some plugins need. Form Builder ships an
   * `/admin` side-effect module; skip it and the plugin installs, its server
   * half runs, and its builder silently degrades to plain inputs.
   */
  it("asks for the admin route import when the plugin ships one", async () => {
    renderDetail("nextlyhq-plugin-form-builder");

    expect(
      await screen.findByText('import "@nextlyhq/plugin-form-builder/admin";')
    ).toBeInTheDocument();
  });

  /**
   * The separating case. SEO has no `/admin` export, so telling a reader to
   * import one would name a subpath that does not resolve.
   */
  it("omits the admin route import for a plugin without one", async () => {
    renderDetail("nextlyhq-plugin-seo");

    await screen.findByRole("heading", { name: "SEO" });
    expect(screen.queryByText(/\/admin";$/)).toBeNull();
    expect(screen.queryByText("Admin route import")).toBeNull();
  });

  /**
   * The catalogue query suspends. The only boundary above this page is
   * `RootLayout`'s `fallback={null}`, which exists to hide a lazy chunk
   * swapping in, so without a local one the page is blank for the duration of
   * the request rather than merely slow.
   */
  it("shows a loading state while the catalogue is in flight", () => {
    renderDetail("nextlyhq-plugin-seo");

    // Read synchronously, before the catalogue promise settles: this is the
    // frame the missing boundary would have rendered as nothing.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  /**
   * The Clipboard API needs a secure context, so an admin on plain HTTP has no
   * `navigator.clipboard` at all. Without this the button is inert and the
   * page looks broken; the line is still selectable, so the fix is to say so.
   */
  it("says copying failed when the clipboard is unavailable", async () => {
    setClipboard(undefined);

    renderDetail("nextlyhq-plugin-seo");
    fireEvent.click(
      await screen.findByRole("button", { name: /copy install command/i })
    );

    expect(await screen.findByText(/could not copy/i)).toBeInTheDocument();
  });

  it("says copying failed when the write is rejected", async () => {
    setClipboard({
      writeText: () => Promise.reject(new Error("denied")),
    } as unknown as Clipboard);

    renderDetail("nextlyhq-plugin-seo");
    fireEvent.click(
      await screen.findByRole("button", { name: /copy install command/i })
    );

    expect(await screen.findByText(/could not copy/i)).toBeInTheDocument();
  });

  /**
   * The positive control for the two above: a working clipboard must NOT show
   * the failure text, or both would pass on a component that always shows it.
   */
  it("stays quiet when the copy succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText } as unknown as Clipboard);

    renderDetail("nextlyhq-plugin-seo");
    fireEvent.click(
      await screen.findByRole("button", { name: /copy install command/i })
    );

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.queryByText(/could not copy/i)).toBeNull();
  });

  /**
   * The invariant the whole surface rests on: verified content only ever
   * appears in the verified section. Nothing here has been observed running,
   * so the sections that report what a plugin contributes must be absent.
   */
  it("reports no contributions, because none have been observed", async () => {
    renderDetail("nextlyhq-plugin-seo");

    await screen.findByRole("heading", { name: "SEO" });
    expect(screen.queryByText("Permissions")).toBeNull();
    expect(screen.queryByText("API routes")).toBeNull();
  });

  it("still says not found for a slug no plugin and no entry matches", async () => {
    renderDetail("no-such-plugin");

    expect(await screen.findByText("Plugin not found")).toBeInTheDocument();
  });

  /**
   * Installed metadata is observed; the catalogue is a claim. When both
   * describe the same package the observed one decides which view renders,
   * otherwise installing a plugin would leave it looking uninstalled.
   */
  it("prefers the installed plugin over the catalogue entry", async () => {
    mockBranding = {
      plugins: [{ name: "@nextlyhq/plugin-seo", version: "1.0.0" }],
    } as unknown as AdminBranding;

    renderDetail("nextlyhq-plugin-seo");

    expect(await screen.findByText("v1.0.0")).toBeInTheDocument();
    expect(screen.queryByText(INSTALL_COMMAND)).toBeNull();
  });
});
