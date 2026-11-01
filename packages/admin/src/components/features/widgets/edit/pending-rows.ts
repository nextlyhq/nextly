/**
 * The rows a settings panel's controls hold begun and not finished, such as a filter row added
 * and left blank. Such a row writes nothing to the form, so the panel's stored draft cannot tell
 * it is there; each control says so here instead, and the panel counts it as a change: the
 * dashboard's Save and the leave prompts then ask about it, and staging refuses it as Done does.
 *
 * @module components/features/widgets/edit/pending-rows
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type Context,
} from "react";

/** Says whether the setting `name` holds a row begun and not finished. */
type ReportPending = (name: string, pending: boolean) => void;

/** Where a panel's controls report their unfinished rows; outside a panel, nowhere. */
export const PendingRowsContext: Context<ReportPending> =
  createContext<ReportPending>(() => undefined);

/** Report, for the setting `name`, whether it holds an unfinished row, and that it holds none once unmounted. */
export function useReportPendingRow(name: string, pending: boolean): void {
  const report = useContext(PendingRowsContext);
  useEffect(() => {
    report(name, pending);
  }, [report, name, pending]);
  useEffect(() => () => report(name, false), [report, name]);
}

/** The panel's side: whether any of its settings holds an unfinished row, and how they say so. */
export function usePendingRows(): {
  anyPending: boolean;
  report: ReportPending;
} {
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const report = useCallback<ReportPending>((name, isPending) => {
    setPending(previous => {
      if (previous.has(name) === isPending) return previous;
      const next = new Set(previous);
      if (isPending) next.add(name);
      else next.delete(name);
      return next;
    });
  }, []);
  return { anyPending: pending.size > 0, report };
}
