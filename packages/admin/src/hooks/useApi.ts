import { protectedApi } from "../lib/api/protectedApi";
import { publicApi } from "../lib/api/publicApi";

export function useApi(): {
  api: { public: typeof publicApi; protected: typeof protectedApi };
} {
  return {
    api: {
      public: publicApi,
      protected: protectedApi,
    },
  };
}
