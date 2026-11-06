import { useState } from "react";
import { api } from "../api";
import { useFetch } from "../useFetch";
import { dateTime, money, money0 } from "../format";

// Alternatives chez la concurrence trouvées par l'IA (recherche web). Les prix viennent des sources citées ;
// l'économie annuelle est calculée par l'application (montant réel actuel − prix publié), pas par le modèle.
export default function Savings() {
  const [tick, setTick] = useState(0);
  const sv = useFetch(api.savings, [tick]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setErr(null);
    try { await api.runSavings(); setTick((t) => t + 1); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const p = sv.data?.payload;
  const best = (p?.items ?? []).reduce((t, i) => t + Math.max(0, ...i.alternatives.map((a) => a.economie_annuelle ?? 0)), 0);
  return (
    <div className="card">
      <h2>
        Où gagner : alternatives chez la concurrence
        {best > 0 && <span className="sub">jusqu'à {money0(best)} par an</span>}
      </h2>
      <div className="line" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 10 }}>
        <div className="sub" style={{ flex: "1 1 300px" }}>
          L'IA cherche sur le web, pour chaque contrat récurrent (box, mobiles, assurances, énergie, frais bancaires), des offres équivalentes moins chères.
          Chaque offre cite sa source ; l'économie est calculée par l'application.
        </div>
        <button className="primary" disabled={busy} onClick={run}>{busy ? "Recherche en cours (1 à 3 min)…" : p ? "Relancer la recherche (≈ 0,40 $)" : "Chercher des alternatives (≈ 0,40 $)"}</button>
      </div>
      {err && <div className="err" role="alert" style={{ padding: 0, textAlign: "left", marginBottom: 8 }}>{err}</div>}
      {!p && !busy && <div className="empty">Pas encore de recherche.</div>}
      {p?.items.map((it) => (
        <section key={it.contrat.id} className="avoid-group">
          <div className="group-title">
            <span>{it.contrat.libelle} <span className="acct-meta">· {it.contrat.categorie}</span></span>
            <span>actuellement {money(it.contrat.mensuel)} / mois</span>
          </div>
          {it.alternatives.map((a, i) => (
            <div className="avoid-row" key={i}>
              <div className="avoid-main">
                <b>{a.fournisseur} — {a.offre}</b>
                <span className="acct-meta">
                  {a.engagement ? `${a.engagement} · ` : ""}{a.conditions ?? ""}
                  {a.prix_apres_promo != null ? ` · prix normal après promotion : ${money(a.prix_apres_promo)}` : ""}
                </span>
                <span className="acct-meta">
                  <a href={a.source_url} target="_blank" rel="noopener noreferrer">Source</a>
                  {a.date_constat ? ` · constaté le ${new Date(a.date_constat).toLocaleDateString("fr-FR")}` : ""}
                </span>
              </div>
              <div className="avoid-num">
                <b>{money(a.prix_mensuel)}</b><span className="acct-meta">/ mois</span>
                {a.economie_annuelle != null && (
                  <span className="pos" style={{ fontWeight: 600 }} title={a.economie_estimee ? "Montant actuel estimé (moyenne observée, pas un prélèvement régulier)" : undefined}>
                    {a.economie_estimee ? "≈ " : ""}−{money0(a.economie_annuelle)} / an
                  </span>
                )}
              </div>
            </div>
          ))}
          {!!it.pistes.length && (
            <div className="acct-meta" style={{ padding: "6px 8px" }}>À essayer : {it.pistes.join(" · ")}</div>
          )}
          {it.prudence && <div className="acct-meta" style={{ padding: "0 8px 8px" }}>⚠ {it.prudence}</div>}
        </section>
      ))}
      {p && (
        <div className="acct-meta" style={{ marginTop: 10 }}>
          Recherche du {dateTime(sv.data?.created_at ?? null)} · {p.sources_consultees} sources consultées · {p.rejetees} offre(s) écartée(s) (sans prix ni source, ou pas moins chères).
          {" "}{p.note} {p.avertissements.join(" ")}
        </div>
      )}
    </div>
  );
}
