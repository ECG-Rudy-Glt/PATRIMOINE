import { Fragment, ReactNode } from "react";

// Rendu Markdown minimal (titres, listes, tableaux, gras, italique, code) : tout passe par des nœuds React, aucun HTML brut.
function inline(t: string): ReactNode[] {
  return t.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g).map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2) return <code key={i}>{p.slice(1, -1)}</code>;
    if (p.startsWith("*") && p.endsWith("*") && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: ReactNode[] = [];
  let i = 0, k = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const n = h[1].length;
      const Tag = (`h${Math.min(n + 1, 5)}`) as "h2" | "h3" | "h4" | "h5";
      out.push(<Tag key={k++} style={{ margin: n === 1 ? "0 0 8px" : "18px 0 6px" }}>{inline(h[2])}</Tag>);
      i++; continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { out.push(<div key={k++} className="divider" />); i++; continue; }
    if (l.includes("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = cells(l); i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) { rows.push(cells(lines[i])); i++; }
      out.push(
        <div className="table-wrap" key={k++}>
          <table>
            <thead><tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
            <tbody>{rows.map((r, a) => <tr key={a}>{head.map((_, j) => <td key={j}>{inline(r[j] ?? "")}</td>)}</tr>)}</tbody>
          </table>
        </div>);
      continue;
    }
    if (/^\s*([-*]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d+[.)]\s+/.test(l);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i]) && /^\s*\d+[.)]\s+/.test(lines[i]) === ordered) { items.push(lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, "")); i++; }
      const L = ordered ? "ol" : "ul";
      out.push(<L key={k++} style={{ margin: "4px 0 8px", paddingLeft: 22 }}>{items.map((x, j) => <li key={j}>{inline(x)}</li>)}</L>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*([-*]|\d+[.)])\s+)/.test(lines[i]) && !(lines[i].includes("|") && i + 1 < lines.length && isSep(lines[i + 1]))) { para.push(lines[i]); i++; }
    out.push(<p key={k++} style={{ margin: "6px 0" }}>{inline(para.join(" "))}</p>);
  }
  return <div className="markdown">{out}</div>;
}
