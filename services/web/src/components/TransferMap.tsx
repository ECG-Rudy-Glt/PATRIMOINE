import { useMemo, useState } from "react";
import { Transfers, TransferNode } from "../api";
import { money, money0, pretty, shortDate } from "../format";

const W = 900;
const ACC = { w: 176, h: 44 };
const EXT = { w: 138, h: 28 };

type P = { x: number; y: number };
const size = (n: TransferNode) => (n.kind === "account" ? ACC : EXT);

// Comptes suivis sur une ellipse intérieure ; contreparties non suivies sur l'ellipse extérieure, dans la direction
// des comptes auxquels elles sont liées, avec un écart angulaire minimal pour éviter les chevauchements.
function layout(nodes: TransferNode[], edges: Transfers["edges"]) {
  const acc = nodes.filter((n) => n.kind === "account");
  const ext = nodes.filter((n) => n.kind === "external");
  const H = Math.max(400, 330 + ext.length * 12);
  const cx = W / 2, cy = H / 2;
  const pos = new Map<string, P>();
  acc.forEach((n, i) => {
    if (acc.length === 1) return pos.set(n.key, { x: cx, y: cy });
    const a = -Math.PI / 2 + (2 * Math.PI * i) / acc.length;
    pos.set(n.key, { x: cx + W * 0.2 * Math.cos(a), y: cy + H * 0.17 * Math.sin(a) });
  });
  const angle = new Map<string, number>();
  ext.forEach((n, i) => {
    let vx = 0, vy = 0;
    for (const e of edges) {
      const other = e.source === n.key ? e.target : e.target === n.key ? e.source : null;
      const p = other && pos.get(other);
      if (!p) continue;
      const len = Math.hypot(p.x - cx, p.y - cy) || 1;
      vx += ((p.x - cx) / len) * e.monthly;
      vy += ((p.y - cy) / len) * e.monthly;
    }
    angle.set(n.key, Math.hypot(vx, vy) > 1 ? Math.atan2(vy, vx) : -Math.PI / 2 + (2 * Math.PI * i) / Math.max(ext.length, 1));
  });
  const sorted = [...ext].sort((a, b) => angle.get(a.key)! - angle.get(b.key)!);
  const gap = Math.min((32 * Math.PI) / 180, (2 * Math.PI) / Math.max(sorted.length, 1));
  sorted.forEach((n, i) => {
    if (i > 0) angle.set(n.key, Math.max(angle.get(n.key)!, angle.get(sorted[i - 1].key)! + gap));
  });
  sorted.forEach((n) => {
    const a = angle.get(n.key)!;
    pos.set(n.key, { x: cx + W * 0.43 * Math.cos(a), y: cy + (H / 2 - 36) * Math.sin(a) });
  });
  return { pos, H };
}

// Point du bord du rectangle de `n` (centré en `c`) dans la direction de `to`, reculé de `pad`
function edgePoint(n: TransferNode, c: P, to: P, pad: number): P {
  const { w, h } = size(n);
  const dx = to.x - c.x, dy = to.y - c.y;
  const t = Math.min(dx ? w / 2 / Math.abs(dx) : Infinity, dy ? h / 2 / Math.abs(dy) : Infinity);
  const len = Math.hypot(dx, dy) || 1;
  return { x: c.x + dx * t + (dx / len) * pad, y: c.y + dy * t + (dy / len) * pad };
}

const COLORS = { transfer: "var(--series-1)", in: "var(--series-3)", out: "var(--series-4)" };

