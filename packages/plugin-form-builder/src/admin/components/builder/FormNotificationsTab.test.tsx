// @vitest-environment jsdom

/**
 * A form's notifications: the list (each one's name and when, who it goes to
 * and by which message, Active), the two presets with "Confirm to the
 * visitor" unavailable on a form with no Email field, and each notification's
 * own page, at its own address, writing every edit to the form: several team
 * addresses, the visitor's Email field and Reply-To from a second one, all/any
 * conditions, the file fields it attaches, and the message's defaults in the
 * Email hub's words.
 */
import {
  act,
  cleanup,
  render as renderBare,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  FORM_CONFIRMATION_TEMPLATE,
  FORM_SUBMISSION_TEMPLATE,
} from "../../../emails/starter-messages";
import type { AnyFormField, FormNotification } from "../../../types";

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

const updateNotification = vi.fn();
const addNotification = vi.fn();
const deleteNotification = vi.fn();
const duplicateNotification = vi.fn();

let notifications: FormNotification[] = [];
let fields: AnyFormField[] = [];

const EMAIL: AnyFormField = { type: "email", name: "email", label: "Email" };
const WORK: AnyFormField = { type: "email", name: "work", label: "Work email" };
const CV: AnyFormField = { type: "file", name: "cv", label: "CV" };
const PHOTO: AnyFormField = { type: "file", name: "photo", label: "Photo" };
const JOIN: AnyFormField = {
  type: "select",
  name: "join",
  label: "Joining",
  options: [{ label: "Online", value: "online" }],
};

vi.mock("../../context/FormBuilderContext", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../../context/FormBuilderContext")>();
  return {
    ...actual,
    useFormBuilder: () => ({
      notifications,
      fields,
      formData: {
        id: "form-1",
        name: "Sign-up",
        slug: "sign-up",
        status: "published",
      },
      addNotification,
      duplicateNotification,
      updateNotification,
      deleteNotification,
    }),
    useFieldBookkeeping: () => ({ restored: 0 }),
  };
});

const { FormNotificationsTab } = await import("./FormNotificationsTab");

/** Render inside a fresh query client, as the admin provides one. */
function render(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderBare(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
}

function aNotification(over: Partial<FormNotification> = {}): FormNotification {
  return {
    id: "n1",
    name: "Notify your team",
    enabled: true,
    recipientType: "static",
    to: "events@example.com",
    cc: [],
    bcc: [],
    templateSlug: FORM_SUBMISSION_TEMPLATE,
    ...over,
  };
}

/** The admin's answers: one message, two providers, and the caller's grants. */
function serve(permissions: string[] = ["update-email-templates"]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const at = String(url);
      if (at.endsWith("/email-templates")) {
        return new Response(
          JSON.stringify({
            templates: [
              {
                id: "tpl-1",
                name: "Form submission",
                slug: FORM_SUBMISSION_TEMPLATE,
                isActive: true,
                kind: "template",
                subject: "New sign-up",
                fromOverride: "hello@example.com",
                providerId: "p2",
              },
            ],
          })
        );
      }
      if (at.includes("/email-providers")) {
        return new Response(
          JSON.stringify({
            providers: [
              { id: "p1", name: "Default", type: "smtp", isDefault: true },
              { id: "p2", name: "Resend", type: "resend", isDefault: false },
            ],
          })
        );
      }
      if (at.endsWith("/me/permissions")) {
        return new Response(JSON.stringify({ permissions }));
      }
      return new Response("{}");
    })
  );
}

/** The last change written to the notification. */
const lastChange = () =>
  updateNotification.mock.calls.at(-1)?.[1] as Partial<FormNotification>;

/** Show one notification, as its address names it. */
function openPage(id: string | null) {
  const url = id === null ? "/" : `/?section=${id}`;
  window.history.pushState(null, "", url);
}

