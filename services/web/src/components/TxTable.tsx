import { useState } from "react";
import { api, Category, Tx } from "../api";
import { date, merchantName, pretty, signed } from "../format";
import { useNarrow } from "../useNarrow";

type Props = { items: Tx[]; showAccount?: boolean; categories?: Category[]; onChanged?: () => void; compact?: boolean };

export default function TxTable({ items, showAccount: showAccountProp = true, categories, onChanged, compact: compactProp }: Props) {
  // sur mobile : date, libellé, montant seulement
  const narrow = useNarrow();
  const compact = compactProp || narrow;
  const showAccount = showAccountProp && !narrow;
  // choix en attente : appliquer à cette opération seulement ou à tout le marchand
  const [pending, setPending] = useState<{ id: number; category: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!items.length) return <div className="empty">Aucune transaction.</div>;

  const apply = async (remember: boolean) => {
    if (!pending) return;
    setBusy(true);
    try {
      await api.setCategory(pending.id, pending.category, remember);
      setPending(null);
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="table-wrap">
    <table className={"tx" + (compact ? " compact" : "")}>
      <colgroup>
        <col className="c-date" /><col />
        {!compact && <col className="c-cat" />}
        {showAccount && <col className="c-acct" />}
        <col className="c-amt" />
      </colgroup>
      <thead>
        <tr>
          <th>Date</th><th>Libellé</th>
          {!compact && <th>Catégorie</th>}
          {showAccount && <th>Compte</th>}
          <th className="num">Montant</th>
        </tr>
      </thead>
      <tbody>
        {items.map((t) => (
          <tr key={t.id}>
            <td>{date(t.booked_on)}</td>
            <td className="label-cell" title={t.label ?? ""}>
              <span className="merchant">{merchantName(t)}</span>
              {!compact && <span className="raw">{t.label}</span>}
            </td>
            {!compact && <td>
              {categories ? (
                pending?.id === t.id ? (
                  <span className="apply">
                    <button disabled={busy} onClick={() => apply(false)}>Cette opération</button>
                    <button disabled={busy} className="primary" onClick={() => apply(true)}>Tout ce marchand</button>
                    <button disabled={busy} className="ghost" onClick={() => setPending(null)} aria-label="Annuler">✕</button>
                  </span>
                ) : (
                  <select className="cat" value={t.category ?? ""}
                    onChange={(e) => setPending({ id: t.id, category: e.target.value })}
                    title={t.category_source === "manual" ? "Catégorie choisie manuellement" : "Catégorie attribuée par règle"}>
                    {categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </select>
                )
              ) : (
                <span className="badge">{t.category_label ?? "—"}</span>
              )}
              {t.category_source === "manual" && pending?.id !== t.id && <span className="manual" title="Manuelle">●</span>}
            </td>}
            {showAccount && <td className="acct-meta">{pretty(t.account)}</td>}
            <td className={"num " + (t.amount < 0 ? "ink" : "credit")}>{signed(t.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
