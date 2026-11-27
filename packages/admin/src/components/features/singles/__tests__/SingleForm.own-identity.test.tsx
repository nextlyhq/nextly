/**
 * A Single whose author declared their own `title` (or `slug`) field.
 *
 * Nextly gives every Single a title and a slug of its own, fixed by its
 * config: the editor draws them read-only and saves them as the Single's label
 * and slug. A Single that declares a field of either name has none of Nextly's
 * in its place, and the field is the author's: what it holds is content. The
 * property that separates the two is what a save sends for the field. The
 * Single's own value must go back as stored or as typed, never the label, while
 * a Single without its own title keeps sending the label as before.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import userEvent from "@testing-library/user-event";

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@admin/__tests__/utils";

const { useDocumentLock } = vi.hoisted(() => ({ useDocumentLock: vi.fn() }));

vi.mock("@admin/hooks/queries/useDocumentLock", () => ({ useDocumentLock }));

import {
  SingleForm,
  type SingleSchema,
  type SingleDocumentData,
} from "../SingleForm";

/** The heading the blog page keeps in its own `title` field. */
const HEADING = "Thoughts & <span>Insights</span>";

/** A Single that declares its own `title` and `slug`, as the server reports it. */
const ownSchema = {
  slug: "blog-page",
  label: "Blog Page",
  ownIdentityFields: ["title", "slug"],
  fields: [
    { type: "text", name: "title", label: "Heading", required: true },
    { type: "text", name: "slug", label: "Path" },
    { type: "text", name: "intro", label: "Intro" },
  ],
} as unknown as SingleSchema;

/** The same fields with Nextly's own title and slug: nothing reported as the author's. */
const systemSchema = {
  slug: "blog-page",
  label: "Blog Page",
  fields: [
    { type: "text", name: "title", label: "Title", required: true },
    { type: "text", name: "slug", label: "Slug", required: true, unique: true },
    { type: "text", name: "intro", label: "Intro" },
  ],
} as unknown as SingleSchema;

const stored = {
  id: "blog-page",
  updatedAt: "2026-11-27T07:46:00.000Z",
  title: HEADING,
  slug: "writing",
  intro: "",
} as unknown as SingleDocumentData;

/** The real DOM document, since `document` names the Single in these tests. */
const document_ = globalThis.document;

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentLock.mockReturnValue({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
  });
});

/** Submits the editor's form and answers what its save sent, once it is sent. */
async function save(
  onSubmit: ReturnType<typeof vi.fn>
): Promise<Record<string, unknown>> {
  const form = document_.querySelector("form");
  expect(form, "the editor renders a form to submit").not.toBeNull();
  fireEvent.submit(form as HTMLFormElement);
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  return onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
}

function titleInput(): HTMLInputElement {
  return screen.getByRole("textbox", { name: /heading|title/i });
}

describe("SingleForm, a Single with its own title and slug", () => {
  it("shows the stored title, editable, and saves it back unchanged", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    render(
      <SingleForm schema={ownSchema} document={stored} onSubmit={onSubmit} />
    );

    await user.type(screen.getByLabelText("Intro"), "Notes");
    const sent = await save(onSubmit);

    // What the save sends first: the stored heading, not the Single's label.
    expect(sent).toMatchObject({
      title: HEADING,
      slug: "writing",
      intro: "Notes",
    });
    expect(titleInput().value).toBe(HEADING);
    expect(titleInput().readOnly).toBe(false);
  });

  it("saves what the author typed into it", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    render(
      <SingleForm schema={ownSchema} document={stored} onSubmit={onSubmit} />
    );

    await user.clear(titleInput());
    await user.type(titleInput(), "Field notes");
    const sent = await save(onSubmit);

    expect(sent).toMatchObject({ title: "Field notes", slug: "writing" });
  });

  it("keeps the field's own required rule", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    render(
      <SingleForm schema={ownSchema} document={stored} onSubmit={onSubmit} />
    );

    await user.clear(titleInput());
    const form = document_.querySelector("form");
    fireEvent.submit(form as HTMLFormElement);

    // Settled, then found not to have been called: a negative `waitFor` would
    // pass before the submission it is meant to catch had run.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("draws its own slug to be edited, so a required one can be filled in and saved", async () => {
    // A required slug of the author's starts empty: nothing fills it with the
    // Single's slug any more. Unless the editor draws it, every save is
    // refused by its required rule with no way to supply a value.
    const requiredSlug = {
      ...ownSchema,
      fields: [
        { type: "text", name: "title", label: "Heading", required: true },
        { type: "text", name: "slug", label: "Path", required: true },
      ],
    } as unknown as SingleSchema;
    const onSubmit = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    render(
      <SingleForm
        schema={requiredSlug}
        document={{ ...stored, slug: "" } as unknown as SingleDocumentData}
        onSubmit={onSubmit}
      />
    );

    await user.type(screen.getByRole("textbox", { name: /path/i }), "notes");
    const sent = await save(onSubmit);

    expect(sent).toMatchObject({ title: HEADING, slug: "notes" });
  });

  it("draws its own slug through the field's own gates: none where it is hidden", () => {
    // Drawn by the field's own control, so its `admin` gates hold as they do
    // for any other field; a hidden slug keeps its stored value unseen.
    const hiddenSlug = {
      ...ownSchema,
      fields: [
        { type: "text", name: "title", label: "Heading", required: true },
        {
          type: "text",
          name: "slug",
          label: "Path",
          admin: { hidden: true },
        },
      ],
    } as unknown as SingleSchema;
    render(
      <SingleForm schema={hiddenSlug} document={stored} onSubmit={vi.fn()} />
    );

    expect(screen.queryByRole("textbox", { name: /path/i })).toBeNull();
    // CONTROL: the same slug, not hidden, is drawn.
    render(
      <SingleForm schema={ownSchema} document={stored} onSubmit={vi.fn()} />
    );
    expect(screen.getByRole("textbox", { name: /path/i })).toHaveValue(
      "writing"
    );
  });
});

describe("SingleForm, a Single with Nextly's own title and slug", () => {
  it("shows the label read-only and saves the label and slug, whatever is stored", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    render(
      <SingleForm schema={systemSchema} document={stored} onSubmit={onSubmit} />
    );

    expect(titleInput().value).toBe("Blog Page");
    expect(titleInput().readOnly).toBe(true);

    await user.type(screen.getByLabelText("Intro"), "Notes");
    const sent = await save(onSubmit);

    expect(sent).toMatchObject({ title: "Blog Page", slug: "blog-page" });
  });
});
