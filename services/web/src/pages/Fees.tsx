import { useState } from "react";
import { api, FeeAccount, FeeBenchmark, FeeSchedule } from "../api";
import { useFetch } from "../useFetch";
import { usePerson } from "../person";
import { money, money0, pretty, signed } from "../format";
import Kpi from "../components/Kpi";

// Onglet « Frais » de Placements : tous les chiffres viennent de /alloc/fees (allocation-engine), rien n'est calculé ici.
const pctFmt = (n: number | null | undefined, digits = 2) =>
  n == null ? "—" : `${n.toLocaleString("fr-FR", { maximumFractionDigits: digits })} %`;
const ENV: Record<string, string> = { pea: "PEA", cto: "Compte-titres", assurance_vie: "Assurance-vie", per: "PER" };

export default function Fees() {
  const { person } = usePerson();
  const [reload, setReload] = useState(0);
  const f = useFetch(() => api.fees(person), [person, reload]);
  const [editing, setEditing] = useState<number | null>(null);
  const refresh = () => { setEditing(null); setReload((n) => n + 1); };
  const d = f.data;
  const t = d?.totals ?? {};

  return (
    <>
      <div className="grid kpis" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        <Kpi label="Tous mes frais, par an" value={money0(t.all_annual)}
          hint={d?.bank.available ? "Placements + frais bancaires" : "Placements seuls (budget indisponible)"} />
        <Kpi label="Frais des placements, par an" value={money0(t.annual)}
          hint={t.annual_pct != null ? `${pctFmt(t.annual_pct)} de l'encours` : undefined} />
        <Kpi label="Frais bancaires, par an" value={money0(d?.bank.annual)} hint="Moyenne mensuelle sur la période couverte × 12" />
        <Kpi label="Manque à gagner sur 20 ans" value={money0(t.manque_20)} hint={`vs sans frais · 10 ans : ${money0(t.manque_10)}`} />
        <Kpi label="Surcoût vs frais réduits, 20 ans" value={money0(t.vs_repere_20)} hint={`10 ans : ${money0(t.vs_repere_10)}`} />
      </div>

      {f.error && <div className="card err">{f.error}</div>}
      {d && !d.accounts.length && (
        <div className="card empty" style={{ marginBottom: 16 }}>
          Aucun compte de placement. Crée-le dans l'onglet « Opérations », puis saisis ici son barème de frais.
        </div>
      )}

      {!!d?.accounts.length && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Coût par compte <span className="sub">rendement brut hypothétique {pctFmt(d.gross_return_pct)} par an</span></h2>
          {d.accounts.map((a) => {
            const p20 = a.projection["20"], p10 = a.projection["10"];
            return (
              <section key={a.account_id} className="fee-account">
                <div className="line" style={{ alignItems: "flex-start" }}>
                  <div>
                    <b style={{ fontSize: 15 }}>{pretty(a.name)}</b>
                    <div className="acct-meta">{a.envelope}{a.institution ? ` · ${a.institution}` : ""} · encours {money0(a.value)} · versement {money0(a.monthly_contribution)}/mois ({a.contribution_source})</div>
                  </div>
                  <button onClick={() => setEditing(editing === a.account_id ? null : a.account_id)}>{editing === a.account_id ? "Fermer" : "Barème"}</button>
                </div>
                <div className="facts">
                  <div className="fact"><div className="kpi-label">Frais par an</div><b>{money(a.annual_total)}</b><div className="acct-meta">{pctFmt(a.annual_pct)} de l'encours</div></div>
                  <div className="fact"><div className="kpi-label">Manque à gagner, 10 ans</div><b>{money0(p10?.manque)}</b></div>
                  <div className="fact"><div className="kpi-label">Manque à gagner, 20 ans</div><b>{money0(p20?.manque)}</b>
                    <div className="acct-meta">capital {money0(p20?.avec_frais)} au lieu de {money0(p20?.sans_frais)}</div></div>
                  <div className="fact"><div className="kpi-label">Surcoût vs frais réduits, 20 ans</div>
                    <b className={(p20?.vs_repere ?? 0) > 0 ? "" : "credit"}>{p20?.vs_repere != null ? signed(p20.vs_repere) : "—"}</b>
                    <div className="acct-meta">{a.benchmark.label}</div></div>
                </div>
                <div className="acct-meta">
                  Détail annuel : gestion {money0(a.annual.gestion)} · supports {money0(a.annual.supports)} (TER {pctFmt(a.ter_pct)})
                  {!!a.annual.versements && <> · versements {money0(a.annual.versements)}</>}
                  {!!a.annual.arbitrages && <> · arbitrages {money0(a.annual.arbitrages)}</>}
                  {!!a.annual.tenue && <> · tenue {money0(a.annual.tenue)}</>}
                </div>
                {a.notes.map((n) => <div key={n} className="acct-meta">⚠ {n}</div>)}
                {editing === a.account_id && <ScheduleEditor key={editing} a={a} onSaved={refresh} />}
              </section>
            );
          })}
          <p className="explain">
            Frais annuels = encours × (frais de gestion + TER moyen des supports) + versements de l'année × frais sur versement
            + arbitrages + tenue de compte. Manque à gagner = capital obtenu sans aucun frais moins capital obtenu avec tes frais,
            avec le même encours de départ et les mêmes versements mensuels, au rendement brut hypothétique (calcul mois par mois).
            « vs repère » compare au même placement dans un contrat à frais réduits : un montant négatif signifie que tu paies déjà moins.
            Hypothèse, pas une prévision : seul l'écart entre les scénarios compte.
          </p>
        </div>
      )}

      <div className="grid two">
        <TerEditor onSaved={refresh} />
        <ParamsEditor onSaved={refresh} />
      </div>
    </>
  );
}

