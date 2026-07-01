import { protectedApi } from "../lib/api/protectedApi";
import { publicApi } from "../lib/api/publicApi";

export function useApi() {
  return {
    api: {
      public: publicApi,
      protected: protectedApi,
    },
  };
}
