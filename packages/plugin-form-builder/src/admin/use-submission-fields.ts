"use client";

/**
 * The fields a site added to its submissions (`formSubmissionOverrides.fields`),
 * as the plugin's `/submission-fields` route answers them: what a submission's
 * page shows in its details beside its own. Read by anyone who may read
 * submissions, so a person without rights to forms still sees them.
 *
 * @module admin/use-submission-fields
 */
import { useQuery } from "@tanstack/react-query";

/** A field a site added to the submissions collection. */
export interface SubmissionExtensionField {
  name: string;
  label: string;
  type: string;
}

const NONE: SubmissionExtensionField[] = [];

/** The site's own submission fields; none until known or if unreadable. */
export function useSubmissionFields(): SubmissionExtensionField[] {
  const { data } = useQuery({
    queryKey: ["form-builder", "submission-fields"],
    queryFn: async (): Promise<SubmissionExtensionField[]> => {
      const response = await fetch(
        "/admin/api/plugins/@nextlyhq/plugin-form-builder/submission-fields",
        { credentials: "include" }
      );
      if (!response.ok) return NONE;
      const body = (await response.json()) as {
        fields?: SubmissionExtensionField[];
      };
      return body.fields ?? NONE;
    },
    staleTime: Infinity,
  });
  return data ?? NONE;
}
