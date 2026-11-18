/** "Bügel" – the friendly wardrobe helper (original character: a smiling cloud with a little hanger hook). */
export function Mascot({ className = "mascot" }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 100 100" aria-hidden="true">
			<defs>
				<linearGradient id="m-body" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#ffffff" />
					<stop offset="1" stopColor="#dbe6fb" />
				</linearGradient>
			</defs>
			<g className="float">
				<path d="M50 20 C50 15 55 14.5 55 10.5 C55 7 52.5 5 50 5 C47.5 5 45.5 6.8 45.3 9" stroke="#8e9aac" strokeWidth="3.2" fill="none" strokeLinecap="round" />
				<path
					d="M26 78 C12 78 8 64 18 57 C14 44 28 35 38 41 C42 28 62 26 67 40 C79 36 90 47 84 58 C93 64 88 78 76 78 Z"
					fill="url(#m-body)"
					stroke="#b9c8e4"
					strokeWidth="2"
				/>
				<ellipse cx="34" cy="62" rx="5" ry="3" fill="#ffc2cf" opacity="0.8" />
				<ellipse cx="66" cy="62" rx="5" ry="3" fill="#ffc2cf" opacity="0.8" />
				<g className="blink">
					<ellipse cx="40" cy="55" rx="3.2" ry="4.2" fill="#2b3a55" />
					<ellipse cx="60" cy="55" rx="3.2" ry="4.2" fill="#2b3a55" />
				</g>
				<path d="M44 64 Q50 69 56 64" stroke="#2b3a55" strokeWidth="2.6" fill="none" strokeLinecap="round" />
			</g>
		</svg>
	);
}
