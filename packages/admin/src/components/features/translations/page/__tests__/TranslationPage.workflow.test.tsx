/**
 * The translation page of a language a workflow holds, as a writer, a reviewer
 * and a publisher meet it: the language's own step leads, its stage is said
 * beside its status, and publishing stays the page's own. Only the requests and
 * the person's rights are replaced.
 *
 * The plausible broken pages: one that still offers the publish a stage holds,
 * one whose step moves the shared fields too, one that saves and publishes in
 * one press although the save asks for the review again, one that hides the
 * step from a reviewer who may not write, and one that loses the page's own
 * rows or why a step was refused.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@admin/__tests__/utils";
import type { PublishPartsChoice } from "@admin/services/publishParts";
import type { PartReview, ReviewStep } from "@admin/types/workflows";

import { TranslationPage } from "../TranslationPage";

const api = vi.hoisted(() => ({
  findByID: vi.fn(),
  update: vi.fn(),
  publishParts: vi.fn(),
  reviewState: vi.fn(),
  takeStep: vi.fn(),
}));
const schema = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const reader = vi.hoisted(() => ({
  update: "allowed" as "allowed" | "refused",
  can: new Set<string>(),
}));

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return {
    ...actual,
    entryApi: {
      ...actual.entryApi,
      findByID: api.findByID,
      update: api.update,
      publishParts: api.publishParts,
    },
  };
});
vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  fetchReviewState: api.reviewState,
  takeWorkflowStep: api.takeStep,
}));
// The versions this person may read, which the shared fields' approval is
// judged by in the editor; the page moves the language alone.
vi.mock("@admin/hooks/queries/useVersions", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useVersions")
  >()),
  useVersions: () => ({ data: undefined, isError: true }),
}));
vi.mock("@admin/hooks/queries/useCollections", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useCollections")
  >()),
  useCollectionSchema: () => ({
    data: schema.value,
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (permission: string) => reader.can.has(permission),
}));
vi.mock("@admin/hooks/useCanRequest", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useCanRequest")>()),
  useCanRequest: () => true,
}));
vi.mock("@admin/hooks/useUpdateAnswer", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useUpdateAnswer")>()),
  useUpdateAnswer: () => reader.update,
}));
vi.mock("@admin/hooks/queries/useDocumentLockHolder", () => ({
  useDocumentLockHolder: () => null,
}));
vi.mock("@admin/hooks/useCurrentUserId", () => ({
  useCurrentUserId: () => "me",
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins: [], locales: LOCALES }),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
    retry: vi.fn(),
  }),
}));

const LOCALES = vi.hoisted(() => ({
  defaultLocale: "en",
  fallback: true,
  locales: [
    { code: "en", label: "English", rtl: false, fallbackLocale: [] },
    { code: "es", label: "Spanish", rtl: false, fallbackLocale: ["en"] },
  ],
}));

const COLLECTION = {
  name: "authors",
  label: "Authors",
  localized: true,
  status: true,
  draftsEnabled: true,
  workflow: { slug: "review", label: "Review" },
  versions: null,
  admin: { useAsTitle: "name" },
  fields: [
    { name: "name", type: "text", label: "Name", localized: false },
    { name: "bio", type: "textarea", label: "Biography" },
  ],
};
const PUBLISHED = { translated: true, status: "published" };
const DRAFT = { translated: true, status: "draft" };
const ENTRY = { kind: "collection", slug: "authors", id: "a1" } as const;

const SUBMIT: ReviewStep = {
  name: "submit",
  label: "Submit for review",
  kind: "submit",
  to: "inReview",
  mayTake: true,
  primary: true,
  commentRequired: false,
};
const APPROVE: ReviewStep = {
  ...SUBMIT,
  name: "approve",
  label: "Approve",
  kind: "approve",
  to: "approved",
};

/** Spanish, being written, to a person who may submit it. */
function part(over: Partial<PartReview> = {}): PartReview {
  return {
    part: "es",
    stage: "drafting",
    stageLabel: "Drafting",
    stageColour: null,
    publishable: false,
    enteredAt: null,
    enteredBy: null,
    assignee: null,
    dueAt: null,
    approval: null,
    revision: 4,
    version: "v-es",
    steps: [SUBMIT],
    waitingFor: null,
    lastMove: null,
    reviewedVersionNo: null,
    ...over,
  };
}

