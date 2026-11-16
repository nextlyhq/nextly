/**
 * The diagnostics report for System health: read for Details, where it is
 * shown as "What Copy diagnostics copies", and copied by "Copy diagnostics".
 *
 * Copying asks for a fresh report and writes it to the clipboard
 * (`copyReport`), then says what happened: copied; refused, when Details opens
 * with the report selected for the reader to copy by hand; or not built.
 */

import { type MutableRefObject, useCallback, useRef, useState } from "react";

import { toast } from "@admin/components/ui";

import {
  COPIED_MESSAGE,
  copyReport,
  fetchDiagnosticsReport,
  REFUSED_MESSAGE,
  UNBUILT_MESSAGE,
} from "./copy-diagnostics";

/** How long the refusal's message stays: long enough to read and act on. */
const REFUSED_TOAST_MS = 12_000;

/** The report as Details shows it; the last text is kept while it is read again. */
export interface DiagnosticsReportState {
  status: "idle" | "loading" | "ready" | "failed";
  text?: string;
}

export interface CopyDiagnostics {
  report: DiagnosticsReportState;
  /** Reads the report again, for Details. */
  load: () => Promise<string>;
  /** Builds and copies the report, and says what happened. */
  copy: () => Promise<void>;
  /** A copy is in flight. */
  copying: boolean;
  /**
   * Whether Details should select the report when it is next drawn: set when
   * the clipboard refused it, and cleared by the one who selects it.
   */
  selectPending: MutableRefObject<boolean>;
  /** Counts the refusals, so a Details already open selects the report again. */
  selectRequest: number;
}

/**
 * The report and its copy, for one card.
 *
 * @param showRefused - Opens Details, where the refused report is selected.
 */
export function useCopyDiagnostics(showRefused: () => void): CopyDiagnostics {
  const [report, setReport] = useState<DiagnosticsReportState>({
    status: "idle",
  });
  const [copying, setCopying] = useState(false);
  const selectPending = useRef(false);
  const [selectRequest, setSelectRequest] = useState(0);
  // Only the latest read's answer is kept: an earlier one that arrives later
  // would show a report older than the one already shown.
  const latest = useRef(0);

  const load = useCallback((): Promise<string> => {
    const asked = ++latest.current;
    setReport(previous => ({ status: "loading", text: previous.text }));
    const read = fetchDiagnosticsReport();
    read.then(
      text => {
        if (asked === latest.current) setReport({ status: "ready", text });
      },
      () => {
        if (asked === latest.current) setReport({ status: "failed" });
      }
    );
    return read;
  }, []);

  const inFlight = useRef(false);
  const copy = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setCopying(true);
    try {
      const outcome = await copyReport(load());
      if (outcome === "copied") {
        toast.success(COPIED_MESSAGE);
      } else {
        selectPending.current = true;
        setSelectRequest(count => count + 1);
        showRefused();
        toast.info(REFUSED_MESSAGE, { duration: REFUSED_TOAST_MS });
      }
    } catch {
      toast.error(UNBUILT_MESSAGE);
    } finally {
      inFlight.current = false;
      setCopying(false);
    }
  }, [load, showRefused]);

  return { report, load, copy, copying, selectPending, selectRequest };
}
