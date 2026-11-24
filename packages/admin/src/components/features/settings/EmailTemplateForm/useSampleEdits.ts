import { useMemo, useState } from "react";

import { editedValues, recordValues, type SampleEdits } from "./sample-data";

/** One template's edits, and the names its last record filled. */
interface TemplateEdits {
  /** The template the edits are for; undefined for one not saved yet. */
  templateId: string | undefined;
  edits: SampleEdits | null;
  /** Names the last record gave and the author hasn't edited since. */
  fromRecord: ReadonlySet<string>;
}

/**
 * The author's edits to the test data, and each way the Data panel makes one.
 * They belong to `templateId`: an editor moved to another template starts
 * with none, so one template's record never fills another's preview or test.
 */
export function useSampleEdits(
  variables: ReadonlyArray<{ name: string }>,
  templateId: string | undefined
): {
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
  const [state, setState] = useState<TemplateEdits>(() => none(templateId));
  const handlers = useMemo(() => {
    const change = (
      next: (current: TemplateEdits) => Omit<TemplateEdits, "templateId">
    ) =>
      setState(held => ({
        ...next(held.templateId === templateId ? held : none(templateId)),
        templateId,
      }));
    return {
      onFieldChange: (name: string, value: unknown) =>
        change(current => ({
          edits: { values: { ...editedValues(current.edits), [name]: value } },
          fromRecord: withoutName(current.fromRecord, name),
        })),
      onJsonChange: (json: string) =>
        change(() => ({ edits: { json }, fromRecord: new Set() })),
      onReset: () => change(() => none(templateId)),
      onRecord: (values: Record<string, unknown>) =>
        change(current => {
          const given = recordValues(values, variables);
          return {
            edits: {
              values: {
                ...withoutNames(
                  editedValues(current.edits),
                  current.fromRecord
                ),
                ...given,
              },
            },
            fromRecord: new Set(Object.keys(given)),
          };
        }),
    };
  }, [variables, templateId]);
  return {
    sampleEdits: state.templateId === templateId ? state.edits : null,
    ...handlers,
  };
}

/** No edits, for a template. */
function none(templateId: string | undefined): TemplateEdits {
  return { templateId, edits: null, fromRecord: new Set() };
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
