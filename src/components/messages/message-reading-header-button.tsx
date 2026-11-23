"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Columns2 } from "@/components/icons";
import clsx from "clsx";
import { useLanguage } from "@/components/language-provider";
import { Tooltip } from "@/components/ui/tooltip";
import { useMessageListVisibility } from "./message-list-visibility";

/**
 * Leaves the open email. On phones and tablets it is a labelled back button; on the desktop the split
 * icon closes the email and returns to the list, also while the assistant panel takes the list's place.
 */
export function MessageReadingHeaderButton() {
	const { t } = useLanguage();
	const router = useRouter();
	const { showList, singleColumn, backHref, backLabel } = useMessageListVisibility();
	const label = singleColumn ? t("message.nav.backTo", { folder: backLabel }) : t("message.nav.close");

	function handleClick() {
		if (!singleColumn) showList();
		router.push(backHref);
	}

	return (
		<Tooltip label={label} className={singleColumn ? "inline-flex" : "hidden lg:inline-flex"}>
			<button
				type="button"
				className={clsx("relative z-10 flex shrink-0 items-center gap-1.5 rounded-full p-2 text-neutral-600 duration-200 hover:bg-neutral-100 hover:text-neutral-900", singleColumn && "max-lg:-ml-2 max-lg:min-h-11 max-lg:pr-3 max-lg:text-blue-700")}
				onClick={handleClick}
				aria-label={label}
			>
				{singleColumn ? <ArrowLeft size={16} className="max-lg:h-5 max-lg:w-5" /> : <Columns2 size={16} />}
				{/* On phones and tablets the way back names where it goes, as in iOS Mail. */}
				{singleColumn && <span className="max-w-[9rem] truncate text-[15px] font-medium lg:hidden">{backLabel}</span>}
			</button>
		</Tooltip>
	);
}
