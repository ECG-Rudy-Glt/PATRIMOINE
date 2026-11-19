import { Layer, Rectangle, ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { Flows } from "../api";
import { money0, pretty } from "../format";
import { useNarrow } from "../useNarrow";
import { ChartA11y, ProgressBar } from "./ui";

const GROUP_COLOR: Record<string, string> = {
  income: "var(--series-3)", internal: "var(--muted)", account: "var(--series-1)", household: "var(--series-7)",
  fixed: "var(--series-4)", variable: "var(--series-2)", savings: "var(--series-6)", draw: "var(--series-5)",
};

// Nœud personnalisé : barre colorée + libellé + montant, libellé à gauche pour la colonne de droite
function Node(props: any) {
  const { x, y, width, height, payload } = props;
  // recharts : sourceLinks = liens entrants. Colonne de droite (destinations) = entrants sans sortants -> libellé à gauche
  const right = !!payload.sourceLinks?.length && !payload.targetLinks?.length;
  const middle = !!payload.sourceLinks?.length && !!payload.targetLinks?.length;   // comptes : libellé au-dessus de la barre
  const color = GROUP_COLOR[payload.group] ?? "var(--muted)";
  const raw = payload.group === "account" ? pretty(payload.name) : payload.name;
  const max = middle ? 24 : 30;
  const label = raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
  const text = { fontSize: 13, fontWeight: 500, fill: "var(--ink)", stroke: "var(--bg-base)", strokeWidth: 4, paintOrder: "stroke", strokeLinejoin: "round" } as const;
  const amount = <tspan fill="var(--muted)" fontWeight={400} dx={6}>{money0(payload.value)}</tspan>;
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={Math.max(height, 2)} fill={color} radius={2} />
      {middle ? (
        <text x={x + width / 2} y={y - 8} textAnchor="middle" {...text}>{label}{amount}</text>
      ) : (
        <text x={right ? x - 8 : x + width + 8} y={y + height / 2} textAnchor={right ? "end" : "start"} dominantBaseline="middle" {...text}>{label}{amount}</text>
      )}
    </Layer>
  );
}

type Col = { title: string; rows: { name: string; value: number; group: string }[] };
// Lecture en colonnes : d'où vient l'argent, par quels comptes il passe, où il part
function columns(flows: Flows): Col[] {
  const inn = new Map<number, number>(), out = new Map<number, number>();
  flows.links.forEach((l) => { out.set(l.source, (out.get(l.source) ?? 0) + l.value); inn.set(l.target, (inn.get(l.target) ?? 0) + l.value); });
  const pick = (f: (i: number) => boolean, val: (i: number) => number) =>
    flows.nodes.map((n, i) => ({ name: n.group === "account" ? pretty(n.name) : n.name, value: val(i), group: n.group, i })).filter((r) => f(r.i)).sort((a, b) => b.value - a.value);
  return [
    { title: "D'où vient l'argent", rows: pick((i) => !inn.has(i) && out.has(i), (i) => out.get(i) ?? 0) },
    { title: "Comptes traversés", rows: pick((i) => inn.has(i) && out.has(i), (i) => inn.get(i) ?? 0) },
    { title: "Où il part", rows: pick((i) => inn.has(i) && !out.has(i), (i) => inn.get(i) ?? 0) },
  ].filter((c) => c.rows.length);
}

function FlowList({ flows }: { flows: Flows }) {
  return (
    <div className="flow-list">
      {columns(flows).map((c) => {
        const max = Math.max(...c.rows.map((r) => r.value), 1);
        return (
          <section key={c.title} className="flow-col" aria-label={c.title}>
            <div className="k">{c.title}</div>
            {c.rows.map((r) => (
              <div className="flow-row" key={r.name + r.group}>
                <div className="line"><span>{r.name}</span><b className="num">{money0(r.value)}</b></div>
                <ProgressBar thin value={(r.value / max) * 100} color={GROUP_COLOR[r.group] ?? "var(--muted)"} label={`${r.name} ${money0(r.value)}`} />
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

export default function FlowMap({ flows }: { flows: Flows }) {
  const narrow = useNarrow("(max-width: 760px)");
  if (!flows.links.length) return <div className="empty">Pas encore assez de données pour tracer les flux.</div>;
  const cols = columns(flows);
  const summary = cols.map((c) => `${c.title} : ${c.rows.map((r) => `${r.name} ${money0(r.value)}`).join(", ")}`).join(". ");
  // mobile : le diagramme n'est pas lisible en 390 px, on affiche la même information en colonnes
  if (narrow) return <FlowList flows={flows} />;
  const height = Math.max(360, flows.nodes.length * 46);
  return (
    <>
      <ChartA11y label="Diagramme des flux mensuels moyens" summary={summary}>
        <ResponsiveContainer width="100%" height={height}>
          <Sankey data={flows} nodePadding={28} nodeWidth={12} margin={{ top: 30, bottom: 10, left: 6, right: 6 }}
            node={<Node />} link={{ stroke: "var(--series-1)", strokeOpacity: 0.25 }} iterations={64}>
            <Tooltip formatter={(v) => money0(Number(v))}
              contentStyle={{ background: "var(--glass-solid)", border: "1px solid var(--glass-border)", borderRadius: 12 }} />
          </Sankey>
        </ResponsiveContainer>
      </ChartA11y>
      <details className="mt-8"><summary className="sub">Voir le détail en liste</summary><div className="mt-12"><FlowList flows={flows} /></div></details>
    </>
  );
}
