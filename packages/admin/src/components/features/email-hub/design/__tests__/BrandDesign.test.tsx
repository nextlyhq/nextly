// @vitest-environment jsdom
/**
 * The brand settings beside a live preview: a change shows in the preview
 * before it is saved, Save sends only what changed, Match my site offers the
 * site's light-theme colours, and a reader sees the settings without changing
 * them.
 */
import { act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { BrandOverview } from "@admin/services/emailBrandApi";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import { BrandDesign } from "../BrandDesign";

const { save, preview, grants, getDocument, overview } = vi.hoisted(() => ({
  overview: { current: null as unknown as BrandOverview },
  save: vi.fn(),
  preview: vi.fn(),
  grants: new Set<string>(),
  getDocument: vi.fn(),
}));

function email(
  id: string,
  name: string,
  over: Partial<EmailTemplateRecord> = {}
): EmailTemplateRecord {
  return {
    id,
    name,
    slug: id,
    kind: "template",
    subject: `${name} subject`,
    htmlContent: "<p>Hi</p>",
    plainTextContent: null,
    preheader: null,
    layoutId: null,
    useLayout: true,
    isActive: true,
    variables: [],
    owner: { kind: "core" },
    ...over,
  } as EmailTemplateRecord;
}

const TEMPLATES = [
  email("layout", "Default layout", { kind: "layout", slug: "default-layout" }),
  email("welcome", "Welcome"),
  email("reset", "Password reset"),
  email("notify", "Contact form: notify team", {
    owner: { kind: "site" },
    layoutId: "plain",
  }),
];

const OVERVIEW: BrandOverview = {
  settings: {
    logoUrl: null,
    logoWidth: 120,
    accentColor: "#18181b",
    backgroundColor: "#f4f4f5",
    contentColor: "#ffffff",
    fontFamily: "system",
    footerText: null,
    footerLinks: [],
  },
  starting: {
    logoUrl: null,
    logoWidth: 120,
    accentColor: "#18181b",
    backgroundColor: "#f4f4f5",
    contentColor: "#ffffff",
    fontFamily: "system",
    footerText: null,
    footerLinks: [],
  },
  fonts: [
    { key: "system", label: "System", stack: "-apple-system, sans-serif" },
    { key: "georgia", label: "Georgia", stack: "Georgia, serif" },
  ],
  reach: [
    {
      templateId: "welcome",
      slug: "welcome",
      name: "Welcome",
      reached: true,
      reason: null,
      via: { body: true, layout: true },
      layout: null,
    },
    {
      templateId: "reset",
      slug: "reset",
      name: "Password reset",
      reached: true,
      reason: null,
      via: { body: true, layout: true },
      layout: null,
    },
    {
      templateId: "notify",
      slug: "notify",
      name: "Contact form: notify team",
      reached: false,
      reason: "layoutWithoutBrand",
      via: { body: false, layout: false },
      layout: {
        id: "plain",
        slug: "plain",
        name: "Plain layout",
        overridden: false,
      },
    },
  ],
};

/** A site's design variables, with dark values the email must not take. */
const SITE_STYLE = {
  tokens: [
    {
      name: "color.brand",
      kind: "color",
      values: { light: "#2f6b4f", dark: "#7fd1a8" },
    },
    {
      name: "color.surface",
      kind: "color",
      values: { light: "#f6f3ee", dark: "#151b2b" },
    },
    {
      name: "color.card",
      kind: "color",
      values: { light: "#ffffff", dark: "#0b0f19" },
    },
    {
      name: "font.body",
      kind: "fontFamily",
      values: { light: "Fraunces, serif" },
    },
  ],
};

vi.mock("@admin/hooks/queries/useEmailBrand", () => ({
  useEmailBrand: () => ({
    data: overview.current,
    isError: false,
    error: null,
  }),
  useUpdateEmailBrand: () => ({ mutate: save, isPending: false }),
  useBrandPreview: (...args: unknown[]) => {
    preview(...args);
    return {
      data: { html: "<p>Rendered</p>", text: "", subject: "Welcome" },
      isPending: false,
      error: null,
    };
  },
}));

vi.mock("@admin/hooks/queries/useEmailTemplates", () => ({
  useEmailTemplates: () => ({ data: TEMPLATES, isError: false, error: null }),
}));

vi.mock("@admin/hooks/useCurrentUserPermissions", async () => {
  // Asked as the product asks it.
  const { holdsPermission } = await import(
    "@admin/lib/permissions/holds-permission"
  );
  return {
    useCurrentUserPermissions: () => ({
      hasPermission: (slug: string) => holdsPermission(grants, slug),
    }),
  };
});

vi.mock("@admin/services/singleApi", () => ({
  singleApi: { getDocument: (slug: string) => getDocument(slug) },
}));

vi.mock("../../useTemplateActions", () => ({
  editRouteFor: (record: { id: string }) =>
    `/admin/email/messages/edit/${record.id}`,
  useTemplateActions: () => ({
    canOpen: true,
    actionsFor: () => [],
    dialogs: null,
  }),
}));

// The preview's own frame is covered where it is defined.
vi.mock(
  "@admin/components/features/settings/EmailTemplateForm/TemplatePreview",
  () => ({
    PreviewPane: ({ html }: { html: string }) => (
      <div data-testid="preview">{html}</div>
    ),
  })
);

vi.mock("@admin/hooks/useDebouncedValue", () => ({
  useDebouncedValue: <T,>(value: T) => value,
}));

vi.mock("@admin/components/features/media-library/MediaPickerDialog", () => ({
  MediaPickerDialog: () => null,
}));

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  save.mockReset();
  preview.mockReset();
  getDocument.mockReset();
  getDocument.mockResolvedValue({ id: "s", updatedAt: "", tokens: SITE_STYLE });
  grants.clear();
  for (const slug of [
    "read-email-templates",
    "create-email-templates",
    "update-email-templates",
    "delete-email-templates",
  ])
    grants.add(slug);
  overview.current = OVERVIEW;
});

