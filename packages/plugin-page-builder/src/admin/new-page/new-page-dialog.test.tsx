// @vitest-environment jsdom
/**
 * The New page dialog where it opens: through the admin's create-dialog slot,
 * handing the made page back to the admin; and in the builder, titled by the
 * collection, opening the page where its author may work on it, with the
 * question about unsaved work on the page on screen: Save saves first,
 * Discard and Keep editing answer without saving, and a failed save makes
 * nothing.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CreatedPageItem } from "../../pages-write-contract";

import type { NewPageFormProps } from "./new-page-form";

const navigateTo = vi.fn<(href: string) => void>();
const leaveWithoutWarning = vi.fn();
const save = vi.fn<() => Promise<{ ok: boolean }>>();

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  navigateTo: (href: string) => navigateTo(href),
  useLeaveWithoutWarning: () => leaveWithoutWarning,
  useDocumentActions: () => ({
    run: vi.fn(),
    saveWithoutPublishing: () => save(),
  }),
}));

function made(over: Partial<CreatedPageItem> = {}): CreatedPageItem {
  return {
    id: "new",
    collection: "pages",
    collectionLabel: "Page",
    field: "content",
    title: "Pricing",
    mayUpdate: true,
    ...over,
  };
}

/** The form, as far as the dialog around it is concerned. */
let created: CreatedPageItem = made();
vi.mock("./new-page-form", () => ({
  NewPageForm: (props: NewPageFormProps): JSX.Element => {
    const [answer, setAnswer] = useState("");
    return (
      <div>
        <p>form for {props.collection}</p>
        <button
          type="button"
          onClick={() =>
            props.onFacts?.({
              collection: { slug: "landing", label: "Landing page" },
            } as never)
          }
        >
          facts
        </button>
        <button
          type="button"
          onClick={() =>
            void (props.unsaved?.ask() ?? Promise.resolve("none")).then(
              setAnswer
            )
          }
        >
          make
        </button>
        <p>answer: {answer}</p>
        <button type="button" onClick={() => props.onCreated(created)}>
          made
        </button>
        <button type="button" onClick={props.onCancel}>
          cancel
        </button>
        <button type="button" onClick={() => props.onHoldsNoPages?.()}>
          holds no pages
        </button>
      </div>
    );
  },
}));

const { NewPageCreateDialog, openingAddress, useNewPageDialog } = await import(
  "./new-page-dialog"
);

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  created = made();
});

describe("from a list's + New", () => {
  it("hands the page made back to the admin, and closes with nothing on Cancel", async () => {
    const close = vi.fn();
    render(
      <NewPageCreateDialog
        collection={{
          slug: "pages",
          labels: { singular: "Page", plural: "Pages" },
        }}
        close={close}
      />
    );
    expect(screen.getByText("form for pages")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "made" }));
    expect(close).toHaveBeenLastCalledWith("new");
    await userEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(close).toHaveBeenLastCalledWith();
  });

  it("hands a collection that holds no pages to its create form", async () => {
    const close = vi.fn();
    render(
      <NewPageCreateDialog
        collection={{
          slug: "snippets",
          labels: { singular: "Snippet", plural: "Snippets" },
        }}
        close={close}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "holds no pages" })
    );
    expect(close).toHaveBeenCalledWith();
    expect(navigateTo).toHaveBeenCalledWith(
      "/admin/collections/snippets/create"
    );
  });
});

describe("where a page just made opens", () => {
  it("is the builder on its field, or the form for an author who may not change it", () => {
    expect(openingAddress(made())).toBe(
      "/admin/collections/pages/new/builder?field=content"
    );
    expect(openingAddress(made({ mayUpdate: false }))).toBe(
      "/admin/collections/pages/new"
    );
  });
});

/** The builder's dialog behind a button that opens it. */
function Builder({ unsavedWork }: { unsavedWork: boolean }): JSX.Element {
  const newPage = useNewPageDialog({ unsavedWork, title: "Home" });
  return (
    <>
      <button type="button" onClick={() => newPage.open("pages")}>
        New page
      </button>
      {newPage.dialog}
    </>
  );
}

describe("from the builder", () => {
  it("is titled by the collection, opens the page made, and gives focus back to the button that opened it", async () => {
    render(<Builder unsavedWork={false} />);
    const opener = screen.getByRole("button", { name: "New page" });
    await userEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "New page" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "facts" }));
    expect(
      screen.getByRole("dialog", { name: "New landing page" })
    ).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "made" }));
    expect(navigateTo).toHaveBeenCalledWith(
      "/admin/collections/pages/new/builder?field=content"
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("asks nothing when the page on screen is saved", async () => {
    render(<Builder unsavedWork={false} />);
    await userEvent.click(screen.getByRole("button", { name: "New page" }));
    await userEvent.click(screen.getByRole("button", { name: "make" }));
    expect(await screen.findByText("answer: none")).toBeTruthy();
  });

  it.each([
    ["Keep editing", "keep"],
    ["Discard", "discard"],
  ])("answers %s without saving", async (button, answer) => {
    render(<Builder unsavedWork />);
    await userEvent.click(screen.getByRole("button", { name: "New page" }));
    await userEvent.click(screen.getByRole("button", { name: "make" }));
    expect(
      await screen.findByRole("alertdialog", {
        name: "Save changes to Home first?",
      })
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: button }));
    expect(await screen.findByText(`answer: ${answer}`)).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("on Save saves the page first, answering saved only once it is", async () => {
    save.mockResolvedValue({ ok: true });
    render(<Builder unsavedWork />);
    await userEvent.click(screen.getByRole("button", { name: "New page" }));
    await userEvent.click(screen.getByRole("button", { name: "make" }));
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText("answer: saved")).toBeTruthy();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("makes nothing when the save fails", async () => {
    save.mockResolvedValue({ ok: false });
    render(<Builder unsavedWork />);
    await userEvent.click(screen.getByRole("button", { name: "New page" }));
    await userEvent.click(screen.getByRole("button", { name: "make" }));
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText("answer: keep")).toBeTruthy();
  });
});
