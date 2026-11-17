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
			<Button size="lg" asChild className="rounded-xl bg-blue-600 px-6 text-[#ffffff] transition-transform hover:bg-blue-700 active:scale-[0.98]">
				<Link href={hasUser ? "/inbox" : "/login"}>
					{hasUser ? t("home.openDashboard") : t("home.logIn")}
					<ArrowRight className="h-4 w-4" />
				</Link>
			</Button>
		</div>
	);
}