export default function TransferMap({ data }: { data: Transfers }) {
  const [hover, setHover] = useState<string | null>(null);
  const { nodes, edges } = data;
  const { pos, H } = useMemo(() => layout(nodes, edges), [nodes, edges]);
  const byKey = useMemo(() => new Map(nodes.map((n) => [n.key, n])), [nodes]);
  if (!edges.length) return <div className="empty">Aucun virement entre comptes sur la période couverte par les données.</div>;

  const max = Math.max(...edges.map((e) => e.monthly), 1);
  const has = new Set(edges.map((e) => `${e.source}>${e.target}`));
  const label = (n: TransferNode) => (n.kind === "account" ? pretty(n.name) : `${pretty(n.name)}`);
  const kindOf = (e: Transfers["edges"][number]) =>
    byKey.get(e.source)!.kind === "account" && byKey.get(e.target)!.kind === "account" ? "transfer"
      : byKey.get(e.source)!.kind === "external" ? "in" : "out";

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
        aria-label="Carte des virements entre comptes : comptes suivis au centre, contreparties non suivies autour"
        style={{ maxHeight: 620 }}>
        <defs>
          {Object.entries(COLORS).map(([k, c]) => (
            <marker key={k} id={`arrow-${k}`} viewBox="0 0 11 11" refX="9" refY="5.5" markerWidth="11" markerHeight="11"
              markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0,0 L11,5.5 L0,11 z" fill={c} />
            </marker>
          ))}
        </defs>

        {edges.map((e) => {
          const a = byKey.get(e.source)!, b = byKey.get(e.target)!;
          const pa = pos.get(e.source)!, pb = pos.get(e.target)!;
          const p1 = edgePoint(a, pa, pb, 3), p2 = edgePoint(b, pb, pa, 4);
          const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
          const off = has.has(`${e.target}>${e.source}`) ? 26 : 12;
          const c = { x: (p1.x + p2.x) / 2 + (-(pb.y - pa.y) / len) * off, y: (p1.y + p2.y) / 2 + ((pb.x - pa.x) / len) * off };
          const mid = { x: 0.25 * p1.x + 0.5 * c.x + 0.25 * p2.x, y: 0.25 * p1.y + 0.5 * c.y + 0.25 * p2.y };
          const k = kindOf(e);
          const dim = hover && hover !== e.source && hover !== e.target;
          return (
            <g key={`${e.source}>${e.target}`} opacity={dim ? 0.12 : 1}>
              <title>{`${label(a)} → ${label(b)} : ${money(e.monthly)} par mois, ${e.count} opération(s), dernière le ${shortDate(e.last)}`}</title>
              <path d={`M${p1.x},${p1.y} Q${c.x},${c.y} ${p2.x},${p2.y}`} fill="none" stroke={COLORS[k]}
                strokeWidth={1.2 + 5.5 * Math.sqrt(e.monthly / max)} strokeOpacity={0.75}
                strokeDasharray={k === "transfer" ? undefined : "5 4"} markerEnd={`url(#arrow-${k})`} />
              {/* halo dessiné à part : paint-order n'est pas géré partout */}
              <text x={mid.x} y={mid.y} textAnchor="middle" dominantBaseline="middle" fontSize={11.5}
                fill="var(--surface)" stroke="var(--surface)" strokeWidth={4} strokeLinejoin="round">{money0(e.monthly)}</text>
              <text x={mid.x} y={mid.y} textAnchor="middle" dominantBaseline="middle" fontSize={11.5} fontWeight={600}
                fill="var(--text)">{money0(e.monthly)}</text>
            </g>
          );
        })}

        {nodes.map((n) => {
          const p = pos.get(n.key);
          if (!p) return null;
          const { w, h } = size(n);
          const acct = n.kind === "account";
          const linked = !hover || hover === n.key || edges.some((e) => (e.source === hover && e.target === n.key) || (e.target === hover && e.source === n.key));
          return (
            <g key={n.key} opacity={linked ? 1 : 0.25} onMouseEnter={() => setHover(n.key)} onMouseLeave={() => setHover(null)}
              style={{ cursor: "default" }}>
              <title>{n.kind === "account" ? `${pretty(n.name)}${n.institution ? ` · ${n.institution}` : ""}` : `${pretty(n.name)} (compte non suivi, identifié par le libellé des virements)`}</title>
              <rect x={p.x - w / 2} y={p.y - h / 2} width={w} height={h} rx={9}
                fill={acct ? "var(--accent-soft)" : "var(--surface)"} stroke={acct ? "var(--accent)" : "var(--muted)"}
                strokeWidth={acct ? 1.5 : 1} strokeDasharray={acct ? undefined : "4 3"} />
              <text x={p.x} y={acct ? p.y - 5 : p.y} textAnchor="middle" dominantBaseline="middle" fontSize={acct ? 11.5 : 11}
                fontWeight={acct ? 600 : 400} fill="var(--text)">{clip(label(n), acct ? 22 : 20)}</text>
              {acct && <text x={p.x} y={p.y + 10} textAnchor="middle" dominantBaseline="middle" fontSize={10.5} fill="var(--muted)">
                {n.institution ? clip(n.institution, 24) : ""}</text>}
            </g>
          );
        })}
      </svg>

      <div className="chips" style={{ marginTop: 8 }}>
        <span className="chip"><span style={{ color: COLORS.transfer }}>━</span> entre comptes suivis</span>
        <span className="chip"><span style={{ color: COLORS.in }}>╍</span> reçu d'un compte non suivi</span>
        <span className="chip"><span style={{ color: COLORS.out }}>╍</span> envoyé vers un compte non suivi</span>
      </div>

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th>De</th><th>Vers</th><th style={{ textAlign: "right" }}>Par mois</th><th style={{ textAlign: "right" }}>Opérations</th><th>Dernier</th></tr></thead>
          <tbody>
            {edges.map((e) => {
              const a = byKey.get(e.source)!, b = byKey.get(e.target)!;
              const tag = (n: TransferNode) => (n.kind === "external" ? <span className="acct-meta"> · non suivi</span> : null);
              return (
                <tr key={`${e.source}>${e.target}`}>
                  <td>{label(a)}{tag(a)}</td><td>{label(b)}{tag(b)}</td>
                  <td style={{ textAlign: "right" }}><b>{money(e.monthly)}</b></td>
                  <td style={{ textAlign: "right" }}>{e.count}</td><td>{shortDate(e.last)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
