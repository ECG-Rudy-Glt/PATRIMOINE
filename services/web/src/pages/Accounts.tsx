import { useState } from "react";
import { api } from "../api";
import { useFetch } from "../useFetch";
import { usePerson } from "../person";
import { ACCOUNT_TYPES, dateTime, initials, money, money0, pretty } from "../format";
import Donut from "../components/Donut";
import FlowMap from "../components/FlowMap";
import TransferMap from "../components/TransferMap";
import { BigNumber, Card, ErrorState, ListItem, LoadingState, Segmented } from "../components/ui";

const STALE_MS = 48 * 3600 * 1000;
type View = "comptes" | "flux" | "virements";
const VIEWS = [{ value: "comptes" as View, label: "Comptes" }, { value: "flux" as View, label: "Flux" }, { value: "virements" as View, label: "Virements" }];

export default function Accounts() {
  const { person } = usePerson();
  const all = useFetch(api.accounts);
  const br = useFetch(() => api.breakdownAccounts(person), [person]);
  const flows = useFetch(() => api.flows(person), [person]);
  // 3 vues : liste des comptes, flux (d'où vient l'argent, où il part), virements (qui envoie quoi à quel compte)
  const [view, setView] = useState<View>(() => {
    try { const v = localStorage.getItem("accounts-view"); return v === "virements" || v === "flux" ? v : "comptes"; } catch { return "comptes"; }
  });
  const pick = (v: View) => { setView(v); try { localStorage.setItem("accounts-view", v); } catch { /* sans stockage */ } };
  const transfers = useFetch(() => (view === "virements" ? api.transfers(person) : Promise.resolve(null)), [person, view]);
  if (all.error) return <ErrorState error={all.error} what="les comptes" onRetry={() => location.reload()} />;
  if (!all.data) return <><h1 className="sr">Comptes</h1><LoadingState /></>;
  // Foyer (-1) = comptes à plusieurs titulaires ; une personne = ses comptes personnels (un seul titulaire)
  const data = all.data.filter((a) => !person
    || (person === -1 ? a.holders.length > 1 : a.holders.length === 1 && a.holders[0].person_id === person));
  const total = data.reduce((t, a) => t + (a.balance ?? 0), 0);

  const byType = new Map<string, number>();
  br.data?.forEach((s) => byType.set(ACCOUNT_TYPES[s.type] ?? s.type, (byType.get(ACCOUNT_TYPES[s.type] ?? s.type) ?? 0) + s.value));
  const byHolder = new Map<string, number>();
  br.data?.forEach((s) => byHolder.set(s.holders || "Sans titulaire", (byHolder.get(s.holders || "Sans titulaire") ?? 0) + s.value));
  const byInstitution = new Map<string, typeof data>();
  const inst = (a: { institution: string | null }) => (!a.institution || a.institution === "À préciser" ? "Établissement non précisé" : a.institution);
  data.forEach((a) => byInstitution.set(inst(a), [...(byInstitution.get(inst(a)) ?? []), a]));

  const flowNote = (() => {
    const d = view === "flux" ? flows.data : transfers.data;
    if (!d) return "moyenne mensuelle";
    return d.partial ? `moyenne mensuelle sur ${String(d.months).replace(".", ",")} mois (pas encore de cycle complet : toutes les données disponibles)` : `moyenne mensuelle, ${d.cycles} cycle(s) complet(s)`;
  })();

  const views = [
    { title: "Par compte", items: (br.data ?? []).map((a) => ({ name: pretty(a.name), value: a.value })) },
    { title: "Par type", items: [...byType].map(([name, value]) => ({ name, value })) },
    ...(person ? [] : [{ title: "Par titulaire", items: [...byHolder].map(([name, value]) => ({ name, value })) }]),
  ].filter((v) => v.items.filter((i) => i.value > 0).length >= 2);

  return (
    <>
      <h1 className="sr">Comptes et flux</h1>
      <BigNumber value={total} label={`${data.length} compte(s) suivi(s) · ${person === -1 ? "foyer (compte commun)" : person ? "comptes personnels" : "tous les comptes"}`} size="md" />
      <div className="view-switch">
        <Segmented fill role="tab" label="Vue des comptes" value={view} onChange={pick} options={VIEWS} />
      </div>

      {view === "comptes" && (
        <div className="grid">
          <div className="grid two ai-start">
            {[...byInstitution.entries()].map(([bank, accts]) => (
              <Card key={bank} title={bank} aside={money0(accts.reduce((t, a) => t + (a.balance ?? 0), 0))}>
                <div className="list">
                  {accts.map((a) => {
                    const stale = !a.last_sync_at || Date.now() - new Date(a.last_sync_at).getTime() > STALE_MS;
                    const holders = a.holders.length ? a.holders.map((h) => (h.share < 1 ? `${h.name} ${Math.round(h.share * 100)} %` : h.name)).join(" / ") : "sans titulaire";
                    return (
                      <ListItem key={a.id} to={`/transactions?account_id=${a.id}`} icon={initials(pretty(a.name))} title={pretty(a.name)}
                        meta={`${ACCOUNT_TYPES[a.type] ?? a.type} · ${holders}${stale ? ` · dernière synchro ${dateTime(a.last_sync_at)}` : ""}`} amount={money(a.balance)}
                        sub={stale ? "Synchro en retard" : undefined} subTone={stale ? "warn" : undefined} />
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>
          {br.data && views.length > 0 && (
            <div className={`grid ${views.length === 3 ? "three" : "two"}`}>
              {views.map((v) => <Card key={v.title} title={v.title}><Donut items={v.items} /></Card>)}
            </div>
          )}
          {br.data && !views.length && <div className="sub">Répartition par compte, par type{person ? "" : " et par titulaire"} : disponible dès le 2e compte connecté.</div>}
        </div>
      )}

      {view !== "comptes" && (
        <Card title={view === "flux" ? "Cartographie des flux" : "Virements entre comptes"} aside={flowNote}>
          {view === "flux" && (flows.error ? <ErrorState error={flows.error} what="les flux" /> : flows.data ? <FlowMap flows={flows.data} /> : <LoadingState />)}
          {view === "virements" && (transfers.error ? <ErrorState error={transfers.error} what="les virements" /> : transfers.data ? <TransferMap data={transfers.data} /> : <LoadingState />)}
          <div className="acct-meta mt-8">
            {view === "flux"
              ? "D'où vient l'argent (à gauche), sur quel compte il passe, et où il part (à droite)."
              : "Qui envoie combien à quel compte. Trait plein : les deux comptes sont suivis. Pointillés : l'autre côté n'est pas connecté (livret, compte à votre nom ailleurs…), identifié par le libellé du virement. Survolez un compte pour isoler ses flux."}
          </div>
        </Card>
      )}
    </>
  );
}
