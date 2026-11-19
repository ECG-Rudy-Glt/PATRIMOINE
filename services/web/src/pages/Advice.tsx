import { useState } from "react";
import { api, Analysis, Fact } from "../api";
import { useFetch } from "../useFetch";
import { dateTime, num, usd, money0 } from "../format";
import { Button, Card, Chip, ErrorState, LoadingState, ProgressBar } from "../components/ui";
import Status, { Level } from "../components/Status";
import Markdown from "../components/Markdown";

const PRIO: Record<string, Level> = { haute: "serious", moyenne: "warning", basse: "good" };
const HORIZON: Record<string, string> = { immediat: "Immédiat", ce_mois: "Ce mois-ci", trimestre: "Ce trimestre", long_terme: "Long terme" };
const TRIGGERS: Record<string, string> = {
  cycle_clos: "cycle clos", objectif_hors_portee: "objectif hors de portée", plafond_depasse: "plafond dépassé",
  prevision_basse: "prévision de solde basse", abonnement_nouveau_ou_hausse: "abonnement nouveau ou en hausse",
  depense_inhabituelle: "dépense inhabituelle", allocation_hors_bande: "allocation hors de la bande cible", manuel: "demande manuelle",
};
const fmt = (f: Fact) =>
  typeof f.value === "number"
    ? (f.unit === "€" ? money0(f.value) : `${num(f.value, 1)}\u00A0${f.unit}`.trim())
    : String(f.value);
// « Plus tard » : mémorisé sur cet appareil seulement (aucun changement côté serveur, la recommandation reste « proposée »)
const LATER_KEY = "advice-later";
const loadLater = (): number[] => { try { return JSON.parse(localStorage.getItem(LATER_KEY) ?? "[]"); } catch { return []; } };

