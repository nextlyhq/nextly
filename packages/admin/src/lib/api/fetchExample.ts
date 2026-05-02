import { useApi } from "@admin/hooks/useApi";

interface UserResponse {
  id: string;
  email: string;
  emailVerified: string;
  name: string;
}

export async function fetchSingleUser() {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { api } = useApi();

  try {
    // Fetch a single user by ID
    const user = await api.public.get<UserResponse>(
      "/users/786fd7a2-52e9-40cb-9538-5d0adbc8bb80"
    );
    console.log("Single User:", user.name);
  } catch (error) {
    if (error instanceof Error) {
      console.error("API error:", error);
    } else {
      console.error("Unexpected error:", error);
    }
  }
}

export async function fetchMultipleUsers() {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { api } = useApi();

  try {
    // Phase 4 wire shape (spec section 5.1): list endpoints return
    // `{ items, meta }`, not a bare array. Type the response with the
    // canonical envelope so the example mirrors what real consumers see.
    const response = await api.public.get<{
      items: UserResponse[];
      meta: { total: number; page: number; limit: number };
    }>("/users");
    console.log("First user's name:", response.items?.[0]?.name);
    console.log("Total users:", response.meta.total);
  } catch (error) {
    if (error instanceof Error) {
      console.error("API error:", error.message);
    } else {
      console.error("Unexpected error:", error);
    }
  }
}
