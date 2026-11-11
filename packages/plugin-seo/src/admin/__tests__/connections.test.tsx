// @vitest-environment jsdom

/**
 * The SEO settings screen's Connections tab as a person uses it: IndexNow,
 * llms.txt and plain-text copies are off until switched on, each switch saves
 * with the rest of the settings, and switching one off again saves it off;
 * Search Console is connected and disconnected through its own routes, and
 * each connection's last failure is said in plain words. What each save
 * sends is read from the save itself.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  useSingleDocument: vi.fn(),
  useUpdateSingleDocument: vi.fn(),
  usePluginRoute: vi.fn(),
  useMediaItem: vi.fn(() => ({ data: undefined })),
  MediaPickerDialog: () => null,
  toastMutationResult: vi.fn(),
  usePluginClientConfig: vi.fn(() => undefined),
  writePluginRoute: vi.fn(),
}));

import {
  usePluginRoute,
  useSingleDocument,
  useUpdateSingleDocument,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";

import type {
  ConnectionsBody,
  SearchConsoleReportBody,
} from "../../connections/contract";

import { SeoSettingsPage } from "../SeoSettingsPage";

/** The stored Single, as the fake server holds it between saves. */
let stored: Record<string, unknown>;
/** Every body a save sent, in order. */
let sent: Record<string, unknown>[];

/** What the connections route answers, unless a test says otherwise. */
let connections: ConnectionsBody;
/** What the report route answers. */
let report: SearchConsoleReportBody | undefined;
/** How often the connections were read again. */
let rereads: number;

function serving(
  document: Record<string, unknown>,
  state: ConnectionsBody = {
    searchConsole: { configured: true },
    indexNow: {},
  }
): void {
  connections = state;
  report = undefined;
  rereads = 0;
  stored = { id: "s1", updatedAt: "", setupStep: 3, ...document };
  sent = [];
  const refetch = vi.fn(async () => ({ data: stored }));
  vi.mocked(useSingleDocument).mockImplementation(
    () =>
      ({ data: stored, error: null, refetch }) as unknown as ReturnType<
        typeof useSingleDocument
      >
  );
  vi.mocked(useUpdateSingleDocument).mockImplementation(
    () =>
      ({
        mutateAsync: vi.fn(async (body: Record<string, unknown>) => {
          sent.push(body);
          const { _rev: _read, _overwrite: _replace, ...values } = body;
          const revision = Number(stored._rev ?? 0) + 1;
          stored = { ...stored, ...values, _rev: String(revision) };
          return stored;
        }),
      }) as unknown as ReturnType<typeof useUpdateSingleDocument>
  );
  vi.mocked(usePluginRoute).mockImplementation(
    request =>
      ({
        data: request.path.endsWith("/document")
          ? { single: "seo-settings" }
          : request.path === "/connections"
            ? connections
            : request.path.endsWith("/report")
              ? report
              : { items: [] },
        pending: false,
        error: null,
        refetch: () => {
          rereads += 1;
        },
        fetching: false,
      }) as ReturnType<typeof usePluginRoute>
  );
}

