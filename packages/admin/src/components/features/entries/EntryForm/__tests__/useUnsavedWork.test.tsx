/**
 * A field reporting that it holds work the form cannot see.
 *
 * The page builder keeps its document outside the form and commits on exit, so
 * through an entire editing session the form is not dirty — and the guard, the
 * save shortcut and the header are all wrong in the same direction. These cases
 * pin the reporting, and in particular the retraction, which is what stops a
 * closed editor leaving a form permanently unsaved.
 *
 * @module components/features/entries/EntryForm/__tests__/useUnsavedWork.test
 */
import { act, render, renderHook, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  UnsavedWorkProvider,
  useFormUnsavedWork,
  useReportUnsavedWork,
  useUnsavedWork,
} from "../UnsavedWorkContext";

describe("useUnsavedWork", () => {
  it("is quiet until something reports", () => {
    const { result } = renderHook(useUnsavedWork);

    expect(result.current.anyUnsaved).toBe(false);
  });

  it("says so once a surface reports", () => {
    const { result } = renderHook(useUnsavedWork);

    act(() => result.current.report("blocks:layout", true));

    expect(result.current.anyUnsaved).toBe(true);
  });

  it("goes quiet again when it retracts", () => {
    const { result } = renderHook(useUnsavedWork);

    act(() => result.current.report("blocks:layout", true));
    act(() => result.current.report("blocks:layout", false));

    expect(result.current.anyUnsaved).toBe(false);
  });

  it("keeps one surface's work when ANOTHER retracts", () => {
    // Two blocks fields on one page is an ordinary schema. A single boolean
    // would let the second to finish clear the first one's work.
    const { result } = renderHook(useUnsavedWork);

    act(() => result.current.report("blocks:hero", true));
    act(() => result.current.report("blocks:body", true));
    act(() => result.current.report("blocks:body", false));

    expect(result.current.anyUnsaved).toBe(true);
  });

  it("does not re-render ONCE PER report that changes nothing", () => {
    /*
     * A surface reporting on every edit would otherwise re-render the whole
     * form on every keystroke.
     *
     * "At most one more" rather than "no more", because React documents that a
     * `setState` returning the identical value may still render that component
     * once before bailing out. What must not happen is a render PER report,
     * which is what the count below separates: five identical reports move the
     * count by at most one.
     */
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useUnsavedWork();
    });

    act(() => result.current.report("blocks:layout", true));
    const afterFirst = renders;
    for (let i = 0; i < 5; i += 1) {
      act(() => result.current.report("blocks:layout", true));
    }

    expect(renders).toBeLessThanOrEqual(afterFirst + 1);
  });
});

/** A surface that reports while mounted, so the retraction can be observed. */
function Surface({ unsaved }: { unsaved: boolean }) {
  useReportUnsavedWork("blocks:layout", unsaved);
  return <span>surface</span>;
}

function Harness({ children }: { children: (state: boolean) => ReactNode }) {
  const work = useUnsavedWork();
  return (
    <UnsavedWorkProvider report={work.report}>
      <output>{work.anyUnsaved ? "unsaved" : "clean"}</output>
      {children(work.anyUnsaved)}
    </UnsavedWorkProvider>
  );
}

describe("useReportUnsavedWork", () => {
  it("reports through the provider", () => {
    render(<Harness>{() => <Surface unsaved />}</Harness>);

    expect(screen.getByRole("status").textContent).toBe("unsaved");
  });

  it("RETRACTS when the surface unmounts", () => {
    /*
     * The handoff that makes this safe. The page builder commits its document
     * on the way out, so the form goes dirty in the same moment this stops
     * claiming anything — and without the retraction a closed editor would
     * leave the form permanently unsaved, warning on every navigation forever.
     */
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <Harness>
          {() => (
            <>
              {open ? <Surface unsaved /> : null}
              <button type="button" onClick={() => setOpen(false)}>
                close
              </button>
            </>
          )}
        </Harness>
      );
    }
    render(<Host />);
    expect(screen.getByRole("status").textContent).toBe("unsaved");

    act(() => screen.getByRole("button", { name: "close" }).click());

    expect(screen.getByRole("status").textContent).toBe("clean");
  });

  it("says nothing when the surface has no unsaved work", () => {
    render(<Harness>{() => <Surface unsaved={false} />}</Harness>);

    expect(screen.getByRole("status").textContent).toBe("clean");
  });

  it("renders outside a form without complaining", () => {
    // A field also renders in previews and pickers, where nobody is asking.
    expect(() => render(<Surface unsaved />)).not.toThrow();
  });
});

describe("useFormUnsavedWork", () => {
  it("is unsaved when the FORM is dirty and nothing reported", () => {
    const { result } = renderHook(() => useFormUnsavedWork(true));

    expect(result.current.hasUnsavedWork).toBe(true);
  });

  it("is unsaved when a FIELD reported and the form is clean", () => {
    // The case the whole seam exists for: the page builder holds its document
    // outside the form, so the form is clean while real work is outstanding.
    const { result } = renderHook(() => useFormUnsavedWork(false));

    act(() => result.current.report("blocks:layout", true));

    expect(result.current.hasUnsavedWork).toBe(true);
  });

  it("is clean only when NEITHER says otherwise", () => {
    const { result } = renderHook(() => useFormUnsavedWork(false));

    expect(result.current.hasUnsavedWork).toBe(false);

    // And a field retracting does not clear a dirty form, which is the other
    // direction: the two sources are combined, not swapped.
    act(() => result.current.report("blocks:layout", true));
    act(() => result.current.report("blocks:layout", false));
    expect(result.current.hasUnsavedWork).toBe(false);
  });

  it("keeps saying unsaved while the form is dirty, whatever a field retracts", () => {
    const { result } = renderHook(() => useFormUnsavedWork(true));

    act(() => result.current.report("blocks:layout", true));
    act(() => result.current.report("blocks:layout", false));

    expect(result.current.hasUnsavedWork).toBe(true);
  });
});
