/**
 * Opening the choice of what goes live: from the menu's own row, and from the editor's Publish,
 * which names the choice it opens with and whether the shared fields hold changes a save made a
 * moment ago.
 *
 * The plausible broken versions: Publish opening under the menu's name or at the menu's choice;
 * the shared fields shown as holding nothing until the editor's read catches up with the save; one
 * opening's answer carried into the next; a document that does not apply opening anything; and a
 * publish the page is never told of.
 */
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";
import type {
  PublishPartsChoice,
  PublishPartsResult,
} from "@admin/services/publishParts";

import {
  usePublishPartsAction,
  type PublishPartsActionProps,
} from "../usePublishPartsAction";

const api = vi.hoisted(() => ({
  publishParts: vi.fn(),
  findByID: vi.fn(),
  reviewState: vi.fn(),
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
vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  fetchReviewState: api.reviewState,
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));

/** The route's answer for a live post whose every language holds a change. */
function answerTo(choice: PublishPartsChoice): PublishPartsResult {
  const asked = choice.locales === "all" ? ["en", "es"] : choice.locales;
  return {
    id: "post-1",
    languages: asked.map(locale => ({
      locale,
      outcome: "goes-live-with-pending-change",
    })),
    shared: { changes: false, added: false },
  };
}

function Page(props: Partial<PublishPartsActionProps>): ReactElement {
  const action = usePublishPartsAction({
    target: { kind: "collection", slug: "posts", id: "post-1" },
    lifecycleEnabled: true,
    languages: ["en", "es"],
    labelOf: code => ({ en: "English", es: "Spanish" })[code] ?? code,
    currentLocale: undefined,
    defaultLocale: "en",
    sharedPending: false,
    ...props,
  });
  return (
    <>
      <button
        type="button"
        onClick={() => action.contributed?.binding.onSelect({ values: {} })}
      >
        {action.contributed?.action.label ?? "No menu row"}
      </button>
      <button
        type="button"
        onClick={() =>
          action.open({ locales: ["es"], shared: true }, "publish", {
            sharedPending: true,
          })
        }
      >
        Publish
      </button>
      {action.dialog}
    </>
  );
}

const pressPublish = () =>
  userEvent.click(screen.getByRole("button", { name: "Publish" }));
const pressMenuRow = () =>
  userEvent.click(
    screen.getByRole("button", { name: "Choose what to publish…" })
  );
const part = (name: string) => screen.getByRole("checkbox", { name });
/** The answer of every language has come, so what is offered is settled. */
const settled = () =>
  waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Publish selected" })
    ).toBeEnabled()
  );

beforeEach(() => {
  vi.clearAllMocks();
  api.publishParts.mockImplementation(
    (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
      Promise.resolve(answerTo(choice))
  );
  api.findByID.mockResolvedValue({ id: "post-1", _rev: "1" });
  api.reviewState.mockResolvedValue({ attached: false });
});

describe("opening the choice of what goes live", () => {
  it("opens from the editor's Publish under its own name, at the choice it gives", async () => {
    render(<Page />);
    expect(screen.queryByRole("dialog")).toBeNull();

    await pressPublish();

    expect(
      screen.getByRole("dialog", { name: "Publish changes" })
    ).toBeInTheDocument();
    await settled();
    expect(part("Spanish")).toBeChecked();
    expect(part("English")).not.toBeChecked();
    // The language on screen is the default one, where the address names none.
    expect(part("English")).toHaveAccessibleDescription(/^This page /);
  });

  it("holds the shared fields pending as the opening says, though the editor's read does not yet", async () => {
    render(<Page />);
    await pressPublish();
    await settled();

    expect(part("Shared fields")).toBeEnabled();
    expect(part("Shared fields")).toBeChecked();
    expect(part("Shared fields")).toHaveAccessibleDescription(
      /Their unpublished changes go live for readers of every language\.$/
    );
  });

  it("opens from the menu under the menu's name, at the language on screen, with nothing carried over", async () => {
    render(<Page />);
    await pressPublish();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await pressMenuRow();

    expect(
      screen.getByRole("dialog", { name: "Choose what to publish" })
    ).toBeInTheDocument();
    await settled();
    expect(part("English")).toBeChecked();
    expect(part("Spanish")).not.toBeChecked();
    expect(part("Shared fields")).toBeDisabled();
    expect(part("Shared fields")).toHaveAccessibleDescription(
      /No unpublished changes\.$/
    );
  });

  it("does nothing for a document with no publish lifecycle", async () => {
    render(<Page lifecycleEnabled={false} />);

    await pressPublish();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "No menu row" })
    ).toBeInTheDocument();
    expect(api.publishParts).not.toHaveBeenCalled();
  });

  it("tells the page which languages went live, and closes", async () => {
    const onPublished = vi.fn();
    render(<Page onPublished={onPublished} />);
    await pressPublish();
    await settled();

    await userEvent.click(
      screen.getByRole("button", { name: "Publish selected" })
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onPublished.mock.calls).toEqual([[{ published: ["es"] }]]);
  });

  it("says what the publish would leave out of date, from the overview the page holds", async () => {
    api.findByID.mockImplementation(
      (_slug: string, _id: string, options?: { draft?: boolean }) =>
        Promise.resolve({ title: options?.draft === true ? "Otra" : "Hola" })
    );
    render(
      <Page
        overview={{
          en: { fields: { title: { origin: "person", sourceLocale: "es" } } },
        }}
      />
    );

    await pressPublish();

    expect(
      await screen.findByText(
        "After this, 1 English field will be out of date."
      )
    ).toBeInTheDocument();
  });
});
