// @vitest-environment jsdom

/**
 * A form's Settings: one page in sections, each of today's settings editable
 * and saved, the new ones beside them, stored values from before the change
 * shown as what they now mean, and the form's ID fixed once it has been live.
 *
 * Run against the real provider and view, saving through the same request the
 * admin sends, so a value that never reaches the save fails here.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { FIXED_FORM_ID_REASON } from "./components/builder/FormIdentitySection";
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

/** Answers the builder's settings read, and every save as stored. */
/** The plugin's spam options as Settings is told them, unless a test says. */
const SPAM = {
  honeypot: true,
  recaptchaEnabled: false,
  botCheckDefault: null,
  botChecks: {
    recaptcha: { secret: true, siteKey: true },
    turnstile: { secret: false, siteKey: false },
  },
  rateLimit: { maxSubmissions: 10, windowMs: 60_000 },
};

function server(spamProtection: Record<string, unknown> = SPAM) {
  const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
    init?.method === "PATCH"
      ? answer(200, { message: "Updated", item: { id: "form-1" } })
      : answer(200, { spamProtection })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The bodies the editor saved, in order. */
const saves = (fetchMock: ReturnType<typeof server>) =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === "PATCH")
    .map(
      ([, init]) =>
        JSON.parse(String(init?.body)) as {
          status?: string;
          slug?: string;
          closedMessage?: string;
          settings: Record<string, unknown>;
        }
    );

function view(
  initialData: Record<string, unknown> = {},
  spamProtection?: Record<string, unknown>
) {
  const fetchMock = server(spamProtection);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FormBuilderView
        entryId="form-1"
        initialData={{
          name: "Contact",
          slug: "contact",
          status: "draft",
          fields: [{ id: "f1", name: "email", label: "Email", type: "email" }],
          ...initialData,
        }}
        view="settings"
      />
    </QueryClientProvider>
  );
  return { user: userEvent.setup(), fetchMock };
}

const save = () => screen.getByRole("button", { name: "Save", exact: true });

