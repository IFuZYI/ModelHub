/** Public API of the lib layer. Import from "@/lib" in app code. */

// domain
export * from "./domain/provider";
export * from "./domain/errors";
export * from "./domain/validation";
export * from "./domain/presets";
export * from "./domain/user";
export {
  deriveStat,
  type StatContribution,
  type DerivedStat,
} from "./domain/stats";

// services (use-cases)
export {
  userProviderService,
  UserProviderService,
  type UserProviderView,
  type CreateUserProviderInput,
  type UpdateUserProviderInput,
} from "./services/userProviderService";
export { userService, UserService } from "./services/userService";
export { authService, AuthService } from "./services/authService";
export {
  settingsService,
  SettingsService,
  type PublicSettings,
} from "./services/settingsService";
export {
  statsService,
  StatsService,
  type ProviderStatView,
} from "./services/statsService";
export { keyPoolService, KeyPoolService } from "./services/keyPoolService";
export { probeModels, type ProbeResult } from "./services/probe";
export { startScheduler, stopScheduler } from "./services/scheduler";
export {
  createToken,
  parseToken,
  currentUser,
  isAuthenticated,
  requireUser,
  requireAdmin,
  adminConfigured,
  sessionCookieName,
  sessionMaxAgeSeconds,
  type Session,
} from "./services/auth";

// infra
export { assertMasterKey } from "./infra/crypto";
export { getDatabase, createDatabase, destroyDatabase } from "./infra/db";
export { migrateDatabase } from "./infra/migrate";
export { seedFromJsonIfNeeded } from "./infra/seedFromJson";
export { logger } from "./infra/logger";
export { fetchWithTimeout } from "./infra/http";

// http helpers
export { withErrorHandling, parseJson, errorResponse } from "./http/handler";

// importers
export { importNewapiSite } from "./services/importer";
export type { NewapiImportResult } from "./services/importer";
export {
  publicService,
  PublicService,
  type PublicProvider,
  type PublicProviderDetail,
  type PublicPage,
} from "./services/publicService";
export { sendMail, isMailerConfigured } from "./services/mailer";

// upstream adapters
export { getAdapter, listAdapters, registerAdapter } from "./upstream";
export type { UpstreamAdapter } from "./upstream";

// config
export { config } from "./config/env";
