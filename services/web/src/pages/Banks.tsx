import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, BankSession } from "../api";
import { useFetch } from "../useFetch";
import { date, dateTime, pretty } from "../format";
import Status, { Level } from "../components/Status";

const RENEW_DAYS = 14;

function expiry(s: BankSession): [Level, string] {
  if (s.days_left < 0) return ["critical", "Expiré"];
  if (s.days_left <= RENEW_DAYS) return ["warning", `${s.days_left} j restants`];
  return ["good", `${s.days_left} j restants`];
}

export default function Banks() {
  const [params, setParams] = useSearchParams();
  const sessions = useFetch(api.bankSessions);
  const persons = useFetch(api.persons);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // redirection vers la banque : l'URL Enable Banking renvoie ensuite sur /api/bank/callback puis ici
  const go = async (key: string, start: () => Promise<{ url: string }>) => {
    setBusy(key); setErr(null);
    try { window.location.assign((await start()).url); }
    catch (e) { setErr(String(e)); setBusy(null); }
  };

  const ok = params.get("ok"), erreur = params.get("erreur");
  const current = sessions.data?.filter((s) => s.status === "active") ?? [];
  const replaced = sessions.data?.filter((s) => s.status !== "active") ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Banques</h1>
          <div className="sub">Accès DSP2 via Enable Banking : consentement à renouveler tous les 90 à 180 jours selon la banque.</div>
        </div>
      </div>

      {(ok || erreur) && (
        <div className="notice" style={ok ? { borderColor: "var(--pos)", color: "var(--pos)" } : undefined} role="status">
          <span>
            {ok ? <>
              <b>{ok}</b> connectée : {params.get("comptes")} compte(s), accès jusqu'au {date(params.get("jusqu"))}.
              {params.get("comptes") === "0"
                ? " Aucun compte renvoyé : déclarer les comptes dans le portail Enable Banking (« Link accounts »), puis renouveler."
                : " Première synchronisation en cours (quelques secondes à quelques minutes)."}
            </> : erreur}
          </span>
          <button className="ghost" aria-label="Fermer" onClick={() => setParams({}, { replace: true })}>✕</button>
        </div>
      )}
      {err && <div className="notice" role="alert"><span>{err}</span></div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Accès bancaires <span className="sub">{current.length} session(s) active(s)</span></h2>
        {sessions.error ? <div className="err">{sessions.error}</div> : current.length ? (
          <div>
            {current.map((s) => {
              const [level, label] = expiry(s);
              return (
                <section key={s.session_id} className="bank-session">
                  <div className="line" style={{ alignItems: "flex-start" }}>
                    <div>
                      <b style={{ fontSize: 15 }}>{s.bank}</b>
                      <div className="acct-meta" style={{ marginTop: 2 }}>
                        {s.accounts.length ? s.accounts.map((a) => (
                          <span key={a.uid} style={{ display: "block" }}>{a.name ? pretty(a.name) : "Compte en attente de synchro"}{a.holders ? ` · ${a.holders}` : ""}</span>
                        )) : "Aucun compte renvoyé (voir « Link accounts »)"}
                      </div>
                    </div>
                    <button className={s.days_left <= RENEW_DAYS ? "primary" : ""} disabled={!!busy}
                      onClick={() => go(s.session_id, () => api.bankRenew(s.session_id))}>
                      {busy === s.session_id ? "Redirection…" : "Renouveler"}
                    </button>
                  </div>
                  <div className="chips" style={{ alignItems: "center" }}>
                    <Status level={level}>{label}</Status>
                    <span className="acct-meta">jusqu'au {date(s.valid_until)} · dernière synchro {dateTime(s.last_sync_at)}</span>
                  </div>
                  {s.last_error && <div className="acct-meta neg">{s.last_error}</div>}
                </section>
              );
            })}
          </div>
        ) : <div className="empty">{sessions.loading ? "Chargement…" : "Aucune banque connectée."}</div>}
        {!!replaced.length && (
          <details style={{ marginTop: 12 }}>
            <summary className="acct-meta">{replaced.length} ancienne(s) session(s) remplacée(s)</summary>
            <ul className="acct-meta">
              {replaced.map((s) => <li key={s.session_id}>{s.bank} — créée le {date(s.created_at)}, valable jusqu'au {date(s.valid_until)}</li>)}
            </ul>
          </details>
        )}
      </div>

      <div className="grid two">
        <AddBank persons={persons.data ?? []} busy={busy} onStart={(bank, holders) => go("add", () => api.bankAuth(bank, holders))} />
        <div className="card">
          <h2>À savoir</h2>
          <p className="explain" style={{ marginTop: 0 }}>
            L'application Enable Banking est en <b>mode restreint</b> (gratuit, limité à nos propres comptes) :
            seuls les comptes déclarés dans le portail Enable Banking (<b>« Link accounts »</b>) sont renvoyés.
            Un compte absent après connexion : le lier dans le portail, puis « Renouveler ».
          </p>
          <p className="explain">
            L'adresse de retour <code>{window.location.origin}/api/bank/callback</code> doit figurer dans les
            URL de redirection autorisées de l'application, dans le portail.
          </p>
          <p className="explain">
            Les identifiants bancaires sont saisis sur le site de la banque, jamais ici. Une notification ntfy prévient
            {` ${RENEW_DAYS}`} jours avant l'expiration ; renouveler conserve les comptes et leur historique.
          </p>
        </div>
      </div>
    </>
  );
}

function AddBank({ persons, busy, onStart }: {
  persons: { id: number; name: string }[]; busy: string | null; onStart: (bank: string, holders: number[]) => void;
}) {
  const banks = useFetch(() => api.aspsps("FR"));
  const [q, setQ] = useState("");
  const [bank, setBank] = useState("");
  const [holders, setHolders] = useState<number[]>([]);
  const list = useMemo(() => {
    const t = q.trim().toLocaleLowerCase("fr-FR");
    return (banks.data ?? []).filter((b) => !t || b.name.toLocaleLowerCase("fr-FR").includes(t));
  }, [banks.data, q]);
  const picked = banks.data?.find((b) => b.name === bank);
  const toggle = (id: number) => setHolders((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));

  return (
    <div className="card">
      <h2>Ajouter une banque</h2>
      {banks.error ? <div className="err" style={{ padding: 0, textAlign: "left" }}>Liste des banques indisponible ({banks.error}).</div> : (
        <div className="stack">
          <input type="search" placeholder="Rechercher une banque (ex. Crédit Mutuel)" value={q} onChange={(e) => setQ(e.target.value)} />
          <select size={6} value={bank} onChange={(e) => setBank(e.target.value)} aria-label="Banque">
            {banks.loading && <option disabled>Chargement…</option>}
            {list.map((b) => <option key={b.name} value={b.name}>{b.name}{b.beta ? " (bêta)" : ""}</option>)}
          </select>
          {picked && <div className="acct-meta">Consentement maximal chez cette banque : {picked.max_days} jours.</div>}
          <div>
            <div className="acct-meta" style={{ marginBottom: 6 }}>Titulaire(s) des comptes (compte joint : cocher les deux)</div>
            <div className="toolbar" style={{ marginBottom: 0 }}>
              {persons.map((p) => (
                <label key={p.id} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={holders.includes(p.id)} onChange={() => toggle(p.id)} />{p.name}
                </label>
              ))}
            </div>
          </div>
          <div>
            <button className="primary" disabled={!bank || !holders.length || !!busy} onClick={() => onStart(bank, holders)}>
              {busy === "add" ? "Redirection vers la banque…" : "Ajouter une banque"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
