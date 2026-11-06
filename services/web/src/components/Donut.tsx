import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { money, money0, PALETTE, pct } from "../format";

export type DonutItem = { name: string; value: number; hint?: string };

export default function Donut({ items: all, center }: { items: DonutItem[]; center?: string }) {
  // lisibilité : au-delà de 7 parts, les plus petites sont regroupées (un anneau à 14 couleurs ne se lit pas)
  const sorted = [...all].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const items: DonutItem[] = sorted.length > 7
    ? [...sorted.slice(0, 6), { name: `Autres (${sorted.length - 6})`, value: sorted.slice(6).reduce((t, i) => t + i.value, 0), hint: sorted.slice(6).map((i) => i.name).join(", ") }]
    : sorted;
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!items.length || total <= 0) return <div className="empty">Aucun solde à répartir.</div>;
  // une seule part : un camembert n'apporte rien, le chiffre suffit
  if (items.length === 1)
    return (
      <div className="stack">
        <div className="big">{money0(total)}</div>
        <div className="sub">100 % sur {items[0].name}{items[0].hint ? ` · ${items[0].hint}` : ""}. La répartition apparaîtra dès le 2e compte connecté.</div>
      </div>
    );
  return (
    <div className="donut">
      <div className="donut-chart">
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={items} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="95%"
              paddingAngle={items.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
              {items.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip formatter={(v) => money(Number(v))}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center"><span>{center ?? "Total"}</span><b>{money0(total)}</b></div>
      </div>
      <ul className="legend">
        {items.map((it, i) => (
          <li key={it.name}>
            <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="legend-name">{it.name}{it.hint && <small>{it.hint}</small>}</span>
            <span className="legend-val">{money0(it.value)}<small>{pct((it.value / total) * 100)}</small></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
