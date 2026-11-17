"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Columns2 } from "@/components/icons";
import clsx from "clsx";
import { useLanguage } from "@/components/language-provider";
import { Tooltip } from "@/components/ui/tooltip";
import { useMessageListVisibility } from "./message-list-visibility";
import type { MessageReadingHeaderButtonProps } from "./message-reading-header-button-types";

export function MessageReadingHeaderButton({ assistantVisible }: MessageReadingHeaderButtonProps) {
	const { t } = useLanguage();
	const router = useRouter();
	const { visible, toggle, singleColumn, backHref, backLabel } = useMessageListVisibility();
	const label = singleColumn
		? t("message.nav.backTo", { folder: backLabel })
		: assistantVisible ? null : visible ? t("message.nav.hideList") : t("message.nav.showList");

	function handleClick() {
		if (singleColumn) router.push(backHref);
		else toggle();
	}

	return (
		<Tooltip label={label} className={singleColumn ? "inline-flex" : "hidden lg:inline-flex"}>
			<button
				type="button"
				className={clsx(!singleColumn && assistantVisible ? "opacity-40" : !singleColumn && !visible ? "opacity-60 hover:opacity-100" : "", (singleColumn || !assistantVisible) && "hover:bg-neutral-100 hover:text-neutral-900", "relative z-10 flex shrink-0 items-center gap-1.5 rounded-full p-2 text-neutral-600 duration-200", singleColumn && "max-lg:-ml-2 max-lg:min-h-11 max-lg:pr-3 max-lg:text-blue-700")}
				onClick={handleClick}
				disabled={!singleColumn && assistantVisible}
				aria-label={label ?? t("message.nav.listUnavailable")}
				aria-pressed={singleColumn ? undefined : visible}
			>
				{singleColumn ? <ArrowLeft size={16} className="max-lg:h-5 max-lg:w-5" /> : <Columns2 size={16} />}
				{/* On phones and tablets the way back names where it goes, as in iOS Mail. */}
				{singleColumn && <span className="max-w-[9rem] truncate text-[15px] font-medium lg:hidden">{backLabel}</span>}
			</button>
		</Tooltip>
	);
}
