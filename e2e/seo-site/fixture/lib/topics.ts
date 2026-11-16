/**
 * The topics `/topics/[topic]` declares through `generateStaticParams`. A
 * topic with no posts answers not found, as a site's topic page does before
 * anything is written under it.
 */
export const TOPICS: Record<string, string[]> = {
  guides: ["Getting started", "Writing a good title"],
  news: ["The site is open"],
  empty: [],
};
