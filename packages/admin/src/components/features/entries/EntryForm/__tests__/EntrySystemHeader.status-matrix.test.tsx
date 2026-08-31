/**
 *
 * Locks the button matrix per lifecycle state:
 *  - hasStatus + create / draft → Save Draft + Publish (Globe icon)
 *  - hasStatus + edit + published clean → Save changes (disabled) + Unpublish
 *  - hasStatus + edit + published dirty → Save changes (enabled) + Unpublish
 *  - !hasStatus → single Save / Create button
 *
 */
import userEvent from "@testing-library/user-event";
import { useForm, FormProvider } from "react-hook-form";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { EntrySystemHeader } from "../EntrySystemHeader";

// The Publish and Unpublish affordances are permission-gated. The matrix cases
// below are about lifecycle state, not authorization, so the caller holds every
// permission by default; the gating cases override this per test.
const { canFor } = vi.hoisted(() => ({
  canFor: vi.fn((_slug: string) => true),
}));
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => canFor(slug),
}));

beforeEach(() => {
  canFor.mockReset();
  canFor.mockImplementation(() => true);
});

interface HarnessProps {
  mode: "create" | "edit";
  hasStatus?: boolean;
  draftsEnabled?: boolean;
  entry?: {
    id: string;
    status?: string;
    title?: string;
    slug?: string;
    _isWorkingDraft?: boolean;
  } | null;
  isDirty?: boolean;
  onDiscardWorkingDraft?: () => void | Promise<void>;
}

function Harness({
  mode,
  hasStatus = true,
  draftsEnabled = false,
  entry = null,
  isDirty = false,
  onDiscardWorkingDraft,
}: HarnessProps) {
  const methods = useForm({ defaultValues: { title: entry?.title ?? "" } });
  return (
    <FormProvider {...methods}>
      <EntrySystemHeader
        mode={mode}
        hasStatus={hasStatus}
        draftsEnabled={draftsEnabled}
        isDirty={isDirty}
        entry={entry}
        collectionSlug="posts"
        onSaveDraft={vi.fn()}
        onPublish={vi.fn()}
        onSaveChanges={vi.fn()}
        onSaveWorkingDraft={vi.fn()}
        onUnpublish={vi.fn()}
        onDiscardWorkingDraft={onDiscardWorkingDraft ?? vi.fn()}
      />
    </FormProvider>
  );
}

describe("EntrySystemHeader — button matrix", () => {
  it("create + hasStatus → Save Draft + Publish", () => {
    render(<Harness mode="create" hasStatus />);
    expect(
      screen.getByRole("button", { name: /^save draft$/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^publish$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^save changes$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^unpublish$/i })
    ).not.toBeInTheDocument();
  });

  it("edit + draft entry → Save Draft + Publish", () => {
    render(
      <Harness
        mode="edit"
        hasStatus
        entry={{ id: "x", status: "draft", title: "Untitled" }}
      />
    );
    expect(
      screen.getByRole("button", { name: /^save draft$/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^publish$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^unpublish$/i })
    ).not.toBeInTheDocument();
  });

  /*
   * UNPUBLISH IS NO LONGER A BUTTON, and the four cases below were rewritten to
   * say so rather than loosened to pass.
   *
   * It sat beside Publish — the two most consequential and opposite verbs in
   * the editor, one slip apart and styled almost alike — and it is rare, public
   * and reversible only by re-publishing. It is now a destructive item in the
   * menu. What is asserted here is the promotion side: the toolbar holds the
   * one action an author is reaching for, and the menu holds the rest.
   * `document-actions.test` covers which actions exist in which state; these
   * cover what the header draws.
   */
  it("edit + published clean → Save changes leads, Unpublish demoted", () => {
    render(
      <Harness
        mode="edit"
        hasStatus
        entry={{ id: "x", status: "published", title: "Live" }}
        isDirty={false}
      />
    );
    const saveChanges = screen.getByRole("button", {
      name: /^save changes$/i,
    });
    expect(saveChanges).toBeInTheDocument();
    expect(saveChanges).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /^unpublish$/i })
    ).not.toBeInTheDocument();
    // It has somewhere to be, though — a verb that vanished entirely would
    // satisfy the line above and take the capability with it.
    expect(
      screen.getByRole("button", { name: /more actions/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^save draft$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^publish$/i })
    ).not.toBeInTheDocument();
  });

  it("edit + published dirty → Save changes leads, enabled", () => {
    render(
      <Harness
        mode="edit"
        hasStatus
        entry={{ id: "x", status: "published", title: "Live" }}
        isDirty
      />
    );
    const saveChanges = screen.getByRole("button", {
      name: /^save changes$/i,
    });
    expect(saveChanges).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /^unpublish$/i })
    ).not.toBeInTheDocument();
  });

  it("!hasStatus → single Save / Create button", () => {
    render(<Harness mode="create" hasStatus={false} />);
    // In create mode the single submit button reads "Create".
    expect(
      screen.getByRole("button", { name: /^create$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^save draft$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^unpublish$/i })
    ).not.toBeInTheDocument();
  });
});