/** The brand change the preview was last asked to render. */
function lastPreviewBrand(): unknown {
  return preview.mock.calls.at(-1)?.[2];
}

async function typeAccent(
  user: ReturnType<typeof userEvent.setup>,
  hex: string
) {
  const field = screen.getByLabelText("Accent colour");
  await user.clear(field);
  await user.click(field);
  await user.paste(hex);
}

describe("the brand settings", () => {
  it("show a changed accent in the preview before it is saved", async () => {
    const user = userEvent.setup();
    render(<BrandDesign />);
    expect(lastPreviewBrand()).toBeUndefined();

    await typeAccent(user, "#2F6B4F");

    expect(lastPreviewBrand()).toEqual({ accentColor: "#2f6b4f" });
    expect(screen.getByText("Unsaved")).toBeTruthy();
    expect(
      screen.getByText("Saving changes the look of 2 emails.")
    ).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("save only what changed, and Discard puts the saved settings back", async () => {
    const user = userEvent.setup();
    render(<BrandDesign />);

    await typeAccent(user, "#2f6b4f");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(save.mock.calls[0][0]).toEqual({ accentColor: "#2f6b4f" });

    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(
      (screen.getByLabelText("Accent colour") as HTMLInputElement).value
    ).toBe("#18181b");
    expect(screen.queryByText("Unsaved")).toBeNull();
  });

  it("say a colour that isn't hex, and keep it out of the draft", async () => {
    const user = userEvent.setup();
    render(<BrandDesign />);

    await typeAccent(user, "green");

    expect(screen.getByText("Use a hex colour, like #2f6b4f.")).toBeTruthy();
    expect(lastPreviewBrand()).toBeUndefined();
  });

  it("are shown to a reader, who can't change them", () => {
    grants.clear();
    grants.add("read-email-templates");
    render(<BrandDesign />);

    expect(
      (screen.getByLabelText("Accent colour") as HTMLInputElement).disabled
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Match my site" })).toBeNull();
  });

  it("say which emails they reach, and why not the others", () => {
    render(<BrandDesign />);
    expect(screen.getByText("Reaches 2 emails")).toBeTruthy();
    expect(screen.getByText("On Plain layout, your own")).toBeTruthy();
  });
});

describe("the brand settings, in harder cases", () => {
  it("keep an edit made while a save is still on its way", async () => {
    const user = userEvent.setup();
    render(<BrandDesign />);
    await typeAccent(user, "#2f6b4f");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Changed again before the save answers.
    const background = screen.getByLabelText("Email background");
    await user.clear(background);
    await user.click(background);
    await user.paste("#abcdef");
    // As the mutation calls it: the saved settings, then what was sent.
    act(() =>
      save.mock.calls[0][1].onSuccess(undefined, save.mock.calls[0][0])
    );

    expect(lastPreviewBrand()).toMatchObject({ backgroundColor: "#abcdef" });
    expect(screen.getByText("Unsaved")).toBeTruthy();
  });

  it("don't preview for someone who may read templates but not preview them", () => {
    grants.clear();
    grants.add("read-email-templates");
    render(<BrandDesign />);
    expect(preview).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Previewing needs permission to create templates/)
    ).toBeTruthy();
  });

  it("count the emails a save reaches even when the Default layout is kept", async () => {
    overview.current = {
      ...OVERVIEW,
      reach: [
        ...OVERVIEW.reach.slice(0, 1),
        {
          templateId: "reset",
          slug: "reset",
          name: "Password reset",
          reached: false,
          reason: "layoutWithoutBrand",
          via: { body: false, layout: false },
          layout: {
            id: "layout",
            slug: "default-layout",
            name: "Default layout",
            overridden: true,
          },
        },
      ],
    };
    const user = userEvent.setup();
    render(<BrandDesign />);
    await typeAccent(user, "#2f6b4f");
    expect(
      screen.getByText("Saving changes the look of 1 email.")
    ).toBeTruthy();
  });

  it("take a typed logo width as typed, and keep it in bounds when left", async () => {
    overview.current = {
      ...OVERVIEW,
      settings: { ...OVERVIEW.settings, logoUrl: "https://cdn.test/logo.png" },
    };
    const user = userEvent.setup();
    render(<BrandDesign />);
    const width = screen.getByRole("spinbutton", {
      name: "Logo width",
    }) as HTMLInputElement;
    await user.clear(width);
    await user.type(width, "40");
    expect(width.value).toBe("40");
    await user.tab();
    expect(lastPreviewBrand()).toMatchObject({ logoWidth: 40 });

    await user.clear(width);
    await user.type(width, "4");
    await user.tab();
    expect(width.value).toBe("16");
  });
});

describe("Match my site", () => {
  it("offers the site's light-theme colours and puts its picks in the draft", async () => {
    const user = userEvent.setup();
    render(<BrandDesign />);

    await user.click(
      await screen.findByRole("button", { name: "Match my site" })
    );

    // Light values only: the email has no dark theme of the site's.
    const swatches = screen.getByRole("list", { name: "Your site's colours" });
    expect(swatches.textContent).toContain("#2f6b4f");
    expect(swatches.textContent).not.toContain("#7fd1a8");
    expect(screen.getAllByText("Suggested")).toHaveLength(3);
    expect(
      screen.getByText(
        "Your site uses Fraunces, which email clients don't have. We'll use Georgia, the closest email-safe font."
      )
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(lastPreviewBrand()).toEqual({
      accentColor: "#2f6b4f",
      backgroundColor: "#f6f3ee",
      fontFamily: "georgia",
    });
  });

  it("isn't offered where the site's design variables can't be read", async () => {
    getDocument.mockRejectedValue(new Error("Not found"));
    render(<BrandDesign />);
    await waitFor(() => expect(getDocument).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Match my site" })).toBeNull();
  });
});
