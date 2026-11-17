"use client";

import { useEffect, useState } from "react";

/** The element a maximized composer docks into: the right pane of the mail split layout. */
export const COMPOSE_DOCK_SELECTOR = "[data-compose-dock]";

export type DockRect = { top: number; left: number; width: number; height: number };

const sameRect = (a: DockRect | null, b: DockRect | null) =>
	!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

/**
 * Tracks the on-screen box of the compose dock while `enabled`, or null when the page has none
 * (calendar, drive, settings or a narrow window), in which case the composer keeps its modal.
 * The box can move without resizing (sidebar toggles, route changes swap the element), so it is
 * read once per frame and only committed to state when it changes.
 */
export function useComposeDock(enabled: boolean): DockRect | null {
	const [rect, setRect] = useState<DockRect | null>(null);
	useEffect(() => {
		if (!enabled) return;
		let frame = 0;
		let last: DockRect | null = null;
		const read = () => {
			const element = document.querySelector<HTMLElement>(COMPOSE_DOCK_SELECTOR);
			const box = element?.getBoundingClientRect();
			const next = box && box.width > 0 && box.height > 0 ? { top: box.top, left: box.left, width: box.width, height: box.height } : null;
			if (!sameRect(last, next) && (last || next)) {
				last = next;
				setRect(next);
			}
			frame = requestAnimationFrame(read);
		};
		frame = requestAnimationFrame(read);
		return () => {
			cancelAnimationFrame(frame);
			setRect(null);
		};
	}, [enabled]);
	return enabled ? rect : null;
}
