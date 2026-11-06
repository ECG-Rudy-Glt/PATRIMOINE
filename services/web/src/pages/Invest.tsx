import { useState } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AllocRow, api, Signal } from "../api";
import { useFetch } from "../useFetch";
import { usePerson } from "../person";
import { date, money, money0, pretty, shortDate, signed } from "../format";
import { legendText } from "../components/legend";
import Kpi from "../components/Kpi";
import Donut from "../components/Donut";
import Status, { Level } from "../components/Status";
import Fees from "./Fees";

const axis = { stroke: "var(--muted)", fontSize: 12, tickLine: false, axisLine: false };
const tip = { contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" } };
const pctFmt = (n: number | null | undefined, sign = false) =>
  n == null ? "—" : `${sign && n > 0 ? "+" : ""}${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
const TABS = ["Portefeuille", "Allocation", "Frais", "Marchés", "Opérations"] as const;

export default function Invest() {
  // lien direct vers un onglet : /placements?tab=Frais
  const [tab, setTab] = useState<(typeof TABS)[number]>(() => {
    const q = new URLSearchParams(window.location.search).get("tab");
    return (TABS as readonly string[]).includes(q ?? "") ? (q as (typeof TABS)[number]) : "Portefeuille";
  });
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Placements</h1>
          <div className="sub">Positions, allocation cible, plan d'investissement, frais et marchés. Chiffres calculés par le moteur de règles ; rien n'est exécuté.</div>
        </div>
        <div className="seg" role="tablist">
          {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}
        </div>
      </div>
      {tab === "Portefeuille" && <Portfolio />}
      {tab === "Allocation" && <Allocation />}
      {tab === "Frais" && <Fees />}
      {tab === "Marchés" && <Markets />}
      {tab === "Opérations" && <Operations />}
    </>
  );
}

// ------------------------------------------------------------------ portefeuille

function Portfolio() {
  const { person } = usePerson();
  const h = useFetch(() => api.holdings(person), [person]);
  const hist = useFetch(() => api.portfolioHistory(person), [person]);
  const d = h.data;
  if (d && !d.items.length)
    return <div className="card empty">Aucun placement pour l'instant. Ajoute un compte de placement et tes opérations dans l'onglet « Opérations » (ou importe un CSV de ton courtier).</div>;
  return (
    <>
      <div className="grid kpis">
        <Kpi label="Valeur des placements" value={money(d?.total)} />
        <Kpi label="Montant investi" value={money(d?.invested)} hint="Prix de revient, frais inclus" />
        <Kpi label="Plus-value latente" value={d ? signed(d.gain) : "—"} hint={pctFmt(d?.gain_pct, true)} />
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Valeur du portefeuille et montant investi</h2>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={hist.data ?? []}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="day" tickFormatter={(x) => shortDate(x)} minTickGap={40} {...axis} />
            <YAxis tickFormatter={(v) => money0(v)} width={80} {...axis} />
            <Tooltip {...tip} formatter={(v) => money(Number(v))} labelFormatter={(x) => date(String(x))} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
            <Area isAnimationActive={false} type="monotone" dataKey="value" name="Valeur" stroke="var(--series-1)" strokeWidth={2} fill="var(--series-1)" fillOpacity={0.12} />
            <Line isAnimationActive={false} type="stepAfter" dataKey="invested" name="Investi" stroke="var(--series-2)" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="card">
        <h2>Positions</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Support</th><th>Compte</th><th className="num">Quantité</th><th className="num">PRU</th><th className="num">Cours</th><th className="num">Valeur</th><th className="num">+/- value</th></tr></thead>
            <tbody>
              {d?.items.map((p) => (
                <tr key={`${p.account_id}-${p.asset_id}`}>
                  <td><b>{p.asset}</b><span className="raw">{p.isin} · {p.exposure.replace("_", " ")}</span>
                    {!p.envelope_ok && <Status level="critical">{p.envelope_issue}</Status>}</td>
                  <td className="acct-meta">{pretty(p.account)}</td>
                  <td className="num">{p.quantity.toLocaleString("fr-FR", { maximumFractionDigits: 4 })}</td>
                  <td className="num">{money(p.pru)}</td>
                  <td className="num">{money(p.price)}<span className="raw">{p.price_day ? shortDate(p.price_day) : ""}</span></td>
                  <td className="num"><b>{money(p.value)}</b></td>
                  <td className={"num " + ((p.gain ?? 0) < 0 ? "ink" : "credit")}>{p.gain != null ? signed(p.gain) : "—"}<span className="raw">{pctFmt(p.gain_pct, true)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ allocation

function Allocation() {
  const { person } = usePerson();
  const [reload, setReload] = useState(0);
  const alloc = useFetch(() => api.allocation(person), [person, reload]);
  const [sim, setSim] = useState<number | null>(null);
  const plan = useFetch(() => api.plan(person, sim ?? undefined), [person, reload, sim]);
  const [editing, setEditing] = useState(false);
  const rows = alloc.data ?? [];

  return (
    <>
      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2>Actuel et cible <button onClick={() => setEditing(!editing)}>{editing ? "Fermer" : "Définir la cible"}</button></h2>
          {editing ? <TargetEditor rows={rows} onSaved={() => { setEditing(false); setReload((n) => n + 1); }} /> : <AllocBars rows={rows} />}
        </div>
        <div className="card" style={{ alignSelf: "start" }}>
          <h2>Répartition actuelle</h2>
          <Donut items={rows.filter((r) => r.value > 0).map((r) => ({ name: r.label, value: r.value }))} center="Patrimoine financier" />
        </div>
      </div>

      <div className="card">
        <h2>Plan d'investissement du mois <span className="sub">{plan.data ? `${money0(plan.data.monthly)} · source : ${plan.data.source}` : ""}</span></h2>
        <label className="field" style={{ maxWidth: 420, marginBottom: 14 }}>
          <span>Simuler un autre montant mensuel : <b>{money0(sim ?? plan.data?.monthly ?? 0)}</b></span>
          <input type="range" min={0} max={2000} step={25} value={sim ?? plan.data?.monthly ?? 0} onChange={(e) => setSim(Number(e.target.value))} />
        </label>
        {plan.data?.note && <div className="sub">{plan.data.note}</div>}
        {plan.data && !plan.data.monthly && !plan.data.note && (
          <div className="explain">Montant investissable nul aujourd'hui (coussin de sécurité à reconstituer d'abord, voir Budget). Utilise le curseur pour simuler.</div>
        )}
        {!!plan.data?.items.length && (
          <div className="table-wrap"><table>
            <thead><tr><th>Exposition</th><th className="num">Montant</th><th>Enveloppe (filtre fiscal appliqué)</th></tr></thead>
            <tbody>{plan.data.items.map((i) => (
              <tr key={i.exposure}>
                <td><b>{i.label}</b></td>
                <td className="num"><b>{money0(i.amount)}</b></td>
                <td>{i.envelope ? <>{i.envelope}<span className="raw">{i.envelope_why}</span></>
                  : <><Status level="warning">À ouvrir : {i.to_open}</Status><span className="raw">{i.to_open_why}</span></>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="explain">Rééquilibrage par les apports : le montant va d'abord aux expositions sous leur cible, sans rien vendre. Pour chaque exposition, l'enveloppe la plus avantageuse fiscalement parmi celles que tu détiens (PEA, puis assurance-vie, puis compte-titres).</p>
      </div>
    </>
  );
}

// Barre = part actuelle ; repère = cible ; zone claire = bande de tolérance
function AllocBars({ rows }: { rows: AllocRow[] }) {
  if (!rows.length) return <div className="empty">Aucune donnée.</div>;
  const max = Math.max(100, ...rows.map((r) => Math.max(r.pct ?? 0, (r.target_pct ?? 0) + (r.band_pct ?? 0))));
  const x = (v: number) => `${(v / max) * 100}%`;
  return (
    <div className="stack" style={{ gap: 14 }}>
      {rows.map((r) => (
        <div key={r.exposure} className="stack" style={{ gap: 5 }}>
          <div className="line">
            <span>{r.label}</span>
            <span className="sub">
              {pctFmt(r.pct)}{r.target_pct != null && <> · cible {pctFmt(r.target_pct)} · </>}
              {r.out_of_band ? <Status level="serious">écart {pctFmt(r.drift_pct, true)}</Status> : r.target_pct != null ? "dans la bande" : " · sans cible"}
            </span>
          </div>
          <div className="alloc-track">
            {r.target_pct != null && r.band_pct != null && (
              <div className="alloc-band" style={{ left: x(Math.max(0, r.target_pct - r.band_pct)), width: x(2 * r.band_pct) }} />
            )}
            <div className="alloc-fill" style={{ width: x(r.pct ?? 0) }} />
            {r.target_pct != null && <div className="alloc-target" style={{ left: x(r.target_pct) }} title={`Cible ${r.target_pct} %`} />}
          </div>
        </div>
      ))}
      <div className="acct-meta">Barre : part actuelle · trait : cible · zone claire : tolérance (± bande)</div>
    </div>
  );
}

function TargetEditor({ rows, onSaved }: { rows: AllocRow[]; onSaved: () => void }) {
  const ex = useFetch(api.exposures);
  const [vals, setVals] = useState<Record<string, number>>(() =>
    Object.fromEntries(rows.filter((r) => r.target_pct != null).map((r) => [r.exposure, r.target_pct as number])));
  const [band, setBand] = useState(5);
  const [err, setErr] = useState<string | null>(null);
  const total = Object.values(vals).reduce((s, v) => s + (v || 0), 0);
  const save = async () => {
    try {
      await api.setTargets(Object.entries(vals).filter(([, v]) => v > 0).map(([exposure, target_pct]) => ({ exposure, target_pct, band_pct: band })));
      onSaved();
    } catch (e) { setErr(String(e)); }
  };
  return (
    <div className="stack">
      {Object.entries(ex.data ?? {}).filter(([k]) => k !== "autre").map(([k, label]) => (
        <label key={k} className="item-row" style={{ gridTemplateColumns: "1fr 90px" }}>
          <span style={{ alignSelf: "center" }}>{label}</span>
          <input type="number" min={0} max={100} value={vals[k] ?? ""} placeholder="0 %"
            onChange={(e) => setVals({ ...vals, [k]: Number(e.target.value) })} />
        </label>
      ))}
      <label className="item-row" style={{ gridTemplateColumns: "1fr 90px" }}>
        <span style={{ alignSelf: "center" }}>Bande de tolérance (± points)</span>
        <input type="number" min={1} max={20} value={band} onChange={(e) => setBand(Number(e.target.value))} />
      </label>
      <div className="line">
        <span className={total === 100 ? "sub" : "neg"}>Total : {total} % {total !== 100 && "(doit faire 100 %)"}</span>
        <button className="primary" disabled={total !== 100} onClick={save}>Enregistrer</button>
      </div>
      {err && <div className="err" style={{ padding: 0 }}>{err}</div>}
      <p className="explain">Exemple prudent pour démarrer : liquidités (coussin inclus), fonds euros, actions monde. C'est ta décision : l'appli mesure seulement l'écart.</p>
    </div>
  );
}

// ------------------------------------------------------------------ marchés

const TREND: Record<string, Level> = { "haussière": "good", "baissière": "critical", "indécise": "warning", "historique insuffisant": "warning" };

function Markets() {
  const m = useFetch(api.markets);
  const idx = m.data?.signals.map((s) => s.code) ?? [];
  const pts = useFetch(() => (idx.length ? api.marketSeries(idx, 365) : Promise.resolve([])), [idx.join()]);
  if (m.data && !m.data.series.some((s) => s.points > 0))
    return (
      <div className="card empty">
        Pas encore de données de marché. Il faut les clés gratuites <b>Twelve Data</b> (cours) et <b>FRED</b> (taux, inflation)
        dans la configuration ; la collecte tourne chaque soir de semaine à 22:30.
      </div>
    );
  const since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  return (
    <>
      <div className="grid kpis">
        {m.data?.macro.map((x) => <Kpi key={x.code} label={x.label} value={pctFmt(x.value)} hint={`au ${date(x.day)}`} />)}
      </div>
      <div className="grid three" style={{ marginBottom: 16 }}>
        {m.data?.signals.map((s) => (
          <SmallMultiple key={s.code} s={s} data={(pts.data ?? []).filter((p) => p.code === s.code && p.day >= since)} />
        ))}
      </div>
      <div className="card">
        <h2>Signaux <span className="sub">calculés, pas des prédictions</span></h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Marché</th><th>Tendance</th><th className="num">vs MM200</th><th className="num">Repli / plus haut 1 an</th><th className="num">3 mois</th><th className="num">12 mois</th><th className="num">Volatilité</th></tr></thead>
          <tbody>{m.data?.signals.map((s) => (
            <tr key={s.code}>
              <td><b>{s.label}</b><span className="raw">au {date(s.last_day)}</span></td>
              <td><Status level={TREND[s.trend] ?? "warning"}>{s.trend}</Status></td>
              <td className="num">{pctFmt(s.vs_ma200_pct, true)}</td>
              <td className="num">{pctFmt(s.drawdown_pct)}</td>
              <td className="num">{pctFmt(s.perf_3m_pct, true)}</td>
              <td className="num">{pctFmt(s.perf_12m_pct, true)}</td>
              <td className="num">{pctFmt(s.vol_20d_pct)}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="explain">
          Tendance : haussière si le cours et la moyenne 50 jours sont au-dessus de la moyenne 200 jours, baissière dans le cas inverse.
          Indices suivis via des ETF américains représentatifs (cotés en dollars). Ces signaux servent à moduler le rythme d'investissement,
          pas à prédire le marché.
        </p>
      </div>
    </>
  );
}

// Un indice par graphique (petits multiples) : cours + moyenne 200 jours, même axe
function SmallMultiple({ s, data }: { s: Signal; data: { day: string; value: number; ma200: number }[] }) {
  return (
    <div className="card">
      <h2 style={{ marginBottom: 4 }}>{s.label.split(" (")[0]}<Status level={TREND[s.trend] ?? "warning"}>{s.trend}</Status></h2>
      <div className="sub" style={{ marginBottom: 8 }}>{pctFmt(s.perf_12m_pct, true)} sur 12 mois · repli {pctFmt(s.drawdown_pct)}</div>
      <ResponsiveContainer width="100%" height={150}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="day" tickFormatter={(x) => shortDate(x)} minTickGap={50} {...axis} />
          <YAxis type="number" domain={["dataMin", "dataMax"]} tickCount={4} tickFormatter={(v) => Math.round(v).toLocaleString("fr-FR")} width={44} {...axis} />
          <Tooltip {...tip} labelFormatter={(x) => date(String(x))} formatter={(v, n) => [Number(v).toLocaleString("fr-FR"), String(n)]} />
          <Line isAnimationActive={false} dataKey="value" name="Cours" stroke="var(--series-1)" strokeWidth={2} dot={false} />
          <Line isAnimationActive={false} dataKey="ma200" name="Moyenne 200 j" stroke="var(--muted)" strokeWidth={1.5} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="acct-meta">Bleu : cours · gris : moyenne 200 jours</div>
    </div>
  );
}

// ------------------------------------------------------------------ opérations

function Operations() {
  const [reload, setReload] = useState(0);
  const accounts = useFetch(api.accounts, [reload]);
  const assets = useFetch(api.assets, [reload]);
  const trades = useFetch(api.trades, [reload]);
  const persons = useFetch(api.persons);
  const ex = useFetch(api.exposures);
  const invest = (accounts.data ?? []).filter((a) => ["pea", "cto", "assurance_vie", "per"].includes(a.type));
  const [msg, setMsg] = useState<string | null>(null);
  const done = (m: string) => { setMsg(m); setReload((n) => n + 1); };
  const fail = (e: unknown) => setMsg(String(e).replace(/^Error: \d+ /, ""));

  const [acc, setAcc] = useState({ name: "", type: "pea", institution: "", owner: "" });
  const [asset, setAsset] = useState({ name: "", isin: "", exposure: "actions_monde", pea_eligible: true, data_symbol: "" });
  const [tr, setTr] = useState({ account_id: "", asset_id: "", day: new Date().toISOString().slice(0, 10), kind: "achat", quantity: "", price: "", fees: "" });
  const [csv, setCsv] = useState({ account_id: "", text: "" });

  return (
    <>
      {msg && <div className="card" style={{ marginBottom: 16 }}>{msg}</div>}
      <div className="grid three" style={{ marginBottom: 16 }}>
        <div className="card stack">
          <h2>1. Compte de placement</h2>
          <input placeholder="Nom (ex. PEA Boursorama)" value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} />
          <select value={acc.type} onChange={(e) => setAcc({ ...acc, type: e.target.value })}>
            <option value="pea">PEA</option><option value="assurance_vie">Assurance-vie</option><option value="per">PER</option><option value="cto">Compte-titres</option>
          </select>
          <input placeholder="Établissement" value={acc.institution} onChange={(e) => setAcc({ ...acc, institution: e.target.value })} />
          <select value={acc.owner} onChange={(e) => setAcc({ ...acc, owner: e.target.value })}>
            <option value="">Titulaire…</option>
            {persons.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="joint">Commun (50/50)</option>
          </select>
          <button className="primary" disabled={!acc.name || !acc.owner} onClick={async () => {
            const holders: Record<number, number> = acc.owner === "joint"
              ? Object.fromEntries((persons.data ?? []).map((p) => [p.id, 1 / (persons.data?.length || 1)])) : { [Number(acc.owner)]: 1 };
            try { await api.addInvestAccount({ name: acc.name, type: acc.type, institution: acc.institution, holders }); done("Compte créé."); } catch (e) { fail(e); }
          }}>Créer le compte</button>
        </div>
        <div className="card stack">
          <h2>2. Support</h2>
          <input placeholder="Nom (ex. ETF MSCI World)" value={asset.name} onChange={(e) => setAsset({ ...asset, name: e.target.value })} />
          <input placeholder="ISIN" value={asset.isin} onChange={(e) => setAsset({ ...asset, isin: e.target.value.toUpperCase() })} />
          <select value={asset.exposure} onChange={(e) => setAsset({ ...asset, exposure: e.target.value })}>
            {Object.entries(ex.data ?? {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={asset.pea_eligible} onChange={(e) => setAsset({ ...asset, pea_eligible: e.target.checked })} /> Éligible PEA
          </label>
          <input placeholder="Symbole de cotation (ex. CW8:XPAR), optionnel" value={asset.data_symbol} onChange={(e) => setAsset({ ...asset, data_symbol: e.target.value })} />
          <button className="primary" disabled={!asset.name} onClick={async () => {
            try { await api.addAsset(asset); done("Support enregistré."); } catch (e) { fail(e); }
          }}>Enregistrer le support</button>
        </div>
        <div className="card stack">
          <h2>3. Opération</h2>
          <select value={tr.account_id} onChange={(e) => setTr({ ...tr, account_id: e.target.value })}>
            <option value="">Compte…</option>{invest.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={tr.asset_id} onChange={(e) => setTr({ ...tr, asset_id: e.target.value })}>
            <option value="">Support…</option>{assets.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <div className="cols-2">
            <select value={tr.kind} onChange={(e) => setTr({ ...tr, kind: e.target.value })}>
              <option value="achat">Achat</option><option value="vente">Vente</option><option value="dividende">Dividende</option><option value="frais">Frais</option>
            </select>
            <input type="date" value={tr.day} onChange={(e) => setTr({ ...tr, day: e.target.value })} />
            <input type="number" placeholder="Quantité" value={tr.quantity} onChange={(e) => setTr({ ...tr, quantity: e.target.value })} />
            <input type="number" placeholder="Prix unitaire €" value={tr.price} onChange={(e) => setTr({ ...tr, price: e.target.value })} />
          </div>
          <input type="number" placeholder="Frais €" value={tr.fees} onChange={(e) => setTr({ ...tr, fees: e.target.value })} />
          <button className="primary" disabled={!tr.account_id || !tr.asset_id} onClick={async () => {
            try {
              await api.addTrade({ account_id: +tr.account_id, asset_id: +tr.asset_id, day: tr.day, kind: tr.kind,
                quantity: +tr.quantity || 0, price: tr.price ? +tr.price : undefined, fees: +tr.fees || 0 });
              done("Opération enregistrée.");
            } catch (e) { fail(e); }
          }}>Enregistrer</button>
          <div className="acct-meta">Un support non autorisé dans l'enveloppe est refusé (ex. action non éligible dans un PEA).</div>
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Historique des opérations</h2>
          {trades.data?.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Support</th><th>Type</th><th className="num">Qté</th><th className="num">Prix</th><th /></tr></thead>
              <tbody>{trades.data.map((t) => (
                <tr key={t.id}>
                  <td>{date(t.day)}</td><td>{t.asset}<span className="raw">{pretty(t.account)} · {t.source}</span></td><td>{t.kind}</td>
                  <td className="num">{t.quantity.toLocaleString("fr-FR")}</td><td className="num">{money(t.price)}</td>
                  <td className="num"><button className="ghost" aria-label="Supprimer" onClick={async () => { await api.deleteTrade(t.id); done("Opération supprimée."); }}>✕</button></td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <div className="empty">Aucune opération.</div>}
        </div>
        <div className="card stack">
          <h2>Import CSV (export courtier)</h2>
          <select value={csv.account_id} onChange={(e) => setCsv({ ...csv, account_id: e.target.value })}>
            <option value="">Compte…</option>{invest.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <textarea style={{ minHeight: 140, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
            placeholder={"date;isin;nom;type;quantite;prix;frais\n2026-09-01;FR0010315770;ETF Monde;achat;3;512,40;1,99"}
            value={csv.text} onChange={(e) => setCsv({ ...csv, text: e.target.value })} />
          <button className="primary" disabled={!csv.account_id || !csv.text} onClick={async () => {
            try {
              const r = await api.importTrades(+csv.account_id, csv.text);
              done(`${r.imported} opération(s) importée(s).${r.errors.length ? ` Erreurs : ${r.errors.join(" ; ")}` : ""} Précise l'exposition des nouveaux supports dans « Support ».`);
            } catch (e) { fail(e); }
          }}>Importer</button>
          <div className="acct-meta">Synchro automatique du PEA / de l'assurance-vie via woob : à venir (voir TODO).</div>
        </div>
      </div>
    </>
  );
}
