import { BarChart3, Luggage, MessageCircle, MoreHorizontal, Settings, Shirt, Sparkles, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";

const MAIN = [
	{ href: "/", label: "Schrank", icon: Shirt },
	{ href: "/outfits", label: "Outfits", icon: Sparkles },
	{ href: "/assistent", label: "Assistent", icon: MessageCircle },
];

const DESKTOP_EXTRA = [
	{ href: "/anprobe", label: "Anprobe", icon: UserRound },
	{ href: "/reisen", label: "Reisen", icon: Luggage },
	{ href: "/statistik", label: "Statistik", icon: BarChart3 },
	{ href: "/einstellungen", label: "Einstellungen", icon: Settings },
];

function isActive(loc: string, href: string): boolean {
	if (href === "/") return loc === "/" || loc.startsWith("/teil") || loc.startsWith("/neu");
	return loc.startsWith(href);
}

export function TopNav() {
	const [loc] = useLocation();
	return (
		<nav className="topnav container" aria-label="Hauptnavigation">
			{[...MAIN, ...DESKTOP_EXTRA].map(({ href, label, icon: Icon }) => (
				<Link key={href} href={href} className={isActive(loc, href) ? "on" : ""}>
					<Icon size={17} />
					{label}
				</Link>
			))}
		</nav>
	);
}

function TabBar() {
	const [loc] = useLocation();
	const moreActive = ["/mehr", "/anprobe", "/reisen", "/statistik", "/einstellungen", "/shopping"].some((p) => loc.startsWith(p));
	return (
		<nav className="tabbar" aria-label="Navigation">
			{MAIN.map(({ href, label, icon: Icon }) => (
				<Link key={href} href={href} className={isActive(loc, href) ? "on" : ""}>
					<Icon size={22} />
					{label}
				</Link>
			))}
			<Link href="/mehr" className={moreActive ? "on" : ""}>
				<MoreHorizontal size={22} />
				Mehr
			</Link>
		</nav>
	);
}

export function Layout({ children }: { children: ReactNode }) {
	const [loc] = useLocation();
	return (
		<div className="app">
			{loc !== "/" && (
				<div className="hide-mobile" style={{ display: "block", paddingTop: 34 }}>
					<TopNav />
				</div>
			)}
			{children}
			<TabBar />
		</div>
	);
}

export function PageHead({ title, left, right }: { title: ReactNode; left?: ReactNode; right?: ReactNode }) {
	return (
		<div className="page-head">
			<div className="left">
				{left}
				<h1 className="ellipsis">{title}</h1>
			</div>
			{right && <div className="row">{right}</div>}
		</div>
	);
}
