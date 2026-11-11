// @vitest-environment jsdom

/**
 * The form editor sends the version it started from with every save, and the
 * version each save answered with the next, and says who changed the form
 * when a save is refused because someone saved it since.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { FormBuilderView } from "./FormBuilderView";

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const answer = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  );

function view() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FormBuilderView
        entryId="form-1"
        initialData={{
          name: "Contact",
          slug: "contact",
          fields: [{ id: "f1", name: "email", label: "Email", type: "email" }],
          _rev: "3",
        }}
      />
    </QueryClientProvider>
  );
}

/** The saves the editor sent, apart from its read of the builder's settings. */
const saves = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")
    .map(
      ([, init]) =>
        JSON.parse(String((init as RequestInit).body)) as Record<
          string,
          unknown
        >
    );

/** Picks a status in the bar's menu: an unsaved change, so Save is offered. */
async function pickStatus(
  user: ReturnType<typeof userEvent.setup>,
  state: RegExp
) {
  await user.click(screen.getByRole("button", { name: /^Status:/ }));
  await user.click(await screen.findByRole("menuitemradio", { name: state }));
}

/** Answers the builder's settings read; `saved` answers each save in turn. */
function server(...saved: (() => Promise<Response>)[]) {
  return vi.fn((_url: string, init?: RequestInit) =>
    init?.method === "PATCH"
      ? (saved.shift() ?? (() => answer(500, {})))()
      : answer(200, {})
  );
}

describe("the form editor's save", () => {
  it("sends the version it started from, then the version each save answered", async () => {
    const fetchMock = server(
      () =>
        answer(200, { message: "Updated", item: { id: "form-1", _rev: "4" } }),
      () =>
        answer(200, { message: "Updated", item: { id: "form-1", _rev: "5" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    view();
    const user = userEvent.setup();

    await pickStatus(user, /^Live/);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saves(fetchMock)).toHaveLength(1));
    await pickStatus(user, /^Closed/);
    await user.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(saves(fetchMock)).toHaveLength(2));

    expect(saves(fetchMock).map(body => body._rev)).toEqual(["3", "4"]);
  });

  it("says who changed the form when a save is refused because someone saved it since", async () => {
    vi.stubGlobal(
      "fetch",
      server(() =>
        answer(409, {
          error: {
            code: "STALE_VERSION",
            message: "This document changed since the version you gave.",
            data: {
              currentVersion: "4",
              changedBy: { kind: "person", name: "Ana Ruiz" },
            },
          },
        })
      )
    );
    view();
    const user = userEvent.setup();
    await pickStatus(user, /^Live/);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText(
        "Ana Ruiz changed this form since you opened it. Reload to see their change; your edits are still here, not saved."
      )
    ).toBeInTheDocument();
  });
});
