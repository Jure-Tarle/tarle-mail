"use client";

import { useEffect, useState } from "react";

/** The element a maximized composer docks into: the right pane of the mail split layout. */
export const COMPOSE_DOCK_SELECTOR = "[data-compose-dock]";

/** The dock's box, plus the page card's top corner radii where the dock sits in those corners. */
export type DockRect = { top: number; left: number; width: number; height: number; topLeftRadius: string; topRightRadius: string };

const sameRect = (a: DockRect | null, b: DockRect | null) =>
	!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height && a.topLeftRadius === b.topLeftRadius && a.topRightRadius === b.topRightRadius;

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
			const card = element?.closest("main");
			const cardBox = card?.getBoundingClientRect();
			// The composer covers the card's top corners where it reaches them, so it takes over their rounding.
			const atTop = !!box && !!cardBox && Math.abs(cardBox.top - box.top) < 2;
			const style = atTop && card ? getComputedStyle(card) : null;
			const topLeftRadius = style && Math.abs(cardBox!.left - box!.left) < 2 ? style.borderTopLeftRadius : "0px";
			const topRightRadius = style && Math.abs(cardBox!.right - box!.right) < 2 ? style.borderTopRightRadius : "0px";
			const next = box && box.width > 0 && box.height > 0 ? { top: box.top, left: box.left, width: box.width, height: box.height, topLeftRadius, topRightRadius } : null;
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
