import { useState } from "react";
import { Link } from "react-router-dom";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, BreakdownRow, Kind } from "../api";
import { useFetch } from "../useFetch";
import { legendText } from "../components/legend";
import { usePerson } from "../person";
import { cycleLabel, date, KINDS, money, money0, signed } from "../format";
import Kpi from "../components/Kpi";
import Donut from "../components/Donut";
import Avoidable from "../components/Avoidable";
import Savings from "../components/Savings";
import Partage from "../components/Partage";
import Progress from "../components/Progress";
import Status from "../components/Status";
import { shortDate } from "../format";

const axis = { stroke: "var(--muted)", fontSize: 12, tickLine: false, axisLine: false };
const tip = { contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 } };
const KIND_ORDER: Kind[] = ["income", "fixed", "household", "variable", "internal", "savings"];
const KIND_COLOR: Record<Kind, string> = {
  income: "var(--series-3)", fixed: "var(--series-1)", household: "var(--series-7)", variable: "var(--series-2)",
  internal: "var(--muted)", savings: "var(--series-6)",
};
const short = (c: string) => new Date(c).toLocaleDateString("fr-FR", { month: "short" });

export default function Budget() {
  const { person } = usePerson();
  const s = useFetch(() => api.budgetSummary(person), [person]);
  const m = useFetch(() => api.budgetMonthly(person), [person]);
  const b = useFetch(() => api.breakdown(person), [person]);

  if (s.error) return <div className="err">{s.error}</div>;
  const sum = s.data;
  if (sum && sum.cycles === 0) return <PartialBudget person={person} />;

  const buf = sum?.buffer;
  const bufPct = buf ? Math.min(100, (buf.liquid / buf.target) * 100) : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Budget</h1>
          <div className="sub">
            Moyenne mensuelle sur {sum?.cycles ?? "–"} cycle(s) complet(s), du {date(sum?.from_day ?? null)} au{" "}
            {date(sum?.to_day ?? null)} · cycle aligné sur la paie (du 25 au 24)
          </div>
        </div>
      </div>

      <div className="grid kpis">
        <Kpi label="Revenus / mois" value={money(sum?.income)} hint={sum?.internal_net ? `+ ${money(sum.internal_net)} de virements entre vous` : undefined} />
        <Kpi label="Charges fixes / mois" value={money(sum?.fixed)} hint="Assurances, abonnements, compte commun…" />
        <Kpi label="Dépenses variables / mois" value={money(sum?.variable)} />
        <Kpi label="Reste à vivre épargnable" value={sum?.available != null ? signed(sum.available) : "—"}
          hint="Revenus + virements reçus − dépenses" />
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2>Par cycle</h2>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={m.data ?? []}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="cycle" tickFormatter={(c) => short(c)} {...axis} />
              <YAxis tickFormatter={(v) => money0(v)} width={70} {...axis} />
              <Tooltip {...tip} formatter={(v) => money(Number(v))}
                labelFormatter={(c, p) => `${cycleLabel(String(c))}${p?.[0]?.payload?.complete ? "" : " (en cours)"}`}
                cursor={{ fill: "var(--surface-2)" }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
              <Bar isAnimationActive={false} dataKey="fixed" name="Fixes" stackId="d" fill="var(--series-1)" />
              <Bar isAnimationActive={false} dataKey="variable" name="Variables" stackId="d" fill="var(--series-2)" radius={[4, 4, 0, 0]} />
              <Line isAnimationActive={false} dataKey="income" name="Revenus" stroke="var(--series-3)" strokeWidth={2} dot={{ r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2>Combien mettre de côté ?</h2>
          {buf && (
            <>
              <div className="kpi-label">Coussin de sécurité ({buf.months} mois de dépenses)</div>
              <div className="meter"><div style={{ width: `${bufPct}%` }} /></div>
              <div className="sub">{money0(buf.liquid)} disponibles sur {money0(buf.target)} visés</div>
              <div style={{ marginTop: 18 }} className="kpi-label">Investissable chaque mois</div>
              <div className="kpi-value">{money(sum?.investable)}</div>
              <p className="explain">
                Capacité d'épargne moyenne <b>{signed(sum!.available!)}</b>
                {buf.shortfall > 0 ? (
                  <> − reconstitution du coussin <b>{money(buf.refill_per_month)}</b> / mois
                    ({money0(buf.shortfall)} manquants sur {buf.refill_months} mois). Tant que le coussin n'est pas
                    constitué, l'épargne va d'abord sur un livret.</>
                ) : <> ; coussin constitué, tout le reste est investissable.</>}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Par poste (moyenne mensuelle)</h2>
          {b.data && <Breakdown rows={b.data} />}
        </div>
        <div className="card" style={{ alignSelf: "start" }}>
          <h2>Où part l'argent</h2>
          {b.data && <Donut items={spendSlices(b.data)} center="Dépenses / mois" />}
          <p className="explain">Charges fixes, compte commun et dépenses variables : les 5 premiers postes, le reste regroupé. Le détail complet est dans la liste.</p>
        </div>
      </div>

      <HouseholdSplit />

      <Caps person={person} />
      <RecurringList person={person} />
      <Partage />
      <div style={{ height: 16 }} />
      <Avoidable person={person} />
      <div style={{ height: 16 }} />
      <Savings />
    </>
  );
}

// Donut : <= 6 segments (5 premiers postes + « Autres »), ordre fixe par montant
function spendSlices(rows: BreakdownRow[]) {
  const spend = rows.filter((r) => ["fixed", "household", "variable"].includes(r.kind) && r.amount < 0)
    .map((r) => ({ name: r.label, value: -r.amount })).sort((a, b) => b.value - a.value);
  const top = spend.slice(0, 5);
  const rest = spend.slice(5).reduce((s, r) => s + r.value, 0);
  return rest > 0 ? [...top, { name: "Autres postes", value: Math.round(rest * 100) / 100 }] : top;
}

function HouseholdSplit() {
  const h = useFetch(api.household);
  if (!h.data) return null;
  return (
    <>
      <div className="section-title">Compte commun</div>
      <div className="card">
        <h2>Qui verse combien <span className="sub">moyenne mensuelle · {money0(h.data.total_contribution)} versés</span></h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Personne</th><th className="num">Revenus</th><th className="num">Versé</th><th className="num">Part des revenus</th><th className="num">Équilibre au prorata</th></tr></thead>
            <tbody>
              {h.data.persons.map((p) => (
                <tr key={p.person_id}>
                  <td><b>{p.name}</b></td>
                  {p.tracked ? (
                    <>
                      <td className="num">{money0(p.income)}</td>
                      <td className="num">{money0(p.contribution)}</td>
                      <td className="num">{p.effort_pct != null ? `${p.effort_pct.toLocaleString("fr-FR")} %` : "—"}</td>
                      <td className="num">{p.fair_contribution != null ? money0(p.fair_contribution) : "—"}</td>
                    </>
                  ) : <td colSpan={4} className="num sub">comptes non connectés</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="explain">
          Au prorata : chacun verse la même proportion de ses revenus. {h.data.complete
            ? "Comparer « Versé » et « Équilibre au prorata »."
            : "L'équilibre sera calculé quand les comptes de chacun seront connectés : aujourd'hui seuls tes versements sont visibles."}
        </p>
      </div>
    </>
  );
}

function Caps({ person }: { person: number | null }) {
  const [reload, setReload] = useState(0);
  const caps = useFetch(() => api.caps(person), [person, reload]);
  const cats = useFetch(api.categories);
  const [cat, setCat] = useState("achats_en_ligne");
  const [amount, setAmount] = useState("");
  const add = async () => {
    if (!Number(amount)) return;
    await api.setCap(cat, Number(amount));
    setAmount("");
    setReload((n) => n + 1);
  };
  const capped = new Set(caps.data?.map((k) => k.category));
  return (
    <>
      <div className="section-title" id="plafonds">Plafonds par catégorie</div>
      <div className="card">
        <p className="explain" style={{ marginTop: 0 }}>
          Un plafond par cycle de paie. Notification ntfy à 80 % puis au dépassement, avec la projection de fin de cycle.
        </p>
        {caps.data?.length ? (
          <div className="stack" style={{ gap: 16, marginBottom: 16 }}>
            {caps.data.map((k) => (
              <div key={k.category} className="stack" style={{ gap: 6 }}>
                <div className="line">
                  <span><b>{k.label}</b> <span className="sub">· {money0(k.spent)} / {money0(k.monthly)} · projection {money0(k.projected)}</span></span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {k.pct >= 100 ? <Status level="critical">Dépassé</Status> : k.pct >= k.alert_pct ? <Status level="warning">{k.pct} %</Status> : <span className="sub">{k.pct} %</span>}
                    <button className="ghost" aria-label={`Supprimer le plafond ${k.label}`}
                      onClick={async () => { await api.deleteCap(k.category); setReload((n) => n + 1); }}>✕</button>
                  </span>
                </div>
                <Progress value={k.pct} mark={null} state={k.pct >= 100 ? "over" : k.pct >= k.alert_pct ? "near" : undefined} />
              </div>
            ))}
          </div>
        ) : null}
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            {cats.data?.filter((c) => c.kind === "variable" || c.kind === "fixed").filter((c) => !capped.has(c.code))
              .map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
          <input type="number" min={1} placeholder="€ / mois" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 120 }} />
          <button className="primary" onClick={add}>Ajouter un plafond</button>
        </div>
      </div>
    </>
  );
}

function RecurringList({ person }: { person: number | null }) {
  const r = useFetch(() => api.recurring(person), [person]);
  return (
    <>
      <div className="section-title">Dépenses récurrentes détectées</div>
      <div className="card">
        <h2>{r.data?.items.length ?? "–"} abonnement(s) et prélèvement(s) <span className="sub">{money(r.data?.monthly_total)} / mois · {money0((r.data?.monthly_total ?? 0) * 12)} / an</span></h2>
        {r.data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Marchand</th><th>Catégorie</th><th className="num">Montant</th><th className="num">Prochain</th><th /></tr></thead>
              <tbody>
                {r.data.items.map((i) => (
                  <tr key={i.grp + i.category}>
                    <td><b>{i.merchant}</b> <span className="acct-meta">· {i.occurrences} fois</span></td>
                    <td className="sub">{i.category_label}</td>
                    <td className="num">{money(i.last_amount)}</td>
                    <td className="num">{shortDate(i.next_date)}</td>
                    <td className="num">
                      {i.price_change ? <Status level={i.price_change > 0 ? "serious" : "good"}>{i.price_change > 0 ? "+" : ""}{money(i.price_change)}</Status>
                        : i.is_new ? <Status level="warning">Nouveau</Status> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">Rien de récurrent détecté pour l'instant (il faut au moins 2 cycles).</div>}
        <p className="explain">Détection : même marchand, montant stable (±20 %), environ tous les 30 jours, sur au moins 2 cycles. Signale les hausses de prix et les nouveaux abonnements.</p>
      </div>
    </>
  );
}

function Breakdown({ rows }: { rows: BreakdownRow[] }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.amount)), 1);
  return (
    <div>
      {KIND_ORDER.filter((k) => rows.some((r) => r.kind === k)).map((k) => {
        const group = rows.filter((r) => r.kind === k).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
        const total = group.reduce((s, r) => s + r.amount, 0);
        return (
          <div key={k}>
            <div className="group-title"><span>{KINDS[k]}</span><span>{signed(total)}</span></div>
            <div className="rows">
              {group.map((r) => (
                <Link key={r.code} to={`/transactions?category=${r.code}`} className="row">
                  <span>{r.label} <span className="acct-meta">· {r.n}</span></span>
                  <span className="bar">
                    <div style={{ width: `${(Math.abs(r.amount) / max) * 100}%`, background: KIND_COLOR[k] }} />
                  </span>
                  <span className={"num " + (r.amount < 0 ? "ink" : "credit")}>{signed(r.amount)}</span>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Aucun cycle complet : on montre déjà le cycle en cours (réel, partiel) et les dépenses sur lesquelles agir
function PartialBudget({ person }: { person: number | null }) {
  const cur = useFetch(() => api.current(person), [person]);
  const bd = useFetch(() => (cur.data ? api.breakdown(person, cur.data.cycle) : Promise.resolve([] as BreakdownRow[])), [person, cur.data?.cycle]);
  const rows = (bd.data ?? []).filter((r) => r.kind === "variable" || r.kind === "fixed").map((r) => ({ ...r, spent: -r.amount })).filter((r) => r.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, 10);
  const c = cur.data;
  const toCommun = -(bd.data ?? []).filter((r) => r.kind === "household").reduce((t, r) => t + r.amount, 0);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Budget</h1>
          <div className="sub">Pas encore de cycle complet : voici le cycle en cours{c ? ` (${shortDate(c.starts)} → ${shortDate(c.ends)})` : ""}. Les moyennes apparaîtront après un cycle entier.</div>
        </div>
      </div>
      {c && (
        <div className="grid kpis">
          <Kpi label="Dépensé ce cycle" value={money(c.spent)} hint={toCommun > 1 ? `dont ${money0(toCommun)} versés au compte commun` : "Hors virements entre vous"} />
          <Kpi label="Entré ce cycle" value={money(c.income)} />
          <Kpi label="Prélèvements à venir" value={money(c.upcoming_total)} />
          <Kpi label="Jours avant la paie" value={String(c.days_left)} />
        </div>
      )}
      {!!rows.length && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Où part l'argent ce cycle <span className="sub">dépenses fixes et variables, par poste</span></h2>
          <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 34)}>
            <ComposedChart data={rows} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid horizontal={false} stroke="var(--border)" />
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="label" width={150} {...axis} />
              <Tooltip {...tip} formatter={(v) => money(Number(v))} />
              <Bar isAnimationActive={false} dataKey="spent" name="Dépensé" fill="var(--series-1)" radius={[0, 6, 6, 0]} barSize={16} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <Partage />
      <div style={{ height: 16 }} />
      <Avoidable person={person} />
      <div style={{ height: 16 }} />
      <Savings />
    </>
  );
}