// ------------------------------------------------------------------ saisie du barème d'un compte

const FIELDS: [keyof FeeSchedule, string, string][] = [
  ["mgmt_pct", "Frais de gestion annuels", "% de l'encours"],
  ["entry_pct", "Frais sur versement", "% du versement"],
  ["custody_eur", "Frais de tenue de compte", "€ par an"],
  ["switch_pct", "Frais d'arbitrage", "% du montant arbitré"],
  ["switch_eur", "Frais d'arbitrage", "€ par arbitrage"],
  ["switches_per_year", "Arbitrages prévus", "par an"],
  ["switch_amount_eur", "Montant moyen arbitré", "€ (optionnel)"],
  ["monthly_contribution", "Versement mensuel prévu", "€ (vide = moyenne des achats 12 mois)"],
];
const OPTIONAL = new Set<keyof FeeSchedule>(["switch_amount_eur", "monthly_contribution"]);

function ScheduleEditor({ a, onSaved }: { a: FeeAccount; onSaved: () => void }) {
  const init = (k: keyof FeeSchedule) => (a.schedule?.[k] == null ? "" : String(a.schedule[k]));
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map(([k]) => [k, init(k)])));
  const [note, setNote] = useState(a.schedule?.note ?? "");
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const n = (k: keyof FeeSchedule) => (vals[k] === "" ? (OPTIONAL.has(k) ? null : 0) : Number(vals[k].replace(",", ".")));
    try {
      await api.setFees(a.account_id, {
        mgmt_pct: n("mgmt_pct") ?? 0, entry_pct: n("entry_pct") ?? 0, switch_pct: n("switch_pct") ?? 0,
        switch_eur: n("switch_eur") ?? 0, switches_per_year: n("switches_per_year") ?? 0,
        switch_amount_eur: n("switch_amount_eur"), custody_eur: n("custody_eur") ?? 0,
        monthly_contribution: n("monthly_contribution"), note,
      });
      onSaved();
    } catch (e) { setErr(String(e).replace(/^Error: \d+ /, "")); }
  };
  return (
    <div className="stack" style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
      <h2 style={{ margin: 0 }}>Barème — {pretty(a.name)} <span className="sub">voir les conditions tarifaires ou le DIC du contrat</span></h2>
      <div className="grid three" style={{ gap: 10 }}>
        {FIELDS.map(([k, label, unit]) => (
          <label key={k} className="field">
            <span>{label} <span className="sub">({unit})</span></span>
            <input type="number" min={0} step="any" value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
          </label>
        ))}
        <label className="field"><span>Note</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <div className="line">
        {err ? <span className="neg">{err}</span> : <span className="sub">Montants du compte entier ; la quote-part est appliquée selon le périmètre.</span>}
        <button className="primary" onClick={save}>Enregistrer</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ TER des supports détenus

function TerEditor({ onSaved }: { onSaved: () => void }) {
  const { person } = usePerson();
  const h = useFetch(() => api.holdings(person), [person]);
  const assets = useFetch(api.assets);
  const held = (assets.data ?? []).filter((s) => h.data?.items.some((p) => p.asset_id === s.id));
  const [vals, setVals] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    try {
      for (const [id, v] of Object.entries(vals)) await api.setTer(Number(id), v === "" ? null : Number(v.replace(",", ".")));
      setVals({}); setMsg("TER enregistrés."); onSaved();
    } catch (e) { setMsg(String(e).replace(/^Error: \d+ /, "")); }
  };
  return (
    <div className="card stack">
      <h2>Frais courants des supports (TER)</h2>
      {!held.length ? <div className="empty">Aucun support détenu.</div> : held.map((s) => (
        <label key={s.id} className="item-row" style={{ gridTemplateColumns: "1fr 100px" }}>
          <span style={{ alignSelf: "center" }}>{s.name}<span className="raw">{s.isin}</span></span>
          <input type="number" min={0} step="any" placeholder="% / an"
            value={vals[s.id] ?? (s.ter == null ? "" : String(s.ter))} onChange={(e) => setVals({ ...vals, [s.id]: e.target.value })} />
        </label>
      ))}
      <div className="line">
        <span className="sub">{msg ?? "Indiqués dans le DIC du support (« frais courants »)."}</span>
        <button className="primary" disabled={!Object.keys(vals).length} onClick={save}>Enregistrer</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ hypothèses : rendement et repères

function ParamsEditor({ onSaved }: { onSaved: () => void }) {
  const p = useFetch(api.feeParams);
  const [gross, setGross] = useState<string | null>(null);
  const [bench, setBench] = useState<FeeBenchmark[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const rows = bench ?? p.data?.benchmarks ?? [];
  const edit = (i: number, k: keyof FeeBenchmark, v: string) =>
    setBench(rows.map((b, j) => (j !== i ? b : { ...b, [k]: k === "label" ? v : v === "" ? (k === "ter_pct" ? null : 0) : Number(v) })));
  const save = async () => {
    try {
      await api.setFeeParams({ gross_return_pct: Number(gross ?? p.data?.gross_return_pct ?? 5), benchmarks: rows });
      setMsg("Hypothèses enregistrées."); onSaved();
    } catch (e) { setMsg(String(e).replace(/^Error: \d+ /, "")); }
  };
  return (
    <div className="card stack" style={{ alignSelf: "start" }}>
      <h2>Hypothèses</h2>
      <label className="item-row" style={{ gridTemplateColumns: "1fr 100px" }}>
        <span style={{ alignSelf: "center" }}>Rendement brut annuel hypothétique (%)</span>
        <input type="number" min={0} max={15} step="0.1" value={gross ?? String(p.data?.gross_return_pct ?? "")}
          onChange={(e) => setGross(e.target.value)} />
      </label>
      <div className="table-wrap"><table>
        <thead><tr><th>Repère à frais réduits</th><th className="num">Gestion %</th><th className="num">Versement %</th><th className="num">Tenue €/an</th><th className="num">TER %</th></tr></thead>
        <tbody>{rows.map((b, i) => (
          <tr key={b.account_type}>
            <td><b>{ENV[b.account_type] ?? b.account_type}</b><span className="raw">{b.label}</span></td>
            {(["mgmt_pct", "entry_pct", "custody_eur", "ter_pct"] as const).map((k) => (
              <td key={k} className="num"><input type="number" min={0} step="any" style={{ width: 70 }}
                placeholder={k === "ter_pct" ? "réel" : "0"} value={b[k] == null ? "" : String(b[k])}
                onChange={(e) => edit(i, k, e.target.value)} /></td>
            ))}
          </tr>
        ))}</tbody>
      </table></div>
      <div className="line">
        <span className="sub">{msg ?? "TER vide : mêmes supports qu'aujourd'hui (seul le contrat change)."}</span>
        <button className="primary" disabled={gross == null && bench == null} onClick={save}>Enregistrer</button>
      </div>
    </div>
  );
}