beforeEach(() => {
  serve();
  fields = [EMAIL, WORK, CV, PHOTO, JOIN];
  openPage(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  notifications = [];
});

describe("the list", () => {
  it("shows each notification's name and when, who it goes to, its message and Active", async () => {
    notifications = [
      aNotification({
        recipients: ["events@example.com", "access@example.com"],
        conditions: {
          match: "all",
          list: [{ field: "join", comparison: "equals", value: "online" }],
        },
      }),
      aNotification({
        id: "n2",
        name: "Confirmation",
        enabled: false,
        recipientType: "field",
        to: "{{work}}",
        templateSlug: undefined,
      }),
    ];
    render(<FormNotificationsTab defaults={null} />);
    const list = screen.getByRole("list", { name: "Notifications" });
    const [team, visitor] = within(list).getAllByRole("listitem");

    expect(team).toHaveTextContent("Only when Joining is Online");
    expect(team).toHaveTextContent("events@example.com, access@example.com");
    expect(
      await within(team!).findByText("Message: Form submission")
    ).toBeInTheDocument();
    expect(
      within(team!).getByRole("switch", { name: "Notify your team active" })
    ).toBeChecked();

    expect(visitor).toHaveTextContent("The person who submitted (Work email)");
    expect(visitor).toHaveTextContent("No message: will not send");
    expect(
      within(visitor!).getByRole("switch", { name: "Confirmation active" })
    ).not.toBeChecked();
  });

  it("turns a notification off from its row", async () => {
    notifications = [aNotification()];
    const user = userEvent.setup();
    render(<FormNotificationsTab defaults={null} />);
    await user.click(
      screen.getByRole("switch", { name: "Notify your team active" })
    );
    expect(updateNotification).toHaveBeenCalledWith("n1", { enabled: false });
  });

  it("opens a notification on its own address", async () => {
    notifications = [aNotification()];
    const user = userEvent.setup();
    render(<FormNotificationsTab defaults={null} />);
    const link = screen.getByRole("link", { name: "Notify your team" });
    expect(link).toHaveAttribute("href", "/?section=n1");
    await user.click(link);
    expect(window.location.search).toBe("?section=n1");
    expect(await screen.findByRole("textbox", { name: "Name" })).toHaveValue(
      "Notify your team"
    );
  });
});

describe("adding a notification", () => {
  it("starts the team's with its starter message and the visitor as Reply-To", async () => {
    const user = userEvent.setup();
    render(<FormNotificationsTab defaults={null} />);
    await user.click(screen.getByRole("button", { name: "Add notification" }));
    await user.click(
      screen.getByRole("menuitem", { name: /Notify your team/ })
    );
    const [created] = addNotification.mock.calls[0] as [FormNotification];
    expect(created).toMatchObject({
      kind: "team",
      recipientType: "static",
      replyTo: "{{email}}",
      templateSlug: FORM_SUBMISSION_TEMPLATE,
      attachFields: [],
    });
    expect(window.location.search).toBe(`?section=${created.id}`);
  });

  it("sends a team preset to an address set on it afterwards", async () => {
    const { createNotification } = await import(
      "../../context/FormBuilderContext"
    );
    const { teamAddressesOf } = await import(
      "../../../utils/notification-model"
    );
    // As the editor seeds a new form with the site's default recipient.
    const seeded = {
      ...createNotification("team", fields),
      to: "team@site.test",
    };
    expect(teamAddressesOf(seeded)).toEqual(["team@site.test"]);
  });

  it("starts the visitor's confirmation at the form's Email field", async () => {
    const user = userEvent.setup();
    render(<FormNotificationsTab defaults={null} />);
    await user.click(screen.getByRole("button", { name: "Add notification" }));
    await user.click(
      screen.getByRole("menuitem", { name: /Confirm to the visitor/ })
    );
    const [created] = addNotification.mock.calls[0] as [FormNotification];
    expect(created).toMatchObject({
      kind: "visitor",
      recipientType: "field",
      to: "{{email}}",
      templateSlug: FORM_CONFIRMATION_TEMPLATE,
      attachFields: [],
    });
  });

  it("offers no confirmation on a form with no Email field, saying why", async () => {
    fields = [CV];
    const user = userEvent.setup();
    render(<FormNotificationsTab defaults={null} />);
    await user.click(screen.getByRole("button", { name: "Add notification" }));
    const confirm = screen.getByRole("menuitem", {
      name: /Confirm to the visitor/,
    });
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(confirm).toHaveTextContent(
      "Add an Email field to the form to confirm to the visitor."
    );
  });
});

describe("a notification's page", () => {
  it("adds several team addresses, typed or pasted", async () => {
    notifications = [aNotification({ recipients: ["events@example.com"] })];
    openPage("n1");
    const user = userEvent.setup();
    render(<FormNotificationsTab defaults={null} />);
    await user.type(
      screen.getByRole("textbox", { name: "Add to Team addresses" }),
      "access@example.com; hr@example.com{Enter}"
    );
    expect(lastChange()).toEqual({
      recipients: [
        "events@example.com",
        "access@example.com",
        "hr@example.com",
      ],
      to: "events@example.com",
    });
  });

  it("refuses an address that is not one, saying so", async () => {
    notifications = [aNotification()];
    openPage("n1");
    const user = userEvent.setup();
    render(<FormNotificationsTab defaults={null} />);
    await user.type(
      screen.getByRole("textbox", { name: "Add to Team addresses" }),
      "not-an-address{Enter}"
    );
    expect(
      screen.getByText("not-an-address is not an email address.")
    ).toBeInTheDocument();
    expect(updateNotification).not.toHaveBeenCalled();
  });

  it("sends to the visitor from one Email field, with Reply-To from another", async () => {
    notifications = [
      aNotification({
        recipientType: "field",
        to: "{{email}}",
        replyTo: "{{email}}",
      }),
    ];
    openPage("n1");
    const user = userEvent.setup();
    render(<FormNotificationsTab defaults={null} />);

    await user.click(screen.getByRole("combobox", { name: "Email field" }));
    await user.click(screen.getByRole("option", { name: "Work email" }));
    expect(lastChange()).toEqual({ to: "{{work}}" });

    await user.click(screen.getByRole("combobox", { name: "Reply-To" }));
    await user.click(
      screen.getByRole("option", { name: "The visitor, field: Work email" })
    );
    expect(lastChange()).toEqual({ replyTo: "{{work}}" });
  });

  it("sends only when any of several conditions hold", async () => {
    notifications = [
      aNotification({
        condition: { field: "join", comparison: "equals", value: "online" },
      }),
    ];
    openPage("n1");
    const user = userEvent.setup();
    render(<FormNotificationsTab defaults={null} />);

    // A single condition saved before reads as a list of one.
    expect(
      within(screen.getByRole("list", { name: "Conditions" })).getAllByRole(
        "listitem"
      )
    ).toHaveLength(1);

    await user.click(
      screen.getByRole("combobox", { name: "How conditions combine" })
    );
    await user.click(screen.getByRole("option", { name: "Any" }));
    expect(lastChange()).toEqual({
      conditions: {
        match: "any",
        list: [{ field: "join", comparison: "equals", value: "online" }],
      },
    });
    // The single condition is cleared, written as undefined, so the rule
    // reads one way from here on.
    expect(lastChange()).toHaveProperty("condition", undefined);
  });

  it("compares a box as checked or not, and a dropdown by its options' labels", async () => {
    fields = [
      EMAIL,
      { type: "checkbox", name: "access", label: "Access needs" },
      JOIN,
    ];
    notifications = [
      aNotification({
        conditions: {
          match: "all",
          list: [
            { field: "access", comparison: "equals", value: true },
            { field: "join", comparison: "equals", value: "online" },
          ],
        },
      }),
    ];
    openPage("n1");
    const user = userEvent.setup();
    render(<FormNotificationsTab defaults={null} />);

    expect(
      screen.getByRole("combobox", { name: "Condition 1 value" })
    ).toHaveTextContent("checked");
    expect(
      screen.getByRole("combobox", { name: "Condition 2 value" })
    ).toHaveTextContent("Online");

    await user.click(
      screen.getByRole("combobox", { name: "Condition 1 value" })
    );
    await user.click(screen.getByRole("option", { name: "not checked" }));
    // A box's answer is compared as stored: true or false, not text.
    expect(lastChange().conditions?.list[0]).toEqual({
      field: "access",
      comparison: "equals",
      value: false,
    });
  });

  it("attaches the file fields ticked, starting from those a saved rule attached", async () => {
    fields = [EMAIL, { ...CV, attachToEmail: true } as AnyFormField, PHOTO];
    notifications = [aNotification()];
    openPage("n1");
    const user = userEvent.setup();
    render(<FormNotificationsTab defaults={null} />);
    const files = screen.getByRole("list", { name: "Attach files from" });
    expect(within(files).getByRole("checkbox", { name: "CV" })).toBeChecked();
    expect(
      within(files).getByRole("checkbox", { name: "Photo" })
    ).not.toBeChecked();

    await user.click(within(files).getByRole("checkbox", { name: "Photo" }));
    expect(lastChange()).toEqual({ attachFields: ["cv", "photo"] });
  });

  it("says when the form has no file fields to attach", () => {
    fields = [EMAIL];
    notifications = [aNotification()];
    openPage("n1");
    render(<FormNotificationsTab defaults={null} />);
    expect(
      screen.getByText("This form has no file fields")
    ).toBeInTheDocument();
  });

  it("shows the message's From and Provider as the defaults, in the Email hub's words", async () => {
    notifications = [aNotification()];
    openPage("n1");
    render(
      <FormNotificationsTab defaults={{ defaultFrom: "forms@example.com" }} />
    );
    expect(await screen.findByText("Subject:")).toBeInTheDocument();
    // The site's default sender wins over the message's, as sending does.
    expect(screen.getByRole("textbox", { name: "From" })).toHaveAttribute(
      "placeholder",
      "forms@example.com"
    );
    expect(
      screen.getByRole("textbox", { name: "From" })
    ).toHaveAccessibleDescription(
      /forms@example.com, the site's default sender/
    );
    expect(
      screen.getByRole("combobox", { name: "Provider" })
    ).toHaveTextContent("The message's provider (Resend)");
    expect(
      screen.getByRole("combobox", { name: "Reply-To" })
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Active" })).toBeChecked();
  });

  it("shows the message's From as the default when the site sets none", async () => {
    notifications = [aNotification()];
    openPage("n1");
    render(<FormNotificationsTab defaults={null} />);
    await screen.findByText("Subject:");
    expect(screen.getByRole("textbox", { name: "From" })).toHaveAttribute(
      "placeholder",
      "hello@example.com"
    );
  });

  it("links to the message in the Email hub, in a new tab, for someone who may edit it", async () => {
    notifications = [aNotification()];
    openPage("n1");
    render(<FormNotificationsTab defaults={null} />);
    const link = await screen.findByRole("link", { name: /Edit in Email/ });
    expect(link).toHaveAttribute(
      "href",
      "/admin/settings/email/messages/edit/tpl-1"
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("offers no Email hub link to someone who may only read messages", async () => {
    serve(["read-email-templates", "manage-email-templates"]);
    notifications = [aNotification()];
    openPage("n1");
    render(<FormNotificationsTab defaults={null} />);
    await screen.findByText("Subject:");
    expect(screen.queryByRole("link", { name: /Edit in Email/ })).toBeNull();
  });

  it("gives a notification with no message its starter in one press", async () => {
    notifications = [
      aNotification({
        recipientType: "field",
        to: "{{email}}",
        templateSlug: undefined,
      }),
    ];
    openPage("n1");
    const user = userEvent.setup();
    render(<FormNotificationsTab defaults={null} />);
    await user.click(
      screen.getByRole("button", { name: "Use Form confirmation" })
    );
    expect(lastChange()).toEqual({ templateSlug: FORM_CONFIRMATION_TEMPLATE });
  });

  it("follows the starter when it turns from the team to the visitor", async () => {
    notifications = [aNotification()];
    openPage("n1");
    const user = userEvent.setup();
    render(<FormNotificationsTab defaults={null} />);
    await user.click(
      screen.getByRole("radio", { name: "The person who submitted" })
    );
    expect(lastChange()).toMatchObject({
      kind: "visitor",
      recipientType: "field",
      to: "{{email}}",
      templateSlug: FORM_CONFIRMATION_TEMPLATE,
    });
  });

  it("goes back to the list", async () => {
    notifications = [aNotification()];
    openPage("n1");
    const user = userEvent.setup();
    render(<FormNotificationsTab defaults={null} />);
    await user.click(screen.getByRole("link", { name: "All notifications" }));
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(
      await screen.findByRole("list", { name: "Notifications" })
    ).toBeInTheDocument();
  });

  it("says so when the address names a notification the form no longer has", () => {
    openPage("gone");
    render(<FormNotificationsTab defaults={null} />);
    expect(
      screen.getByText(/This notification is not on the form/)
    ).toBeInTheDocument();
    void act;
  });
});