export default function Advice() {
  const [reload, setReload] = useState(0);
  const status = useFetch(api.advisorStatus, [reload]);
  const list = useFetch(api.analyses, [reload]);
  const ctx = useFetch(api.advisorContext, [reload]);
  const docs = useFetch(api.advisorDocs, [reload]);
  const [writing, setWriting] = useState(false);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const strategie = docs.data?.strategie;
  const writeStrategy = async () => {
    setWriting(true); setMsg(null);
    try { const r = await api.writeStrategy(); setMsg(`Document rédigé (${num(r.chars)} caractères, ${usd(r.cost_usd)}).`); setReload((n) => n + 1); }
    catch (e) { setMsg(String(e)); } finally { setWriting(false); }
  };
  const download = () => {
    if (!strategie?.content) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([strategie.content], { type: "text/markdown;charset=utf-8" }));
    a.download = `strategie-epargne-${new Date().toISOString().slice(0, 10)}.md`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const ask = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.runAdvisor(null);
      setMsg(r.skipped ? "Rien de nouveau à analyser." : `Analyse terminée${r.warnings?.length ? ` (${r.warnings.length} avertissement(s))` : ""}.`);
      setReload((n) => n + 1);
    } catch (e) { setMsg(String(e)); } finally { setBusy(false); }
  };
  const pending = status.data?.scopes.flatMap((s) => s.pending_triggers) ?? [];
  const spend = status.data?.spend;

  const [later, setLater] = useState<number[]>(loadLater);
  const snooze = (id: number, on: boolean) => {
    const n = on ? [...later, id] : later.filter((x) => x !== id);
    setLater(n); try { localStorage.setItem(LATER_KEY, JSON.stringify(n)); } catch { /* sans stockage */ }
  };
  if (status.error) return <ErrorState error={status.error} what="le conseiller" onRetry={() => setReload((n) => n + 1)} />;
  if (!status.data) return <><h1 className="sr">Conseils</h1><LoadingState /></>;

  return (
    <>
      <h1 className="sr">Conseils</h1>
      <div className="bignum">
        <div className="lab">Conseiller · dépense API ce mois</div>
        <div className="big md">{spend ? usd(spend.spent) : "—"}{spend && <small>/ {usd(spend.budget, 0)}</small>}</div>
        {spend && <div className="mw-260 mx-auto mt-10"><ProgressBar thin value={(spend.spent / Math.max(spend.budget, 0.01)) * 100} state={spend.blocked ? "over" : spend.spent / spend.budget > 0.8 ? "near" : undefined} label="Dépense API du mois" /></div>}
        <p className="sub mx-auto mt-10 mw-52ch">Claude interprète tes chiffres réels : il ne calcule rien, chaque conseil cite les chiffres sur lesquels il s'appuie. Rien n'est exécuté.</p>
        <div className="mt-12">
          <Button variant="primary" disabled={busy || !status.data?.configured || !!spend?.blocked} onClick={ask}>
            {busy ? "Analyse en cours… (1 à 2 min)" : "Demander un avis"}
          </Button>
        </div>
      </div>

      {status.data && !status.data.configured && (
        <div className="notice"><span>Conseiller inactif : clé API Anthropic absente (<code>ANTHROPIC_API_KEY</code>).</span></div>
      )}
      {spend?.blocked && (
        <div className="notice"><span>Plafond mensuel de dépense API atteint : plus d'analyse jusqu'au mois prochain.</span></div>
      )}
      {msg && <div className="card mb-16" role="status">{msg}</div>}
      {!!pending.length && (
        <div className="sub mb-16 ta-center">
          Prochaine analyse automatique (07:15) déclenchée par : {[...new Set(pending)].map((t) => TRIGGERS[t] ?? t).join(", ")}.
        </div>
      )}

      <Card className="stack mb-16">
        <div className="line ai-flex-start gap-12 fw">
          <div className="grow-320">
            <div className="goal-name">Stratégie d'épargne <span className="sub">où placer, comment économiser, combien pour chaque projet</span></div>
            <div className="acct-meta">
              Document rédigé par Claude Opus à partir de vos chiffres réels, de votre contexte et de notes de marché datées.
              {strategie?.updated_at && strategie.content ? ` Dernière rédaction : ${dateTime(strategie.updated_at)} (${strategie.meta?.model ?? ""}, ${usd(strategie.meta?.cost_usd ?? 0)}).` : ""}
            </div>
          </div>
          <div className="line gap-8">
            {!!strategie?.content && <button onClick={download}>Télécharger (.md)</button>}
            <button className="primary" disabled={writing || !status.data?.configured || !!spend?.blocked} onClick={writeStrategy}>
              {writing ? "Rédaction en cours… (1 à 3 min)" : strategie?.content ? "Actualiser (≈ 0,30 $)" : "Rédiger (≈ 0,30 $)"}
            </button>
          </div>
        </div>
        {strategie?.content ? <Markdown text={strategie.content} /> : <div className="empty">Pas encore de document. Cliquez sur « Rédiger » : le conseiller rédige la stratégie en une à trois minutes.</div>}
        <details>
          <summary className="sub">Notes de marché et hypothèses utilisées (modifiables)</summary>
          <div className="stack gap-10 mt-8">
            {([["notes_marche", "Notes de marché (taux, fiscalité, frais, règles), datées", 10], ["hypotheses", "Hypothèses chiffrées (JSON : versements, hausse de salaire, taux du prêt, hors application…)", 8]] as const).map(([kind, label, rows]) => (
              <div key={kind} className="stack gap-4">
                <div className="kpi-label">{label}</div>
                <textarea rows={rows} value={notesDraft[kind] ?? docs.data?.[kind]?.content ?? ""}
                  onChange={(e) => setNotesDraft((d) => ({ ...d, [kind]: e.target.value }))} />
                <div><button disabled={notesDraft[kind] === undefined} onClick={async () => {
                  try { await api.saveAdvisorDoc(kind, notesDraft[kind]); setNotesDraft((d) => { const n = { ...d }; delete n[kind]; return n; }); setReload((n) => n + 1); setMsg("Enregistré."); }
                  catch (e) { setMsg(String(e)); }
                }}>Enregistrer</button></div>
              </div>
            ))}
          </div>
        </details>
      </Card>

      <details className="card mb-16">
        <summary className="goal-name cur-p">
          Contexte donné au conseiller <span className="sub">votre situation réelle, modifiable : elle prime sur ce qu'il déduit des chiffres</span>
        </summary>
        <div className="stack gap-10 mt-10">
          <textarea rows={12} value={draft ?? ctx.data?.content ?? ""}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Qui vous êtes, revenus, épargne hors application, comptes non connectés, projets, ce que vous attendez du conseiller…" />
          <div className="line">
            <span className="acct-meta">
              {ctx.data?.updated_at ? `Dernière modification : ${dateTime(ctx.data.updated_at)} · ` : ""}
              Ce texte est lu par les deux membres du foyer et envoyé au modèle à chaque analyse.
            </span>
            <button className="primary" disabled={saving || draft === null} onClick={async () => {
              setSaving(true);
              try { await api.saveAdvisorContext(draft ?? ""); setDraft(null); setReload((n) => n + 1); setMsg("Contexte enregistré."); }
              catch (e) { setMsg(String(e)); } finally { setSaving(false); }
            }}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
          </div>
          <details>
            <summary className="sub">Cartographie des comptes et des flux (générée automatiquement, lecture seule)</summary>
            <pre className="explain pre-wrap mt-6">{ctx.data?.map ?? "…"}</pre>
          </details>
        </div>
      </details>

      {list.error && <ErrorState error={list.error} what="les analyses" onRetry={() => setReload((n) => n + 1)} />}
      {list.data && !list.data.length && (
        <div className="card empty">Aucune analyse pour l'instant. Elles se lancent seules sur des faits précis (fin de cycle, plafond dépassé, objectif hors de portée…) ou à la demande.</div>
      )}
      <div className="convo">
        {list.data?.map((a) => <AnalysisCard key={a.id} a={a} later={later} snooze={snooze} onChange={() => setReload((n) => n + 1)} />)}
      </div>
    </>
  );
}

