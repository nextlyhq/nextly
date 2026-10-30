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

import { render, screen } from "@admin/__tests__/utils";

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
  documentTitle: "Spring launch",
};

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
        <button type="button" onClick={contributed.binding.onSelect}>
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
