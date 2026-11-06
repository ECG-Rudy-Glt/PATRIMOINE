import { Layer, Rectangle, ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { Flows } from "../api";
import { money, pretty } from "../format";

const GROUP_COLOR: Record<string, string> = {
  income: "var(--series-3)", internal: "var(--muted)", account: "var(--series-1)", household: "var(--series-7)",
  fixed: "var(--series-4)", variable: "var(--series-2)", savings: "var(--series-6)", draw: "var(--series-8)",
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
  const text = { fontSize: 13, fontWeight: 500, fill: "var(--text)", stroke: "var(--surface)", strokeWidth: 4, paintOrder: "stroke", strokeLinejoin: "round" } as const;
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={Math.max(height, 2)} fill={color} radius={2} />
      {middle ? (
        <text x={x + width / 2} y={y - 8} textAnchor="middle" {...text}>
          {label}
          <tspan fill="var(--muted)" fontWeight={400} dx={6}>{money(payload.value)}</tspan>
        </text>
      ) : (
        <text x={right ? x - 8 : x + width + 8} y={y + height / 2} textAnchor={right ? "end" : "start"} dominantBaseline="middle" {...text}>
          {label}
          <tspan fill="var(--muted)" fontWeight={400} dx={6}>{money(payload.value)}</tspan>
        </text>
      )}
    </Layer>
  );
}

export default function FlowMap({ flows }: { flows: Flows }) {
  if (!flows.links.length) return <div className="empty">Pas encore assez de données pour tracer les flux.</div>;
  const height = Math.max(360, flows.nodes.length * 46);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Sankey data={flows} nodePadding={28} nodeWidth={12} margin={{ top: 10, bottom: 10, left: 6, right: 6 }}
        node={<Node />} link={{ stroke: "var(--series-1)", strokeOpacity: 0.28 }} iterations={64}>
        <Tooltip formatter={(v) => money(Number(v))}
          contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }} />
      </Sankey>
    </ResponsiveContainer>
  );
}
