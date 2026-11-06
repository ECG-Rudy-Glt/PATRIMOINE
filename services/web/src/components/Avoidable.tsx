import { api } from "../api";
import { useFetch } from "../useFetch";
import { money, money0, shortDate } from "../format";

// Tableau des dépenses sur lesquelles agir : chiffres réels (SQL), jamais estimés par le modèle de langage.
export default function Avoidable({ person }: { person: number | null }) {
  const a = useFetch(() => api.avoidable(person), [person]);
  if (a.error) return <div className="err">{a.error}</div>;
  if (!a.data) return <div className="card"><div className="skeleton" style={{ width: "40%" }} /></div>;
  const groups = a.data.groups.filter((g) => g.items.length);
  const annual = groups.reduce((t, g) => t + g.annual, 0);
  const max = Math.max(1, ...groups.flatMap((g) => g.items.map((i) => i.monthly)));
  if (!groups.length) return <div className="card empty">Rien à signaler sur la période.</div>;
  return (
    <div className="card">
      <h2>Dépenses à éviter ou à négocier <span className="sub">{money0(annual)} dépensés par an sur ces postes</span></h2>
      <div className="sub" style={{ marginBottom: 10 }}>{a.data.note} Période : {a.data.months.toLocaleString("fr-FR")} mois.</div>
      {groups.map((g) => (
        <section key={g.key} className="avoid-group">
          <div className="group-title"><span>{g.title}</span><span>{money0(g.monthly)} / mois · {money0(g.annual)} / an</span></div>
          {g.items.map((i) => (
            <div className="avoid-row" key={i.category}>
              <div className="avoid-main">
                <b>{i.label}</b>
                <span className="avoid-bar"><span style={{ width: `${Math.max(3, (i.monthly / max) * 100)}%` }} /></span>
                <span className="acct-meta">{i.hint}</span>
                {!!i.recurring.length && (
                  <div className="acct-meta">
                    Prélèvements récurrents : {i.recurring.map((r) => `${r.merchant} ${money(r.amount)} (prochain ${shortDate(r.next)})`).join(" · ")}
                  </div>
                )}
                {!i.recurring.length && !!i.top.length && (
                  <div className="acct-meta">Principaux : {i.top.slice(0, 3).map((t) => `${t.merchant} ${money0(t.total)}`).join(" · ")}</div>
                )}
              </div>
              <div className="avoid-num"><b>{money0(i.monthly)}</b><span className="acct-meta">/ mois</span><span className="acct-meta">{money0(i.annual)} / an</span></div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
