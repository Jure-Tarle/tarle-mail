export type MailboxRouteParams = {
	params: Promise<{ id: string }>;
};

export type MailboxUpdateValues = {
	displayName?: string | null;
	signature?: string | null;
	autoReplyEnabled?: boolean;
	autoReplySubject?: string;
	autoReplyBody?: string;
	useAllDomains?: boolean;
	storageLimitBytes?: number | null;
	dailySendLimit?: number | null;
};