/** Waits for every pending save and the re-read after it. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  window.history.replaceState(
    null,
    "",
    "/admin/plugins/nextlyhq-plugin-seo/settings"
  );
});

const switchNamed = (name: string) => screen.getByRole("switch", { name });

describe("the Connections tab", () => {
  it("shows llms.txt and plain-text copies off by default, at the site's own address", () => {
    serving({ _rev: "1", productionAddresses: ["https://rext.ai"] });
    // A link can land on the tab.
    window.history.replaceState(
      null,
      "",
      "/admin/plugins/nextlyhq-plugin-seo/settings?tab=connections"
    );
    render(<SeoSettingsPage />);

    expect(
      screen
        .getByRole("tab", { name: "Connections" })
        .getAttribute("aria-selected")
    ).toBe("true");
    expect(
      screen.getByText("Optional services. If one fails, no page is affected.")
    ).toBeTruthy();
    expect(switchNamed("llms.txt").getAttribute("aria-checked")).toBe("false");
    expect(switchNamed("Plain-text copies").getAttribute("aria-checked")).toBe(
      "false"
    );
    expect(
      screen.getByText(/A plain list of your pages at rext\.ai\/llms\.txt/)
    ).toBeTruthy();
  });

  it("saves each switch turned on, and turned off again", async () => {
    serving({ _rev: "4" });
    render(<SeoSettingsPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Connections" }));

    fireEvent.click(switchNamed("llms.txt"));
    fireEvent.click(switchNamed("Plain-text copies"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    expect(sent).toEqual([{ llmsTxt: true, plainTextCopies: true, _rev: "4" }]);

    fireEvent.click(switchNamed("llms.txt"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    expect(sent[1]).toEqual({ llmsTxt: false, _rev: "5" });
  });

  it("shows a switch already on as on", () => {
    serving({ _rev: "1", llmsTxt: true });
    render(<SeoSettingsPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Connections" }));

    expect(switchNamed("llms.txt").getAttribute("aria-checked")).toBe("true");
  });
});

describe("Search Console on the Connections tab", () => {
  const open = () =>
    fireEvent.click(screen.getByRole("tab", { name: "Connections" }));

  it("can't be connected until the site names a Google sign-in, and says so", () => {
    serving(
      { _rev: "1" },
      { searchConsole: { configured: false }, indexNow: {} }
    );
    render(<SeoSettingsPage />);
    open();
    const button = screen.getByRole("button", {
      name: "Connect Search Console",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/Needs a Google sign-in/)).toBeTruthy();
  });

  it("sends the person to Google to approve read-only access", async () => {
    serving({ _rev: "1" });
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      assign,
    });
    vi.mocked(writePluginRoute).mockResolvedValue({
      url: "https://accounts.google.com/o/oauth2/v2/auth?state=s",
    });
    render(<SeoSettingsPage />);
    open();
    fireEvent.click(
      screen.getByRole("button", { name: "Connect Search Console" })
    );
    await settle();
    expect(vi.mocked(writePluginRoute)).toHaveBeenCalledWith({
      plugin: "@nextlyhq/plugin-seo",
      path: "/connections/search-console/connect",
    });
    expect(assign).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/v2/auth?state=s"
    );
    vi.restoreAllMocks();
  });

  it("names who is connected, shows what Google says, and disconnects", async () => {
    serving(
      { _rev: "1" },
      {
        searchConsole: {
          configured: true,
          connected: { email: "sara@rext.ai", property: "sc-domain:rext.ai" },
        },
        indexNow: {},
      }
    );
    report = {
      from: "2026-10-13",
      to: "2026-11-09",
      clicks: 1234,
      pages: [],
      queries: [{ query: "ai article writer", clicks: 80, impressions: 900 }],
      otherAddress: [
        {
          page: "https://rext.ai/about",
          declared: "https://rext.ai/about",
          chosen: "https://rext.ai/company",
        },
      ],
      checked: 10,
    };
    vi.mocked(writePluginRoute).mockResolvedValue(undefined);
    render(<SeoSettingsPage />);
    open();
    expect(
      screen.getByText(/Connected as sara@rext\.ai · rext\.ai/)
    ).toBeTruthy();
    expect(screen.getByText("1,234")).toBeTruthy();
    expect(screen.getByText("ai article writer")).toBeTruthy();
    expect(screen.getByText("Google uses /company")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await settle();
    expect(vi.mocked(writePluginRoute)).toHaveBeenCalledWith({
      plugin: "@nextlyhq/plugin-seo",
      path: "/connections/search-console/disconnect",
    });
    expect(rereads).toBe(1);
  });

  it("says the last failure in plain words", () => {
    serving(
      { _rev: "1" },
      {
        searchConsole: {
          configured: true,
          failed: {
            at: "2026-11-11T10:00:00.000Z",
            result: "failed",
            message: "Google no longer accepts this connection.",
          },
        },
        indexNow: {},
      }
    );
    render(<SeoSettingsPage />);
    open();
    expect(
      screen.getByText("Google no longer accepts this connection.")
    ).toBeTruthy();
  });
});

describe("IndexNow on the Connections tab", () => {
  it("is off by default, saves switched on, and says when search engines refused its key", async () => {
    serving({ _rev: "2" });
    const { unmount } = render(<SeoSettingsPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Connections" }));
    expect(switchNamed("IndexNow").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(switchNamed("IndexNow"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    expect(sent).toEqual([{ indexNow: true, _rev: "2" }]);
    unmount();

    serving(
      { _rev: "3", indexNow: true },
      {
        searchConsole: { configured: true },
        indexNow: {
          last: {
            at: "2026-11-11T10:00:00.000Z",
            result: "refused-key",
            urls: 2,
          },
        },
      }
    );
    render(<SeoSettingsPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Connections" }));
    const row = switchNamed("IndexNow").closest(".nx-seo-conn") as HTMLElement;
    expect(
      within(row).getByText(/Search engines refused the site's IndexNow key/)
    ).toBeTruthy();
  });
});
