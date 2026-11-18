export function Hanger({ className = "hanger" }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 62 34" fill="none" aria-hidden="true">
			<path
				d="M31 13 C31 9 35 8.5 35 5.5 C35 3 33 1.5 31 1.5 C29 1.5 27.4 2.8 27.2 4.6"
				stroke="currentColor"
				strokeWidth="2.4"
				strokeLinecap="round"
			/>
			<path d="M31 13 L5 28 Q2.5 30 5.5 31 L56.5 31 Q59.5 30 57 28 Z" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
		</svg>
	);
}
