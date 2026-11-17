import type { TranslationKey } from "@/lib/i18n/types";
import type { ButtonProps } from "@/components/ui/button";
import type { MailboxSelectorUser } from "@/components/mailbox-selector-types";
import type { ReactNode } from "react";

export type HomeAuthProviderProps = {
	children: ReactNode;
	/**
	 * The account resolved from the session cookie on the server. `undefined`
	 * means the server did not answer, so the provider must check itself.
	 */
	initialUser?: MailboxSelectorUser | null;
};

export type HomeAccountMenuProps = {
	user: MailboxSelectorUser;
};

export type HomeAction = {
	href: string;
	labelKey: TranslationKey;
	variant: ButtonProps["variant"];
};
