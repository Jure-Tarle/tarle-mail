"use client";

import Link from "next/link";
import { useLanguage } from "@/components/language-provider";
import { LanguageSelector } from "@/components/language-selector";
import { Button } from "@/components/ui/button";
import { getHomeActions } from "./utils";
import { HomeAccountMenu } from "./home-account-menu";
import { useHomeAuth } from "./home-auth";

export function HomeHeaderActions() {
	const { t } = useLanguage();
	const user = useHomeAuth();
	if (user) return <HomeAccountMenu user={user} />;

	return (
		<>
			{getHomeActions(false).map((action) => (
				<Button
					key={action.href}
					variant={action.variant}
					asChild
					className={action.variant === "default" ? "bg-[#0f1b2d] text-[#f4f6f9] hover:bg-[#1b2a40] dark:bg-[#f4f6f9] dark:text-[#0f1b2d] dark:hover:bg-[#dfe4ea]" : undefined}
				>
					<Link href={action.href}>{t(action.labelKey)}</Link>
				</Button>
			))}
		</>
	);
}
