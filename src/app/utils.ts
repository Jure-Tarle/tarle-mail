import type { HomeAction } from "./types";

/** Public source of this installation's code (AGPL-3.0 section 13). */
export const SOURCE_URL = "https://github.com/Jure-Tarle/tarle-mail";

export function getHomeActions(isLoggedIn: boolean): HomeAction[] {
	if (isLoggedIn) {
		return [{ href: "/inbox", labelKey: "home.dashboard", variant: "default" }];
	}

	return [
		{ href: "/login", labelKey: "home.logIn", variant: "outline" },
		{ href: "/setup", labelKey: "home.createAccount", variant: "default" },
	];
}