/** Picks `option` in the select named `name`. */
async function pick(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  option: string | RegExp
) {
  await user.click(screen.getByRole("combobox", { name }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("a form's Settings", () => {
  it("is one page in sections, in order", () => {
    view();
    // Each section is a region named by its label.
    const sections = screen.getAllByRole("region");
    const names = [
      "Form",
      "After someone submits",
      "Availability",
      "One response per person",
      "Spam protection",
      "Privacy",
    ];
    expect(sections).toHaveLength(names.length);
    sections.forEach((section, index) =>
      expect(section).toHaveAccessibleName(names[index])
    );
  });

  it("saves each of today's settings, and the new ones", async () => {
    const { user, fetchMock } = view({ status: "published" });

    const button = screen.getByRole("textbox", { name: "Button text" });
    await user.clear(button);
    await user.type(button, "Save my seat");
    const message = screen.getByRole("textbox", {
      name: "Message after submitting",
    });
    await user.clear(message);
    await user.type(message, "You're on the list.");
    await user.type(
      screen.getByRole("textbox", { name: "Message when closed" }),
      "Sign-ups are closed."
    );
    await user.click(
      screen.getByRole("switch", { name: "Accepting submissions" })
    );
    await user.click(
      screen.getByRole("radio", { name: "One per network (IP address)" })
    );
    await pick(user, "Hidden trap field", "On");
    await pick(user, "Bot check", "reCAPTCHA");
    await user.type(
      screen.getByRole("textbox", { name: "Internal note" }),
      "Lahore meetup."
    );
    await user.click(save());

    await waitFor(() => expect(saves(fetchMock)).toHaveLength(1));
    const [saved] = saves(fetchMock);
    expect(saved).toMatchObject({
      status: "closed",
      closedMessage: "Sign-ups are closed.",
      settings: {
        submitButtonText: "Save my seat",
        confirmationType: "message",
        successMessage: "You're on the list.",
        oneResponse: "ip",
        honeypotEnabled: true,
        botCheck: "recaptcha",
        internalNote: "Lahore meetup.",
      },
    });
  });

  it("saves a form that keeps no IP address or browser", async () => {
    const { user, fetchMock } = view({ status: "published" });
    const keep = screen.getByRole("switch", {
      name: "Store IP address and browser",
    });
    expect(keep).toBeChecked();
    expect(keep).toHaveAccessibleDescription(/one per network still works/);
    await user.click(keep);
    await user.click(save());

    await waitFor(() => expect(saves(fetchMock)).toHaveLength(1));
    expect(saves(fetchMock)[0]).toMatchObject({
      settings: { storeIpAndBrowser: false },
    });
  });

  it("saves how long submissions are kept, and Never as no period", async () => {
    const { user, fetchMock } = view({ settings: { keepDays: 365 } });
    const keep = screen.getByRole("combobox", {
      name: "Delete submissions after",
    });
    expect(keep).toHaveTextContent("1 year");
    expect(keep).toHaveAccessibleDescription(/Spam goes after 30 days/);
    await pick(user, "Delete submissions after", "90 days");
    await user.click(save());
    await waitFor(() => expect(saves(fetchMock)).toHaveLength(1));
    expect(saves(fetchMock)[0]).toMatchObject({ settings: { keepDays: 90 } });

    await pick(user, "Delete submissions after", "Never");
    await user.click(save());
    await waitFor(() => expect(saves(fetchMock)).toHaveLength(2));
    const settings = (saves(fetchMock)[1] as { settings: object }).settings;
    expect(settings).not.toHaveProperty("keepDays");
  });

  it("shows a keep period set another way as it is", () => {
    view({ settings: { keepDays: 45 } });
    expect(
      screen.getByRole("combobox", { name: "Delete submissions after" })
    ).toHaveTextContent("45 days");
  });

  it("saves a web address to go to after submitting", async () => {
    const { user, fetchMock } = view();
    await user.click(
      screen.getByRole("radio", { name: "Go to a web address" })
    );
    await user.type(
      screen.getByRole("textbox", { name: "Web address" }),
      "https://example.com/thanks"
    );
    await user.click(save());

    await waitFor(() => expect(saves(fetchMock)).toHaveLength(1));
    expect(saves(fetchMock)[0]?.settings).toMatchObject({
      confirmationType: "redirect",
      redirectUrl: "https://example.com/thanks",
    });
  });

  it.each([
    [{ allowMultipleSubmissions: false }, "One per network (IP address)"],
    [{ allowMultipleSubmissions: true }, "Allow several responses"],
    [{}, "Allow several responses"],
  ])(
    "shows a form saved before the change with %j as %s",
    (settings, chosen) => {
      view({ settings });
      expect(screen.getByRole("radio", { name: chosen })).toBeChecked();
    }
  );

  it.each([
    [{ captchaEnabled: true }, "reCAPTCHA"],
    [{ captchaEnabled: false }, "Off"],
    [{}, "Site default (off)"],
  ])(
    "shows a bot check saved before the change as %j",
    async (settings, shown) => {
      view({ settings });
      // "Site default" names what it follows once the plugin's options load.
      await waitFor(() =>
        expect(
          screen.getByRole("combobox", { name: "Bot check" })
        ).toHaveTextContent(shown)
      );
    }
  );

  it("saves one response per browser, saying how it is counted", async () => {
    const { user, fetchMock } = view({ status: "published" });
    const browser = screen.getByRole("radio", { name: "One per browser" });
    expect(browser).toHaveAccessibleDescription(
      /Counted from when you choose it/
    );
    await user.click(browser);
    await user.click(save());

    await waitFor(() => expect(saves(fetchMock)).toHaveLength(1));
    expect(saves(fetchMock)[0]).toMatchObject({
      settings: { oneResponse: "browser" },
    });
  });

  it("offers one per email, comparing only an Email field it can", async () => {
    const { user, fetchMock } = view({
      fields: [
        {
          id: "f1",
          name: "email",
          label: "Email",
          type: "email",
          required: true,
        },
        {
          id: "f2",
          name: "work",
          label: "Work email",
          type: "email",
          required: true,
          conditionalLogic: {
            enabled: true,
            action: "show",
            operator: "AND",
            conditions: [{ field: "email", comparison: "is_not_empty" }],
          },
        },
        { id: "f3", name: "other", label: "Other email", type: "email" },
      ],
    });
    await user.click(
      screen.getByRole("radio", { name: "One per email address" })
    );
    // Started on the one field it can compare, and offering no other.
    const fieldPicker = screen.getByRole("combobox", {
      name: "Email field to compare",
    });
    expect(fieldPicker).toHaveTextContent("Email");
    await user.click(fieldPicker);
    expect(
      (await screen.findAllByRole("option")).map(option => option.textContent)
    ).toEqual(["Email"]);
    await user.keyboard("{Escape}");
    await user.click(save());

    await waitFor(() => expect(saves(fetchMock)).toHaveLength(1));
    expect(saves(fetchMock)[0]).toMatchObject({
      settings: { oneResponse: "email", oneResponseField: "email" },
    });
  });

  it("cannot take one per email without an Email field it can compare", () => {
    // The form's only Email field is optional.
    view();
    expect(
      screen.getByRole("radio", { name: "One per email address" })
    ).toBeDisabled();
    expect(
      screen.getByText(/Add an Email field that is required/)
    ).toBeInTheDocument();
  });
});

describe("closing by itself", () => {
  it("saves a closing time and a limit once switched on and set", async () => {
    const { user, fetchMock } = view({ status: "published" });
    expect(
      screen.queryByLabelText("Closing date and time")
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Close on a date" }));
    const closing = screen.getByLabelText("Closing date and time");
    await user.clear(closing);
    await user.type(closing, "2026-12-06T18:00");

    await user.click(
      screen.getByRole("switch", { name: "Limit the number of submissions" })
    );
    const limit = screen.getByRole("spinbutton", { name: "Submission limit" });
    await user.clear(limit);
    await user.type(limit, "120");
    await user.click(save());

    await waitFor(() => expect(saves(fetchMock)).toHaveLength(1));
    expect(saves(fetchMock)[0]?.settings).toMatchObject({
      // Typed in the author's time zone, stored as the instant it names.
      closesAt: new Date("2026-12-06T18:00").toISOString(),
      submissionLimit: 120,
    });
  });

  it("clears each when switched off", async () => {
    const { user, fetchMock } = view({
      status: "published",
      settings: { closesAt: "2026-12-06T18:00:00.000Z", submissionLimit: 50 },
    });
    expect(
      screen.getByRole("spinbutton", { name: "Submission limit" })
    ).toHaveValue(50);

    await user.click(screen.getByRole("switch", { name: "Close on a date" }));
    await user.click(
      screen.getByRole("switch", { name: "Limit the number of submissions" })
    );
    await user.click(save());

    await waitFor(() => expect(saves(fetchMock)).toHaveLength(1));
    const { settings } = saves(fetchMock)[0]!;
    expect(settings).not.toHaveProperty("closesAt");
    expect(settings).not.toHaveProperty("submissionLimit");
  });
});

describe("spam protection", () => {
  it("describes reCAPTCHA as a background score, not a puzzle", async () => {
    view({ settings: { botCheck: "recaptcha" } });
    expect(
      await screen.findByText(/scores each visitor in the background/i)
    ).toBeVisible();
  });

  it("refuses to newly choose a check whose keys are missing", async () => {
    const { user } = view();
    await user.click(screen.getByRole("combobox", { name: "Bot check" }));
    const turnstile = await screen.findByRole("option", {
      name: "Turnstile (needs keys)",
    });
    expect(turnstile).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("option", { name: "reCAPTCHA" })
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("refuses a check with a secret but no site key a visitor's widget could use", async () => {
    const { user } = view(
      {},
      {
        ...SPAM,
        botChecks: {
          recaptcha: { secret: true, siteKey: false },
          turnstile: { secret: true, siteKey: true },
        },
      }
    );
    await user.click(screen.getByRole("combobox", { name: "Bot check" }));
    expect(
      await screen.findByRole("option", { name: "reCAPTCHA (needs keys)" })
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("option", { name: "Turnstile" })
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("says a form's check without a secret accepts submissions unchecked, naming the option", async () => {
    view({ settings: { botCheck: "turnstile" } });
    expect(
      await screen.findByText(/submissions are accepted unchecked/i)
    ).toBeVisible();
    expect(
      screen.getByText("spamProtection.turnstile.secretKey")
    ).toBeVisible();
    expect(screen.getByText("spamProtection.turnstile.siteKey")).toBeVisible();
  });

  it("asks to move a form's own reCAPTCHA site key into the plugin's options", async () => {
    view(
      { settings: { captchaEnabled: true, captchaSiteKey: "legacy" } },
      {
        ...SPAM,
        botChecks: {
          recaptcha: { secret: true, siteKey: false },
          turnstile: { secret: false, siteKey: false },
        },
      }
    );
    expect(
      await screen.findByText(/keeps its own reCAPTCHA site key/i)
    ).toBeVisible();
    expect(screen.getByText("spamProtection.recaptcha.siteKey")).toBeVisible();
  });

  it("shows the plugin's rate limit, read-only", async () => {
    view();
    expect(await screen.findByText("10 a minute")).toBeVisible();
    expect(screen.getByText(/spamProtection\.rateLimit/)).toBeVisible();
  });
});

describe("the form's ID", () => {
  it("follows the name, and can be typed, while the form is a draft", async () => {
    const { user } = view({ name: "", slug: "" });
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Meetup");
    const id = screen.getByRole("textbox", { name: "Form ID" });
    expect(id).toHaveValue("meetup");
    expect(id).toBeEnabled();
  });

  const STAMP = "2026-11-01T09:00:00.000Z";

  it.each([
    ["live", { status: "published" }],
    ["closed after being live", { status: "closed", wentLiveAt: STAMP }],
    ["back to draft after being live", { status: "draft", wentLiveAt: STAMP }],
  ])("is fixed while the form is %s, with the reason", async (_, stored) => {
    const { user } = view(stored);
    const id = screen.getByRole("textbox", { name: "Form ID" });
    expect(id).toBeDisabled();
    expect(id).toHaveAccessibleDescription(FIXED_FORM_ID_REASON);

    // Renaming the form no longer moves its ID either.
    await user.type(screen.getByRole("textbox", { name: "Name" }), " form");
    expect(id).toHaveValue("contact");
  });

  it("can still be typed on a form closed before it ever went live", () => {
    view({ status: "closed" });
    expect(screen.getByRole("textbox", { name: "Form ID" })).toBeEnabled();
  });

  it("is fixed while the save that makes it live runs, and freed if refused", async () => {
    // The save is held open, then refused, to watch the ID while it runs.
    let refuseSave: () => void = () => undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? new Promise<Response>(resolve => {
            refuseSave = () =>
              resolve(
                new Response(
                  JSON.stringify({ error: { message: "Refused." } }),
                  {
                    status: 400,
                    headers: { "content-type": "application/json" },
                  }
                )
              );
          })
        : answer(200, {})
    );
    const { user } = view({ name: "Meetup", slug: "meetup" });
    vi.stubGlobal("fetch", fetchMock);

    await user.click(screen.getByRole("button", { name: /^Status:/ }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: /^Live/ })
    );
    await user.click(save());

    // What this save sends is the ID it publishes: a rename while it runs
    // does not move it.
    const id = screen.getByRole("textbox", { name: "Form ID" });
    await waitFor(() => expect(id).toBeDisabled());
    await user.type(screen.getByRole("textbox", { name: "Name" }), " 2026");
    expect(id).toHaveValue("meetup");

    // Refused, nothing was stored: the form has not been live.
    refuseSave();
    await waitFor(() => expect(id).toBeEnabled());
  });

  it("is fixed once a draft made live is saved, not before, and stays fixed", async () => {
    const { user, fetchMock } = view();
    await user.click(screen.getByRole("button", { name: /^Status:/ }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: /^Live/ })
    );
    const id = screen.getByRole("textbox", { name: "Form ID" });
    // Live only once stored: the site has not read it by this ID yet.
    expect(id).toBeEnabled();

    await user.click(save());
    await waitFor(() => expect(saves(fetchMock)).toHaveLength(1));
    await waitFor(() => expect(id).toBeDisabled());

    // Set back to draft and saved: it has still been live.
    await user.click(screen.getByRole("button", { name: /^Status:/ }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: /^Draft/ })
    );
    await user.click(save());
    await waitFor(() => expect(saves(fetchMock)).toHaveLength(2));
    expect(saves(fetchMock)[1]?.status).toBe("draft");
    expect(id).toBeDisabled();
  });
});
