/**
 * Everything the editor DERIVES from what has been typed.
 *
 * Split along one line: what the SERVER must answer, and what only the browser
 * can. Rendering is the server's — the fields go to
 * `POST /api/email-templates/preview`, which composes them through the same
 * function the transport uses, so the preview cannot disagree with what is
 * sent. Interpreting the sample-data JSON and spotting variables that resolve
 * to nothing is the browser's: both are properties of the text on screen, and
 * a round-trip would only make the feedback slower.
 *
 * A client-side copy of the render lived here and had already drifted: it
 * omitted the preheader entirely, and it reported an empty plain-text part for
 * every template that does not author one, when the send path derives that
 * text from the body and delivers it.
 */
import { useMemo } from "react";

import type {
  DraftPreviewTemplate,
  EmailTemplateKind,
} from "@admin/services/emailTemplateApi";

import { collectVariableNames } from "./interpolate";
import { BUILT_IN_VARIABLES, buildSampleData } from "./sample-data";
import type { TemplateFormVariable } from "./schema";
import { useDraftPreview } from "./useDraftPreview";

export interface DerivedTemplateState {
  /** Sample JSON as edited, or as derived from the declared variables. */
  sampleText: string;
  sampleData: Record<string, unknown>;
  sampleError: string | null;
  /** Referenced in the body or subject, but neither declared nor sampled. */
  unknownVariables: string[];
  previewHtml: string;
  previewText: string;
  previewSubject: string;
  /** A render is in flight and no earlier one is being shown in its place. */
  isPreviewPending: boolean;
  /** The render was refused or unreachable; the pane says so rather than lying. */
  previewError: string | null;
}

export function useDerivedTemplateState({
  variables,
  sampleOverride,
  subject,
  htmlContent,
  plainTextContent,
  preheader,
  useLayout,
  layoutId,
  kind,
}: {
  variables: TemplateFormVariable[] | undefined;
  sampleOverride: string | null;
  subject: string | undefined;
  htmlContent: string | undefined;
  plainTextContent: string | undefined;
  preheader: string | undefined;
  useLayout: boolean;
  layoutId: string | undefined;
  kind: EmailTemplateKind;
}): DerivedTemplateState {
  const isLayoutRow = kind === "layout";

  const suggestedSample = useMemo(
    () => buildSampleData(variables ?? [], { isLayoutRow }),
    [variables, isLayoutRow]
  );
  const sampleText = sampleOverride ?? JSON.stringify(suggestedSample, null, 2);
  const { sampleData, sampleError } = useMemo<{
    sampleData: Record<string, unknown>;
    sampleError: string | null;
  }>(() => {
    try {
      const parsed: unknown = JSON.parse(sampleText);
      // `JSON.parse("null")` / arrays / primitives succeed but then crash the
      // downstream `Object.keys(sampleData)`; require a plain object.
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Sample data must be a JSON object.");
      }
      return {
        sampleData: parsed as Record<string, unknown>,
        sampleError: null,
      };
    } catch (e) {
      return {
        sampleData: {},
        sampleError:
          e instanceof Error ? e.message : "Invalid JSON in sample data.",
      };
    }
  }, [sampleText]);

  const knownNames = useMemo(() => {
    const set = new Set<string>(BUILT_IN_VARIABLES.map(v => v.name));
    for (const v of variables ?? []) if (v.name) set.add(v.name);
    for (const k of Object.keys(sampleData)) set.add(k);
    return set;
  }, [variables, sampleData]);

  const unknownVariables = useMemo(() => {
    const referenced = new Set<string>([
      ...collectVariableNames(subject ?? ""),
      ...collectVariableNames(htmlContent ?? ""),
    ]);
    return [...referenced].filter(n => !knownNames.has(n.split(".")[0]));
  }, [subject, htmlContent, knownNames]);

  /*
   * Exactly the route's schema, and nothing beyond it. Assembled as one object
   * so the debounce and the query key both track the whole render input: a
   * key that tracked only the body would serve a stale subject.
   */
  const draft = useMemo<DraftPreviewTemplate>(
    () => ({
      subject: subject ?? "",
      htmlContent: htmlContent ?? "",
      plainTextContent: plainTextContent ?? null,
      preheader: preheader ?? null,
      useLayout,
      kind,
      layoutId: layoutId ?? null,
    }),
    [
      subject,
      htmlContent,
      plainTextContent,
      preheader,
      useLayout,
      kind,
      layoutId,
    ]
  );

  const {
    previewHtml,
    previewText,
    previewSubject,
    isPreviewPending,
    previewError,
  } = useDraftPreview(
    /*
     * `null` while the sample JSON is unparseable: sending `{}` would preview
     * against values the author cannot see. Carried INSIDE the snapshot rather
     * than as a separate `enabled` flag, so the decision and the payload are
     * debounced together — see `DraftPreviewRequest`.
     */
    sampleError === null ? { draft, data: sampleData } : null
  );

  return {
    sampleText,
    sampleData,
    sampleError,
    unknownVariables,
    previewHtml,
    previewText,
    previewSubject,
    isPreviewPending,
    previewError,
  };
}
