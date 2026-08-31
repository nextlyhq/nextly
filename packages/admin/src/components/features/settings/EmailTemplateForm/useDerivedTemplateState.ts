/**
 * Everything the editor DERIVES from what has been typed.
 *
 * Pulled out of the form component because none of it is about the form: it is
 * a pure function of the authored fields plus the sample data, and the
 * component was carrying eight interlocking `useMemo`s that obscured the small
 * amount of state it genuinely owns.
 *
 * The interpolation here is a CLIENT-SIDE copy of what the server renders, and
 * it disagrees with the send path — a preheader is missing, a layout's own
 * `year`/`appName` render blank, and the plain-text tab claims there is no text
 * part when one is generated and sent. Isolating it is the step before deleting
 * it in favour of `POST /api/email-templates/preview`, which renders through
 * the same composition the transport uses.
 */
import { useMemo } from "react";

import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import { collectVariableNames, interpolate } from "./interpolate";
import { BUILT_IN_VARIABLES, buildSampleData } from "./sample-data";
import type { TemplateFormVariable } from "./schema";
import { PREVIEW_PALETTE } from "./TemplatePreview";

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
}

export function useDerivedTemplateState({
  variables,
  sampleOverride,
  subject,
  htmlContent,
  plainTextContent,
  useLayout,
  activeLayout,
  isLayoutRow,
}: {
  variables: TemplateFormVariable[] | undefined;
  sampleOverride: string | null;
  subject: string | undefined;
  htmlContent: string | undefined;
  plainTextContent: string | undefined;
  useLayout: boolean;
  activeLayout: EmailTemplateRecord | null;
  isLayoutRow: boolean;
}): DerivedTemplateState {
  const suggestedSample = useMemo(
    () => buildSampleData(variables ?? []),
    [variables]
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

  const previewHtml = useMemo(() => {
    // Split a wrapper at its FIRST {{content}} marker, preserving the rest (a
    // well-formed layout has exactly one). With no marker, the body is appended
    // after the wrapper so nothing is silently dropped.
    const CONTENT_MARKER = "{{content}}";
    const splitLayout = (wrapper: string): [string, string] => {
      const i = wrapper.indexOf(CONTENT_MARKER);
      return i === -1
        ? [wrapper, ""]
        : [wrapper.slice(0, i), wrapper.slice(i + CONTENT_MARKER.length)];
    };

    // A layout row previews its own wrapper with a stand-in body at the
    // {{content}} placeholder so authors can see where content lands.
    if (isLayoutRow) {
      const [before, after] = splitLayout(htmlContent ?? "");
      const head = interpolate(before, sampleData, false);
      const tail = interpolate(after, sampleData, false);
      const sampleBody = `<p style="color:${PREVIEW_PALETTE.sample};font-style:italic;">Your email content appears here.</p>`;
      return `${head}${sampleBody}${tail}`;
    }

    const body = interpolate(htmlContent ?? "", sampleData, true);
    if (!useLayout || !activeLayout) return body;
    const [before, after] = splitLayout(activeLayout.htmlContent);
    const head = interpolate(before, sampleData, false);
    const tail = interpolate(after, sampleData, false);
    return `${head}${body}${tail}`;
  }, [htmlContent, sampleData, useLayout, activeLayout, isLayoutRow]);

  const previewText = useMemo(
    () => interpolate(plainTextContent ?? "", sampleData, false),
    [plainTextContent, sampleData]
  );
  const previewSubject = useMemo(
    () => interpolate(subject ?? "", sampleData, false),
    [subject, sampleData]
  );

  return {
    sampleText,
    sampleData,
    sampleError,
    unknownVariables,
    previewHtml,
    previewText,
    previewSubject,
  };
}
