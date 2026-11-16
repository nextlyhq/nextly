"use client";

/**
 * The Content overview page: every collection and Single the reader may open, in two tables.
 *
 * @module pages/dashboard/content/index
 */
import type { JSX } from "react";

import { ContentOverview } from "@admin/components/features/content-overview/ContentOverview";

export default function ContentOverviewPage(): JSX.Element {
  return <ContentOverview scope="all" />;
}
