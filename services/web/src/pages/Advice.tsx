import { useState } from "react";
import { api, Analysis, Fact } from "../api";
import { useFetch } from "../useFetch";
import { dateTime } from "../format";
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
    ? `${f.value.toLocaleString("fr-FR", { maximumFractionDigits: f.unit === "€" ? 0 : 1 })} ${f.unit}`.trim()
    : String(f.value);

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
    try { const r = await api.writeStrategy(); setMsg(`Document rédigé (${r.chars.toLocaleString("fr-FR")} caractères, ${r.cost_usd.toFixed(2)} $).`); setReload((n) => n + 1); }
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

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Conseils</h1>
          <div className="sub">Claude interprète tes chiffres réels : il ne calcule rien, chaque conseil cite les chiffres sur lesquels il s'appuie. Rien n'est exécuté.</div>
        </div>
        <button className="primary" disabled={busy || !status.data?.configured || !!spend?.blocked} onClick={ask}>
          {busy ? "Analyse en cours… (1 à 2 min)" : "Demander un avis"}
        </button>
      </div>

      {status.data && !status.data.configured && (
        <div className="notice"><span>Conseiller inactif : clé API Anthropic absente (<code>ANTHROPIC_API_KEY</code>).</span></div>
      )}
      {spend?.blocked && (
        <div className="notice"><span>Plafond mensuel de dépense API atteint : plus d'analyse jusqu'au mois prochain.</span></div>
      )}
      {spend && (
        <div className="sub" style={{ marginBottom: 16 }}>
          Dépense API ce mois : {spend.spent.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} $ sur un plafond de {spend.budget.toLocaleString("fr-FR")} $.
        </div>
      )}
      {msg && <div className="card" style={{ marginBottom: 16 }}>{msg}</div>}
      {!!pending.length && (
        <div className="sub" style={{ marginBottom: 16 }}>
          Prochaine analyse automatique (07:15) déclenchée par : {[...new Set(pending)].map((t) => TRIGGERS[t] ?? t).join(", ")}.
        </div>
      )}

      <div className="card stack" style={{ marginBottom: 16, gap: 12 }}>
        <div className="line" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 320px" }}>
            <div className="goal-name">Stratégie d'épargne <span className="sub">où placer, comment économiser, combien pour chaque projet</span></div>
            <div className="acct-meta">
              Document rédigé par Claude Opus à partir de vos chiffres réels, de votre contexte et de notes de marché datées.
              {strategie?.updated_at && strategie.content ? ` Dernière rédaction : ${dateTime(strategie.updated_at)} (${strategie.meta?.model ?? ""}, ${(strategie.meta?.cost_usd ?? 0).toFixed(2)} $).` : ""}
            </div>
          </div>
          <div className="line" style={{ gap: 8 }}>
            {!!strategie?.content && <button onClick={download}>Télécharger (.md)</button>}
            <button className="primary" disabled={writing || !status.data?.configured || !!spend?.blocked} onClick={writeStrategy}>
              {writing ? "Rédaction en cours… (1 à 3 min)" : strategie?.content ? "Actualiser (≈ 0,30 $)" : "Rédiger (≈ 0,30 $)"}
            </button>
          </div>
        </div>
        {strategie?.content ? <Markdown text={strategie.content} /> : <div className="empty">Pas encore de document. Cliquez sur « Rédiger » : le conseiller rédige la stratégie en une à trois minutes.</div>}
        <details>
          <summary className="sub">Notes de marché et hypothèses utilisées (modifiables)</summary>
          <div className="stack" style={{ gap: 10, marginTop: 8 }}>
            {([["notes_marche", "Notes de marché (taux, fiscalité, frais, règles), datées", 10], ["hypotheses", "Hypothèses chiffrées (JSON : versements, hausse de salaire, taux du prêt, hors application…)", 8]] as const).map(([kind, label, rows]) => (
              <div key={kind} className="stack" style={{ gap: 4 }}>
                <div className="kpi-label">{label}</div>
                <textarea rows={rows} style={{ width: "100%", font: "inherit" }} value={notesDraft[kind] ?? docs.data?.[kind]?.content ?? ""}
                  onChange={(e) => setNotesDraft((d) => ({ ...d, [kind]: e.target.value }))} />
                <div><button disabled={notesDraft[kind] === undefined} onClick={async () => {
                  try { await api.saveAdvisorDoc(kind, notesDraft[kind]); setNotesDraft((d) => { const n = { ...d }; delete n[kind]; return n; }); setReload((n) => n + 1); setMsg("Enregistré."); }
                  catch (e) { setMsg(String(e)); }
                }}>Enregistrer</button></div>
              </div>
            ))}
          </div>
        </details>
      </div>

      <details className="card" style={{ marginBottom: 16 }}>
        <summary className="goal-name" style={{ cursor: "pointer" }}>
          Contexte donné au conseiller <span className="sub">votre situation réelle, modifiable : elle prime sur ce qu'il déduit des chiffres</span>
        </summary>
        <div className="stack" style={{ gap: 10, marginTop: 10 }}>
          <textarea rows={12} style={{ width: "100%", font: "inherit" }} value={draft ?? ctx.data?.content ?? ""}
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
            <pre className="explain" style={{ whiteSpace: "pre-wrap", margin: "6px 0 0" }}>{ctx.data?.map ?? "…"}</pre>
          </details>
        </div>
      </details>

      {list.data && !list.data.length && (
        <div className="card empty">Aucune analyse pour l'instant. Elles se lancent seules sur des faits précis (fin de cycle, plafond dépassé, objectif hors de portée…) ou à la demande.</div>
      )}
      <div className="grid">
        {list.data?.map((a) => <AnalysisCard key={a.id} a={a} onChange={() => setReload((n) => n + 1)} />)}
      </div>
    </>
  );
}

