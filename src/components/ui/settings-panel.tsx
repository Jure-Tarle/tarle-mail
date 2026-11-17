import type { FormEventHandler, ReactNode } from "react";
import { cn } from "@/lib/utils";

type SettingsPanelProps = {
	title: ReactNode;
	description?: ReactNode;
	children: ReactNode;
	/** The primary action, usually a save button. Sits at the end of the footer. */
	action?: ReactNode;
	/** Status or error text, shown at the start of the footer. */
	status?: ReactNode;
	/** With onSubmit the panel is a form, so Enter in a field submits it. */
	onSubmit?: FormEventHandler<HTMLFormElement>;
	className?: string;
	id?: string;
};

/**
 * A settings card for full-width pages: title and explanation on the left, the fields on the right
 * (stacked on small screens), and a footer with the status at the start and the action at the end.
 */
export function SettingsPanel({ title, description, children, action, status, onSubmit, className, id }: SettingsPanelProps) {
	const body = (
		<>
			<div className="grid grid-cols-[minmax(0,1fr)] gap-5 p-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
				<div className="min-w-0">
					<h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
					{description && <div className="mt-1.5 text-sm leading-6 text-neutral-500">{description}</div>}
				</div>
				<div className="min-w-0 space-y-4">{children}</div>
			</div>
			{(action || status) && (
				<div className="flex flex-wrap items-center justify-end gap-3 border-t border-neutral-100 px-6 py-4">
					{status && <div role="status" className="mr-auto min-w-0 text-sm text-neutral-700">{status}</div>}
					{action}
				</div>
			)}
		</>
	);
	const classes = cn("rounded-3xl bg-white", className);
	return onSubmit
		? <form id={id} onSubmit={onSubmit} className={classes}>{body}</form>
		: <section id={id} className={classes}>{body}</section>;
}

/** Fields that belong together, side by side from the small breakpoint up. */
export function SettingsFieldGrid({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn("grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[repeat(2,minmax(0,1fr))] [&>*]:min-w-0", className)}>{children}</div>;
}
