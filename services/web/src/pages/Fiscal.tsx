import { useState } from "react";
import { api, FiscalEnvelope, FiscalSummary, TaxProfile } from "../api";
import { useFetch } from "../useFetch";
import { usePerson } from "../person";
import { ACCOUNT_TYPES, date, money0, pretty } from "../format";
import Progress from "../components/Progress";
import Status from "../components/Status";

const KINDS: Record<string, string> = { livret_a: "Livret A", ldds: "LDDS", lep: "LEP", autre: "Autre livret" };
const PER_SOURCE: Record<string, string> = {
  avis: "lu sur l'avis d'imposition", estimation: "estimé : 10 % des revenus d'activité, bornes PASS",
  plancher: "plancher (revenus non renseignés)",
};
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

export default function Fiscal() {
  const { person } = usePerson();
  const [reload, setReload] = useState(0);
  const sum = useFetch(() => api.fiscalSummary(person), [person, reload]);
  const rules = useFetch(api.fiscalRules);
  const [editing, setEditing] = useState(false);
  const refresh = () => setReload((n) => n + 1);
  const s = sum.data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Fiscalité</h1>
          <div className="sub">
            Règles {s?.rules_year ?? "–"} · profil fiscal {s?.profile_year ? `revenus ${s.profile_year}` : "non renseigné"}
            {s?.profile_year ? ` · déclaration ${s.joint ? "commune" : "séparée"}` : ""}. Tous les chiffres sont calculés par le serveur.
          </div>
        </div>
        <button className="primary" onClick={() => setEditing(true)}>Profil fiscal</button>
      </div>

      {sum.error && <div className="err">{sum.error}</div>}
      {s && !!(s.warnings.length || s.unverified_rules.length) && (
        <div className="card stack" style={{ marginBottom: 16 }}>
          {s.warnings.map((w) => <div className="explain" key={w}>{w}</div>)}
          {!!s.unverified_rules.length && (
            <div className="explain">
              Valeurs à confirmer sur service-public.fr / impots.gouv.fr : <b>{s.unverified_rules.join(", ")}</b> (voir « Règles appliquées »).
            </div>
          )}
        </div>
      )}

      {s && s.rules_year && (
        <>
          <Livrets s={s} onChange={refresh} />
          <div className="grid two" style={{ margin: "16px 0" }}>
            <Lep s={s} />
            <Per s={s} />
          </div>
          <Envelopes s={s} onChange={refresh} />
        </>
      )}

      <details className="card" style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer" }}><b>Règles appliquées {rules.data?.year ?? ""}</b> <span className="sub">mise à jour annuelle manuelle (table tax_rules)</span></summary>
        <div className="table-wrap" style={{ marginTop: 10 }}><table>
          <thead><tr><th>Règle</th><th className="num">Valeur</th><th>Source</th><th>Statut</th></tr></thead>
          <tbody>
            {rules.data?.items.map((r) => (
              <tr key={r.key}>
                <td>{r.label}<span className="raw">{r.key}</span></td>
                <td className="num"><b>{r.unit === "€" ? money0(r.value) : `${r.value.toLocaleString("fr-FR")} ${r.unit}`}</b></td>
                <td className="sub">{r.source}</td>
                <td>{r.verified ? <Status level="good">Vérifiée</Status> : <Status level="warning">À vérifier</Status>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </details>

      {editing && <ProfileForm onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} />}
    </>
  );
}

function Livrets({ s, onChange }: { s: FiscalSummary; onChange: () => void }) {
  const unclassified = s.livrets.accounts.filter((a) => !a.savings_kind);
  const setKind = async (id: number, kind: string) => { await api.setFiscalAccount(id, { savings_kind: kind || null }); onChange(); };
  return (
    <div className="card">
      <h2>Livrets réglementés <span className="sub">place restante sous les plafonds de versement</span></h2>
      <div className="facts" style={{ marginBottom: 14 }}>
        {s.livrets.totals.map((t) => (
          <div className="fact" key={t.kind}>
            <div className="kpi-label">{t.label} · plafond {money0(t.ceiling)}</div>
            <b>{money0(t.remaining_held)}</b>
            <div className="acct-meta">place restante · {t.openable ? `${t.openable} à ouvrir` : "aucun à ouvrir"}</div>
          </div>
        ))}
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Livret</th><th>Titulaire</th><th className="num">Solde</th><th style={{ width: "28%" }}>Remplissage</th><th className="num">Place restante</th></tr></thead>
        <tbody>
          {s.livrets.items.map((r) => (
            <tr key={`${r.kind}-${r.person_id}`}>
              <td>{r.label}</td>
              <td>{r.name}</td>
              <td className="num">{r.held ? money0(r.balance) : "—"}</td>
              <td>{r.held && r.balance != null
                ? <Progress value={(100 * r.balance) / r.ceiling} state={r.balance >= r.ceiling ? "over" : undefined} />
                : r.can_open ? <Status level="good">Pas encore ouvert</Status>
                : r.can_open === false ? <Status level="serious">Non éligible</Status>
                : <Status level="warning">Éligibilité inconnue</Status>}</td>
              <td className="num"><b>{r.held ? money0(r.remaining) : r.can_open ? `${money0(r.ceiling)} si ouvert` : "—"}</b></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <details style={{ marginTop: 12 }}>
        <summary className="sub" style={{ cursor: "pointer" }}>
          Nature des livrets suivis ({s.livrets.accounts.length}){unclassified.length ? ` · ${unclassified.length} à préciser` : ""}
        </summary>
        <div className="stack" style={{ marginTop: 10, gap: 6 }}>
          {s.livrets.accounts.map((a) => (
            <div className="line" key={a.id}>
              <span>{pretty(a.name)} <span className="acct-meta">{a.institution ?? ""} · {money0(a.balance)}</span></span>
              <select value={a.savings_kind ?? ""} aria-label={`Nature de ${a.name}`} onChange={(e) => setKind(a.id, e.target.value)}>
                <option value="">À préciser</option>
                {Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function Lep({ s }: { s: FiscalSummary }) {
  return (
    <div className="card">
      <h2>LEP <span className="sub">éligibilité selon le revenu fiscal de référence</span></h2>
      <div className="stack">
        {s.lep.map((r) => (
          <div key={r.person_id} className="stack" style={{ gap: 4 }}>
            <div className="line">
              <b>{r.name}</b>
              {r.eligible == null ? <Status level="warning">Profil fiscal à saisir</Status>
                : r.eligible ? <Status level="good">Éligible</Status> : <Status level="serious">Non éligible</Status>}
            </div>
            {r.ceiling != null && (
              <div className="acct-meta">
                RFR {money0(r.rfr)} ({r.basis === "foyer" ? "foyer" : "individuel"}, {r.parts?.toLocaleString("fr-FR")} part(s), revenus {r.income_year})
                · plafond {money0(r.ceiling)} · marge {money0(r.margin)}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="explain">Un LEP par déclarant au plus ; l'éligibilité se vérifie sur l'avis d'imposition (revenus N-1 ou N-2).</p>
    </div>
  );
}

function Per({ s }: { s: FiscalSummary }) {
  return (
    <div className="card">
      <h2>PER <span className="sub">plafond de déduction des versements de l'année</span></h2>
      <div className="stack">
        {s.per.items.map((r) => (
          <div key={r.person_id} className="stack" style={{ gap: 4 }}>
            <div className="line"><b>{r.name}</b><span className="sub">{PER_SOURCE[r.source]}</span></div>
            <div className="facts">
              <div className="fact"><div className="kpi-label">Plafond</div><b>{money0(r.ceiling)}</b></div>
              <div className="fact"><div className="kpi-label">Déjà versé ({r.paid_source})</div><b>{money0(r.paid)}</b></div>
              <div className="fact"><div className="kpi-label">Encore déductible</div><b>{money0(r.remaining)}</b></div>
            </div>
          </div>
        ))}
      </div>
      <p className="explain">
        Plancher {money0(s.per.floor)}, plafond {money0(s.per.cap)} (PASS {money0(s.per.pass)}). L'estimation ignore les plafonds
        non utilisés des 3 années précédentes : le montant de l'avis d'imposition, s'il est saisi, fait foi.
      </p>
    </div>
  );
}

function Envelopes({ s, onChange }: { s: FiscalSummary; onChange: () => void }) {
  const setOpened = async (e: FiscalEnvelope, v: string) => { await api.setFiscalAccount(e.id, { opened_on: v || null }); onChange(); };
  return (
    <div className="card">
      <h2>Ancienneté fiscale <span className="sub">PEA (5 ans), assurance-vie (8 ans), PER</span></h2>
      {!s.envelopes.length ? <div className="empty">Aucun PEA, assurance-vie ou PER suivi sur ce périmètre.</div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Contrat</th><th>Ouvert le</th><th className="num">Ancienneté</th><th>Seuil fiscal</th></tr></thead>
          <tbody>
            {s.envelopes.map((e) => (
              <tr key={e.id}>
                <td>{pretty(e.name)}<span className="raw">{ACCOUNT_TYPES[e.type] ?? e.type}{e.holders ? ` · ${e.holders}` : ""}</span></td>
                <td><input type="date" defaultValue={e.opened_on ?? ""} aria-label={`Date d'ouverture de ${e.name}`}
                  max={new Date().toISOString().slice(0, 10)}
                  onBlur={(ev) => ev.target.value !== (e.opened_on ?? "") && setOpened(e, ev.target.value)} /></td>
                <td className="num">{e.years != null ? `${e.years.toLocaleString("fr-FR")} ans` : "—"}</td>
                <td>{!e.threshold_years ? <span className="sub">pas de seuil (blocage jusqu'à la retraite)</span>
                  : !e.opened_on ? <Status level="warning">Date d'ouverture à saisir</Status>
                  : e.reached ? <Status level="good">{e.threshold_years} ans atteints le {date(e.threshold_date)}</Status>
                  : <Status level="warning">{e.threshold_years} ans le {date(e.threshold_date)} ({e.days_left} j)</Status>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {s.av_allowance.value != null && (
        <p className="explain">Abattement annuel sur les gains des rachats d'assurance-vie après 8 ans : <b>{money0(s.av_allowance.value)}</b> ({s.av_allowance.basis === "couple" ? "imposition commune" : "personne seule"}).</p>
      )}
    </div>
  );
}

function ProfileForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const prof = useFetch(api.fiscalProfile);
  const [p, setP] = useState<TaxProfile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cur = p ?? (prof.data && { ...prof.data, income_year: prof.data.income_year ?? new Date().getFullYear() - 1 });
  if (!cur) return null;
  const set = (patch: Partial<TaxProfile>) => setP({ ...cur, ...patch });
  const setPerson = (id: number, k: string, v: string) =>
    set({ persons: cur.persons.map((x) => (x.person_id === id ? { ...x, [k]: num(v) } : x)) });
  const field = (label: string, value: number | null, onChange: (v: string) => void, step = "1") => (
    <label className="field"><span>{label}</span>
      <input type="number" min={0} step={step} value={value ?? ""} onChange={(e) => onChange(e.target.value)} /></label>
  );

  const save = async () => {
    try { await api.saveFiscalProfile(cur); onSaved(); } catch (e) { setErr(String(e)); }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Profil fiscal">
        <div className="line"><h1 style={{ fontSize: 20 }}>Profil fiscal</h1>
          <button className="ghost" onClick={onClose} aria-label="Fermer">✕</button></div>
        <p className="explain">Recopie les montants de l'avis d'imposition. Le plafond PER {new Date().getFullYear()} se calcule sur les revenus {new Date().getFullYear() - 1}.</p>

        {field("Année des revenus (avis reçu l'année suivante)", cur.income_year, (v) => set({ income_year: num(v) }))}
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={cur.joint} onChange={(e) => set({ joint: e.target.checked })} />
          Déclaration commune (mariés ou pacsés)
        </label>
        {cur.joint && (
          <div className="cols-2">
            {field("Revenu fiscal de référence du foyer (€)", cur.rfr, (v) => set({ rfr: num(v) }))}
            {field("Nombre de parts", cur.parts, (v) => set({ parts: num(v) }), "0.25")}
          </div>
        )}

        {cur.persons.map((x) => (
          <div className="stack" key={x.person_id} style={{ gap: 8 }}>
            <div className="group-title"><b>{x.name}</b></div>
            {!cur.joint && (
              <div className="cols-2">
                {field("Revenu fiscal de référence (€)", x.rfr, (v) => setPerson(x.person_id, "rfr", v))}
                {field("Nombre de parts", x.parts, (v) => setPerson(x.person_id, "parts", v), "0.25")}
              </div>
            )}
            <div className="cols-2">
              {field("Revenus d'activité nets imposables (€)", x.earned_income, (v) => setPerson(x.person_id, "earned_income", v))}
              {field("Plafond épargne retraite de l'avis (€)", x.per_ceiling_notice, (v) => setPerson(x.person_id, "per_ceiling_notice", v))}
              {field("Versements PER déjà faits cette année (€)", x.per_paid, (v) => setPerson(x.person_id, "per_paid", v))}
            </div>
            <div className="acct-meta">Versements PER vides : calculés d'après les opérations saisies sur les PER.</div>
          </div>
        ))}

        {err && <div className="err" style={{ padding: 0, textAlign: "left" }}>{err}</div>}
        <div className="line"><span />
          <span style={{ display: "flex", gap: 8 }}><button onClick={onClose}>Annuler</button>
            <button className="primary" disabled={!cur.income_year} onClick={save}>Enregistrer</button></span>
        </div>
      </aside>
    </>
  );
}
