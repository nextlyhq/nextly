/**
 * Shared test setup for Direct API tests.
 *
 * Creates mock services and registers them in the DI container
 * so that the Nextly class can resolve its dependencies.
 */

import { vi, type Mock } from "vitest";

import { container } from "../../../di/container";
import { Nextly } from "../../nextly";

// Each `vi.fn()` resolves to a Mock type from the transitive
// `@vitest/spy` package. When tsc emits .d.ts files for these factories
// it tries to name that transitive path and fails with TS2742. Casting
// the returned shape through this helper rewrites every value's type to
// vitest's directly-exported `Mock`, which is nameable.
type MockOf<T> = { [K in keyof T]: Mock };

const asMocks = <T extends object>(o: T): MockOf<T> => o as MockOf<T>;

export function createMockCollectionsHandler(): Record<string, Mock> {
  return asMocks({
    listEntries: vi.fn(),
    getEntry: vi.fn(),
    createEntry: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(),
    countEntries: vi.fn(),
    bulkDeleteEntries: vi.fn(),
    bulkUpdateEntries: vi.fn(),
    duplicateEntry: vi.fn(),
    bulkUpdateByQuery: vi.fn(),
    bulkDeleteByQuery: vi.fn(),
    createCollection: vi.fn(),
    registerDynamicSchemas: vi.fn(),
  });
}

export function createMockSingleEntryService(): Record<string, Mock> {
  return asMocks({
    get: vi.fn(),
    update: vi.fn(),
  });
}

export function createMockAuthService(): Record<string, Mock> {
  return asMocks({
    verifyCredentials: vi.fn(),
    registerUser: vi.fn(),
    changePassword: vi.fn(),
    generatePasswordResetToken: vi.fn(),
    resetPasswordWithToken: vi.fn(),
    verifyEmail: vi.fn(),
    generateEmailVerificationToken: vi.fn(),
  });
}

export function createMockUserAccountService(): Record<string, Mock> {
  return asMocks({
    getCurrentUser: vi.fn(),
    updateCurrentUser: vi.fn(),
    updatePasswordHash: vi.fn(),
    hasPassword: vi.fn(),
    getUserPasswordHashById: vi.fn(),
    getAccounts: vi.fn(),
    deleteUserAccount: vi.fn(),
    unlinkAccountForUser: vi.fn(),
  });
}

export function createMockUserService(): Record<string, Mock> {
  return asMocks({
    create: vi.fn(),
    findById: vi.fn(),
    findByEmail: vi.fn(),
    listUsers: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    authenticate: vi.fn(),
    changePassword: vi.fn(),
    hasPassword: vi.fn(),
    updateProfile: vi.fn(),
  });
}

export function createMockSingleRegistryService(): Record<string, Mock> {
  return asMocks({
    listSingles: vi.fn(),
    getSingleBySlug: vi.fn(),
    getSingle: vi.fn(),
    getAllSingles: vi.fn(),
    registerSingle: vi.fn(),
    updateSingle: vi.fn(),
    deleteSingle: vi.fn(),
    isLocked: vi.fn(),
  });
}

export function createMockMediaService(): Record<string, Mock> {
  return asMocks({
    upload: vi.fn(),
    findById: vi.fn(),
    listMedia: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulkUpload: vi.fn(),
    bulkDelete: vi.fn(),
    moveToFolder: vi.fn(),
    createFolder: vi.fn(),
    findFolderById: vi.fn(),
    listRootFolders: vi.fn(),
    listSubfolders: vi.fn(),
    getFolderContents: vi.fn(),
    updateFolder: vi.fn(),
    deleteFolder: vi.fn(),
    getStorageType: vi.fn().mockReturnValue("local"),
    hasStorage: vi.fn().mockReturnValue(true),
    isImage: vi.fn(),
    validateImage: vi.fn(),
    getImageDimensions: vi.fn(),
  });
}

export function createMockAdapter(): Record<string, Mock> {
  return asMocks({
    getCapabilities: vi.fn().mockReturnValue({
      dialect: "sqlite",
      supportsJsonb: false,
      supportsReturning: false,
      supportsFts: false,
    }),
    select: vi.fn(),
    selectOne: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  });
}

export interface TestMocks {
  collectionsHandler: ReturnType<typeof createMockCollectionsHandler>;
  singleEntryService: ReturnType<typeof createMockSingleEntryService>;
  singleRegistryService: ReturnType<typeof createMockSingleRegistryService>;
  authService: ReturnType<typeof createMockAuthService>;
  userAccountService: ReturnType<typeof createMockUserAccountService>;
  userService: ReturnType<typeof createMockUserService>;
  mediaService: ReturnType<typeof createMockMediaService>;
  adapter: ReturnType<typeof createMockAdapter>;
}

/**
 * Set up a Nextly instance with all mocked services.
 *
 * Registers mock services in the DI container and creates a Nextly instance
 * with mocked auth/account services injected via private properties.
 */
export function setupTestNextly(): {
  nextly: Nextly;
  mocks: TestMocks;
  cleanup: () => void;
} {
  const mocks: TestMocks = {
    collectionsHandler: createMockCollectionsHandler(),
    singleEntryService: createMockSingleEntryService(),
    singleRegistryService: createMockSingleRegistryService(),
    authService: createMockAuthService(),
    userAccountService: createMockUserAccountService(),
    userService: createMockUserService(),
    mediaService: createMockMediaService(),
    adapter: createMockAdapter(),
  };

  container.clear();
  container.registerSingleton(
    "collectionsHandler",
    () => mocks.collectionsHandler
  );
  container.registerSingleton(
    "singleEntryService",
    () => mocks.singleEntryService
  );
  container.registerSingleton(
    "singleRegistryService",
    () => mocks.singleRegistryService
  );
  container.registerSingleton("userService", () => mocks.userService);
  container.registerSingleton("mediaService", () => mocks.mediaService);
  container.registerSingleton("adapter", () => mocks.adapter);

  const nextly = new Nextly();

  // Inject auth/account services directly (bypasses globalDrizzleDb dependency)
  (nextly as any)._authService = mocks.authService;
  (nextly as any)._userAccountService = mocks.userAccountService;

  const cleanup = () => {
    container.clear();
  };

  return { nextly, mocks, cleanup };
}

/**
 * Reset all mock functions in the mocks object.
 */
export function resetMocks(mocks: TestMocks): void {
  for (const service of Object.values(mocks)) {
    for (const fn of Object.values(service)) {
      if (typeof fn === "function" && "mockReset" in fn) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    }
  }
}
