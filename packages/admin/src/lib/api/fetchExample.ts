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
    // Fetch an array of users
    const users = await api.public.get<UserResponse[]>("/users");
    console.log("First User's Name:", users?.[0].name);
  } catch (error) {
    if (error instanceof Error) {
      console.error("API error:", error.message);
    } else {
      console.error("Unexpected error:", error);
    }
  }
}
