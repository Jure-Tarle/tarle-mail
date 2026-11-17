export type AppMode = "mail" | "admin";

// Every route of the (admin) layout group.
export const adminRoutePrefixes = [
	"/admin", "/accounts", "/activity", "/agent", "/ai-usage", "/api-keys", "/audit-logs", "/backups", "/branding",
	"/domains", "/general", "/mailboxes", "/routing", "/spam-filter", "/usage", "/webhooks",
];

export const defaultModePaths: Record<AppMode, string> = { mail: "/inbox", admin: "/admin" };

export function modeStorageKey(mode: AppMode): string {
	return `tarle-mail.last-${mode}-path`;
}

export function isAdminRoute(pathname: string): boolean {
	return adminRoutePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function getActiveMode(pathname: string): AppMode {
	return isAdminRoute(pathname) ? "admin" : "mail";
}

/** The remembered path if it is a same-origin path that belongs to the mode, otherwise the mode's default. */
export function resolveModeHref(mode: AppMode, remembered: string | null | undefined): string {
	if (!remembered || !remembered.startsWith("/") || remembered.startsWith("//") || remembered.includes("\\")) return defaultModePaths[mode];
	return getActiveMode(remembered) === mode ? remembered : defaultModePaths[mode];
}
