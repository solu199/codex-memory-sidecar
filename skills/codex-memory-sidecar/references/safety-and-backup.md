# Safety And Backup

If `repairRecommended`, integrity warnings, FTS warnings, or backup warnings appear, pause risky work and surface the issue.

## Before risky operations

Use:

- `backup_memory`
- `verify_backup`

before repair, heavy cleanup, or other risky DB operations.

## Repair and planning

- Use `repair_memory_index` for FTS repair after a verified backup.
- Use `plan_backup_retention` for dry-run retention cleanup planning.
- Use `plan_backup_restore` for dry-run restore planning.
- Do not delete backups or replace DB files automatically.

## Storage rule

Never store secrets, credentials, private tokens, or unnecessary personal details in normal memory or directive memory.
