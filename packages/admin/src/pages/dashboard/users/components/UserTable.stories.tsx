/**
 * UserTable Stories
 *
 * Storybook documentation for UserTable component with ResponsiveTable integration.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fn } from "storybook/test";

import type { PaginatedResponse } from "@admin/types/api";
import type { UserApiResponse } from "@admin/types/user";

import UserTable from "./UserTable";

// Mock data
const mockUsers: UserApiResponse[] = [
  {
    id: "1",
    name: "John Doe",
    email: "john.doe@example.com",
    image: "https://i.pravatar.cc/150?img=1",
    roles: [{ id: "1", name: "Admin", level: 100, isSystem: true }],
    created: "2025-01-15T10:30:00Z",
    createdAt: "2025-01-15T10:30:00Z",
    updatedAt: "2025-01-15T10:30:00Z",
  },
  {
    id: "2",
    name: "Jane Smith",
    email: "jane.smith@example.com",
    image: "https://i.pravatar.cc/150?img=2",
    roles: [
      { id: "2", name: "Editor", level: 50, isSystem: false },
      { id: "3", name: "Viewer", level: 10, isSystem: false },
    ],
    created: "2025-01-14T09:15:00Z",
    createdAt: "2025-01-14T09:15:00Z",
    updatedAt: "2025-01-14T09:15:00Z",
  },
  {
    id: "3",
    name: "Robert Johnson",
    email: "robert.j@example.com",
    image: "https://i.pravatar.cc/150?img=3",
    roles: [{ id: "2", name: "Editor", level: 50, isSystem: false }],
    created: "2025-01-13T14:20:00Z",
    createdAt: "2025-01-13T14:20:00Z",
    updatedAt: "2025-01-13T14:20:00Z",
  },
  {
    id: "4",
    name: "Emily Davis",
    email: "emily.davis@example.com",
    image: "https://i.pravatar.cc/150?img=4",
    roles: [],
    created: "2025-01-12T11:45:00Z",
    createdAt: "2025-01-12T11:45:00Z",
    updatedAt: "2025-01-12T11:45:00Z",
  },
  {
    id: "5",
    name: "Michael Brown",
    email: "michael.b@example.com",
    image: "https://i.pravatar.cc/150?img=5",
    roles: [{ id: "3", name: "Viewer", level: 10, isSystem: false }],
    created: "2025-01-11T08:00:00Z",
    createdAt: "2025-01-11T08:00:00Z",
    updatedAt: "2025-01-11T08:00:00Z",
  },
];

// Extended mock data for pagination demo (15 users)
const mockUsersExtended: UserApiResponse[] = [
  ...mockUsers,
  {
    id: "6",
    name: "Sarah Wilson",
    email: "sarah.w@example.com",
    image: "https://i.pravatar.cc/150?img=6",
    roles: [{ id: "1", name: "Admin", level: 100, isSystem: true }],
    created: "2025-01-10T16:30:00Z",
    createdAt: "2025-01-10T16:30:00Z",
    updatedAt: "2025-01-10T16:30:00Z",
  },
  {
    id: "7",
    name: "David Martinez",
    email: "david.m@example.com",
    image: "https://i.pravatar.cc/150?img=7",
    roles: [{ id: "2", name: "Editor", level: 50, isSystem: false }],
    created: "2025-01-09T13:15:00Z",
    createdAt: "2025-01-09T13:15:00Z",
    updatedAt: "2025-01-09T13:15:00Z",
  },
  {
    id: "8",
    name: "Lisa Anderson",
    email: "lisa.a@example.com",
    image: "https://i.pravatar.cc/150?img=8",
    roles: [{ id: "3", name: "Viewer", level: 10, isSystem: false }],
    created: "2025-01-08T10:00:00Z",
    createdAt: "2025-01-08T10:00:00Z",
    updatedAt: "2025-01-08T10:00:00Z",
  },
  {
    id: "9",
    name: "James Taylor",
    email: "james.t@example.com",
    image: "https://i.pravatar.cc/150?img=9",
    roles: [{ id: "2", name: "Editor", level: 50, isSystem: false }],
    created: "2025-01-07T15:45:00Z",
    createdAt: "2025-01-07T15:45:00Z",
    updatedAt: "2025-01-07T15:45:00Z",
  },
  {
    id: "10",
    name: "Maria Garcia",
    email: "maria.g@example.com",
    image: "https://i.pravatar.cc/150?img=10",
    roles: [{ id: "1", name: "Admin", level: 100, isSystem: true }],
    created: "2025-01-06T09:30:00Z",
    createdAt: "2025-01-06T09:30:00Z",
    updatedAt: "2025-01-06T09:30:00Z",
  },
  {
    id: "11",
    name: "Christopher Lee",
    email: "chris.l@example.com",
    image: "https://i.pravatar.cc/150?img=11",
    roles: [{ id: "3", name: "Viewer", level: 10, isSystem: false }],
    created: "2025-01-05T14:00:00Z",
    createdAt: "2025-01-05T14:00:00Z",
    updatedAt: "2025-01-05T14:00:00Z",
  },
  {
    id: "12",
    name: "Jennifer White",
    email: "jennifer.w@example.com",
    image: "https://i.pravatar.cc/150?img=12",
    roles: [{ id: "2", name: "Editor", level: 50, isSystem: false }],
    created: "2025-01-04T11:20:00Z",
    createdAt: "2025-01-04T11:20:00Z",
    updatedAt: "2025-01-04T11:20:00Z",
  },
  {
    id: "13",
    name: "Daniel Harris",
    email: "daniel.h@example.com",
    image: "https://i.pravatar.cc/150?img=13",
    roles: [{ id: "1", name: "Admin", level: 100, isSystem: true }],
    created: "2025-01-03T16:45:00Z",
    createdAt: "2025-01-03T16:45:00Z",
    updatedAt: "2025-01-03T16:45:00Z",
  },
  {
    id: "14",
    name: "Ashley Clark",
    email: "ashley.c@example.com",
    image: "https://i.pravatar.cc/150?img=14",
    roles: [{ id: "3", name: "Viewer", level: 10, isSystem: false }],
    created: "2025-01-02T10:15:00Z",
    createdAt: "2025-01-02T10:15:00Z",
    updatedAt: "2025-01-02T10:15:00Z",
  },
  {
    id: "15",
    name: "Matthew Lewis",
    email: "matthew.l@example.com",
    image: "https://i.pravatar.cc/150?img=15",
    roles: [{ id: "2", name: "Editor", level: 50, isSystem: false }],
    created: "2025-01-01T13:30:00Z",
    createdAt: "2025-01-01T13:30:00Z",
    updatedAt: "2025-01-01T13:30:00Z",
  },
];

// Mock paginated response
const mockUsersResponse: PaginatedResponse<UserApiResponse> = {
  data: mockUsers,
  meta: {
    page: 0,
    pageSize: 10,
    totalCount: 5,
    totalPages: 1,
  },
};

const mockUsersResponsePaginated: PaginatedResponse<UserApiResponse> = {
  data: mockUsersExtended.slice(0, 10),
  meta: {
    page: 0,
    pageSize: 10,
    totalCount: 15,
    totalPages: 2,
  },
};

// Create mock QueryClient
const createMockQueryClient = (
  data?: PaginatedResponse<UserApiResponse>,
  isLoading = false,
  isError = false
) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  // Pre-populate cache with mock data
  if (data && !isLoading && !isError) {
    queryClient.setQueryData(["users"], data);
  }

  return queryClient;
};

/**
 * UserTable component with ResponsiveTable integration
 *
 * The UserTable component displays a responsive table/card view of users with:
 * - Mobile responsive: Card view (< 768px), table view (≥ 768px)
 * - Search users by name or email (debounced 300ms)
 * - Server-side pagination (10/25/50 rows per page)
 * - Sorting by name or created date
 * - CRUD actions: View, Edit, Delete
 * - Loading states, error states, empty states
 *
 * ## TanStack Query Integration
 * - useUsers: Fetches paginated user list with auto-caching
 * - useDeleteUser: Deletes user with automatic cache invalidation
 */
