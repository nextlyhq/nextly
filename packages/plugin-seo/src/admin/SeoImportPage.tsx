/**
 * Import, reached from Pages: SEO values brought in from where a site keeps
 * them today, through the import panel (where the values come from, the
 * matching of a group's fields, a dry run that changes nothing, and the
 * import of what the dry run showed, all or nothing).
 *
 * @module admin/SeoImportPage
 */
import { PageFrame, PageHeader } from "@nextlyhq/plugin-sdk/admin";
import type { JSX } from "react";

import { ImportPanel } from "./bulk-import";
import { BulkStyles } from "./bulk-styles";
import { ROOT, SeoStyles } from "./styles";

/** Import, as the admin mounts it. */
export function SeoImportPage(): JSX.Element {
  return (
    <PageFrame type="list">
      <PageHeader
        title="Import"
        description="Bring SEO values in from where the site keeps them today. A dry run shows every value first; the import then sets them all, or none."
      />
      <div className={`${ROOT} max-w-2xl`}>
        <SeoStyles />
        <BulkStyles />
        {/* Pages reads its list afresh each visit, so nothing is read again here. */}
        <ImportPanel onImported={() => {}} />
      </div>
    </PageFrame>
  );
}
