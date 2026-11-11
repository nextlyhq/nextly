// @vitest-environment jsdom

/**
 * The SEO settings screen's Connections tab as a person uses it: llms.txt and
 * plain-text copies are off until switched on, each switch saves with the
 * rest of the settings, and switching one off again saves it off. What each
 * save sends is read from the save itself.
 */
import { fireEvent, render, screen } from "@testing-library/react";
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
}));

import {
  usePluginRoute,
  useSingleDocument,
  useUpdateSingleDocument,
} from "@nextlyhq/plugin-sdk/admin";

import { SeoSettingsPage } from "../SeoSettingsPage";

/** The stored Single, as the fake server holds it between saves. */
let stored: Record<string, unknown>;
/** Every body a save sent, in order. */
let sent: Record<string, unknown>[];

function serving(document: Record<string, unknown>): void {
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
          : { items: [] },
        pending: false,
        error: null,
        refetch: () => {},
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
