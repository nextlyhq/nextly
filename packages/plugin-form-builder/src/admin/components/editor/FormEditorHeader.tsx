"use client";

/**
 * The form editor's page header: the form's name as the title, its field
 * count and API path as the line under it, and a tab for each page of the
 * editor, drawn as links.
 *
 * @module admin/components/editor/FormEditorHeader
 */
import { PageHeader, PageTab, PageTabs } from "@nextlyhq/ui";
import type { JSX, MouseEvent } from "react";

import { FORM_PAGES, formPageId, type FormPageId } from "../../../form-pages";

/** One tab: its page, where it leads, and the count it shows, if any. */
export interface FormEditorTab {
  page: FormPageId;
  label: string;
  href: string;
  count?: number;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}

export interface FormEditorHeaderProps {
  /** The form's name as edited; a new form with none is "New form". */
  name: string;
  fieldCount: number;
  /** The form's ID (its slug), which its API path ends in. */
  formId: string;
  tabs: readonly FormEditorTab[];
  current: FormPageId;
}

/** How many fields the form has, as the header's line says it. */
function fieldCountText(fieldCount: number): string {
  return `${fieldCount} field${fieldCount === 1 ? "" : "s"}`;
}

/** Where a site reads the form, or `undefined` before it has an ID. */
function formApiPath(formId: string): string | undefined {
  return formId === "" ? undefined : `/api/forms/${formId}`;
}

/**
 * The pages a form's tabs show: every page, less Submissions where it is not
 * offered (a new form has none; a role may not read them).
 */
export function formEditorPages(withSubmissions: boolean): FormPageId[] {
  return FORM_PAGES.map(formPageId).filter(
    page => withSubmissions || page !== "submissions"
  );
}

export function FormEditorHeader({
  name,
  fieldCount,
  formId,
  tabs,
  current,
}: FormEditorHeaderProps): JSX.Element {
  const apiPath = formApiPath(formId);
  return (
    <PageHeader
      title={name.trim() === "" ? "New form" : name}
      description={
        <>
          {fieldCountText(fieldCount)}
          {apiPath === undefined ? null : (
            <>
              {" · "}
              <code className="font-mono text-xs">{apiPath}</code>
            </>
          )}
        </>
      }
      tabs={
        <PageTabs label="Form pages">
          {tabs.map(tab => (
            <PageTab key={tab.page} asChild current={tab.page === current}>
              <a href={tab.href} onClick={tab.onClick}>
                {tab.label}
                {tab.count === undefined ? null : (
                  <span className="ml-2 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm bg-muted px-1 text-[10px] font-semibold tabular-nums text-muted-foreground">
                    {tab.count}
                  </span>
                )}
              </a>
            </PageTab>
          ))}
        </PageTabs>
      }
    />
  );
}