/** Waiting for an editor's approval. */
const inReview = (mayTake: boolean): Partial<PartReview> => ({
  stage: "inReview",
  stageLabel: "In review",
  steps: [{ ...APPROVE, mayTake }],
  waitingFor: { kind: "roles", roles: [{ id: "r1", name: "Editors" }] },
});
const APPROVED: Partial<PartReview> = {
  stage: "approved",
  stageLabel: "Approved",
  publishable: true,
  steps: [],
};

function attach(...parts: PartReview[]): void {
  api.reviewState.mockResolvedValue({
    attached: true,
    review: {
      workflow: { slug: "review", label: "Review" },
      parts,
      mayPublishWithoutReview: false,
    },
  });
}

/** Where Spanish stands with its readers. */
let spanish: Record<string, unknown>;

type Read = { everyLanguage?: boolean };

function answer(read: Read): Record<string, unknown> {
  const row = {
    id: "a1",
    name: "Grace Hopper",
    status: "published",
    bio: "Una pionera",
    _rev: "7.es:3",
  };
  return read.everyLanguage
    ? {
        ...row,
        _allLocales: { bio: { en: "A pioneer", es: "Una pionera" } },
      }
    : { ...row, _translations: { en: PUBLISHED, es: spanish } };
}

const render = () => renderWithProviders(<TranslationPage document={ENTRY} />);
const button = (name: string) => screen.getByRole("button", { name });
const panel = () => within(screen.getByRole("complementary"));
const bio = () =>
  within(screen.getByRole("group", { name: "Biography" })).getByRole("textbox");

/** The menu on the main button's arrow. */
async function openMenu(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole("button", { name: /^More / }));
  return screen.findByRole("menu");
}

/** The publishes made, descriptions left out. */
const published = () =>
  (
    api.publishParts.mock.calls as [
      string,
      string,
      string,
      PublishPartsChoice,
    ][]
  )
    .map(([, , , choice]) => choice)
    .filter(choice => choice.describe !== true);

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(
    null,
    "",
    "/admin/translations/collections/authors/a1?locale=es"
  );
  schema.value = COLLECTION;
  reader.update = "allowed";
  reader.can = new Set(["publish-authors", "unpublish-authors"]);
  spanish = DRAFT;
  api.findByID.mockImplementation((_s: string, _i: string, read: Read) =>
    Promise.resolve(answer(read))
  );
  api.update.mockResolvedValue({ item: answer({}) });
  api.publishParts.mockResolvedValue({
    id: "a1",
    languages: [{ locale: "es", outcome: "goes-live" }],
    shared: { changes: false, added: false },
  });
  api.takeStep.mockResolvedValue({ message: "Step taken.", item: {} });
  attach(part());
});

