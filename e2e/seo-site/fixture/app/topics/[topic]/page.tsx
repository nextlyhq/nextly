/**
 * A dynamic route built in code, declaring its pages through
 * `generateStaticParams` wrapped in `seoStaticParams`, as the SEO plugin's
 * guide shows. A topic with no posts answers not found.
 */
import { seoMetadata, seoStaticParams } from "@nextlyhq/plugin-seo";
import { notFound } from "next/navigation";

import { TOPICS } from "../../../lib/topics";

export const generateStaticParams = seoStaticParams("/topics/[topic]", () =>
  Object.keys(TOPICS).map(topic => ({ topic }))
);

type Props = { params: Promise<{ topic: string }> };

export async function generateMetadata({ params }: Props) {
  const { topic } = await params;
  return seoMetadata(`/topics/${topic}`, { metadata: { title: topic } });
}

export default async function TopicPage({ params }: Props) {
  const { topic } = await params;
  const posts = TOPICS[topic] ?? [];
  if (posts.length === 0) notFound();
  return (
    <main>
      <h1>{topic}</h1>
      <ul>
        {posts.map(post => (
          <li key={post}>{post}</li>
        ))}
      </ul>
    </main>
  );
}
