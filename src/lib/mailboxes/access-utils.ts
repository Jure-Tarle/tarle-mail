import type { AppDatabase } from "@/db";

/** Shared inboxes are always available: this fork runs with the full Team feature set. */
export async function isTeamMailboxSharingEnabled(_db: AppDatabase): Promise<boolean> {
	return true;
}
