import "@fontsource-variable/nunito";
import "@fontsource/caveat/500.css";
import "@fontsource/caveat/600.css";
import "./styles.css";
import { QueryClient } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiError } from "./api.ts";
import { App } from "./App.tsx";
import { ToastProvider } from "./components/Toast.tsx";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			gcTime: 7 * 24 * 3600_000,
			refetchOnWindowFocus: true,
			retry: (count, err) => !(err instanceof ApiError && (err.status === 401 || err.status === 404)) && count < 2,
		},
	},
});

let storage: Storage | undefined;
try {
	storage = window.localStorage;
} catch {
	storage = undefined;
}

const persister = createSyncStoragePersister({ storage, key: "garderobe-cache", throttleTime: 2000 });

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<PersistQueryClientProvider
			client={queryClient}
			persistOptions={{
				persister,
				maxAge: 7 * 24 * 3600_000,
				buster: "v1",
				dehydrateOptions: {
					shouldDehydrateQuery: (q) => q.state.status === "success" && !String(q.queryKey[0]).startsWith("suggest"),
				},
			}}
		>
			<ToastProvider>
				<App />
			</ToastProvider>
		</PersistQueryClientProvider>
	</StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js").catch(() => {});
	});
}
