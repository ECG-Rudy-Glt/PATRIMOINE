import { useEffect, useState } from "react";
import { api, Goal, GoalIn } from "../api";
import { useFetch } from "../useFetch";
import { date, money, money0, monthsLabel, pretty } from "../format";
import Progress from "../components/Progress";
import Status, { Level } from "../components/Status";

const KINDS: Record<string, { label: string; items: string[] }> = {
  maison: { label: "Achat immobilier", items: ["Apport", "Frais de notaire", "Travaux", "Déménagement"] },
  voiture: { label: "Voiture", items: ["Prix d'achat", "Carte grise & assurance"] },
  voyage: { label: "Voyage", items: ["Transport", "Hébergement", "Sur place"] },
  precaution: { label: "Épargne de précaution", items: ["Coussin de sécurité"] },
  etudes: { label: "Études / formation", items: ["Frais"] },
  retraite: { label: "Retraite", items: ["Capital visé"] },
  autre: { label: "Autre", items: ["Montant"] },
};
const FEAS: Record<string, [Level, string]> = {
  ok: ["good", "Atteignable"], tight: ["warning", "Tendu"], out: ["critical", "Hors de portée au rythme actuel"],
};

const blank = (): GoalIn => ({
  name: "", kind: "maison", person_id: null, target_date: `${new Date().getFullYear() + 2}-06-30`, priority: 1,
  initial: 0, status: "active", notes: "", items: KINDS.maison.items.map((l) => ({ label: l, amount: 0 })), accounts: [],
});

export default function Goals() {
  const [reload, setReload] = useState(0);
  const goals = useFetch(api.goals, [reload]);
  const [edit, setEdit] = useState<{ id?: number; g: GoalIn } | null>(null);

  const open = (g?: Goal) =>
    setEdit(g ? {
      id: g.id, g: {
        name: g.name, kind: g.kind, person_id: g.person_id, target_date: g.target_date, priority: g.priority, initial: g.initial,
        status: g.status, notes: g.notes ?? "", items: g.items.map(({ label, amount }) => ({ label, amount })),
        accounts: g.accounts.map(({ account_id, share }) => ({ account_id, share })),
      },
    } : { g: blank() });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Objectifs</h1>
          <div className="sub">Chaque objectif a ses postes, ses comptes affectés et sa priorité. Le plan est calculé sur tes chiffres réels.</div>
        </div>
        <button className="primary" onClick={() => open()}>Nouvel objectif</button>
      </div>

      {goals.data && !goals.data.length && (
        <div className="card empty">
          Aucun objectif pour l'instant. Commence par ce qui compte : un achat immobilier, un coussin de sécurité, un voyage.
        </div>
      )}

      <div className="grid">
        {goals.data?.map((g) => <GoalCard key={g.id} g={g} onEdit={() => open(g)} />)}
      </div>

      {edit && (
        <GoalForm initial={edit.g} id={edit.id} onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); setReload((n) => n + 1); }} />
      )}
    </>
  );
}

