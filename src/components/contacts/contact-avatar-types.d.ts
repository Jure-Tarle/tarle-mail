export type ContactAvatarProps = {
	mailboxId: string | null;
	address: string;
	name: string;
	hasManagedAvatar?: boolean;
	managedAvatarUrl?: string;
	/** The sender's BIMI logo, shown when there is no picture of the contact's own. */
	senderLogoUrl?: string;
	className?: string;
};
