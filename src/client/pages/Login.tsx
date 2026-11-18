import { useState, type FormEvent } from "react";
import { api } from "../api.ts";
import { Mascot } from "../components/Mascot.tsx";
import { errorText } from "../components/Toast.tsx";

export function Login({ setupAllowed, onDone }: { setupAllowed: boolean; onDone: () => void }) {
	const [pw, setPw] = useState("");
	const [pw2, setPw2] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		setError("");
		if (setupAllowed && pw !== pw2) return setError("Passwörter stimmen nicht überein");
		setBusy(true);
		try {
			await api(setupAllowed ? "/api/auth/setup" : "/api/auth/login", { method: "POST", body: { password: pw } });
			onDone();
		} catch (err) {
			setError(errorText(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="login-wrap">
			<form className="card login-card" onSubmit={submit}>
				<div style={{ display: "flex", justifyContent: "center" }}>
					<Mascot className="mascot" />
				</div>
				<div>
					<h1 className="hand" style={{ fontSize: "2.4rem" }}>
						Garderobe
					</h1>
					<p className="muted small" style={{ margin: "4px 0 0" }}>
						{setupAllowed ? "Lege ein Passwort für deine Garderobe fest." : "Schön, dass du da bist. Bitte anmelden."}
					</p>
				</div>
				<input
					className="input"
					type="password"
					autoComplete={setupAllowed ? "new-password" : "current-password"}
					placeholder="Passwort"
					value={pw}
					onChange={(e) => setPw(e.target.value)}
					autoFocus
					aria-label="Passwort"
				/>
				{setupAllowed && (
					<input className="input" type="password" autoComplete="new-password" placeholder="Passwort wiederholen" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-label="Passwort wiederholen" />
				)}
				{error && <div className="badge danger" style={{ justifyContent: "center", padding: 8 }}>{error}</div>}
				<button className="btn primary block" disabled={busy || !pw}>
					{busy ? "…" : setupAllowed ? "Passwort festlegen" : "Anmelden"}
				</button>
				<input type="text" name="username" autoComplete="username" value="garderobe" readOnly hidden />
			</form>
		</div>
	);
}