describe("EntrySystemHeader — drafts-enabled working-draft matrix", () => {
  it("published + drafts on, no pending draft → Save leads, no Publish", () => {
    render(
      <Harness
        mode="edit"
        draftsEnabled
        entry={{ id: "x", status: "published", title: "Live" }}
        isDirty
      />
    );
    // The primary save on a drafts collection stores a working draft, so it
    // reads "Save" rather than "Save changes"; nothing is pending to promote.
    expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /^save changes$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^publish$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^unpublish$/i })
    ).not.toBeInTheDocument();
  });

  it("published + drafts on + pending working draft → two controls, not three", () => {
    render(
      <Harness
        mode="edit"
        draftsEnabled
        entry={{
          id: "x",
          status: "published",
          title: "Live",
          _isWorkingDraft: true,
        }}
      />
    );
    /*
     * The state this whole change is about. It drew Save, Publish and Unpublish
     * side by side at equal weight, so an author read three buttons to find the
     * one they wanted. Two now: the act, and the quieter way to keep the work
     * private.
     *
     * The label carries the rest — "Publish changes" rather than "Publish",
     * which on a document already live reads as a no-op and says nothing about
     * the draft it promotes.
     */
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^publish changes$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^unpublish$/i })
    ).not.toBeInTheDocument();
  });
});

describe("EntrySystemHeader — discard working draft menu", () => {
  it("offers Discard draft in the More menu for a Changed document", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        mode="edit"
        draftsEnabled
        entry={{ id: "x", status: "published", _isWorkingDraft: true }}
      />
    );

    await user.click(screen.getByRole("button", { name: /more actions/i }));
    expect(
      screen.getByRole("menuitem", { name: /discard draft/i })
    ).toBeInTheDocument();
  });

  it("hides Discard draft when there is no pending working draft", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        mode="edit"
        draftsEnabled
        entry={{ id: "x", status: "published" }}
      />
    );

    await user.click(screen.getByRole("button", { name: /more actions/i }));
    expect(
      screen.queryByRole("menuitem", { name: /discard draft/i })
    ).not.toBeInTheDocument();
  });

  it("keeps Discard draft without the flat update permission, since a code-first rule may grant it", async () => {
    // The working-draft split is code-first only, so update can be granted by a
    // collection `access.update` rule the flat `update-posts` permission does not
    // list. Gating on that permission would hide Discard from an editor who can
    // save the very draft it reverts; the server authorizes the discard as an
    // update, and the sibling Save affordances are not gated on it either.
    canFor.mockImplementation((slug: string) => slug !== "update-posts");
    const user = userEvent.setup();
    render(
      <Harness
        mode="edit"
        draftsEnabled
        entry={{ id: "x", status: "published", _isWorkingDraft: true }}
      />
    );

    await user.click(screen.getByRole("button", { name: /more actions/i }));
    expect(
      screen.getByRole("menuitem", { name: /discard draft/i })
    ).toBeInTheDocument();
  });

  it("keeps the confirm dialog open when the discard fails, for a retry", async () => {
    // The discard handler rejects on failure, and the header closes the dialog
    // only on success — so a failed destructive request keeps its confirmation
    // (and the error toast from the mutation explains what went wrong).
    const onDiscardWorkingDraft = vi.fn().mockRejectedValue(new Error("nope"));
    const user = userEvent.setup();
    render(
      <Harness
        mode="edit"
        draftsEnabled
        entry={{ id: "x", status: "published", _isWorkingDraft: true }}
        onDiscardWorkingDraft={onDiscardWorkingDraft}
      />
    );

    await user.click(screen.getByRole("button", { name: /more actions/i }));
    await user.click(screen.getByRole("menuitem", { name: /discard draft/i }));
    await user.click(screen.getByRole("button", { name: /^Discard draft$/ }));

    expect(onDiscardWorkingDraft).toHaveBeenCalledOnce();
    // Still open: the rejection was caught and the dialog was not closed.
    expect(
      await screen.findByRole("alertdialog", { name: /discard draft for/i })
    ).toBeInTheDocument();
  });
});

describe("EntrySystemHeader — publish permission gating", () => {
  it("hides Publish for a caller without publish-<slug>, keeping Save Draft", () => {
    // An author who may edit but not publish: the primary action for them is
    // to save a draft, and the server would refuse a publish anyway.
    canFor.mockImplementation((slug: string) => slug !== "publish-posts");

    render(<Harness mode="edit" entry={{ id: "1", status: "draft" }} />);

    expect(
      screen.getByRole("button", { name: /^save draft$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^publish$/i })
    ).not.toBeInTheDocument();
  });

  it("hides Publish in create mode without the permission", () => {
    // Create-as-published requires publish; without it the author creates a
    // draft only.
    canFor.mockImplementation((slug: string) => slug !== "publish-posts");

    render(<Harness mode="create" />);

    expect(
      screen.getByRole("button", { name: /^save draft$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^publish$/i })
    ).not.toBeInTheDocument();
  });

  it("hides Unpublish for a caller without unpublish-<slug>", () => {
    // Editing published content: they may save changes but not take it down.
    canFor.mockImplementation((slug: string) => slug !== "unpublish-posts");

    render(
      <Harness mode="edit" entry={{ id: "1", status: "published" }} isDirty />
    );

    expect(
      screen.getByRole("button", { name: /^save changes$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^unpublish$/i })
    ).not.toBeInTheDocument();
  });

  it("still shows Publish when the permission is held", () => {
    canFor.mockImplementation(() => true);

    render(<Harness mode="edit" entry={{ id: "1", status: "draft" }} />);

    expect(
      screen.getByRole("button", { name: /^publish$/i })
    ).toBeInTheDocument();
  });
});
