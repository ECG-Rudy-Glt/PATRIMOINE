import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useFetch } from "../useFetch";
import TxTable from "../components/TxTable";
import { usePerson } from "../person";

const PAGE = 50;

export default function Transactions() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const account_id = params.get("account_id") ?? "";
  const direction = params.get("direction") ?? "";
  const category = params.get("category") ?? "";
  const [reload, setReload] = useState(0);
  const page = Number(params.get("page") ?? 0);

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    v ? p.set(k, v) : p.delete(k);
    if (k !== "page") p.delete("page");
    setParams(p, { replace: true });
  };

  // recherche avec anti-rebond
  useEffect(() => {
    const t = setTimeout(() => q !== (params.get("q") ?? "") && set("q", q), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const { person } = usePerson();
  const accounts = useFetch(api.accounts);
  const categories = useFetch(api.categories);
  const tx = useFetch(
    () => api.transactions({ q: params.get("q") ?? "", account_id, direction, category, person: person ?? undefined,
                             limit: PAGE, offset: page * PAGE }),
    [params.toString(), person, reload],
  );
  const total = tx.data?.total ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Transactions</h1>
          <div className="sub">{tx.data ? `${total} opération(s)` : "Chargement…"}</div>
        </div>
      </div>
      <div className="card">
        <div className="toolbar">
          <input type="search" placeholder="Rechercher un libellé (ex. CB CARREFOUR)" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={account_id} onChange={(e) => set("account_id", e.target.value)}>
            <option value="">Tous les comptes</option>
            {accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={category} onChange={(e) => set("category", e.target.value)}>
            <option value="">Toutes catégories</option>
            {categories.data?.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
          <div className="seg">
            {[["", "Tout"], ["in", "Entrées"], ["out", "Sorties"]].map(([v, l]) => (
              <button key={v} className={direction === v ? "on" : ""} onClick={() => set("direction", v)}>{l}</button>
            ))}
          </div>
        </div>
        {tx.error ? <div className="err">{tx.error}</div> : tx.data ? <TxTable items={tx.data.items} categories={categories.data ?? undefined}
          onChanged={() => setReload((n) => n + 1)} /> : <div className="skeleton" />}
        {total > PAGE && (
          <div className="pager">
            <span>{page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} sur {total}</span>
            <span style={{ display: "flex", gap: 8 }}>
              <button disabled={page === 0} onClick={() => set("page", String(page - 1))}>← Précédent</button>
              <button disabled={(page + 1) * PAGE >= total} onClick={() => set("page", String(page + 1))}>Suivant →</button>
            </span>
          </div>
        )}
      </div>
    </>
  );
}