const meta = {
  title: "Components/Users/UserTable",
  component: UserTable,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "A responsive user table that switches between card view (mobile) and table view (desktop). Features search, pagination, sorting, and CRUD operations with TanStack Query integration.",
      },
    },
  },
  tags: ["autodocs"],
  decorators: [
    Story => {
      const queryClient = createMockQueryClient(mockUsersResponse);
      return (
        <QueryClientProvider client={queryClient}>
          <Story />
        </QueryClientProvider>
      );
    },
  ],
} satisfies Meta<typeof UserTable>;

export default meta;
type Story = StoryObj<typeof meta>;

// ========================================
// Default Story
// ========================================

export const Default: Story = {
  decorators: [
    Story => {
      const queryClient = createMockQueryClient(mockUsersResponse);
      return (
        <QueryClientProvider client={queryClient}>
          <Story />
        </QueryClientProvider>
      );
    },
  ],
  parameters: {
    docs: {
      description: {
        story:
          "Default user table with 5 users. Shows avatar, name, email, roles, creation date, and action menu. Includes SearchBar and no pagination (single page).",
      },
    },
  },
};

// ========================================
// States
// ========================================

export const Loading: Story = {
  decorators: [
    Story => {
      // Create QueryClient without pre-populated data to trigger loading state
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            gcTime: 0,
          },
        },
      });
      return (
        <QueryClientProvider client={queryClient}>
          <Story />
        </QueryClientProvider>
      );
    },
  ],
  parameters: {
    docs: {
      description: {
        story:
          "Initial loading state. Shows SearchBar (enabled) and Skeleton component (400px height) while data is fetching.",
      },
    },
  },
};

