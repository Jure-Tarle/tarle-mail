"use client";

import { createContext, useContext } from "react";

/**
 * The command bar across the top of the desktop reading view (Outlook style). The open message
 * renders its actions into `target`; while a list selection is active the bar shows the bulk
 * actions instead and `suppressed` tells the message to render none.
 */
export type CommandBarSlot = { target: HTMLElement | null; suppressed: boolean };

export const CommandBarContext = createContext<CommandBarSlot | null>(null);

/** The command bar slot, or null where there is no bar (phones, tablets, list-only views). */
export function useCommandBar(): CommandBarSlot | null {
	return useContext(CommandBarContext);
}

/** Shared look of a labelled command bar button. */
export const commandButtonClass = "h-9 shrink-0 gap-2 rounded-full px-3 text-[13px] font-medium text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 [&_svg]:text-neutral-500";
