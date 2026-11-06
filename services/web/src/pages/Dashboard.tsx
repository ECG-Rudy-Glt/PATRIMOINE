import { Link } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { useFetch } from "../useFetch";
import { legendText } from "../components/legend";
import { date, money, money0, monthLabel, pretty, shortDate, signed } from "../format";
import Progress from "../components/Progress";
import Status from "../components/Status";
import TxTable from "../components/TxTable";
import { usePerson } from "../person";

const axis = { stroke: "var(--muted)", fontSize: 12, tickLine: false, axisLine: false };
const tip = { contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" } };

export default function Dashboard() {
  const { person } = usePerson();
  const s = useFetch(() => api.summary(person), [person]);
  const cur = useFetch(() => api.current(person), [person]);
  const h = useFetch(() => api.history(person, 120), [person]);
  const cf = useFetch(() => api.cashflow(person, 12), [person]);
  const caps = useFetch(() => api.caps(person), [person]);
  const fc = useFetch(() => api.forecast(person), [person]);
  const goals = useFetch(api.goals);
  const tx = useFetch(() => api.transactions({ limit: 6, person: person ?? undefined }), [person]);
  const pays = useFetch(api.pay);
  // paies du périmètre : le foyer (compte commun) est alimenté par les deux, une personne a la sienne
  const scopedPays = (pays.data ?? []).filter((p) => !person || person === -1 || p.person_id === person);
  const nextPay = [...scopedPays].sort((a, b) => a.next_date.localeCompare(b.next_date))[0];
  const daysToPay = nextPay ? Math.max(0, Math.round((new Date(nextPay.next_date).getTime() - Date.now()) / 864e5)) : null;

  if (s.error) return <div className="err">Impossible de joindre le ledger ({s.error}).</div>;
  const sum = s.data;
  if (sum && sum.accounts === 0) return <div className="card empty">Aucun compte rattaché à cette personne pour l'instant.</div>;

  const c = cur.data;
  const typical = c?.typical_total ?? null;
  const ratio = c && typical ? (c.spent / typical) * 100 : 0;
  const markPct = c && typical && c.typical_to_date != null ? (c.typical_to_date / typical) * 100 : null;
  const ahead = c && c.typical_to_date != null ? c.spent - c.typical_to_date : null;

  const bdc = useFetch(() => (cur.data ? api.breakdown(person, cur.data.cycle) : Promise.resolve([])), [person, cur.data?.cycle]);
  const toCommun = -(bdc.data ?? []).filter((r) => r.kind === "household").reduce((t, r) => t + r.amount, 0);
  const series = (h.data ?? []).filter((p) => p.known > 0);   // pas de courbe avant le premier solde réel
  const last = series.at(-1)?.total;
  const ref = series.find((p) => new Date(p.day) >= new Date(Date.now() - 30 * 864e5))?.total;
  const delta = last != null && ref != null ? last - ref : null;
  const activeGoals = (goals.data ?? []).filter((g) => g.status === "active" && (!person || g.person_id === person || g.person_id === null));

  // Phrase de synthèse : uniquement des faits déjà calculés (prévision de solde, trésorerie des comptes courants, cycle, paie)
  const fcs = fc.data ?? [];
  const worst = [...fcs].sort((a, b) => a.projected - b.projected)[0];
  const reserve = series.at(-1)?.courant ?? 0;                 // total des comptes courants du périmètre
  let tone: "good" | "warning" | "critical" = "good";
  let headline = "Tout est en ordre.";
  if (worst && worst.projected < 0 && reserve - worst.balance < 500) {
    tone = "critical"; headline = `Attention : « ${pretty(worst.name)} » pourrait passer à découvert avant la paie.`;
  } else if (worst && worst.projected < 200) {
    const others = reserve - worst.balance;                    // réserve sur les autres comptes courants
    if (others >= 1000) headline = `Rien d'alarmant : « ${pretty(worst.name)} » sera serré avant la paie, mais tes autres comptes courants gardent ${money0(others)} de réserve.`;
    else { tone = "warning"; headline = `À surveiller : « ${pretty(worst.name)} » pourrait passer sous 200 € avant la paie.`; }
  }
  const lede2 = [
    c ? (ahead != null ? `${money0(c.spent)} dépensés ce cycle, ${money0(Math.abs(ahead))} ${ahead > 0 ? "de plus" : "de moins"} que d'habitude` : `${money0(c.spent)} dépensés depuis le début du cycle`) : null,
    nextPay && daysToPay != null ? `prochaine paie ${nextPay.name} le ${shortDate(nextPay.next_date)}${daysToPay === 0 ? " (aujourd'hui)" : ` (J-${daysToPay})`}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bonjour</h1>
          {(fc.data || cur.data) && (
            <>
              <p className="lede"><span className={`dot ${tone}`} aria-hidden />{headline}</p>
              {lede2 && <p className="lede-sub">{lede2}</p>}
            </>
          )}
          <div className="sub" style={{ marginTop: 10 }}>{person === -1 ? "Le foyer (compte commun)" : person ? "Comptes personnels" : "Tous les comptes"} · données au {date(sum?.as_of ?? null)}</div>
        </div>
        {!!sum?.stale && <Status level="critical">{sum.stale} compte(s) non synchronisé(s)</Status>}
      </div>

      {/* 1. La question du quotidien : où en est-on d'ici la paie ? */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h2>
          Cycle en cours
          <span className="sub">{c ? `${shortDate(c.starts)} → ${shortDate(c.ends)}` : ""}{nextPay && daysToPay != null
            ? ` · prochaine paie ${nextPay.name} ${shortDate(nextPay.next_date)} (${daysToPay === 0 ? "aujourd'hui" : `J-${daysToPay}`})`
            : c ? ` · ${c.days_left === 0 ? "paie demain" : `J-${c.days_left} avant la paie`}` : ""}</span>
        </h2>
        {c && (
          <div className="hero-cycle">
            <div className="stack">
              <div>
                <div className="kpi-label">Dépensé ce cycle</div>
                <div className="big">{money0(c.spent)}</div>
                {toCommun > 1 && <div className="acct-meta">dont {money0(toCommun)} versés au compte commun</div>}
              </div>
              {typical != null && <Progress value={ratio} mark={markPct} state={ratio > 100 ? "over" : ratio > 90 ? "near" : undefined} />}
              {typical != null && ahead != null ? (
                <div className="sub">
                  Habituellement {money0(c.typical_to_date)} à ce stade, {money0(typical)} sur un cycle complet.{" "}
                  {ahead > 0
                    ? <Status level={ahead > typical * 0.15 ? "serious" : "warning"}>{money0(ahead)} au-dessus</Status>
                    : <Status level="good">{money0(-ahead)} en dessous</Status>}
                </div>
              ) : <div className="sub">La comparaison apparaîtra après un premier cycle complet.</div>}
            </div>
            <div className="stack">
              {fc.data?.map((f) => (
                <div key={f.account_id}>
                  <div className="kpi-label">{f.joint ? `Solde prévu au ${shortDate(f.ends)}` : "Solde prévu à la paie"} · {pretty(f.name)}</div>
                  <div className="line" style={{ alignItems: "baseline" }}>
                    <b style={{ fontSize: 22 }}>{money0(f.projected)}</b>
                    {f.projected < 200 ? <Status level={f.projected < 0 ? "critical" : "serious"}>Sous 200 €</Status> : <span className="sub">aujourd'hui {money0(f.balance)}</span>}
                  </div>
                  <div className="acct-meta">
                    {f.days_left > 0
                      ? `${f.incoming > 0 ? `+ ${money0(f.incoming)} de virements attendus (estimation) ` : ""}− ${money0(f.upcoming)} de prélèvements attendus − ${money0(f.daily_rate)}/jour de dépenses habituelles × ${f.days_left} j`
                      : "Dernier jour du cycle"}
                  </div>
                </div>
              ))}
              <div className="divider" style={{ margin: "2px 0" }} />
              <div className="kpi-label">Prélèvements attendus d'ici la paie</div>
              {c.upcoming.length ? (
                <>
                  {c.upcoming.map((u) => (
                    <div className="line" key={u.merchant + u.next_date}>
                      <span>{u.merchant} <span className="acct-meta">· {shortDate(u.next_date)} · {pretty(u.account)}</span></span>
                      <b>{money(u.amount)}</b>
                    </div>
                  ))}
                  <div className="divider" style={{ margin: "4px 0" }} />
                  <div className="line"><span className="sub">Total à prévoir</span><b>{money(c.upcoming_total)}</b></div>
                </>
              ) : <div className="sub">Aucun prélèvement récurrent attendu avant la paie.</div>}
            </div>
          </div>
        )}
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2>Patrimoine <Link to="/comptes" className="sub">Comptes & flux →</Link></h2>
          <div className="line" style={{ alignItems: "flex-end" }}>
            <div className="big">{money(sum?.networth)}</div>
            {delta != null && <span className="sub">{signed(delta)} sur 30 jours</span>}
          </div>
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart data={series} margin={{ top: 12, left: 0, right: 0, bottom: 0 }}>
              <XAxis dataKey="day" hide />
              <YAxis hide domain={[0, "auto"]} />
              <Tooltip {...tip} formatter={(v, n) => [money(Number(v)), String(n)]} labelFormatter={(d) => date(String(d))} />
              <Area isAnimationActive={false} type="monotone" stackId="a" dataKey="courant" name="Comptes courants" stroke="var(--series-2)" strokeWidth={1.5} fill="var(--series-2)" fillOpacity={0.5} />
              <Area isAnimationActive={false} type="monotone" stackId="a" dataKey="livret" name="Livrets" stroke="var(--series-3)" strokeWidth={1.5} fill="var(--series-3)" fillOpacity={0.5} />
              <Area isAnimationActive={false} type="monotone" stackId="a" dataKey="placements" name="Placements et épargne bloquée" stroke="var(--series-1)" strokeWidth={1.5} fill="var(--series-1)" fillOpacity={0.5} />
            </AreaChart>
          </ResponsiveContainer>
          <div className="chips" style={{ marginTop: 6 }}>
            <span className="chip"><span style={{ color: "var(--series-2)" }}>●</span> Courants {money0(series.at(-1)?.courant)}</span>
            <span className="chip"><span style={{ color: "var(--series-3)" }}>●</span> Livrets {money0(series.at(-1)?.livret)}</span>
            <span className="chip"><span style={{ color: "var(--series-1)" }}>●</span> Placements {money0(series.at(-1)?.placements)}</span>
          </div>
          <div className="line" style={{ marginTop: 8 }}>
            <span className="sub">Comptes courants (trésorerie)</span>
            <b>{money(series.at(-1)?.courant)}</b>
          </div>
          <ResponsiveContainer width="100%" height={90}>
            <AreaChart data={series} margin={{ top: 8, left: 0, right: 0, bottom: 0 }}>
              <XAxis dataKey="day" hide />
              <YAxis hide domain={["dataMin - 50", "dataMax + 50"]} />
              <Tooltip {...tip} formatter={(v) => [money(Number(v)), "Comptes courants"]} labelFormatter={(d) => date(String(d))} />
              <Area isAnimationActive={false} type="stepAfter" dataKey="courant" stroke="var(--series-2)" strokeWidth={2} fill="var(--series-2)" fillOpacity={0.12} />
            </AreaChart>
          </ResponsiveContainer>
          <div className="acct-meta">Les comptes ajoutés récemment sont reportés à leur premier solde connu (courbe « estimée » avant), pour ne pas fausser l'évolution.</div>
        </div>

        <div className="card">
          <h2>Objectifs <Link to="/objectifs" className="sub">Tout voir →</Link></h2>
          {activeGoals.length ? (
            <div className="stack" style={{ gap: 14 }}>
              {activeGoals.slice(0, 3).map((g) => (
                <div key={g.id} className="stack" style={{ gap: 6 }}>
                  <div className="line"><b>{g.name}</b><span className="sub">{money0(g.current)} / {money0(g.target)}</span></div>
                  <Progress value={g.progress_pct} />
                </div>
              ))}
            </div>
          ) : (
            <div className="stack">
              <div className="sub">Fixe un cap (achat immobilier, voyage, coussin de sécurité) et l'appli calcule l'effort mensuel et la faisabilité à partir de tes chiffres réels.</div>
              <Link to="/objectifs"><button className="primary">Créer un objectif</button></Link>
            </div>
          )}
        </div>
      </div>

      {!!scopedPays.length && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Paies détectées <span className="sub">repérées sur vos comptes, sans saisie</span></h2>
          <div className="grid two">
            {scopedPays.map((p) => (
              <div key={p.person_id} className="stack" style={{ gap: 4 }}>
                <div className="kpi-label">{p.name}</div>
                <div className="line" style={{ alignItems: "baseline" }}>
                  <b style={{ fontSize: 22 }}>{money0(p.avg_amount)}</b>
                  <span className="sub">en moyenne · dernière paie {money0(p.last_amount)} le {shortDate(p.last_date)}</span>
                </div>
                <div className="acct-meta">
                  Habituellement vers le {p.usual_day} du mois · prochaine attendue le{" "}
                  {new Date(p.next_date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
                  {" "}({p.n} paie{p.n > 1 ? "s" : ""} analysée{p.n > 1 ? "s" : ""})
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2>Entrées et sorties par mois <span className="sub">hors virements entre comptes</span></h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={cf.data ?? []} barGap={2}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tickFormatter={monthLabel} {...axis} />
              <YAxis tickFormatter={(v) => money0(v)} width={70} {...axis} />
              <Tooltip {...tip} formatter={(v) => money(Number(v))} labelFormatter={(m) => monthLabel(String(m))} cursor={{ fill: "var(--surface-2)" }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
              <Bar isAnimationActive={false} dataKey="income" name="Entrées" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
              <Bar isAnimationActive={false} dataKey="expense" name="Sorties" fill="var(--series-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h2>Plafonds du cycle <Link to="/budget#plafonds" className="sub">Gérer →</Link></h2>
          {caps.data?.length ? (
            <div className="stack" style={{ gap: 14 }}>
              {caps.data.map((k) => (
                <div key={k.category} className="stack" style={{ gap: 6 }}>
                  <div className="line"><span>{k.label}</span><span className="sub">{money0(k.spent)} / {money0(k.monthly)}</span></div>
                  <Progress value={k.pct} state={k.pct >= 100 ? "over" : k.pct >= k.alert_pct ? "near" : undefined} />
                </div>
              ))}
            </div>
          ) : (
            <div className="stack">
              <div className="sub">Aucun plafond. Exemple : Achats en ligne ≤ 150 €/mois, avec une notification à 80 %.</div>
              <Link to="/budget#plafonds"><button>Définir un plafond</button></Link>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Dernières opérations <Link to="/transactions" className="sub">Tout voir →</Link></h2>
        {tx.data ? <TxTable items={tx.data.items} showAccount={false} compact /> : <div className="skeleton" />}
      </div>
    </>
  );
}
