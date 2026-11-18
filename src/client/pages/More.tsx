import { BarChart3, LogOut, Luggage, Settings, ShoppingBag, UserRound } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "../api.ts";
import { PageHead } from "../components/Layout.tsx";

const TILES = [
	{ href: "/anprobe", icon: UserRound, title: "Anprobe & Avatar", text: "Outfits am Hologramm oder per KI an dir" },
	{ href: "/reisen", icon: Luggage, title: "Packlisten", text: "Reise eintragen, Koffer automatisch planen" },
	{ href: "/shopping", icon: ShoppingBag, title: "Shopping-Check", text: "Passt das neue Teil zu deinem Schrank?" },
	{ href: "/statistik", icon: BarChart3, title: "Statistik", text: "Lieblinge, Ladenhüter, Kosten pro Tragen" },
	{ href: "/einstellungen", icon: Settings, title: "Einstellungen", text: "KI, Standort, Passwort, Export" },
];

export function More() {
	const qc = useQueryClient();
	return (
		<div className="container page">
			<PageHead title="Mehr" />
			<div className="menu-grid">
				{TILES.map(({ href, icon: Icon, title, text }) => (
					<Link key={href} href={href} className="menu-tile">
						<span className="ic">
							<Icon size={22} />
						</span>
						<b>{title}</b>
						<span>{text}</span>
					</Link>
				))}
			</div>
			<button
				className="btn"
				style={{ alignSelf: "flex-start" }}
				onClick={async () => {
					await api("/api/auth/logout", { method: "POST" }).catch(() => {});
					try {
						localStorage.removeItem("garderobe-cache");
					} catch {
						/* ignore */
					}
					qc.clear();
					location.href = "/";
				}}
			>
				<LogOut size={17} /> Abmelden
			</button>
		</div>
	);
}
