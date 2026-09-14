/**
 * Setting keys, kept apart from the repository that reads them.
 *
 * `database.ts` needs one of these while it opens the connection, and the
 * repository needs the open connection: importing the keys from the repository
 * made that a require cycle, and Metro handed the module back half-evaluated.
 */

export const SETTING_LOCALE = 'locale';
export const SETTING_CURRENCY = 'currency';
export const SETTING_APP_LOCK = 'appLock';
/** Account id preselected on the import screen: the one the last import went to. */
export const SETTING_LAST_IMPORT_ACCOUNT = 'lastImportAccount';
/**
 * Ids of shipped rules the owner deleted, as a JSON array. Without it the
 * launch-time install would bring every one of them back on the next launch.
 */
export const SETTING_RETIRED_SHIPPED_RULES = 'retiredShippedRules';
/** Whether the ask bubble is shown. Off until a model has been installed. */
export const SETTING_ASSISTANT_ENABLED = 'assistantEnabled';
/**
 * Where the owner parked the bubble, as `edge:fraction` — which side it is
 * clinging to and how far down the screen. Stored rather than remembered per
 * session because a bubble that jumps back to a corner on every launch is a
 * bubble the owner stops moving.
 */
export const SETTING_ASSISTANT_BUBBLE_POSITION = 'assistantBubblePosition';
/**
 * When the last backup was written, ISO 8601. Shown on the backup screen so
 * the owner can see at a glance how stale their safety net is — the only
 * prompt this feature gives them, since it takes no backups on its own.
 */
export const SETTING_LAST_BACKUP_AT = 'lastBackupAt';
