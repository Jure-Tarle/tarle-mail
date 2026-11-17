"use client";

import Link from "next/link";
import { ArrowRight } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { useHomeAuth } from "./home-auth";

export function HomeHeroActions() {
	const { t } = useLanguage();
	const hasUser = !!useHomeAuth();

	return (
		<div className="mt-9">
			<Button size="lg" asChild className="rounded-xl bg-[#0f1b2d] px-6 text-[#f4f6f9] transition-transform hover:bg-[#1b2a40] active:scale-[0.98] dark:bg-[#f4f6f9] dark:text-[#0f1b2d] dark:hover:bg-[#dfe4ea]">
				<Link href={hasUser ? "/inbox" : "/login"}>
					{hasUser ? t("home.openDashboard") : t("home.logIn")}
					<ArrowRight className="h-4 w-4" />
				</Link>
			</Button>
		</div>
	);
}
