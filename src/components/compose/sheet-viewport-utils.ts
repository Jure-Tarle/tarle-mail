const KEYBOARD_THRESHOLD_PX = 120;

export function getSheetViewportStyle(layoutHeight: number, visualHeight: number, visualOffsetTop: number) {
	const keyboardOpen = layoutHeight - visualHeight > KEYBOARD_THRESHOLD_PX;
	const bottom = Math.max(0, layoutHeight - visualHeight - visualOffsetTop);
	return {
		// The sheet is anchored to the top of what is visible, so its header (close and send) never
		// slides under the browser chrome or behind the keyboard.
		top: `${Math.round(Math.max(0, visualOffsetTop))}px`,
		height: `${Math.round(visualHeight)}px`,
		bottom: `${Math.round(bottom)}px`,
		padding: keyboardOpen ? "0.5rem" : "max(env(safe-area-inset-bottom), 1rem)",
	};
}