export const ErrorState: Story = {
  decorators: [
    Story => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            gcTime: 0,
          },
        },
      });
      // Simulate error state
      queryClient.setQueryData(["users"], () => {
        throw new Error("Failed to load users. Please try again.");
      });
      return (
        <QueryClientProvider client={queryClient}>
          <Story />
        </QueryClientProvider>
      );
    },
  ],
  parameters: {
    docs: {
      description: {
        story:
          "Error state. Shows SearchBar and Alert component (destructive variant) with error message when data fetching fails.",
      },
    },
  },
};

export const Empty: Story = {
  decorators: [
    Story => {
      const emptyResponse: PaginatedResponse<UserApiResponse> = {
        data: [],
        meta: {
          page: 0,
          pageSize: 10,
          totalCount: 0,
          totalPages: 0,
        },
      };
      const queryClient = createMockQueryClient(emptyResponse);
      return (
        <QueryClientProvider client={queryClient}>
          <Story />
        </QueryClientProvider>
      );
    },
  ],
  parameters: {
    docs: {
      description: {
        story:
          'Empty state. Shows "No users found. Try adjusting your search." message when no users match the search criteria or no users exist.',
      },
    },
  },
};

// ========================================
// Features
// ========================================

export const WithPagination: Story = {
  decorators: [
    Story => {
      const queryClient = createMockQueryClient(mockUsersResponsePaginated);
      return (
        <QueryClientProvider client={queryClient}>
          <Story />
        </QueryClientProvider>
      );
    },
  ],
  parameters: {
    docs: {
      description: {
        story:
          "Table with 15 users (10 per page, 2 pages total). Shows Pagination component with page controls (First, Previous, 1, 2, Next, Last) and page size selector (10/25/50).",
      },
    },
  },
};

export const SearchInProgress: Story = {
  decorators: [
    Story => {
      const queryClient = createMockQueryClient(mockUsersResponse, true);
      return (
        <QueryClientProvider client={queryClient}>
          <Story />
        </QueryClientProvider>
      );
    },
  ],
  parameters: {
    docs: {
      description: {
        story:
          "Search in progress. Shows SearchBar with loading spinner (Loader2 icon, animated) while search query is being processed. Table data remains visible during search.",
      },
    },
  },
};

export const SingleUser: Story = {
  decorators: [
    Story => {
      const singleUserResponse: PaginatedResponse<UserApiResponse> = {
        data: [mockUsers[0]],
        meta: {
          page: 0,
          pageSize: 10,
          totalCount: 1,
          totalPages: 1,
        },
      };
      const queryClient = createMockQueryClient(singleUserResponse);
      return (
        <QueryClientProvider client={queryClient}>
          <Story />
        </QueryClientProvider>
      );
    },
  ],
  parameters: {
    docs: {
      description: {
        story:
          "Table with a single user. Demonstrates minimum viable data display. No pagination shown (single page).",
      },
    },
  },
};

