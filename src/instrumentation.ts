import { getConfiguredStorageProvider, validateStorageConfiguration } from "@/lib/storage/config";

export function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  )
    validateStorageConfiguration(getConfiguredStorageProvider());
}
