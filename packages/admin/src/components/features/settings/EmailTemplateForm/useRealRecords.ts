import { useCallback, useEffect, useRef, useState } from "react";

import { useSampleRecords } from "@admin/hooks/queries/useEmailTemplates";
import { isApiError } from "@admin/lib/api/parseApiError";
import {
  loadSampleRecord,
  type SampleRecords,
} from "@admin/services/emailTemplateApi";

/** What the Data panel can offer of a template's real records. */
export type RealRecordsOffer =
  /** Still asking the server. */
  | { kind: "asking" }
  /** Nothing to show: a new template, or none offered. */
  | { kind: "none" }
  /** Offered, but this person may not read what they are read from. */
  | { kind: "not-readable" }
  /** Offered, and the list could not be read. */
  | { kind: "failed" }
  | { kind: "offered"; records: SampleRecords };

/**
 * A template's real records, and loading one into the test data. The record
 * is read for the preview and handed to `onLoaded`; nothing is saved. A load
 * that answers after the editor moved to another template is dropped, so one
 * template's record never fills another's test data.
 */
export function useRealRecords(
  templateId: string | undefined,
  onLoaded: (values: Record<string, unknown>) => void
): {
  offer: RealRecordsOffer;
  chosen: string;
  loading: boolean;
  loadError: string | null;
  choose: (recordId: string) => void;
} {
  const records = useSampleRecords(templateId);
  const [chosen, setChosen] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The template the editor shows now, which a load must still be for.
  const current = useRef(templateId);
  useEffect(() => {
    current.current = templateId;
    setChosen("");
    setLoading(false);
    setLoadError(null);
  }, [templateId]);

  const choose = useCallback(
    (recordId: string) => {
      if (!templateId) return;
      const stillCurrent = () => current.current === templateId;
      setChosen(recordId);
      setLoading(true);
      setLoadError(null);
      loadSampleRecord(templateId, recordId)
        .then(values => {
          if (stillCurrent()) onLoaded(values);
        })
        .catch((error: unknown) => {
          if (!stillCurrent()) return;
          setLoadError(
            isApiError(error) && error.status === 404
              ? "That record is no longer there."
              : isApiError(error) && error.status === 403
                ? "You can't read that record."
                : "The record couldn't be read."
          );
        })
        .finally(() => {
          if (stillCurrent()) setLoading(false);
        });
    },
    [templateId, onLoaded]
  );

  return {
    offer: records.isLoading
      ? { kind: "asking" }
      : offerOf(records.data, records.error),
    chosen,
    loading,
    loadError,
    choose,
  };
}

/**
 * What to offer from the latest answer. A refusal or a "none offered" is the
 * server's say now, and wins over records an earlier answer left cached; any
 * other failure keeps what was listed.
 */
function offerOf(
  data: SampleRecords | undefined,
  error: Error | null
): RealRecordsOffer {
  if (isApiError(error) && error.status === 404) return { kind: "none" };
  if (isApiError(error) && error.status === 403) {
    return { kind: "not-readable" };
  }
  if (data) return { kind: "offered", records: data };
  return error ? { kind: "failed" } : { kind: "none" };
}