describe("a language a workflow holds", () => {
  it("leads with its step, says its stage, and keeps the page's own rows", async () => {
    render();

    const submit = await screen.findByRole("button", {
      name: "Submit for review",
    });
    expect(submit).toHaveAttribute("data-primary", "true");
    expect(
      screen.queryByRole("button", { name: "Publish Spanish" })
    ).toBeNull();
    expect(panel().getByRole("region", { name: "Stage" })).toHaveTextContent(
      "Drafting"
    );

    const menu = within(await openMenu());
    expect(
      menu.getByRole("menuitem", { name: /^Save Spanish/ })
    ).toBeInTheDocument();
    expect(
      menu.getByRole("menuitem", { name: "Open in editor" })
    ).toHaveAttribute("href", "/admin/collections/authors/a1");
  });

  it("sends the step for the language alone, where the shared fields wait in the same stage", async () => {
    attach(part(), part({ part: null, revision: 9, version: "v-shared" }));
    render();

    await userEvent.click(
      await screen.findByRole("button", { name: "Submit for review" })
    );

    await waitFor(() =>
      expect(api.takeStep).toHaveBeenCalledWith({
        document: { collection: "authors", id: "a1" },
        step: "submit",
        parts: ["es"],
        seen: [{ part: "es", revision: 4, version: "v-es" }],
      })
    );
  });

  it("holds the step while the page has unsaved work, sending nothing", async () => {
    render();
    const submit = await screen.findByRole("button", {
      name: "Submit for review",
    });

    await userEvent.type(bio(), "!");

    await waitFor(() => expect(submit).toHaveAttribute("data-held"));
    await userEvent.click(submit);
    expect(api.takeStep).not.toHaveBeenCalled();
  });

  it("says on the page why a step was refused, until that is dismissed", async () => {
    api.takeStep.mockRejectedValue(new Error("Someone else took this step."));
    render();
    await userEvent.click(
      await screen.findByRole("button", { name: "Submit for review" })
    );

    const refusal = await screen.findByText("Someone else took this step.");
    // Beside the work, and not in the row of buttons.
    expect(refusal.closest('[aria-label="Spanish actions"]')).toBeNull();

    await userEvent.click(button("Dismiss"));
    expect(screen.queryByText("Someone else took this step.")).toBeNull();
  });

  it("offers the step to a reviewer who may not write, and no save", async () => {
    reader.update = "refused";
    reader.can = new Set();
    attach(part(inReview(true)));
    render();

    const approve = await screen.findByRole("button", { name: "Approve" });
    expect(approve).toHaveAttribute("data-primary", "true");
    expect(panel().getByRole("region", { name: "Stage" })).toHaveTextContent(
      "In review, waiting for Editors"
    );

    await userEvent.click(approve);
    await waitFor(() => expect(api.takeStep).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
  });
});

describe("publishing a language a workflow holds", () => {
  it("is held before approval, saying why, and opens nothing", async () => {
    attach(part(inReview(false)));
    render();

    const publish = await screen.findByRole("button", {
      name: "Publish Spanish",
    });
    await waitFor(() =>
      expect(publish).toHaveAccessibleDescription(
        "Needs approval: In review, waiting for Editors"
      )
    );
    await userEvent.click(publish);
    expect(
      screen.queryByRole("dialog", { name: "Publish Spanish?" })
    ).toBeNull();
    expect(api.publishParts).not.toHaveBeenCalled();
  });

  it("is the page's own once approved: it says what readers will see, then publishes", async () => {
    attach(part(APPROVED));
    render();

    const publish = await screen.findByRole("button", {
      name: "Publish Spanish",
    });
    await waitFor(() => expect(publish).not.toHaveAttribute("data-held"));
    await userEvent.click(publish);
    const dialog = within(
      await screen.findByRole("dialog", { name: "Publish Spanish?" })
    );
    const confirm = dialog.getByRole("button", { name: "Publish Spanish" });
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);

    await waitFor(() => expect(published()).toHaveLength(1));
    expect(published()[0]).toMatchObject({ locales: ["es"] });
  });

  it("waits for Save with unsaved work, since a save asks for the review again", async () => {
    attach(part(APPROVED));
    render();
    const publish = await screen.findByRole("button", {
      name: "Publish Spanish",
    });
    await waitFor(() => expect(publish).not.toHaveAttribute("data-held"));

    await userEvent.type(bio(), "!");

    expect(
      await screen.findByText(/^Save your changes before publishing Spanish/)
    ).toBeInTheDocument();
    await userEvent.click(publish);
    expect(api.update).not.toHaveBeenCalled();
    expect(api.publishParts).not.toHaveBeenCalled();
  });

  it("keeps Take offline on its menu, opening the page's own question", async () => {
    spanish = PUBLISHED;
    attach(part());
    render();
    await screen.findByRole("button", { name: "Submit for review" });

    await userEvent.click(
      within(await openMenu()).getByRole("menuitem", { name: "Take offline…" })
    );

    expect(
      await screen.findByRole("alertdialog", { name: /offline/ })
    ).toBeInTheDocument();
  });
});

describe("a language the workflow says nothing of", () => {
  it("has the page's own actions, and no stage, where no workflow is attached", async () => {
    schema.value = { ...COLLECTION, workflow: null };
    api.reviewState.mockResolvedValue({ attached: false });
    render();

    expect(
      await screen.findByRole("button", { name: "Save draft" })
    ).toBeInTheDocument();
    expect(button("Publish Spanish")).toBeInTheDocument();
    expect(panel().queryByRole("region", { name: "Stage" })).toBeNull();
  });

  it("has them where nothing of it waits, and only the shared fields do", async () => {
    attach(
      part({ part: null }),
      part({ stage: null, stageLabel: null, steps: [] })
    );
    render();

    expect(
      await screen.findByRole("button", { name: "Save draft" })
    ).toBeInTheDocument();
    expect(panel().queryByRole("region", { name: "Stage" })).toBeNull();
  });
});
