/** Numbers the setup steps on the Agent page: choose the provider, then give it keys. */
export function StepBadge({ number }: { number: number }) {
	return <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">{number}</span>;
}
