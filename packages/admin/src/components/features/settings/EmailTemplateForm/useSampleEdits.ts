import { useMemo, useState } from "react";

import { editedValues, recordValues, type SampleEdits } from "./sample-data";

/** The author's edits to the test data, and each way the Data panel makes one. */
export function useSampleEdits(variables: ReadonlyArray<{ name: string }>): {
  sampleEdits: SampleEdits | null;
  /** One field's value, set from the fields. */
  onFieldChange: (name: string, value: unknown) => void;
  /** The JSON as typed, which is then the whole data. */
  onJsonChange: (json: string) => void;
  onReset: () => void;
  /** A real record's values, filling the declared variables. */
  onRecord: (values: Record<string, unknown>) => void;
} {
  const [sampleEdits, setSampleEdits] = useState<SampleEdits | null>(null);
  const handlers = useMemo(
    () => ({
      onFieldChange: (name: string, value: unknown) =>
        setSampleEdits(current => ({
          values: { ...editedValues(current), [name]: value },
        })),
      onJsonChange: (json: string) => setSampleEdits({ json }),
      onReset: () => setSampleEdits(null),
      onRecord: (values: Record<string, unknown>) =>
        setSampleEdits(current => ({
          values: {
            ...editedValues(current),
            ...recordValues(values, variables),
          },
        })),
    }),
    [variables]
  );
  return { sampleEdits, ...handlers };
}
