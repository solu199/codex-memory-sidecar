import type { MemorySidecarConfig } from "./config.js";
import { MemoryStore } from "./memory-store.js";
import type { BackupVerification, DatabaseHealth } from "./types.js";

export interface StartupMaintenanceResult {
  ok: boolean;
  databaseHealth: DatabaseHealth;
  backup: {
    backupPath: string;
    verification: BackupVerification;
  } | null;
  warnings: string[];
}

export type StartupMaintenanceOptions = Pick<
  MemorySidecarConfig,
  "startupIntegrityCheck" | "startupFtsSanityCheck" | "startupWalCheckpoint" | "autoBackupOnStartup"
>;

export async function runStartupMaintenance(
  store: MemoryStore,
  options: StartupMaintenanceOptions,
): Promise<StartupMaintenanceResult> {
  const databaseHealth = store.checkDatabaseHealth({
    integrityCheck: options.startupIntegrityCheck,
    ftsSanityCheck: options.startupFtsSanityCheck,
    walCheckpoint: options.startupWalCheckpoint,
  });
  const warnings = [...databaseHealth.warnings];

  if (!options.autoBackupOnStartup) {
    return {
      ok: databaseHealth.ok,
      databaseHealth,
      backup: null,
      warnings,
    };
  }

  try {
    const backup = await store.createBackup({});
    const verification = store.verifyBackup({ backupPath: backup.backupPath });
    warnings.push(...verification.warnings);
    if (!verification.ok) {
      warnings.push(`Startup backup verification failed: ${backup.backupPath}`);
    }

    return {
      ok: databaseHealth.ok && verification.ok,
      databaseHealth,
      backup: {
        backupPath: backup.backupPath,
        verification,
      },
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Startup backup failed: ${message}`);
    return {
      ok: false,
      databaseHealth,
      backup: null,
      warnings,
    };
  }
}
