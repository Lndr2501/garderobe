import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Route, Switch } from "wouter";
import { useRotationFixups } from "./lib/recognize.ts";
import { useStudioWork } from "./lib/studio.ts";
import { api, UNAUTHORIZED_EVENT } from "./api.ts";
import { Layout } from "./components/Layout.tsx";
import { Mascot } from "./components/Mascot.tsx";
import { AddItems } from "./pages/AddItems.tsx";
import { Assistant } from "./pages/Assistant.tsx";
import { ItemDetail } from "./pages/ItemDetail.tsx";
import { ItemEdit } from "./pages/ItemEdit.tsx";
import { Login } from "./pages/Login.tsx";
import { More } from "./pages/More.tsx";
import { OutfitBuilder } from "./pages/OutfitBuilder.tsx";
import { Outfits } from "./pages/Outfits.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { Shopping } from "./pages/Shopping.tsx";
import { StatsPage } from "./pages/Stats.tsx";
import { TripDetail, Trips } from "./pages/Trips.tsx";
import { TryOnPage } from "./pages/TryOn.tsx";
import { Wardrobe } from "./pages/Wardrobe.tsx";

interface AuthStatus {
	authenticated: boolean;
	setupRequired: boolean;
	setupAllowed: boolean;
}

export function App() {
	const qc = useQueryClient();
	const auth = useQuery({
		queryKey: ["auth"],
		queryFn: () => api<AuthStatus>("/api/auth/status"),
		staleTime: 5 * 60_000,
		retry: 1,
	});

	useEffect(() => {
		const onUnauth = () => void qc.invalidateQueries({ queryKey: ["auth"] });
		window.addEventListener(UNAUTHORIZED_EVENT, onUnauth);
		return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauth);
	}, [qc]);

	if (auth.isPending) {
		return (
			<div className="login-wrap">
				<Mascot />
			</div>
		);
	}
	// Offline with a cached session: allow read-only use of cached data.
	if (auth.isError && !navigator.onLine) return <Routes />;
	if (!auth.data?.authenticated) {
		return <Login setupAllowed={!!auth.data?.setupAllowed} onDone={() => void qc.invalidateQueries()} />;
	}
	return <Routes />;
}

function Routes() {
	useRotationFixups();
	useStudioWork();
	return (
		<Layout>
			<Switch>
				<Route path="/" component={Wardrobe} />
				<Route path="/neu" component={AddItems} />
				<Route path="/teil/:id" component={ItemDetail} />
				<Route path="/teil/:id/bearbeiten" component={ItemEdit} />
				<Route path="/outfits" component={Outfits} />
				<Route path="/outfits/neu" component={OutfitBuilder} />
				<Route path="/outfits/:id" component={OutfitBuilder} />
				<Route path="/assistent" component={Assistant} />
				<Route path="/mehr" component={More} />
				<Route path="/statistik" component={StatsPage} />
				<Route path="/reisen" component={Trips} />
				<Route path="/reisen/:id" component={TripDetail} />
				<Route path="/shopping" component={Shopping} />
				<Route path="/anprobe" component={TryOnPage} />
				<Route path="/einstellungen" component={SettingsPage} />
				<Route>
					<div className="container page">
						<div className="empty">
							<div className="hand">Hier hängt nichts.</div>
						</div>
					</div>
				</Route>
			</Switch>
		</Layout>
	);
}
