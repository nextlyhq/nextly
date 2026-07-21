/**
 * EmptyState component for displaying a friendly message when there's no data
 *
 * Used across listing pages (blog, categories, tags) to show a proper
 * fallback instead of errors or blank screens.
 */

interface EmptyStateProps {
  type?: "posts" | "category" | "tag" | "search";
  entityName?: string;
}

export function EmptyState({ type = "posts", entityName }: EmptyStateProps) {
  const messages = {
    posts: {
      icon: (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
        />
      ),
      title: "No posts yet",
      description: "Posts will appear here once they're published.",
    },
    category: {
      icon: (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
        />
      ),
      title: `No posts in ${entityName || "this category"}`,
      description: "Be the first to publish a post in this category.",
    },
    tag: {
      icon: (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
        />
      ),
      title: `No posts tagged with "${entityName || "this tag"}"`,
      description: "Be the first to publish a post with this tag.",
    },
    search: {
      icon: (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      ),
      title: "No results found",
      description: "Try adjusting your search terms or browse our categories.",
    },
  };

  const { icon, title, description } = messages[type];

  return (
    <div
      className="flex flex-col items-center justify-center py-24 px-6 text-center"
      style={{ color: "var(--color-fg-muted)" }}
    >
      <div
        className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-full"
        style={{
          background: "var(--color-bg)",
          border: "1px solid var(--color-border)",
        }}
      >
        <svg
          className="h-8 w-8"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          {icon}
        </svg>
      </div>
      <h3
        className="mb-2 text-lg font-semibold"
        style={{ color: "var(--color-fg)" }}
      >
        {title}
      </h3>
      <p className="max-w-md text-sm">{description}</p>
    </div>
  );
}
