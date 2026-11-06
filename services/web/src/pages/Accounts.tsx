import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useFetch } from "../useFetch";
import { usePerson } from "../person";
import { ACCOUNT_TYPES, dateTime, money, pretty } from "../format";
import Donut from "../components/Donut";
import FlowMap from "../components/FlowMap";
import TransferMap from "../components/TransferMap";

const STALE_MS = 48 * 3600 * 1000;

export default function Accounts() {
  const { person } = usePerson();
  const all = useFetch(api.accounts);
  const br = useFetch(() => api.breakdownAccounts(person), [person]);
  const flows = useFetch(() => api.flows(person), [person]);
  // vue en option : « flux » (d'où vient l'argent, où il part) ou « virements » (qui envoie quoi à quel compte)
  const [view, setView] = useState<"flux" | "virements">(() => {
    try { return localStorage.getItem("accounts-view") === "virements" ? "virements" : "flux"; } catch { return "flux"; }
  });
  const pick = (v: "flux" | "virements") => { setView(v); try { localStorage.setItem("accounts-view", v); } catch { /* sans stockage */ } };
  const transfers = useFetch(() => (view === "virements" ? api.transfers(person) : Promise.resolve(null)), [person, view]);
  if (all.error) return <div className="err">{all.error}</div>;
  // Foyer (-1) = comptes à plusieurs titulaires ; une personne = ses comptes personnels (un seul titulaire)
  const data = all.data?.filter((a) => !person
    || (person === -1 ? a.holders.length > 1 : a.holders.length === 1 && a.holders[0].person_id === person));

  // répartition par type de compte
  const byType = new Map<string, number>();
  br.data?.forEach((s) => byType.set(ACCOUNT_TYPES[s.type] ?? s.type, (byType.get(ACCOUNT_TYPES[s.type] ?? s.type) ?? 0) + s.value));
  // répartition par titulaire
  const byHolder = new Map<string, number>();
  br.data?.forEach((s) => byHolder.set(s.holders || "Sans titulaire", (byHolder.get(s.holders || "Sans titulaire") ?? 0) + s.value));

  const byInstitution = new Map<string, NonNullable<typeof data>>();
  const inst = (a: { institution: string | null }) => (!a.institution || a.institution === "À préciser" ? "Établissement non précisé" : a.institution);
  data?.forEach((a) => byInstitution.set(inst(a), [...(byInstitution.get(inst(a)) ?? []), a]));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Comptes & flux</h1>
          <div className="sub">{data?.length ?? "–"} compte(s) suivi(s) · {person === -1 ? "foyer (compte commun)" : person ? "comptes personnels" : "tous les comptes"}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="line" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>
            {view === "flux" ? "Cartographie des flux" : "Virements entre comptes"}{" "}
            <span className="sub">{(() => {
              const d = view === "flux" ? flows.data : transfers.data;
              if (!d) return "moyenne mensuelle";
              return d.partial ? `moyenne mensuelle sur ${String(d.months).replace(".", ",")} mois (pas encore de cycle complet : toutes les données disponibles)` : `moyenne mensuelle, ${d.cycles} cycle(s) complet(s)`;
            })()}</span>
          </h2>
          <div className="seg" role="tablist" aria-label="Vue de la cartographie">
            <button role="tab" aria-selected={view === "flux"} className={view === "flux" ? "on" : ""} onClick={() => pick("flux")}>Flux</button>
            <button role="tab" aria-selected={view === "virements"} className={view === "virements" ? "on" : ""} onClick={() => pick("virements")}>Virements entre comptes</button>
          </div>
        </div>
        {view === "flux" && flows.data && <FlowMap flows={flows.data} />}
        {view === "virements" && transfers.data && <TransferMap data={transfers.data} />}
        {view === "virements" && transfers.error && <div className="err">{transfers.error}</div>}
        <div className="acct-meta" style={{ marginTop: 8 }}>
          {view === "flux"
            ? "D'où vient l'argent (à gauche), sur quel compte il passe, et où il part (à droite)."
            : "Qui envoie combien à quel compte. Trait plein : les deux comptes sont suivis. Pointillés : l'autre côté n'est pas connecté (livret, compte à votre nom ailleurs…), identifié par le libellé du virement. Survolez un compte pour isoler ses flux."}
        </div>
      </div>

      {(() => {
        // Répartitions utiles seulement : au moins 2 parts ; « par titulaire » réservé à la vue Foyer
        const views = [
          { title: "Par compte", items: (br.data ?? []).map((a) => ({ name: pretty(a.name), value: a.value })) },
          { title: "Par type", items: [...byType].map(([name, value]) => ({ name, value })) },
          ...(person ? [] : [{ title: "Par titulaire", items: [...byHolder].map(([name, value]) => ({ name, value })) }]),
        ].filter((v) => v.items.filter((i) => i.value > 0).length >= 2);
        if (!br.data) return null;
        if (!views.length)
          return <div className="sub" style={{ marginBottom: 16 }}>Répartition par compte, par type{person ? "" : " et par titulaire"} : disponible dès le 2e compte connecté.</div>;
        return (
          <div className={`grid ${views.length === 3 ? "three" : "two"}`} style={{ marginBottom: 16 }}>
            {views.map((v) => <div className="card" key={v.title}><h2>{v.title}</h2><Donut items={v.items} /></div>)}
          </div>
        );
      })()}

      <div className="grid">
        {[...byInstitution.entries()].map(([bank, accts]) => (
          <div className="card" key={bank}>
            <h2>{bank}</h2>
            <div className="grid" style={{ gap: 12 }}>
              {accts.map((a) => {
                const stale = !a.last_sync_at || Date.now() - new Date(a.last_sync_at).getTime() > STALE_MS;
                return (
                  <div className="acct-card" key={a.id}>
                    <div>
                      <div className="acct-name">{pretty(a.name)}</div>
                      <div className="acct-meta">
                        {ACCOUNT_TYPES[a.type] ?? a.type} · {a.holders.length
                          ? a.holders.map((h) => (h.share < 1 ? `${h.name} ${Math.round(h.share * 100)} %` : h.name)).join(" / ")
                          : "sans titulaire"} ·{" "}
                        <span className={"badge " + (stale ? "ko" : "ok")}>
                          {stale ? "Synchro en retard" : "Synchronisé"} {dateTime(a.last_sync_at)}
                        </span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="kpi-value" style={{ fontSize: 20 }}>{money(a.balance)}</div>
                      <Link to={`/transactions?account_id=${a.id}`} className="sub">Transactions →</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
