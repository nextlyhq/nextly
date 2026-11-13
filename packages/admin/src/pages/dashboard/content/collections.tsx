"use client";

/**
 * The Collections overview page: the Content overview with only its Collections table.
 *
 * @module pages/dashboard/content/collections
 */
import type { JSX } from "react";

import { ContentOverview } from "@admin/components/features/content-overview/ContentOverview";

export default function CollectionsOverviewPage(): JSX.Element {
  return <ContentOverview scope="collections" />;
}
