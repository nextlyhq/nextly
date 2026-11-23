import { useMemo, useRef, useState } from "react";

import { editedValues, recordValues, type SampleEdits } from "./sample-data";

/** The author's edits to the test data, and each way the Data panel makes one. */
export function useSampleEdits(variables: ReadonlyArray<{ name: string }>): {
  sampleEdits: SampleEdits | null;
  /** One field's value, set from the fields. */
  onFieldChange: (name: string, value: unknown) => void;
  /** The JSON as typed, which is then the whole data. */
  onJsonChange: (json: string) => void;
  onReset: () => void;
  /**
   * A real record's values, filling the declared variables. They replace the
   * last record's: a value only the last record gave is dropped, so the data
   * is never two records at once.
   */
  onRecord: (values: Record<string, unknown>) => void;
} {
  const [sampleEdits, setSampleEdits] = useState<SampleEdits | null>(null);
  // The names whose values the last record gave and the author hasn't edited
  // since.
  const fromRecord = useRef<ReadonlySet<string>>(new Set());
  const handlers = useMemo(
    () => ({
      onFieldChange: (name: string, value: unknown) => {
        fromRecord.current = withoutName(fromRecord.current, name);
        setSampleEdits(current => ({
          values: { ...editedValues(current), [name]: value },
        }));
      },
      onJsonChange: (json: string) => {
        fromRecord.current = new Set();
        setSampleEdits({ json });
      },
      onReset: () => {
        fromRecord.current = new Set();
        setSampleEdits(null);
      },
      onRecord: (values: Record<string, unknown>) => {
        const given = recordValues(values, variables);
        const replaced = fromRecord.current;
        fromRecord.current = new Set(Object.keys(given));
        setSampleEdits(current => ({
          values: {
            ...withoutNames(editedValues(current), replaced),
            ...given,
          },
        }));
      },
    }),
    [variables]
  );
  return { sampleEdits, ...handlers };
}

function withoutName(names: ReadonlySet<string>, name: string): Set<string> {
  const kept = new Set(names);
  kept.delete(name);
  return kept;
}

function withoutNames(
  values: Record<string, unknown>,
  names: ReadonlySet<string>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([name]) => !names.has(name))
  );
}
