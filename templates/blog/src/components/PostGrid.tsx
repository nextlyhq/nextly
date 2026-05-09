import { PostCard } from "./PostCard";

import type { Post } from "@/lib/queries/types";

/**
 * PostGrid - responsive grid layout for PostCards.
 * 1 column on mobile, 2 on tablet, 3 on desktop.
 */

interface PostGridProps {
  posts: Post[];
}

export function PostGrid({ posts }: PostGridProps) {
  if (posts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 px-6 py-16 text-center dark:border-neutral-700">
        <p className="text-neutral-500 dark:text-neutral-400">
          No posts yet. Create your first post in the admin panel.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-12 sm:grid-cols-2 lg:grid-cols-3">
      {posts.map(post => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}