export const UsersWithoutRoles: Story = {
  decorators: [
    Story => {
      const usersNoRoles: UserApiResponse[] = [
        {
          id: "1",
          name: "John Doe",
          email: "john.doe@example.com",
          image: "https://i.pravatar.cc/150?img=1",
          roles: [],
          created: "2025-01-15T10:30:00Z",
          createdAt: "2025-01-15T10:30:00Z",
          updatedAt: "2025-01-15T10:30:00Z",
        },
        {
          id: "2",
          name: "Jane Smith",
          email: "jane.smith@example.com",
          image: "https://i.pravatar.cc/150?img=2",
          roles: [],
          created: "2025-01-14T09:15:00Z",
          createdAt: "2025-01-14T09:15:00Z",
          updatedAt: "2025-01-14T09:15:00Z",
        },
      ];
      const responseNoRoles: PaginatedResponse<UserApiResponse> = {
        data: usersNoRoles,
        meta: {
          page: 0,
          pageSize: 10,
          totalCount: 2,
          totalPages: 1,
        },
      };
      const queryClient = createMockQueryClient(responseNoRoles);
      return (
        <QueryClientProvider client={queryClient}>
          <Story />
        </QueryClientProvider>
      );
    },
  ],
  parameters: {
    docs: {
      description: {
        story:
          'Users without roles. Shows "No role" text in the Role column when users have no role assignments.',
      },
    },
  },
};

// ========================================
// Responsive Behavior
// ========================================

export const MobileView: Story = {
  decorators: [
    Story => {
      const queryClient = createMockQueryClient(mockUsersResponse);
      return (
        <QueryClientProvider client={queryClient}>
          <div style={{ maxWidth: "375px" }}>
            <Story />
          </div>
        </QueryClientProvider>
      );
    },
  ],
  parameters: {
    viewport: {
      defaultViewport: "mobile1",
    },
    docs: {
      description: {
        story:
          "Mobile view (< 768px). ResponsiveTable switches to card layout. Each user displayed as a Card with CardHeader (avatar + name + email) and CardContent (roles as definition list). Created date hidden on mobile. Actions menu still accessible.",
      },
    },
  },
};

export const TabletView: Story = {
  decorators: [
    Story => {
      const queryClient = createMockQueryClient(mockUsersResponse);
      return (
        <QueryClientProvider client={queryClient}>
          <div style={{ maxWidth: "768px" }}>
            <Story />
          </div>
        </QueryClientProvider>
      );
    },
  ],
  parameters: {
    viewport: {
      defaultViewport: "tablet",
    },
    docs: {
      description: {
        story:
          "Tablet view (768px). ResponsiveTable displays as traditional table. All columns visible including Created date. Full table functionality available.",
      },
    },
  },
};

export const DesktopView: Story = {
  decorators: [
    Story => {
      const queryClient = createMockQueryClient(mockUsersResponsePaginated);
      return (
        <QueryClientProvider client={queryClient}>
          <Story />
        </QueryClientProvider>
      );
    },
  ],
  parameters: {
    viewport: {
      defaultViewport: "desktop",
    },
    docs: {
      description: {
        story:
          "Desktop view (≥ 1024px). Full table layout with all features: search, sorting, pagination, actions. Optimized spacing for larger screens.",
      },
    },
  },
};

// ========================================
// Interactive Demo
// ========================================

export const InteractiveDemo: Story = {
  decorators: [
    Story => {
      const queryClient = createMockQueryClient(mockUsersResponsePaginated);
      return (
        <QueryClientProvider client={queryClient}>
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted p-4">
              <h3 className="text-sm font-semibold mb-2">Interactive Demo</h3>
              <p className="text-sm text-muted-foreground">
                Try searching users, changing pages, adjusting page size, and
                clicking action buttons (View, Edit, Delete). Actions are logged
                in the Actions panel below.
              </p>
            </div>
            <Story />
          </div>
        </QueryClientProvider>
      );
    },
  ],
  parameters: {
    docs: {
      description: {
        story:
          "Fully interactive demo. All features functional: search (debounced 300ms), pagination (navigate pages, change page size), sorting (click column headers), actions (click View/Edit/Delete). Actions logged to Storybook Actions panel.",
      },
    },
    actions: {
      handles: ["click button", "change input", "submit form"],
    },
  },
};
