// @vitest-environment jsdom

/**
 * A save refused as out of date because the plugin recorded, on the form,
 * that it finished giving earlier submissions their keys: the editor reads
 * the stored form, finds nothing it sends changed, and saves once more on the
 * stored revision. A form someone else changed keeps the refusal.
 *
 * Run against the real provider and view, through the requests the admin
 * sends.
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

/** The form as the editor read it. */
const READ = {
  id: "form-1",
  name: "Contact",
  slug: "contact",
  status: "draft",
  fields: [{ id: "f1", name: "email", label: "Email", type: "email" }],
  settings: {
    oneResponse: "email",
    oneResponseField: "email",
    oneResponseVersion: 1,
    oneResponseKeyedVersion: 0,
  },
  notifications: [],
  _rev: "1",
};

/**
 * A server whose first save is refused as out of date, whose read answers
 * `stored`, and whose next save is taken.
 */
function server(stored: Record<string, unknown>) {
  let refusedOnce = false;
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      if (!refusedOnce) {
        refusedOnce = true;
        return answer(409, {
          error: { code: "STALE_VERSION", message: "Out of date" },
        });
      }
      return answer(200, {
        message: "Updated",
        item: { id: "form-1", _rev: "3" },
      });
    }
    if (url.endsWith("/entries/form-1")) return answer(200, { item: stored });
    return answer(200, { spamProtection: { honeypot: true } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const patches = (fetchMock: ReturnType<typeof server>) =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === "PATCH")
    .map(([, init]) => JSON.parse(String(init?.body)) as { _rev?: string });

async function saveAButtonText(stored: Record<string, unknown>) {
  const fetchMock = server(stored);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FormBuilderView entryId="form-1" initialData={READ} view="settings" />
    </QueryClientProvider>
  );
  const user = userEvent.setup();
  const button = screen.getByRole("textbox", { name: "Button text" });
  await user.clear(button);
  await user.type(button, "Send");
  await user.click(screen.getByRole("button", { name: "Save", exact: true }));
  return fetchMock;
}

describe("a save refused as out of date", () => {
  it("is sent again on the stored revision when only the plugin's keys moved on", async () => {
    const fetchMock = await saveAButtonText({
      ...READ,
      settings: { ...READ.settings, oneResponseKeyedVersion: 1 },
      _rev: "2",
    });
    await waitFor(() => expect(patches(fetchMock)).toHaveLength(2));
    expect(patches(fetchMock).map(body => body._rev)).toEqual(["1", "2"]);
    expect(
      screen.queryByText(/changed this form since you opened it/)
    ).toBeNull();
  });

  it("keeps the refusal when someone else changed what the save sends", async () => {
    const fetchMock = await saveAButtonText({
      ...READ,
      name: "Contact us",
      _rev: "2",
    });
    expect(
      (await screen.findAllByText(/changed this form since you opened it/))
        .length
    ).toBeGreaterThan(0);
    expect(patches(fetchMock)).toHaveLength(1);
  });
});