function AnalysisCard({ a, later, snooze, onChange }: { a: Analysis; later: number[]; snooze: (id: number, on: boolean) => void; onChange: () => void }) {
  return (
    <section className="convo" aria-label={`Analyse du ${dateTime(a.created_at)}`}>
      <div className="sub ta-center">
        {a.person ?? "Tous les comptes"} · {dateTime(a.created_at)} · déclencheurs : {a.trigger.split(",").map((t) => TRIGGERS[t] ?? t).join(", ")} · {a.model}
      </div>
      <div className="bub a">
        <p className="m-0">{a.payload.synthese}</p>
        {!!a.payload.sources?.length && (
          <ul className="src" aria-label="Sources du contexte économique">
            {a.payload.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer noopener" title={s.title}>{s.title}</a></li>)}
          </ul>
        )}
      </div>
      {a.items.map(({ id, item, status, feedback }) => <Item key={id} id={id} r={item} facts={a.facts} status={status} feedback={feedback}
        isLater={later.includes(id)} snooze={(on) => snooze(id, on)} onChange={onChange} />)}
      {!!a.payload.questions.length && (
        <div className="bub a"><div className="k">Questions du conseiller</div>
          <ul className="explain mt-4">{a.payload.questions.map((q) => <li key={q}>{q}</li>)}</ul></div>
      )}
      {!!a.warnings.length && (
        <details><summary className="sub">Contrôles automatiques ({a.warnings.length})</summary>
          <ul className="explain">{a.warnings.map((w) => <li key={w}>{w}</li>)}</ul></details>
      )}
    </section>
  );
}

function Item({ id, r, facts, status, feedback, isLater, snooze, onChange }: {
  id: number; r: Analysis["payload"]["recommandations"][number]; facts: Record<string, Fact>;
  status: string; feedback: string | null; isLater: boolean; snooze: (on: boolean) => void; onChange: () => void;
}) {
  const [why, setWhy] = useState(feedback ?? "");
  const [rejecting, setRejecting] = useState(false);
  const decide = async (s: string, fb?: string) => { await api.decide(id, s, fb); setRejecting(false); snooze(false); onChange(); };
  return (
    <Card>
      <div className="goal-head">
        <div>
          <b>{r.titre}</b>
          <div className="sub">{HORIZON[r.horizon] ?? r.horizon} · {r.categorie.replace("_", " ")}</div>
        </div>
        <Status level={PRIO[r.priorite] ?? "warning"}>Priorité {r.priorite}</Status>
      </div>
      <p className="reco-p">{r.constat}</p>
      <p className="reco-p"><b>Action : </b>{r.action}</p>
      <p className="explain reco-p">{r.vigilance}</p>
      <div className="facts mb-12">
        {r.faits.map((k) => facts[k] && (
          <div className="fact" key={k}><div className="k">{facts[k].label}</div><b className="num">{fmt(facts[k])}</b></div>
        ))}
      </div>
      {status === "proposee" ? (
        rejecting ? (
          <div className="toolbar mb-0">
            <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Pourquoi ? (aide à améliorer les conseils)" aria-label="Motif du refus" className="grow-1" autoFocus />
            <Button onClick={() => decide("rejetee", why)}>Refuser</Button>
            <Button variant="ghost" onClick={() => setRejecting(false)}>Annuler</Button>
          </div>
        ) : isLater ? (
          <div className="line"><Chip tone="warn">À revoir plus tard</Chip><Button variant="ghost" onClick={() => snooze(false)}>Reprendre</Button></div>
        ) : (
          <div className="btns">
            <Button variant="primary" onClick={() => decide("acceptee")}>Accepter</Button>
            <Button onClick={() => snooze(true)}>Plus tard</Button>
            <Button onClick={() => setRejecting(true)}>Refuser</Button>
          </div>
        )
      ) : (
        <div className="line">
          <Status level={status === "acceptee" ? "good" : "critical"}>{status === "acceptee" ? "Acceptée" : "Refusée"}</Status>
          <span className="sub">{feedback}</span>
          <Button variant="ghost" onClick={() => decide("proposee")}>Annuler la décision</Button>
        </div>
      )}
    </Card>
  );
}
