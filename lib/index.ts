/** Public API of the lib layer. Import from "@/lib" in app code. */

// domain
export * from "./domain/provider";
export * from "./domain/errors";
export * from "./domain/validation";
export * from "./domain/presets";

// services (use-cases)
export { providerService, ProviderService } from "./services/providerService";
export {
  refreshProvider,
  refreshAll,
  fetchProviderModels,
} from "./services/fetcher";
export { startScheduler, stopScheduler } from "./services/scheduler";
export {
  verifyPassword,
  createToken,
  verifyToken,
  isAuthenticated,
  requireAdmin,
  adminConfigured,
  sessionCookieName,
  sessionMaxAgeSeconds,
} from "./services/auth";

// infra
export { assertMasterKey } from "./infra/crypto";
export { fileRepository, getDataDir, getDataPath } from "./infra/repository";
export type { ProviderRepository } from "./infra/repository";
export { logger } from "./infra/logger";
export { fetchWithTimeout } from "./infra/http";

// http helpers
export { withErrorHandling, parseJson, errorResponse } from "./http/handler";

// importers
export { importNewapiSite } from "./services/importer";
export type { NewapiImportResult } from "./services/importer";

// upstream adapters
export { getAdapter, listAdapters, registerAdapter } from "./upstream";
export type { UpstreamAdapter } from "./upstream";

// config
export { config } from "./config/env";
