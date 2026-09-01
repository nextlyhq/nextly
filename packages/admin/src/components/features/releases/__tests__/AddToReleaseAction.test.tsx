/**
 * When adding to a release is OFFERED, when it is EXPLAINED, and when it is
 * absent entirely.
 *
 * The three used to be two. Every condition that could refuse this write also
 * removed the control, so an author who lacked the document's publish grant, or
 * who was editing a translation, saw nothing at all — indistinguishable from a
 * site with no releases feature. The distinction this file now draws is:
 * authority over the FEATURE decides whether the action exists, and facts about
 * THIS DOCUMENT decide whether it can be used, with a reason attached.
 *
 * Each case was originally found in review rather than by anything failing,
 * because a control that should not be there looks exactly like one that
 * should: nothing errors, and the refusal arrives only after an editor has
 * filled the dialog in.
 *
 * TWO CASES WERE REMOVED as obsolete rather than repaired: "opens the dialog
 * WITHOUT submitting the document" and "says so on the element rather than
 * relying on where it is mounted". Both guarded a `type="button"` on a trigger
 * rendered inside the editor's own `<form>`, where a `<button>` with no type
 * defaults to `submit`. There is no trigger element any more — the action is a
 * description the editor renders as a menu item, outside the form — so the
 * hazard is retired by construction and there is nothing left to assert it on.
 *
 * @module components/features/releases/__tests__/AddToReleaseAction.test
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import {
  useAddToReleaseAction,
  type AddToReleaseProps,
} from "../AddToReleaseAction";

const { canFor, listReleases } = vi.hoisted(() => ({
  canFor: vi.fn((_slug: string) => true),
  listReleases: vi.fn(),
}));

vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => canFor(slug),
}));

// The queries are observed rather than stubbed away, because one of the cases
// below is about whether they are ISSUED at all.
vi.mock("@admin/hooks/queries/useReleases", () => ({
  useReleases: (params: unknown, enabled = true) => {
    listReleases(params, enabled);
    return { data: undefined, isPending: false, isError: false };
  },
  useAddReleaseMember: () => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

const PROPS: AddToReleaseProps = {
  scopeKind: "collection",
  scopeSlug: "posts",
  entryId: "e1",
  lifecycleEnabled: true,
  onDefaultLocale: true,
};

/**
 * Reports what a PAGE would receive, read out of a render.
 *
 * The hook's whole output is a description a page hands to the editor's action
 * model, so asserting on the rendered report keeps the test on the value a
 * consumer actually gets rather than on a return value nothing consumes.
 */
function Probe(over: Partial<AddToReleaseProps>) {
  const release = useAddToReleaseAction({ ...PROPS, ...over });
  return (
    <div>
      <span data-testid="present">
        {release.contributed === null ? "absent" : "present"}
      </span>
      <span data-testid="placement">
        {release.contributed === null
          ? "-"
          : `${release.contributed.action.placement}/${release.contributed.action.group ?? "-"}`}
      </span>
      <span data-testid="label">
        {release.contributed?.action.label ?? "-"}
      </span>
      <span data-testid="reason">
        {release.contributed?.action.disabledReason ?? "none"}
      </span>
      <span data-testid="dialog">
        {release.dialog === null ? "no-dialog" : "dialog"}
      </span>
      {/* Mounted, as a page mounts it. The picker's protected queries live in
          the dialog, so a probe that only reported its presence would assert
          about requests nothing had the chance to issue. */}
      {release.dialog}
    </div>
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;
const show = (over: Partial<AddToReleaseProps> = {}) =>
  render(<Probe {...over} />);

beforeEach(() => {
  canFor.mockReset();
  canFor.mockImplementation(() => true);
  listReleases.mockReset();
});

describe("the action is offered", () => {
  it("to a caller who can assemble and publish this document", () => {
    show();
    expect(text("present")).toBe("present");
    expect(text("label")).toBe("Add to release");
  });

  it("as a menu action, not a toolbar button", () => {
    /*
     * The placement is the point of contributing a description rather than a
     * control. Scheduling a release is a document-management act like Duplicate,
     * and as a toolbar button it also widened the action cluster — which is what
     * pushed Save under the version-history panel.
     */
    show();
    expect(text("placement")).toBe("menu/document");
  });

  it("carrying no reason when it can actually be used", () => {
    // The control for every reason case below: a hook that attached one
    // unconditionally would satisfy them all while disabling a usable action.
    show();
    expect(text("reason")).toBe("none");
  });
});

describe("the action is absent, because the FEATURE does not apply", () => {
  it("when the collection has no publish lifecycle", () => {
    // A member performs a publish or unpublish; there is no such write to
    // schedule, so there is no action to explain.
    show({ lifecycleEnabled: false });
    expect(text("present")).toBe("absent");
  });

  it("when the caller cannot assemble releases at all", () => {
    canFor.mockImplementation(slug => slug !== "create-content-releases");
    show();
    expect(text("present")).toBe("absent");
  });

  it("mounts no dialog either, so a page rendering it draws nothing", () => {
    // The page mounts `release.dialog` unconditionally. Returning a dialog for
    // an action that does not exist would leave a surface nothing can open.
    show({ lifecycleEnabled: false });
    expect(text("dialog")).toBe("no-dialog");
  });
});

describe("the action is offered but EXPLAINED, because this document refuses", () => {
  it("when the caller can neither publish nor unpublish the document", () => {
    /*
     * Previously absent. An author holding release authority but not this
     * document's lifecycle grants saw nothing, and could not tell that from the
     * feature being switched off.
     */
    canFor.mockImplementation(
      slug => slug !== "publish-posts" && slug !== "unpublish-posts"
    );
    show();
    expect(text("present")).toBe("present");
    expect(text("reason")).toMatch(/permission/i);
  });

  it("when the editor is on a translation rather than the default locale", () => {
    /*
     * A member is whole-document: the service refuses a locale-scoped one, so
     * adding from a translation would schedule every locale while every other
     * control on the screen acts on the one being edited. Saying so beats
     * vanishing, because the way out — switch to the default locale — is
     * something an author can act on.
     */
    show({ onDefaultLocale: false });
    expect(text("present")).toBe("present");
    expect(text("reason")).toMatch(/default locale/i);
  });
});

describe("the protected queries", () => {
  it("are not issued while the dialog is closed", () => {
    // These are gated endpoints. Mounting them unconditionally made every
    // editor visit issue requests for a picker nobody had opened — and, for a
    // reader without the grant, a pair of 403s per visit.
    show();
    expect(listReleases).toHaveBeenCalled();
    for (const call of listReleases.mock.calls) {
      expect(call[1], "enabled").toBe(false);
    }
  });

  it("are not issued to a caller who may not read releases", () => {
    canFor.mockImplementation(slug => slug !== "read-content-releases");
    show();
    for (const call of listReleases.mock.calls) {
      expect(call[1], "enabled").toBe(false);
    }
  });
});
