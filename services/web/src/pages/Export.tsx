import { useState } from "react";
import { api, ImportPreview } from "../api";
import { date, signed } from "../format";
import { useFetch } from "../useFetch";
import { usePerson } from "../person";

const PERIODS = [{ m: 3, label: "3 mois" }, { m: 6, label: "6 mois" }, { m: 12, label: "12 mois" }, { m: 24, label: "24 mois" }, { m: 0, label: "Tout" }];

function Import() {
  const accounts = useFetch(api.accounts);
  const [accountId, setAccountId] = useState("");
  const [mode, setMode] = useState<"extend" | "all">("extend");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const eligible = (accounts.data ?? []).filter((a) => (a.type === "courant" || a.type === "livret") && a.source !== "manuel");

  const reset = () => { setPreview(null); setDone(null); setError(null); };
  const run = async (dry: boolean) => {
    if (!file || !accountId) return;
    setBusy(true); setError(null);
    try {
      const r = await api.importHistory(Number(accountId), await file.arrayBuffer(), file.name, mode, dry);
      if (dry) { setPreview(r); setDone(null); } else { setDone(r); setPreview(null); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setPreview(null);
    } finally { setBusy(false); }
  };
  const shown = preview ?? done;

  return (
    <div className="card stack" style={{ gap: 14, maxWidth: 720, marginTop: 16 }}>
      <div>
        <div className="goal-name">Importer un historique</div>
        <div className="acct-meta">
          Les banques ne donnent par l'API que quelques semaines à quelques mois. Pour remonter plus loin, téléchargez un export
          dans votre espace client (espace client → compte → télécharger les opérations, format CSV ou OFX, période la plus longue),
          puis importez-le ici. Aucune opération existante n'est modifiée.
        </div>
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <label className="field">
          <span className="kpi-label">Compte</span>
          <select value={accountId} onChange={(e) => { setAccountId(e.target.value); reset(); }}>
            <option value="">Choisir un compte…</option>
            {eligible.map((a) => <option key={a.id} value={a.id}>{a.name}{a.institution ? ` (${a.institution})` : ""}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="kpi-label">Fichier (.csv, .ofx, .txt, 8 Mo maximum)</span>
          <input type="file" accept=".csv,.ofx,.qfx,.txt" onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }} />
        </label>
        <label className="field">
          <span className="kpi-label">Que faut-il importer ?</span>
          <select value={mode} onChange={(e) => { setMode(e.target.value as "extend" | "all"); reset(); }}>
            <option value="extend">Seulement les opérations plus anciennes que la première déjà connue (recommandé)</option>
            <option value="all">Tout le fichier, sauf les opérations déjà présentes (même date, montant et libellé)</option>
          </select>
        </label>
        <div className="line" style={{ gap: 8 }}>
          <button className="primary" disabled={!file || !accountId || busy} onClick={() => run(true)}>
            {busy && !preview ? "Analyse…" : "Analyser"}
          </button>
          {preview && preview.new > 0 && (
            <button disabled={busy} onClick={() => run(false)}>{busy ? "Import…" : `Importer ${preview.new} opération${preview.new > 1 ? "s" : ""}`}</button>
          )}
        </div>
      </div>

      {error && <div className="err" role="alert" style={{ padding: 0, textAlign: "left" }}>{error}</div>}

      {done && (
        <div role="status" className="pos">
          {done.result
            ? <>Import terminé : {done.result.inserted} opération{done.result.inserted > 1 ? "s" : ""} ajoutée{done.result.inserted > 1 ? "s" : ""}
                {done.skipped > 0 && <>, {done.skipped} ignorée{done.skipped > 1 ? "s" : ""}</>}.
                {" "}{done.result.backfilled} solde{done.result.backfilled > 1 ? "s" : ""} quotidien{done.result.backfilled > 1 ? "s" : ""} reconstitué{done.result.backfilled > 1 ? "s" : ""},
                {" "}{done.result.categorized} opération{done.result.categorized > 1 ? "s" : ""} catégorisée{done.result.categorized > 1 ? "s" : ""}.</>
            : "Rien de nouveau à importer."}
        </div>
      )}

      {shown && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="divider" />
          <div>
            <strong>{shown.new}</strong> nouvelle{shown.new > 1 ? "s" : ""} opération{shown.new > 1 ? "s" : ""} sur {shown.read} lue{shown.read > 1 ? "s" : ""}
            {" "}({shown.format.toUpperCase()}, compte « {shown.account} »)
          </div>
          <div className="acct-meta">
            Période du fichier : {date(shown.period.from)} au {date(shown.period.to)}.
            {" "}Première opération déjà connue du compte : {shown.first_known ? date(shown.first_known) : "aucune"}.
          </div>
          {shown.skipped_reasons.map((r) => (
            <div key={r.code} className="acct-meta">{r.n} ignorée{r.n > 1 ? "s" : ""} : {r.label}.</div>
          ))}
          {shown.warnings.map((w, i) => <div key={i} className="warn" style={{ fontSize: 13 }}>{w}</div>)}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Libellé</th><th className="num">Montant</th><th /></tr></thead>
              <tbody>
                {shown.examples.map((x, i) => (
                  <tr key={i} style={x.new ? undefined : { opacity: 0.55 }}>
                    <td>{date(x.booked_on)}</td><td>{x.label || "—"}</td>
                    <td className={`num ${x.amount < 0 ? "neg" : "pos"}`}>{signed(x.amount)}</td>
                    <td>{x.new ? "" : <span className="badge">ignorée</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.examples.length > 0 && <div className="acct-meta">Exemples (les plus anciennes et les plus récentes lignes).</div>}
        </div>
      )}
    </div>
  );
}

function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `il y a ${h} h${m % 60 ? ` ${m % 60} min` : ""}` : `il y a ${Math.floor(h / 24)} jours`;
}

function MonthlyReports() {
  const [tick, setTick] = useState(0);
  const list = useFetch(api.reports, [tick]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const generate = async () => {
    setBusy(true); setErr(null);
    try { await api.generateReport(); setTick((t) => t + 1); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const month = (m: string) => new Date(`${m}-01`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const kb = (n: number) => `${Math.round(n / 1024)} Ko`;
  return (
    <div className="card stack" style={{ gap: 12, maxWidth: 720, marginBottom: 16 }}>
      <div className="line" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div style={{ flex: "1 1 320px" }}>
          <div className="goal-name">Rapport mensuel — situation financière complète</div>
          <div className="acct-meta">
            Un classeur Excel par mois : synthèse, Alex, Sam, compte commun, évolution de chaque compte (graphes par classe),
            dépenses à éviter, conseils de l'IA, objectifs et opérations. Généré automatiquement le 1er de chaque mois.
          </div>
        </div>
        <button className="primary" disabled={busy} onClick={generate}>{busy ? "Génération…" : "Générer maintenant"}</button>
      </div>
      {err && <div className="err" role="alert" style={{ padding: 0, textAlign: "left" }}>{err}</div>}
      {(list.data ?? []).length ? (
        <div className="stack" style={{ gap: 0 }}>
          {(list.data ?? []).map((r) => (
            <div className="line" key={r.month} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
              <span>{month(r.month)} <span className="acct-meta">· généré {ago(r.created_at)} · {kb(r.size_bytes)}</span></span>
              <a href={`/api/reports/${r.month}/download`}><button>Télécharger</button></a>
            </div>
          ))}
        </div>
      ) : <div className="acct-meta">Aucun rapport pour l'instant. Le premier sera créé automatiquement le 1er du mois, ou à la demande.</div>}
    </div>
  );
}

function HomeAssistant() {
  const ha = useFetch(api.haIntegration);
  const d = ha.data;
  if (!d || (!d.configured && !d.url)) return null;
  const stale = !d.last_push || Date.now() - new Date(d.last_push).getTime() > 3600_000;
  return (
    <div className="card stack" style={{ gap: 8, maxWidth: 720, marginTop: 16 }}>
      <div className="goal-name">Home Assistant</div>
      {d.configured ? (
        <div className={stale ? "warn" : "pos"} role="status">
          {d.last_push ? <>Dernière mise à jour : {ago(d.last_push)}{stale && " (liaison peut-être interrompue)"}</>
            : "Aucune mise à jour réussie enregistrée pour l'instant"}
        </div>
      ) : <div className="acct-meta">Envoi automatique non configuré (HA_WEBHOOK_URL).</div>}
      <div className="acct-meta">
        Les chiffres sont poussés à Home Assistant après chaque synchronisation bancaire, puis toutes les 30 minutes.
        {d.url && <> <a href={d.url} target="_blank" rel="noopener noreferrer">Ouvrir le tableau de bord</a>.</>}
      </div>
    </div>
  );
}

export default function Export() {
  const { person } = usePerson();
  const [months, setMonths] = useState(12);
  const scope = person === -1 ? "le foyer (compte commun)" : person ? "les comptes personnels sélectionnés" : "tous les comptes";
  const url = (kind: "xlsx" | "csv") => `/api/export/${kind}?months=${months}${person ? `&person=${person}` : ""}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Export et import</h1>
          <div className="sub">Télécharger vos données pour {scope} (le périmètre se choisit dans la colonne de gauche), ou importer un historique bancaire plus ancien</div>
        </div>
      </div>

      <MonthlyReports />

      <div className="card stack" style={{ gap: 16, maxWidth: 720 }}>
        <div>
          <div className="kpi-label">Période</div>
          <div className="seg" role="radiogroup" aria-label="Période exportée" style={{ marginTop: 6 }}>
            {PERIODS.map((p) => (
              <button key={p.m} role="radio" aria-checked={months === p.m} className={months === p.m ? "on" : ""}
                onClick={() => setMonths(p.m)}>{p.label}</button>
            ))}
          </div>
          <div className="acct-meta" style={{ marginTop: 6 }}>
            L'historique réellement disponible dépend des comptes (par exemple, un compte récent ou une banque qui limite la profondeur).
          </div>
        </div>

        <div className="divider" />

        <div className="line" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 320px" }}>
            <div className="goal-name">Excel avec graphiques (.xlsx)</div>
            <div className="acct-meta">
              Un résumé avec des graphiques déjà construits (entrées et sorties, solde du mois, patrimoine, postes de dépenses),
              puis une feuille par jeu de données : mensuel, catégories, patrimoine, comptes, virements, paies, transactions.
            </div>
          </div>
          <button className="primary" onClick={() => { window.location.href = url("xlsx"); }}>Télécharger l'Excel</button>
        </div>

        <div className="line" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 320px" }}>
            <div className="goal-name">Fichiers CSV (.zip)</div>
            <div className="acct-meta">
              Les mêmes données en CSV (séparateur « ; », virgule décimale, UTF-8) : s'ouvrent directement dans Excel ou LibreOffice.
              Un CSV ne peut pas contenir de graphiques : ils sont dans l'export Excel.
            </div>
          </div>
          <button onClick={() => { window.location.href = url("csv"); }}>Télécharger les CSV</button>
        </div>
      </div>

      <HomeAssistant />
      <Import />
    </>
  );
}
