/**
 * A stand-in for the Pagefind bundle a blog build generates at
 * `/pagefind/pagefind.js`. Each search waits until the test answers it, so a
 * test can hold one search open while the user keeps typing.
 */

/**
 * Searches asked for and not yet answered, by query. Answering with `false`
 * finds nothing.
 */
export const pending = new Map<string, (finds?: boolean) => void>();

/** The one document a query finds, titled after it. */
export function documentFor(query: string) {
  return {
    url: `/blog/${query}`,
    excerpt: "",
    meta: { title: `Post about ${query}` },
  };
}

export async function init(): Promise<void> {}

export function search(query: string) {
  return new Promise(resolve => {
    pending.set(query, (finds = true) =>
      resolve({
        results: finds ? [{ data: async () => documentFor(query) }] : [],
      })
    );
  });
}
