/**
 * "Choose what to publish" on a Single: the same choice as an entry's, sent to the Single's own
 * publish route and read for its version from the Single's own read, never an entry's.
 *
 * The plausible broken menu sends a Single's choice to the entry client, which has no Single to
 * publish, or reads the version every language is judged on from the wrong document.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";
import type {
  PublishPartsChoice,
  PublishPartsResult,
} from "@admin/services/publishParts";

import { PublishPartsDialog } from "../PublishPartsDialog";

import { pressConfirm } from "./press-confirm";

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

/** The server's answer for a Single whose shared fields are live. */
const answer = (choice: PublishPartsChoice): PublishPartsResult => ({
  id: "banner-row",
  languages: (choice.locales === "all" ? ["en", "es"] : choice.locales).map(
    locale => ({ locale, outcome: "goes-live" as const })
  ),
  shared: { changes: false, added: false },
});

/** What Spanish's row says, once the server has described it. */
const FIRST_TIME_IN_SPANISH =
  "Goes live for the first time: readers of Spanish see it.";

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
    await screen.findByText(FIRST_TIME_IN_SPANISH);

    await pressConfirm(
      screen.getByRole("button", { name: "Publish selected" })
    );

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
  it("is refused as stale when the editor shows an older version than the Single's, and publishes nothing", async () => {
    render(
      <PublishPartsDialog
        open
        onOpenChange={() => undefined}
        target={{ kind: "single", slug: "banner" }}
        direction="publish"
        languages={["en", "es"]}
        labelOf={code => ({ en: "English", es: "Spanish" })[code] ?? code}
        initialChoice={{ locales: ["es"], shared: false }}
        // The editor opened the Single at version 2; it has since been saved as 3.
        shown={() => ({ version: "2", locale: "es", draft: true })}
      />
    );
    await screen.findByText(FIRST_TIME_IN_SPANISH);

    await pressConfirm(
      screen.getByRole("button", { name: "Publish selected" })
    );

    // The copy on screen is read as the editor reads it, found changed, and said so.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /changed since you opened it/
    );
    expect(api.getDocument).toHaveBeenCalledWith(
      "banner",
      expect.objectContaining({ locale: "es" })
    );
    expect(
      api.singlePublishParts.mock.calls.filter(
        ([, , choice]) => (choice as PublishPartsChoice).describe !== true
      )
    ).toEqual([]);
  });
});
