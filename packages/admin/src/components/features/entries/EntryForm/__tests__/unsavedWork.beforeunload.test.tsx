/**
 * Work a surface reports reaches the browser's "Leave site?" question: the
 * form's unsaved-changes guard asks it on closing or reloading the tab while
 * any surface says it holds unsaved work, and not otherwise. The page
 * builder reports its site style writes still on their way this way, so a
 * write that would be lost with the page is a question rather than silence.
 *
 * @module components/features/entries/EntryForm/__tests__/unsavedWork.beforeunload.test
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { UnsavedChangesGuard } from "../UnsavedChangesGuard";
import {
  UnsavedWorkProvider,
  useFormUnsavedWork,
  useReportUnsavedWork,
} from "../UnsavedWorkContext";

afterEach(cleanup);

function Surface({ unsaved }: { unsaved: boolean }) {
  useReportUnsavedWork("site-style-writes", unsaved);
  return null;
}

/** A clean form with one surface reporting, as the entry form composes them. */
function Form({ unsaved }: { unsaved: boolean }) {
  const { hasUnsavedWork, report } = useFormUnsavedWork(false);
  return (
    <UnsavedWorkProvider report={report}>
      <UnsavedChangesGuard isDirty={hasUnsavedWork}>
        <Surface unsaved={unsaved} />
      </UnsavedChangesGuard>
    </UnsavedWorkProvider>
  );
}

/** Whether leaving now would be questioned, as the browser decides it. */
function leavingIsQuestioned(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("reported unsaved work and leaving the page", () => {
  it("asks before leaving while a surface reports unsaved work", () => {
    render(<Form unsaved />);
    expect(leavingIsQuestioned()).toBe(true);
  });

  it("lets the page go when nothing is reported", () => {
    render(<Form unsaved={false} />);
    expect(leavingIsQuestioned()).toBe(false);
  });
});
