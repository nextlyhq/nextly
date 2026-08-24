/**
 * Collection API Playground Page
 *
 * Accessible via /admin/collections/[slug]/api.
 *
 * A wrapper rather than an implementation: the collection and single routes
 * showed the same page and were kept as two copies, which drifted. The page
 * itself lives in `ApiPlaygroundPage`.
 *
 * @module pages/dashboard/entries/[slug]/api
 * @since 1.0.0
 */

import { ApiPlaygroundPage } from "@admin/components/features/entries/APIPlayground";

interface APIPlaygroundPageProps {
  params?: {
    slug?: string;
  };
}

export default function APIPlaygroundPage({ params }: APIPlaygroundPageProps) {
  return <ApiPlaygroundPage kind="collection" slug={params?.slug} />;
}
