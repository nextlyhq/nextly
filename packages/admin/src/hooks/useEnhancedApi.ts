import { enhancedFetcher } from "../lib/api/enhancedFetcher";

export function useEnhancedApi() {
  return {
    enhancedApi: {
      public: {
        get: <T, M = unknown>(path: string, options = {}) =>
          enhancedFetcher<T, M>(path, options, false),

        post: <T, M = unknown>(path: string, body: unknown, options = {}) =>
          enhancedFetcher<T, M>(
            path,
            {
              ...options,
              method: "POST",
              body: JSON.stringify(body),
            },
            false
          ),

        put: <T, M = unknown>(path: string, body: unknown, options = {}) =>
          enhancedFetcher<T, M>(
            path,
            {
              ...options,
              method: "PUT",
              body: JSON.stringify(body),
            },
            false
          ),

        patch: <T, M = unknown>(path: string, body: unknown, options = {}) =>
          enhancedFetcher<T, M>(
            path,
            {
              ...options,
              method: "PATCH",
              body: JSON.stringify(body),
            },
            false
          ),

        delete: <T, M = unknown>(path: string, options = {}) =>
          enhancedFetcher<T, M>(
            path,
            {
              ...options,
              method: "DELETE",
            },
            false
          ),
      },

      protected: {
        get: <T, M = unknown>(path: string, options = {}) =>
          enhancedFetcher<T, M>(path, options, true),

        post: <T, M = unknown>(path: string, body: unknown, options = {}) =>
          enhancedFetcher<T, M>(
            path,
            {
              ...options,
              method: "POST",
              body: JSON.stringify(body),
            },
            true
          ),

        put: <T, M = unknown>(path: string, body: unknown, options = {}) =>
          enhancedFetcher<T, M>(
            path,
            {
              ...options,
              method: "PUT",
              body: JSON.stringify(body),
            },
            true
          ),

        patch: <T, M = unknown>(path: string, body: unknown, options = {}) =>
          enhancedFetcher<T, M>(
            path,
            {
              ...options,
              method: "PATCH",
              body: JSON.stringify(body),
            },
            true
          ),

        delete: <T, M = unknown>(path: string, options = {}) =>
          enhancedFetcher<T, M>(
            path,
            {
              ...options,
              method: "DELETE",
            },
            true
          ),
      },
    },
  };
}
