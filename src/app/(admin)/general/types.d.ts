export interface GeneralSettings {
	outboundAttachmentMaxMb: number;
	/** Per-user Drive cap in GB; null when unlimited. */
	driveStorageLimitGb: number | null;
	/** Default storage per mailbox in GB; null when unlimited. */
	defaultMailboxStorageLimitGb: number | null;
	/** Default messages per UTC day per mailbox; null when unlimited. */
	defaultMailboxDailySendLimit: number | null;
}
