import type { ReactNode } from "react";

/** User settings pages use the full content width; their navigation lives in the app sidebar. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
	return (
		<div className="min-h-[calc(100dvh-4rem)] w-full bg-inherit px-6 pb-36 pt-4 md:pb-10 lg:px-12">
			{children}
		</div>
	);
}
