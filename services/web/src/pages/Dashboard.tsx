import { Link } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { useFetch } from "../useFetch";
import { legendText } from "../components/legend";
import { date, money, money0, monthLabel, pretty, shortDate, signed } from "../format";
import Status from "../components/Status";
import TxTable from "../components/TxTable";
import { ActionBar, BigNumber, Card, ChartA11y, Chip, ErrorState, LoadingState, ProgressBar, Stat } from "../components/ui";
import { usePerson } from "../person";

const axis = { stroke: "var(--muted)", fontSize: 12, tickLine: false, axisLine: false };
const tip = { contentStyle: { background: "var(--glass-solid)", border: "1px solid var(--glass-border)", borderRadius: 12, color: "var(--ink)", boxShadow: "var(--glass-shadow)" } };

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
  const bdc = useFetch(() => (cur.data ? api.breakdown(person, cur.data.cycle) : Promise.resolve([])), [person, cur.data?.cycle]);

  // paies du périmètre : le foyer (compte commun) est alimenté par les deux, une personne a la sienne
  const scopedPays = (pays.data ?? []).filter((p) => !person || person === -1 || p.person_id === person);
  const nextPay = [...scopedPays].sort((a, b) => a.next_date.localeCompare(b.next_date))[0];
  const daysToPay = nextPay ? Math.max(0, Math.round((new Date(nextPay.next_date).getTime() - Date.now()) / 864e5)) : null;

  if (s.error) return <ErrorState error={s.error} what="le patrimoine" onRetry={() => location.reload()} />;
  const sum = s.data;
  if (!sum) return <><h1 className="sr">Accueil</h1><LoadingState /></>;
  if (sum.accounts === 0) return <div className="card empty">Aucun compte rattaché à cette personne pour l'instant.</div>;

  const c = cur.data;
  const typical = c?.typical_total ?? null;
  const ratio = c && typical ? (c.spent / typical) * 100 : 0;
  const markPct = c && typical && c.typical_to_date != null ? (c.typical_to_date / typical) * 100 : null;
  const ahead = c && c.typical_to_date != null ? c.spent - c.typical_to_date : null;
  const toCommun = -(bdc.data ?? []).filter((r) => r.kind === "household").reduce((t, r) => t + r.amount, 0);
  const series = (h.data ?? []).filter((p) => p.known > 0);   // pas de courbe avant le premier solde réel
  const last = series.at(-1);
  const ref = series.find((p) => new Date(p.day) >= new Date(Date.now() - 30 * 864e5))?.total;
  const delta = last != null && ref != null ? last.total - ref : null;
  const activeGoals = (goals.data ?? []).filter((g) => g.status === "active" && (!person || g.person_id === person || g.person_id === null));

  // Phrase de synthèse : uniquement des faits déjà calculés (prévision de solde, trésorerie des comptes courants, cycle, paie)
  const fcs = fc.data ?? [];
  const worst = [...fcs].sort((a, b) => a.projected - b.projected)[0];
  const reserve = last?.courant ?? 0;                          // total des comptes courants du périmètre
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
  const scopeLabel = person === -1 ? "Foyer (compte commun)" : person ? "Comptes personnels" : "Tous les comptes";

  return (
    <>
      <h1 className="sr">Accueil</h1>
      <div className="hero-block">
        <BigNumber value={sum.networth} label={`Patrimoine net · ${scopeLabel}`}>
          {delta != null && <div><Chip tone={delta >= 0 ? "good" : "warn"}>{signed(delta)} sur 30 jours</Chip></div>}
        </BigNumber>
        {(fc.data || cur.data) && (
          <div>
            <p className="lede" role="status"><span className={`dot ${tone}`} aria-hidden />{headline}</p>
            {lede2 && <p className="lede-sub">{lede2}</p>}
          </div>
        )}
        <div className="sub">Données au {date(sum.as_of)}{!!sum.stale && <> · <Status level="critical">{sum.stale} compte(s) non synchronisé(s)</Status></>}</div>
      </div>

      <div className="dash">
        <div className="full">
          <ActionBar left={{ to: "/banques", label: "Synchro", icon: "sync" }} right={{ to: "/export", label: "Importer", icon: "arrow" }}
            menu={[{ to: "/objectifs", label: "Nouvel objectif", icon: "goal" }, { to: "/budget#plafonds", label: "Définir un plafond", icon: "budget" },
              { to: "/banques", label: "Ajouter une banque", icon: "bank" }, { to: "/alertes", label: "Régler une alerte", icon: "bell" }]} />
        </div>

        <div className="dash-col">
          <Card data-o="1" title="Cycle en cours" aside={c ? `${shortDate(c.starts)} → ${shortDate(c.ends)}${nextPay && daysToPay != null
            ? ` · paie ${nextPay.name} ${shortDate(nextPay.next_date)} (${daysToPay === 0 ? "aujourd'hui" : `J-${daysToPay}`})`
            : ` · ${c.days_left === 0 ? "paie demain" : `J-${c.days_left} avant la paie`}`}` : ""}>
            {cur.error ? <ErrorState error={cur.error} what="le cycle" /> : !c ? <LoadingState /> : (
              <div className="stack">
                <div>
                  <div className="k">Dépensé ce cycle</div>
                  <div className="v num fs-34">{money0(c.spent)}</div>
                  {toCommun > 1 && <div className="acct-meta">dont {money0(toCommun)} versés au compte commun</div>}
                </div>
                {typical != null && <ProgressBar label="Dépenses du cycle par rapport à l'habitude" value={ratio} mark={markPct} state={ratio > 100 ? "over" : ratio > 90 ? "near" : undefined} />}
                {typical != null && ahead != null ? (
                  <div className="sub">
                    Habituellement {money0(c.typical_to_date)} à ce stade, {money0(typical)} sur un cycle complet.{" "}
                    {ahead > 0
                      ? <Status level={ahead > typical * 0.15 ? "serious" : "warning"}>{money0(ahead)} au-dessus de l'habitude</Status>
                      : <Status level="good">{money0(-ahead)} en dessous de l'habitude</Status>}
                  </div>
                ) : <div className="sub">La comparaison apparaîtra après un premier cycle complet.</div>}
                <div className="divider tight" />
                <div className="k">Prélèvements attendus d'ici la paie</div>
                {c.upcoming.length ? (
                  <>
                    {c.upcoming.map((u) => (
                      <div className="line" key={u.merchant + u.next_date}>
                        <span>{u.merchant} <span className="acct-meta">· {shortDate(u.next_date)} · {pretty(u.account)}</span></span>
                        <b className="num">{money(u.amount)}</b>
                      </div>
                    ))}
                    <div className="line"><span className="sub">Total à prévoir</span><b className="num">{money(c.upcoming_total)}</b></div>
                  </>
                ) : <div className="sub">Aucun prélèvement récurrent attendu avant la paie.</div>}
              </div>
            )}
          </Card>

          <Card data-o="4" title="Évolution du patrimoine" aside={<Link to="/comptes" className="sub">Comptes & flux →</Link>}>
            <ChartA11y label="Évolution du patrimoine sur 120 jours, par type de compte"
              summary={last ? `Aujourd'hui : comptes courants ${money0(last.courant)}, livrets ${money0(last.livret)}, placements ${money0(last.placements)}${delta != null ? `, ${signed(delta)} sur 30 jours` : ""}.` : undefined}>
              <ResponsiveContainer width="100%" height={170}>
                <AreaChart data={series} margin={{ top: 12, left: 0, right: 0, bottom: 0 }}>
                  <XAxis dataKey="day" hide />
                  <YAxis hide domain={[0, "auto"]} />
                  <Tooltip {...tip} formatter={(v, n) => [money0(Number(v)), String(n)]} labelFormatter={(d) => date(String(d))} />
                  <Area isAnimationActive={false} type="monotone" stackId="a" dataKey="courant" name="Comptes courants" stroke="var(--series-2)" strokeWidth={1.5} fill="var(--series-2)" fillOpacity={0.45} />
                  <Area isAnimationActive={false} type="monotone" stackId="a" dataKey="livret" name="Livrets" stroke="var(--series-3)" strokeWidth={1.5} fill="var(--series-3)" fillOpacity={0.45} />
                  <Area isAnimationActive={false} type="monotone" stackId="a" dataKey="placements" name="Placements et épargne bloquée" stroke="var(--series-1)" strokeWidth={1.5} fill="var(--series-1)" fillOpacity={0.45} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartA11y>
            <div className="chips mt-8">
              <span className="chip"><span className="sw sw-2" aria-hidden>●</span> Courants {money0(last?.courant)}</span>
              <span className="chip"><span className="sw sw-3" aria-hidden>●</span> Livrets {money0(last?.livret)}</span>
              <span className="chip"><span className="sw sw-1" aria-hidden>●</span> Placements {money0(last?.placements)}</span>
            </div>
            <div className="acct-meta mt-8">Les comptes ajoutés récemment sont reportés à leur premier solde connu, pour ne pas fausser l'évolution.</div>
          </Card>

          <Card data-o="6" title="Entrées et sorties par mois" aside="hors virements entre comptes">
            <ChartA11y label="Entrées et sorties par mois sur 12 mois" summary={cf.data?.length ? `Dernier mois : ${money0(cf.data.at(-1)!.income)} d'entrées, ${money0(cf.data.at(-1)!.expense)} de sorties.` : undefined}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={cf.data ?? []} barGap={2}>
                  <CartesianGrid stroke="var(--hairline)" vertical={false} />
                  <XAxis dataKey="month" tickFormatter={monthLabel} interval="preserveStartEnd" minTickGap={18} {...axis} />
                  <YAxis tickFormatter={(v) => money0(v)} width={64} {...axis} />
                  <Tooltip {...tip} formatter={(v) => money0(Number(v))} labelFormatter={(m) => monthLabel(String(m))} cursor={{ fill: "var(--track)" }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
                  <Bar isAnimationActive={false} dataKey="income" name="Entrées" fill="var(--series-3)" radius={[4, 4, 0, 0]} />
                  <Bar isAnimationActive={false} dataKey="expense" name="Sorties" fill="var(--series-2)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartA11y>
          </Card>

          <Card data-o="8" title="Dernières opérations" aside={<Link to="/transactions" className="sub">Tout voir →</Link>}>
            {tx.error ? <ErrorState error={tx.error} what="les opérations" /> : tx.data ? <TxTable items={tx.data.items} showAccount={false} compact /> : <div className="skeleton" />}
          </Card>
        </div>

        <div className="dash-col">
          {!!fc.data?.length && (
            <div className="tiles" data-o="2">
              {nextPay && <Stat label="À la paie" value={money0(fcs.find((f) => !f.joint)?.projected ?? fcs[0].projected)} hint={`${daysToPay === 0 ? "aujourd'hui" : `J-${daysToPay}`} · ${nextPay.name}`} />}
              {fc.data.filter((f) => f.joint || !nextPay).slice(0, nextPay ? 1 : 2).map((f) => (
                <Stat key={f.account_id} label={pretty(f.name)} value={money0(f.projected)}
                  hint={f.projected < 200 ? <Status level={f.projected < 0 ? "critical" : "serious"}>Sous 200 €</Status> : `prévu au ${shortDate(f.ends)} · aujourd'hui ${money0(f.balance)}`} />
              ))}
            </div>
          )}
          <Card data-o="3" title="Objectifs" aside={<Link to="/objectifs" className="sub">Tout voir →</Link>}>
            {activeGoals.length ? (
              <div className="stack gap-16">
                {activeGoals.slice(0, 3).map((g) => (
                  <div key={g.id} className="stack gap-6">
                    <div className="line"><b>{g.name}</b><span className="sub num">{money0(g.current)} / {money0(g.target)}</span></div>
                    <ProgressBar value={g.progress_pct} label={`Progression de l'objectif ${g.name}`} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="stack">
                <div className="sub">Fixe un cap (achat immobilier, voyage, coussin de sécurité) et l'appli calcule l'effort mensuel et la faisabilité à partir de tes chiffres réels.</div>
                <div><Link to="/objectifs" className="btn primary">Créer un objectif</Link></div>
              </div>
            )}
          </Card>
          <Card data-o="5" title="Plafonds du cycle" aside={<Link to="/budget#plafonds" className="sub">Gérer →</Link>}>
            {caps.data?.length ? (
              <div className="stack gap-16">
                {caps.data.map((k) => (
                  <div key={k.category} className="stack gap-6">
                    <div className="line"><span>{k.label}</span><span className={"num " + (k.pct >= 100 ? "warn" : "sub")}>{money0(k.spent)} / {money0(k.monthly)}</span></div>
                    <ProgressBar value={k.pct} label={`Plafond ${k.label}`} state={k.pct >= 100 ? "over" : k.pct >= k.alert_pct ? "near" : undefined} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="stack">
                <div className="sub">Aucun plafond. Exemple : Achats en ligne ≤ 150 €/mois, avec une notification à 80 %.</div>
                <div><Link to="/budget#plafonds" className="btn">Définir un plafond</Link></div>
              </div>
            )}
          </Card>
          {!!scopedPays.length && (
            <Card data-o="7" title="Paies détectées" aside="repérées sur vos comptes, sans saisie">
              <div className="stack gap-16">
                {scopedPays.map((p) => (
                  <div key={p.person_id} className="stack gap-4">
                    <div className="k">{p.name}</div>
                    <div className="line"><b className="num fs-22 fw-500">{money0(p.avg_amount)}</b><span className="sub">en moyenne</span></div>
                    <div className="acct-meta">
                      Dernière paie {money0(p.last_amount)} le {shortDate(p.last_date)} · habituellement vers le {p.usual_day} · prochaine le{" "}
                      {new Date(p.next_date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} ({p.n} paie{p.n > 1 ? "s" : ""} analysée{p.n > 1 ? "s" : ""})
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