function GoalCard({ g, onEdit }: { g: Goal; onEdit: () => void }) {
  const [level, label] = g.feasibility ? FEAS[g.feasibility] : ["good" as Level, g.status === "done" ? "Atteint" : "En pause"];
  const pace = g.pace_monthly;
  return (
    <div className="card goal-card">
      <div className="goal-head">
        <div>
          <div className="goal-name">{g.name}</div>
          <div className="sub">
            {KINDS[g.kind]?.label ?? g.kind} · {g.person ?? "Foyer"} · échéance {date(g.target_date)} ({monthsLabel(g.months_left)}) · priorité {g.priority}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Status level={level}>{label}</Status>
          <button onClick={onEdit}>Modifier</button>
        </div>
      </div>

      <div>
        <div className="line" style={{ marginBottom: 6 }}>
          <span><b>{money0(g.current)}</b> <span className="sub">sur {money0(g.target)}</span></span>
          <span className="sub">{g.progress_pct.toLocaleString("fr-FR")} %</span>
        </div>
        <Progress value={g.progress_pct} />
      </div>

      <div className="facts">
        <div className="fact"><div className="kpi-label">Effort nécessaire</div><b>{g.monthly_needed != null ? `${money0(g.monthly_needed)} / mois` : "—"}</b></div>
        <div className="fact"><div className="kpi-label">Rythme réel (90 j)</div><b>{pace != null ? `${money0(pace)} / mois` : "—"}</b></div>
        <div className="fact"><div className="kpi-label">Projection à l'échéance</div><b>{money0(g.projected)}</b></div>
        {g.capacity != null && <div className="fact"><div className="kpi-label">Capacité d'épargne réelle</div><b>{money0(g.capacity)} / mois</b></div>}
      </div>

      {g.feasibility && g.feasibility !== "ok" && g.cumulative_needed != null && g.capacity != null && (
        <div className="explain">
          Avec les objectifs plus prioritaires, il faudrait mettre <b>{money0(g.cumulative_needed)} / mois</b> de côté,
          pour une capacité réelle de <b>{money0(g.capacity)} / mois</b>. Leviers : reculer l'échéance, réduire un poste,
          ou augmenter la capacité (voir Budget).
        </div>
      )}
      {!g.accounts.length && (
        <div className="explain">Aucun compte affecté : la progression ne compte que le montant de départ ({money0(g.initial)}). Affecte un livret ou une part de compte dans « Modifier ».</div>
      )}

      {g.status === "active" && <Simulator g={g} />}

      <details>
        <summary className="sub" style={{ cursor: "pointer" }}>Détail des postes ({g.items.length})</summary>
        <div className="stack" style={{ marginTop: 10 }}>
          {g.items.map((i) => <div className="line" key={i.id}><span>{i.label}</span><b>{money(i.amount)}</b></div>)}
          {!!g.accounts.length && <div className="sub">Comptes affectés : {g.accounts.map((a) => `${pretty(a.name ?? "")} (${Math.round(a.share * 100)} %)`).join(", ")}</div>}
          {g.notes && <div className="explain">{g.notes}</div>}
        </div>
      </details>
    </div>
  );
}

// « Et si… » : hypothèses recalculées côté serveur avec les mêmes règles que le plan réel
function Simulator({ g }: { g: Goal }) {
  const [open, setOpen] = useState(false);
  const [targetDate, setTargetDate] = useState(g.target_date);
  const [extra, setExtra] = useState(0);
  const [delta, setDelta] = useState(0);
  const [res, setRes] = useState<Goal | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const rows = await api.simulate({ goal_id: g.id, target_date: targetDate, extra_monthly: extra, target_delta: delta });
      setRes(rows.find((x) => x.id === g.id) ?? null);
    }, 250);
    return () => clearTimeout(t);
  }, [open, targetDate, extra, delta, g.id]);

  if (!open) return <div><button onClick={() => setOpen(true)}>Simuler « et si… »</button></div>;
  const [level, label] = res?.feasibility ? FEAS[res.feasibility] : ["good" as Level, "—"];
  return (
    <div className="card" style={{ background: "var(--surface-2)", boxShadow: "none" }}>
      <h2>Simulation <button className="ghost" onClick={() => { setOpen(false); setExtra(0); setDelta(0); setTargetDate(g.target_date); }}>Fermer</button></h2>
      <div className="cols-2">
        <label className="field"><span>Échéance</span>
          <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} /></label>
        <label className="field"><span>Ajuster le budget de l'objectif (€)</span>
          <input type="number" step={1000} value={delta} onChange={(e) => setDelta(Number(e.target.value) || 0)} /></label>
      </div>
      <label className="field" style={{ marginTop: 12 }}>
        <span>Économies supplémentaires : <b>{money0(extra)} / mois</b> (ex. moins d'achats en ligne)</span>
        <input type="range" min={0} max={1000} step={10} value={extra} onChange={(e) => setExtra(Number(e.target.value))} />
      </label>
      {res && (
        <div className="facts" style={{ marginTop: 14 }}>
          <div className="fact"><div className="kpi-label">Effort nécessaire</div>
            <b>{res.monthly_needed != null ? `${money0(res.monthly_needed)} / mois` : "—"}</b>
            <div className="acct-meta">réel : {g.monthly_needed != null ? money0(g.monthly_needed) : "—"}</div></div>
          <div className="fact"><div className="kpi-label">Projection à l'échéance</div>
            <b>{money0(res.projected)}</b><div className="acct-meta">réel : {money0(g.projected)}</div></div>
          <div className="fact"><div className="kpi-label">Capacité simulée</div>
            <b>{res.capacity != null ? `${money0(res.capacity)} / mois` : "—"}</b></div>
          <div className="fact"><div className="kpi-label">Faisabilité</div><Status level={level}>{label}</Status></div>
        </div>
      )}
      <p className="explain">Simulation seulement : rien n'est enregistré. Pour l'adopter, modifie l'objectif.</p>
    </div>
  );
}