function AnalysisCard({ a, onChange }: { a: Analysis; onChange: () => void }) {
  return (
    <div className="card stack" style={{ gap: 14 }}>
      <div className="line">
        <div>
          <div className="goal-name">{a.person ?? "Tous les comptes"} · {dateTime(a.created_at)}</div>
          <div className="sub">Déclencheurs : {a.trigger.split(",").map((t) => TRIGGERS[t] ?? t).join(", ")} · {a.model}</div>
        </div>
      </div>
      <p className="explain" style={{ margin: 0, color: "var(--text)" }}>{a.payload.synthese}</p>

      {a.items.map(({ id, item, status, feedback }) => <Item key={id} id={id} r={item} facts={a.facts} status={status} feedback={feedback} onChange={onChange} />)}

      {!!a.payload.questions.length && (
        <div><div className="kpi-label">Questions du conseiller</div>
          <ul className="explain" style={{ margin: "4px 0 0" }}>{a.payload.questions.map((q) => <li key={q}>{q}</li>)}</ul></div>
      )}
      {!!a.warnings.length && (
        <details><summary className="sub">Contrôles automatiques ({a.warnings.length})</summary>
          <ul className="explain">{a.warnings.map((w) => <li key={w}>{w}</li>)}</ul></details>
      )}
      {!!a.payload.sources?.length && (
        <details><summary className="sub">Sources du contexte économique ({a.payload.sources.length})</summary>
          <ul className="explain">{a.payload.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}</ul></details>
      )}
    </div>
  );
}

function Item({ id, r, facts, status, feedback, onChange }: {
  id: number; r: Analysis["payload"]["recommandations"][number]; facts: Record<string, Fact>;
  status: string; feedback: string | null; onChange: () => void;
}) {
  const [why, setWhy] = useState(feedback ?? "");
  const [rejecting, setRejecting] = useState(false);
  const decide = async (s: string, fb?: string) => { await api.decide(id, s, fb); setRejecting(false); onChange(); };
  return (
    <div className="card" style={{ background: "var(--surface-2)", boxShadow: "none" }}>
      <div className="goal-head">
        <div>
          <b>{r.titre}</b>
          <div className="sub">{HORIZON[r.horizon] ?? r.horizon} · {r.categorie.replace("_", " ")}</div>
        </div>
        <Status level={PRIO[r.priorite] ?? "warning"}>Priorité {r.priorite}</Status>
      </div>
      <p style={{ margin: "10px 0 6px" }}>{r.constat}</p>
      <p style={{ margin: "0 0 6px" }}><b>Action : </b>{r.action}</p>
      <p className="explain" style={{ margin: "0 0 10px" }}>{r.vigilance}</p>
      <div className="facts" style={{ marginBottom: 12 }}>
        {r.faits.map((k) => facts[k] && (
          <div className="fact" key={k}><div className="kpi-label">{facts[k].label}</div><b>{fmt(facts[k])}</b></div>
        ))}
      </div>
      {status === "proposee" ? (
        rejecting ? (
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Pourquoi ? (aide à améliorer les conseils)" style={{ flex: 1 }} autoFocus />
            <button onClick={() => decide("rejetee", why)}>Rejeter</button>
            <button className="ghost" onClick={() => setRejecting(false)}>Annuler</button>
          </div>
        ) : (
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <button className="primary" onClick={() => decide("acceptee")}>J'accepte</button>
            <button onClick={() => setRejecting(true)}>Je rejette</button>
          </div>
        )
      ) : (
        <div className="line">
          <Status level={status === "acceptee" ? "good" : "critical"}>{status === "acceptee" ? "Acceptée" : "Rejetée"}</Status>
          <span className="sub">{feedback}</span>
          <button className="ghost" onClick={() => decide("proposee")}>Annuler la décision</button>
        </div>
      )}
    </div>
  );
}
