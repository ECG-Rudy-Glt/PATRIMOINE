import { useEffect, useState } from "react";
import { Person } from "../api";
import { api } from "../api";
import { useFetch } from "../useFetch";
import { disablePush, enablePush, pushState, PushState } from "../push";
import { ACCOUNT_TYPES, dateTime, money, money0, pretty } from "../format";

const TYPE_PLURAL: Record<string, string> = { courant: "Tous les comptes courants", livret: "Tous les livrets" };

export default function Alerts() {
  const [reload, setReload] = useState(0);
  const rules = useFetch(api.alertRules, [reload]);
  const events = useFetch(api.alertEvents, [reload]);
  const channel = useFetch(api.alertChannel);
  const accounts = useFetch(api.accounts);
  const [target, setTarget] = useState("type:courant");
  const [threshold, setThreshold] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  // ouvrir la page = marquer les alertes comme lues
  useEffect(() => { if (events.data?.unread) api.markAlertsRead(); }, [events.data?.unread]);

  const add = async () => {
    const t = Number(threshold);
    if (!threshold || Number.isNaN(t)) return;
    const [kind, v] = target.split(":");
    await api.addAlertRule(kind === "type" ? { threshold: t, account_type: v } : { threshold: t, account_id: Number(v) });
    setThreshold("");
    setReload((n) => n + 1);
  };
  const test = async () => {
    try { await api.alertTest(); setMsg("Notification de test envoyée."); }
    catch (e) { setMsg(String(e)); }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Alertes</h1>
          <div className="sub">Vérifiées à chaque synchronisation : une notification quand un solde passe sous un seuil.</div>
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2>Seuils</h2>
          <table>
            <thead><tr><th>Compte(s)</th><th className="num">Seuil</th><th className="num">Actif</th><th /></tr></thead>
            <tbody>
              {rules.data?.map((r) => (
                <tr key={r.id}>
                  <td>{r.account_name ? pretty(r.account_name) : (TYPE_PLURAL[r.account_type!] ?? `Comptes : ${ACCOUNT_TYPES[r.account_type!] ?? r.account_type}`)}</td>
                  <td className="num">{money0(r.threshold)}</td>
                  <td className="num">
                    <input type="checkbox" checked={r.enabled}
                      onChange={async (e) => { await api.toggleAlertRule(r.id, e.target.checked); setReload((n) => n + 1); }} />
                  </td>
                  <td className="num">
                    <button className="ghost" aria-label="Supprimer"
                      onClick={async () => { await api.deleteAlertRule(r.id); setReload((n) => n + 1); }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="toolbar" style={{ marginTop: 14, marginBottom: 0 }}>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="type:courant">Tous les comptes courants</option>
              <option value="type:livret">Tous les livrets</option>
              {accounts.data?.map((a) => <option key={a.id} value={`acc:${a.id}`}>{pretty(a.name)} ({a.institution})</option>)}
            </select>
            <input type="number" placeholder="Seuil €" value={threshold} onChange={(e) => setThreshold(e.target.value)} style={{ width: 110 }} />
            <button className="primary" onClick={add}>Ajouter</button>
          </div>
        </div>

        <div className="card">
          <h2>Notifications sur téléphone</h2>
          <PushCard webpush={!!channel.data?.webpush} />
          {channel.data?.ntfy && (
            <p className="explain">
              Aussi via l'appli <b>ntfy</b> (serveur <b>{channel.data.server}</b>, sujet communiqué par Alex : il sert de mot de passe, ne le partage pas).
            </p>
          )}
          {!channel.data?.ntfy && !channel.data?.webpush && (
            <p className="explain">Les notifications ne sont pas encore activées : les alertes restent visibles ici uniquement.</p>
          )}
          <button onClick={test} disabled={!channel.data?.ntfy && !channel.data?.devices}>Envoyer une notification de test</button>
          {msg && <div className="sub" style={{ marginTop: 8 }}>{msg}</div>}
          <p className="explain" style={{ marginTop: 14 }}>
            Une alerte ne se redéclenche qu'après être repassée au-dessus du seuil. Fréquence : à chaque synchronisation (06:30 et 18:30).
          </p>
        </div>
      </div>

      <Unusual />
      <Digest />

      <div className="section-title">Historique des alertes de solde</div>
      <div className="card">
        <h2>Historique</h2>
        {events.data?.items.length ? (
          <table>
            <thead><tr><th>Date</th><th>Compte</th><th className="num">Solde</th><th className="num">Seuil</th><th className="num">Envoyée</th></tr></thead>
            <tbody>
              {events.data.items.map((e) => (
                <tr key={e.id}>
                  <td>{dateTime(e.fired_at)}</td>
                  <td>{pretty(e.account_name)} <span className="acct-meta">· {e.institution}</span></td>
                  <td className="num neg">{money(e.balance)}</td>
                  <td className="num">{money0(e.threshold)}</td>
                  <td className="num">{e.notified ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">Aucune alerte déclenchée pour l'instant.</div>}
      </div>
    </>
  );
}

function Unusual() {
  const an = useFetch(api.anomalies);
  return (
    <>
      <div className="section-title">Dépenses inhabituelles</div>
      <div className="card">
        <p className="explain" style={{ marginTop: 0 }}>
          À chaque synchro, une dépense de 50 € ou plus est signalée si elle dépasse 3× ton habitude chez ce marchand,
          ou 2× tes plus grosses dépenses de la catégorie. Notification sur téléphone.
        </p>
        {an.data?.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Marchand</th><th className="num">Montant</th><th className="num">Habituellement</th></tr></thead>
            <tbody>{an.data.map((x) => (
              <tr key={x.tx_id}><td>{new Date(x.booked_on).toLocaleDateString("fr-FR")}</td><td>{x.merchant} <span className="acct-meta">· {x.category_label}</span></td>
                <td className="num">{money(-x.amount)}</td><td className="num">~{money0(x.reference)}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <div className="empty">Rien d'inhabituel depuis l'activation (détection sur les nouvelles opérations uniquement).</div>}
      </div>
    </>
  );
}

function Digest() {
  const [reload, setReload] = useState(0);
  const persons = useFetch(api.persons, [reload]);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (p: Person, email: string) => { await api.updatePerson(p.id, p.name, email); setReload((n) => n + 1); };
  return (
    <>
      <div className="section-title">Digest mensuel par email</div>
      <div className="card">
        <p className="explain" style={{ marginTop: 0 }}>
          Le 25 de chaque mois (début de cycle), chaque personne reçoit le bilan du cycle écoulé ; le 1er du mois, le rapport complet (résumé et classeur Excel) est envoyé aux deux : chiffres, principaux postes,
          plafonds, objectifs, abonnements à surveiller, dépenses inhabituelles.
        </p>
        <div className="stack">
          {persons.data?.map((p) => (
            <label key={p.id} className="item-row" style={{ gridTemplateColumns: "90px 1fr" }}>
              <b style={{ alignSelf: "center" }}>{p.name}</b>
              <input type="email" defaultValue={p.email ?? ""} placeholder="adresse email"
                onBlur={(e) => e.target.value !== (p.email ?? "") && save(p, e.target.value)} />
            </label>
          ))}
        </div>
        <div className="toolbar" style={{ marginTop: 14, marginBottom: 0 }}>
          <a href="/api/digest/preview" target="_blank" rel="noreferrer"><button>Aperçu</button></a>
          <button onClick={async () => {
            try { const r = await api.digestSend(); setMsg(`Envoyé à ${r.sent.join(", ") || "personne (aucune adresse)"}.`); }
            catch (e) { setMsg(String(e).includes("SMTP") ? "Envoi impossible : le service d'e-mail n'est pas configuré." : String(e)); }
          }}>Envoyer maintenant</button>
        </div>
        {msg && <div className="sub" style={{ marginTop: 8 }}>{msg}</div>}
      </div>
    </>
  );
}

const PUSH_HELP: Record<PushState, string> = {
  "unsupported": "Ce navigateur ne gère pas les notifications push.",
  "needs-install": "Sur iPhone, les notifications n'existent que dans l'app installée : Safari → Partager → « Sur l'écran d'accueil », puis ouvre Patrimoine depuis l'icône.",
  "disabled-server": "Notifications push pas encore configurées sur le serveur.",
  "denied": "Notifications refusées pour cette app : réactive-les dans les réglages du téléphone (Notifications → Patrimoine).",
  "off": "Reçois les alertes (solde bas, paie, dépense inhabituelle, récap du dimanche) directement sur cet appareil.",
  "on": "Cet appareil reçoit les notifications.",
};

function PushCard({ webpush }: { webpush: boolean }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const devices = useFetch(api.pushDevices, [reload]);
  useEffect(() => { pushState().then(setState); }, [webpush, reload]);

  const toggle = async () => {
    setBusy(true); setErr(null);
    try { await (state === "on" ? disablePush() : enablePush()); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); setReload((n) => n + 1); }
  };

  if (!state) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <p className="explain" style={{ marginTop: 0 }}>{PUSH_HELP[state]}</p>
      {(state === "off" || state === "on") && (
        <button className={state === "off" ? "primary" : undefined} onClick={toggle} disabled={busy}>
          {state === "off" ? "Activer sur cet appareil" : "Désactiver sur cet appareil"}
        </button>
      )}
      {err && <div className="sub" style={{ marginTop: 8 }}>{err}</div>}
      {!!devices.data?.length && (
        <div className="stack" style={{ marginTop: 12 }}>
          {devices.data.map((d) => (
            <div key={d.id} className="item-row" style={{ gridTemplateColumns: "1fr auto" }}>
              <span>{d.device ?? "Appareil"} <span className="acct-meta">· depuis le {new Date(d.created_at).toLocaleDateString("fr-FR")}
                {d.last_ok_at ? ` · dernier envoi ${dateTime(d.last_ok_at)}` : ""}{d.failures ? ` · ${d.failures} échec(s)` : ""}</span></span>
              <button className="ghost" aria-label="Retirer cet appareil"
                onClick={async () => { await api.deletePushDevice(d.id); setReload((n) => n + 1); }}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
