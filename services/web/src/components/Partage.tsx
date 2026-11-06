import { useState } from "react";
import { api } from "../api";
import { useFetch } from "../useFetch";
import { date, money, signed } from "../format";

// « Qui doit quoi à qui » : le solde vient d'opérations classées par vous (dépense du foyer, remboursement) et de l'écart
// de versements au compte commun. Les suggestions (voyages, virements directs) attendent votre confirmation.
export default function Partage() {
  const [tick, setTick] = useState(0);
  const st = useFetch(api.settlement, [tick]);
  const sh = useFetch(api.shared, [tick]);
  const [busy, setBusy] = useState<number | null>(null);
  const act = async (tx: number, kind: string | null) => {
    setBusy(tx);
    try { kind ? await api.setShared(tx, kind) : await api.unsetShared(tx); setTick((t) => t + 1); } finally { setBusy(null); }
  };
  const s = st.data;
  const cands = sh.data?.candidates ?? [];
  return (
    <div className="card">
      <h2>Qui doit quoi à qui <span className="sub">dépenses partagées et compte commun</span></h2>
      {s ? (
        <>
          <div className="big" style={{ fontSize: 24, marginBottom: 6 }}>{s.phrase}</div>
          {s.lignes.map((l, i) => (
            <div className="avoid-row" key={i}>
              <div className="avoid-main">
                <b>{l.type}</b>
                <span className="acct-meta">{l.date ? `${date(l.date)} · ` : ""}{l.libelle}</span>
              </div>
              <div className="avoid-num"><b className={l.effet >= 0 ? "pos" : "neg"}>{signed(l.effet)}</b><span className="acct-meta">{money(l.montant)}</span></div>
            </div>
          ))}
          <div className="acct-meta" style={{ marginTop: 6 }}>Un solde positif signifie que {s.b} doit à {s.a} ; négatif, l'inverse. {s.note}</div>
        </>
      ) : <div className="skeleton" style={{ width: "50%" }} />}
      {!!cands.length && (
        <>
          <div className="section-title">À confirmer ({cands.length})</div>
          <div className="acct-meta" style={{ marginBottom: 6 }}>
            Opérations qui ressemblent à une dépense partagée (voyage, billetterie) ou à un remboursement entre vous. Rien n'est compté tant que vous n'avez pas confirmé.
          </div>
          {cands.map((c) => (
            <div className="avoid-row" key={c.tx_id}>
              <div className="avoid-main">
                <b>{c.label}</b>
                <span className="acct-meta">{date(c.booked_on)} · {c.account}{c.payer ? ` (payé par ${c.payer})` : ""}</span>
                <span className="chips">
                  {c.suggested === "depense"
                    ? <button className="chip on" disabled={busy === c.tx_id} onClick={() => act(c.tx_id, "depense")}>Dépense du foyer (50/50)</button>
                    : <button className="chip on" disabled={busy === c.tx_id} onClick={() => act(c.tx_id, "remboursement")}>C'est un remboursement</button>}
                  <button className="chip" disabled={busy === c.tx_id} onClick={() => act(c.tx_id, "ignore")}>Ce n'est pas partagé</button>
                </span>
              </div>
              <div className="avoid-num"><b className={c.amount < 0 ? "neg" : "pos"}>{signed(c.amount)}</b></div>
            </div>
          ))}
        </>
      )}
      {!!(sh.data?.items ?? []).length && (
        <>
          <div className="section-title">Déjà classées</div>
          {(sh.data?.items ?? []).map((c) => (
            <div className="line" key={c.tx_id} style={{ padding: "6px 0", borderTop: "1px solid var(--border)" }}>
              <span>{date(c.booked_on)} · {c.label} <span className="acct-meta">· {c.kind === "depense" ? "dépense du foyer" : "remboursement"}</span></span>
              <button className="ghost" disabled={busy === c.tx_id} onClick={() => act(c.tx_id, null)}>Retirer</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