function GoalForm({ initial, id, onClose, onSaved }: { initial: GoalIn; id?: number; onClose: () => void; onSaved: () => void }) {
  const [g, setG] = useState<GoalIn>(initial);
  const [err, setErr] = useState<string | null>(null);
  const persons = useFetch(api.persons);
  const accounts = useFetch(api.accounts);
  const set = <K extends keyof GoalIn>(k: K, v: GoalIn[K]) => setG((x) => ({ ...x, [k]: v }));
  const total = g.items.reduce((s, i) => s + (Number(i.amount) || 0), 0);

  const pickKind = (k: string) =>
    setG((x) => ({
      ...x, kind: k,
      // ne remplace les postes que s'ils sont encore vides
      items: x.items.every((i) => !Number(i.amount)) ? KINDS[k].items.map((l) => ({ label: l, amount: 0 })) : x.items,
    }));

  const save = async () => {
    if (!g.name.trim()) return setErr("Donne un nom à l'objectif.");
    if (total <= 0) return setErr("Renseigne au moins un poste avec un montant.");
    try {
      const body = { ...g, items: g.items.filter((i) => i.label.trim()).map((i) => ({ ...i, amount: Number(i.amount) || 0 })) };
      id ? await api.updateGoal(id, body) : await api.createGoal(body);
      onSaved();
    } catch (e) { setErr(String(e)); }
  };
  const remove = async () => {
    if (id && confirm(`Supprimer l'objectif « ${g.name} » ?`)) { await api.deleteGoal(id); onSaved(); }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={id ? "Modifier l'objectif" : "Nouvel objectif"}>
        <div className="line"><h1 style={{ fontSize: 20 }}>{id ? "Modifier l'objectif" : "Nouvel objectif"}</h1>
          <button className="ghost" onClick={onClose} aria-label="Fermer">✕</button></div>

        <label className="field"><span>Nom</span>
          <input value={g.name} placeholder="Achat maison 2028" onChange={(e) => set("name", e.target.value)} autoFocus /></label>

        <div className="field"><span>Type</span>
          <div className="chips">
            {Object.entries(KINDS).map(([k, v]) => (
              <button key={k} type="button" className={"chip " + (g.kind === k ? "on" : "")} onClick={() => pickKind(k)}>{v.label}</button>
            ))}
          </div>
        </div>

        <div className="cols-2">
          <label className="field"><span>Échéance</span>
            <input type="date" value={g.target_date} onChange={(e) => set("target_date", e.target.value)} /></label>
          <label className="field"><span>Pour</span>
            <select value={g.person_id ?? ""} onChange={(e) => set("person_id", e.target.value ? Number(e.target.value) : null)}>
              <option value="">Le foyer</option>
              {persons.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
          <label className="field"><span>Priorité (1 = la plus haute)</span>
            <input type="number" min={1} value={g.priority} onChange={(e) => set("priority", Number(e.target.value) || 1)} /></label>
          <label className="field"><span>Déjà mis de côté ailleurs (€)</span>
            <input type="number" min={0} value={g.initial} onChange={(e) => set("initial", Number(e.target.value) || 0)} /></label>
        </div>

        <div className="field"><span>Postes · total {money0(total)}</span>
          <div className="stack" style={{ gap: 6 }}>
            {g.items.map((it, i) => (
              <div className="item-row" key={i}>
                <input value={it.label} aria-label="Poste" onChange={(e) => set("items", g.items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <input type="number" min={0} value={it.amount || ""} placeholder="€" aria-label="Montant"
                  onChange={(e) => set("items", g.items.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} />
                <button className="ghost" aria-label="Retirer le poste" onClick={() => set("items", g.items.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button type="button" onClick={() => set("items", [...g.items, { label: "", amount: 0 }])}>+ Ajouter un poste</button>
          </div>
        </div>

        <div className="field"><span>Comptes affectés (part du solde qui compte pour cet objectif)</span>
          <div className="stack" style={{ gap: 6 }}>
            {accounts.data?.map((a) => {
              const cur = g.accounts.find((x) => x.account_id === a.id);
              return (
                <div className="item-row" key={a.id} style={{ gridTemplateColumns: "1fr 120px" }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="checkbox" checked={!!cur}
                      onChange={(e) => set("accounts", e.target.checked ? [...g.accounts, { account_id: a.id, share: 1 }] : g.accounts.filter((x) => x.account_id !== a.id))} />
                    {pretty(a.name)} <span className="acct-meta">{money0(a.balance)}</span>
                  </label>
                  {cur && (
                    <select value={cur.share} onChange={(e) => set("accounts", g.accounts.map((x) => (x.account_id === a.id ? { ...x, share: Number(e.target.value) } : x)))}>
                      {[1, 0.75, 0.5, 0.25, 0.1].map((v) => <option key={v} value={v}>{v * 100} %</option>)}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <label className="field"><span>Statut</span>
          <select value={g.status} onChange={(e) => set("status", e.target.value as GoalIn["status"])}>
            <option value="active">Actif</option><option value="paused">En pause</option><option value="done">Atteint</option>
          </select></label>
        <label className="field"><span>Notes (critères, ville, type de bien…)</span>
          <textarea value={g.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></label>

        {err && <div className="err" style={{ padding: 0, textAlign: "left" }}>{err}</div>}
        <div className="line">
          {id ? <button className="ghost" onClick={remove}>Supprimer</button> : <span />}
          <span style={{ display: "flex", gap: 8 }}><button onClick={onClose}>Annuler</button><button className="primary" onClick={save}>Enregistrer</button></span>
        </div>
      </aside>
    </>
  );
}
