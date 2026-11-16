/**
 * "Choose what to publish" on a Single: the same choice as an entry's, sent to the Single's own
 * publish route and read for its version from the Single's own read, never an entry's.
 *
 * The plausible broken menu sends a Single's choice to the entry client, which has no Single to
 * publish, or reads the version every language is judged on from the wrong document.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";
import type {
  PublishPartsChoice,
  PublishPartsResult,
} from "@admin/services/publishParts";

import { PublishPartsDialog } from "../PublishPartsDialog";

const api = vi.hoisted(() => ({
  singlePublishParts: vi.fn(),
  entryPublishParts: vi.fn(),
  getDocument: vi.fn(),
}));

vi.mock("@admin/services/singleApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/singleApi")>();
  return {
    ...actual,
    singleApi: {
      ...actual.singleApi,
      publishParts: api.singlePublishParts,
      getDocument: api.getDocument,
    },
  };
});

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return {
    ...actual,
    entryApi: { ...actual.entryApi, publishParts: api.entryPublishParts },
  };
});

const answer = (choice: PublishPartsChoice): PublishPartsResult => ({
  id: "banner-row",
  languages: (choice.locales === "all" ? [] : choice.locales).map(locale => ({
    locale,
    outcome: "goes-live" as const,
  })),
  shared: { changes: choice.shared === true, added: false },
});

beforeEach(() => {
  api.singlePublishParts.mockReset();
  api.entryPublishParts.mockReset();
  api.getDocument.mockReset();
  api.singlePublishParts.mockImplementation(
    (_slug: string, _direction: string, choice: PublishPartsChoice) =>
      Promise.resolve(answer(choice))
  );
  api.getDocument.mockResolvedValue({ id: "banner-row", _rev: "3" });
});

describe("choosing what to publish on a Single", () => {
  it("describes and publishes through the Single's own route, with its own version", async () => {
    const user = userEvent.setup();
    render(
      <PublishPartsDialog
        open
        onOpenChange={() => undefined}
        target={{ kind: "single", slug: "banner" }}
        direction="publish"
        languages={["en", "es"]}
        labelOf={code => ({ en: "English", es: "Spanish" })[code] ?? code}
        initialChoice={{ locales: ["es"], shared: false }}
      />
    );
    await screen.findByText("Goes live for the first time.");

    await user.click(screen.getByRole("button", { name: "Publish" }));

    // The move, not the descriptions asked before and after it.
    await waitFor(() =>
      expect(
        api.singlePublishParts.mock.calls.filter(
          ([, , choice]) => (choice as PublishPartsChoice).describe !== true
        )
      ).toEqual([
        ["banner", "publish", { locales: ["es"], shared: false, version: "3" }],
      ])
    );
    expect(api.entryPublishParts).not.toHaveBeenCalled();
    // The version is read from the Single, in every language.
    expect(api.getDocument).toHaveBeenCalledWith("banner", { locale: "all" });
  });
});
