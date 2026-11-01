/**
 * When "Schedule publish…" is offered, when it is held and why, and when it
 * is absent: authority over releases and this document decide whether it can
 * be used, and only the document's having a lifecycle decides whether it
 * exists at all.
 *
 * @module components/features/releases/__tests__/SchedulePublishAction.test
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen } from "@admin/__tests__/utils";

import {
  useSchedulePublishAction,
  type SchedulePublishProps,
} from "../SchedulePublishAction";

const { canFor } = vi.hoisted(() => ({
  canFor: vi.fn((_slug: string) => true),
}));

vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => canFor(slug),
}));

const PROPS: SchedulePublishProps = {
  scopeKind: "collection",
  scopeSlug: "posts",
  entryId: "e1",
  lifecycleEnabled: true,
  onDefaultLocale: true,
  documentTitle: () => "Spring launch",
  savesGoLive: false,
};

/** The document as the editor holds it when the action is chosen. */
const EDITED = { values: { headline: "Edited headline" } };

/** What a page would receive, read out of a render, and the dialog mounted. */
function Probe(over: Partial<SchedulePublishProps>) {
  const schedule = useSchedulePublishAction({ ...PROPS, ...over });
  const contributed = schedule.contributed;
  return (
    <div>
      <span data-testid="present">
        {contributed === null ? "absent" : "present"}
      </span>
      <span data-testid="action">
        {contributed === null
          ? "-"
          : `${contributed.action.id}/${contributed.action.placement}/${contributed.action.label}`}
      </span>
      <span data-testid="reason">
        {contributed?.action.disabledReason ?? "none"}
      </span>
      <span data-testid="dialog">
        {schedule.dialog === null ? "no-dialog" : "dialog"}
      </span>
      {contributed === null ? null : (
        <button
          type="button"
          onClick={() => contributed.binding.onSelect(EDITED)}
        >
          open
        </button>
      )}
      {schedule.dialog}
    </div>
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;
const show = (over: Partial<SchedulePublishProps> = {}) =>
  render(<Probe {...over} />);

/** Every grant held, except the ones named. */
function withoutGrants(...missing: string[]) {
  canFor.mockImplementation(slug => !missing.includes(slug));
}

beforeEach(() => {
  canFor.mockReset();
  canFor.mockImplementation(() => true);
});

describe("the action is offered", () => {
  it("on the Publish split's arrow, as Schedule publish…", () => {
    show();
    expect(text("present")).toBe("present");
    expect(text("action")).toBe(
      "schedule-publish/publish-menu/Schedule publish…"
    );
  });

  it("usable, with no reason, by a person who may schedule and publish", () => {
    show();
    expect(text("reason")).toBe("none");
  });
});

describe("the action is held, with the reason", () => {
  it("from a person who may not create releases", () => {
    withoutGrants("create-content-releases");
    show();
    expect(text("present")).toBe("present");
    expect(text("reason")).toBe(
      "You do not have permission to schedule releases."
    );
  });

  it("from a person who may create releases but not schedule them", () => {
    withoutGrants("publish-content-releases");
    show();
    expect(text("reason")).toBe(
      "You do not have permission to schedule releases."
    );
  });

  it("from a person who may not publish this document", () => {
    withoutGrants("publish-posts");
    show();
    expect(text("reason")).toBe(
      "You do not have permission to publish this document."
    );
  });

  it("on a translation, where a release would publish every language", () => {
    show({ onDefaultLocale: false });
    expect(text("reason")).toBe(
      "Schedule publishing from the document's default locale."
    );
  });

  it("naming release permission first, which switching language would not fix", () => {
    withoutGrants("create-content-releases");
    show({ onDefaultLocale: false });
    expect(text("reason")).toBe(
      "You do not have permission to schedule releases."
    );
  });
});

describe("the action is absent", () => {
  it("for a document type with no publish lifecycle", () => {
    show({ lifecycleEnabled: false });
    expect(text("present")).toBe("absent");
  });

  it("before the document exists", () => {
    show({ entryId: undefined });
    expect(text("present")).toBe("absent");
  });
});

describe("the dialog", () => {
  it("is not mounted, nor loaded, until somebody asks for it", async () => {
    show();
    expect(text("dialog")).toBe("no-dialog");
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    expect(
      await screen.findByRole("dialog", { name: "Schedule publish" })
    ).toBeTruthy();
  });
});

describe("the dialog's open state", () => {
  const dialog = () => screen.queryByRole("dialog");

  it("does not carry over to another document, nor reopen on coming back", async () => {
    // The page stays mounted from one document to the next. A dialog left
    // open by navigating away is closed by leaving, so returning does not
    // bring it back unasked.
    const { rerender } = render(<Probe entryId="e1" />);
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    expect(await screen.findByRole("dialog")).not.toBeNull();

    rerender(<Probe entryId="e2" />);
    expect(dialog()).toBeNull();
    rerender(<Probe entryId="e1" />);
    expect(dialog()).toBeNull();
  });

  it("stays open while the document does not change", async () => {
    // The control: a hook closing on every render would pass the case above
    // and could never be kept open.
    const { rerender } = render(<Probe entryId="e1" />);
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    await screen.findByRole("dialog");
    rerender(<Probe entryId="e1" />);
    expect(dialog()).not.toBeNull();
  });
});

describe("what the dialog says about saving before then", () => {
  it("promises later saves go out with the release where saving does not publish", async () => {
    show({ savesGoLive: false });
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(
      "Changes you save before then go out with it."
    );
  });

  it("says saving publishes at once where the document is live and has no drafts", async () => {
    // There, Save writes what readers see: promising the save waits for the
    // release would lead an editor to publish planned content early.
    show({ savesGoLive: true });
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).not.toContain("go out with it");
    expect(dialog.textContent).toContain(
      "It is already published, so changes you save before then go live as soon as you save them."
    );
  });
});

describe("the release's name", () => {
  it("is read from the document as the editor holds it when the action is chosen", async () => {
    // The title being typed is in the form, not the saved entry, and the
    // dialog says changes saved later go out with it: the name it shows and
    // sends is the one on screen.
    show({
      documentTitle: ({ values }) =>
        typeof values.headline === "string" ? values.headline : undefined,
    });
    await userEvent.click(screen.getByRole("button", { name: "open" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Schedule publish",
    });
    expect(dialog.textContent).toContain("Edited headline");
    expect(dialog.textContent).not.toContain("Spring launch");
  });
});

describe("a request on its way", () => {
  it("is never sent a second time by closing and opening the dialog again", async () => {
    // The schedule step makes a new release each time it is asked, so a
    // second request while the first is out would schedule the document
    // twice.
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    try {
      show();
      await userEvent.click(screen.getByRole("button", { name: "open" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(
        dialog.querySelector('button[type="submit"]') as HTMLButtonElement
      );
      await screen.findByRole("button", { name: "Scheduling…" });

      // Every way a person closes a dialog, then the action again.
      await userEvent.keyboard("{Escape}");
      const cancel = screen.queryByRole("button", { name: "Cancel" });
      if (cancel !== null) fireEvent.click(cancel);
      fireEvent.click(
        screen.getByRole("button", { name: "open", hidden: true })
      );

      const again = await screen.findByRole("dialog");
      const send = again.querySelector(
        'button[type="submit"]'
      ) as HTMLButtonElement;
      fireEvent.click(send);
      fireEvent.submit(send.closest("form") as HTMLFormElement);

      // The client sends on a later turn: let anything sent arrive.
      await new Promise(resolve => setTimeout(resolve, 50));
      const posts = fetchMock.mock.calls.filter(
        call =>
          (call as unknown as [string, RequestInit | undefined])[1]?.method ===
          "POST"
      );
      expect(posts).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
