/**
 * "Choose what to publish": each language, and separately the shared fields, is a choice of its
 * own; what each will do is the server's description of exactly that choice; publishing sends
 * the parts chosen and nothing else; and a refusal is shown beside the part it names.
 *
 * The plausible broken menus: one that publishes every language (what publishing all does), one
 * that always takes the shared fields, one whose sentences describe a different choice from the
 * one sent, and one that reports a refusal only as a toast nobody can match to a part.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";
import { parseApiError } from "@admin/lib/api/parseApiError";
import type {
  PublishPartsChoice,
  PublishPartsResult,
} from "@admin/services/publishParts";

import { PublishPartsDialog } from "../PublishPartsDialog";

const api = vi.hoisted(() => ({
  publishParts: vi.fn(),
  findByID: vi.fn(),
}));

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return {
    ...actual,
    entryApi: {
      ...actual.entryApi,
      publishParts: api.publishParts,
      findByID: api.findByID,
    },
  };
});

const LANGUAGES = ["en", "es", "ar"];
const labelOf = (code: string) =>
  ({ en: "English", es: "Spanish", ar: "Arabic" })[code] ?? code;

/** The server's description of `choice`, as the route answers it. */
function describing(choice: PublishPartsChoice): PublishPartsResult {
  const locales = choice.locales === "all" ? LANGUAGES : choice.locales;
  return {
    id: "post-1",
    languages: locales.map(locale => ({ locale, outcome: "goes-live" })),
    shared: { changes: choice.shared === true, added: false },
  };
}

function open(initial = { locales: ["es"], shared: false }) {
  return render(
    <PublishPartsDialog
      open
      onOpenChange={() => undefined}
      target={{ kind: "collection", slug: "posts", id: "post-1" }}
      direction="publish"
      languages={LANGUAGES}
      labelOf={labelOf}
      initialChoice={initial}
    />
  );
}

/** The choices each call to the route was made with, describe or not. */
const calls = () =>
  (
    api.publishParts.mock.calls as [
      string,
      string,
      string,
      PublishPartsChoice,
    ][]
  ).map(([, , direction, choice]) => ({ direction, ...choice }));

beforeEach(() => {
  api.publishParts.mockReset();
  api.findByID.mockReset();
  api.publishParts.mockImplementation(
    (
      _slug: string,
      _id: string,
      _direction: string,
      choice: PublishPartsChoice
    ) => Promise.resolve(describing(choice))
  );
  // A read of every language, for the version the publish is sent with.
  api.findByID.mockResolvedValue({ id: "post-1", _rev: "7" });
});

describe("choosing what to publish", () => {
  it("offers each language and the shared fields as separate choices, opened on the one given", async () => {
    open();

    expect(screen.getByRole("checkbox", { name: "Spanish" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "English" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Arabic" })).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Shared fields" })
    ).not.toBeChecked();
    // What Spanish will do is the server's description of exactly this choice.
    await screen.findByText("Goes live for the first time.");
    expect(calls()[0]).toEqual({
      direction: "publish",
      locales: ["es"],
      shared: false,
      describe: true,
      version: undefined,
    });
  });

  it("asks again for a choice that adds the shared fields", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText("Goes live for the first time.");

    await user.click(screen.getByRole("checkbox", { name: "Shared fields" }));

    await waitFor(() =>
      expect(calls().at(-1)).toMatchObject({
        locales: ["es"],
        shared: true,
        describe: true,
      })
    );
  });

  it("publishes the parts chosen and no others, with the version just read", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText("Goes live for the first time.");
    await user.click(screen.getByRole("checkbox", { name: "Arabic" }));

    await user.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() =>
      expect(calls().filter(call => call.describe !== true)).toEqual([
        {
          direction: "publish",
          locales: ["es", "ar"],
          shared: false,
          version: "7",
        },
      ])
    );
  });

  it("offers nothing to publish when no part is chosen", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("checkbox", { name: "Spanish" }));

    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  });

  it("shows a refusal beside the part it names, and keeps the dialog open", async () => {
    const user = userEvent.setup();
    const refusal = parseApiError(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed.",
          requestId: "r1",
          data: {
            errors: [
              {
                path: "es",
                locale: "es",
                code: "NOT_APPROVED",
                message: 'The "es" language has no current approval.',
              },
            ],
          },
        },
      },
      400
    );
    api.publishParts.mockImplementation(
      (
        _slug: string,
        _id: string,
        _direction: string,
        choice: PublishPartsChoice
      ) =>
        choice.describe === true
          ? Promise.resolve(describing(choice))
          : Promise.reject(refusal)
    );
    open();
    await screen.findByText("Goes live for the first time.");

    await user.click(screen.getByRole("button", { name: "Publish" }));

    const spanish = screen.getByRole("checkbox", { name: "Spanish" });
    await waitFor(() =>
      expect(spanish).toHaveAccessibleDescription(/has no current approval/)
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
