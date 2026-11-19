// Composants de base du design system (voir styles.css) : un composant par variante, plus de styles en ligne dans les pages.
import { ButtonHTMLAttributes, CSSProperties, ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "./Icon";
import { moneyParts } from "../format";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* ---- Card : verre liquide ---- */
export function Card({ children, className, title, aside, ...rest }: {
  children: ReactNode; className?: string; title?: ReactNode; aside?: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("card", className)} {...rest}>
      {title != null && <h2>{title}{aside != null && <span className="sub">{aside}</span>}</h2>}
      {children}
    </div>
  );
}

/* ---- Chip / pastille : le sens passe aussi par le libellé, jamais par la couleur seule ---- */
export type Tone = "good" | "warn" | "serious" | "critical" | "neutral";
export function Chip({ tone = "neutral", dot = true, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return <span className={cx("chip", tone !== "neutral" && `tone-${tone}`)}>{dot && <span className="dot-i" aria-hidden />}{children}</span>;
}

/* ---- Button ---- */
export function Button({ variant = "default", size, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost"; size?: "sm" }) {
  return <button type="button" className={cx(variant !== "default" && variant, size, className)} {...p} />;
}

/* ---- Segmented : sélecteur unique (portée, onglets, thème, vue) ---- */
export function Segmented<T extends string | number | null>({ value, onChange, options, label, role = "radio", fill, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[]; label: string;
  role?: "radio" | "tab"; fill?: boolean; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const idx = options.findIndex((o) => o.value === value);
  // onglets plus larges que l'écran : l'onglet actif reste visible
  useEffect(() => { ref.current?.querySelector<HTMLElement>("button.on")?.scrollIntoView({ block: "nearest", inline: "center" }); }, [value]);
  // flèches gauche/droite : déplace la sélection (radiogroup / tablist)
  const key = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const n = (idx + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
    onChange(options[n].value);
    requestAnimationFrame(() => ref.current?.querySelectorAll("button")[n]?.focus());
  };
  return (
    <div ref={ref} className={cx("seg", fill && "fill", className)} role={role === "radio" ? "radiogroup" : "tablist"} aria-label={label} onKeyDown={key}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button key={String(o.value)} type="button" role={role === "radio" ? "radio" : "tab"} {...(role === "radio" ? { "aria-checked": on } : { "aria-selected": on })}
            tabIndex={on || (idx < 0 && i === 0) ? 0 : -1} title={o.title} className={on ? "on" : ""} onClick={() => onChange(o.value)}>{o.label}</button>
        );
      })}
    </div>
  );
}

/* ---- ProgressBar : seule barre de l'app ; `mark` = repère en %, `color` = série ---- */
export function ProgressBar({ value, mark, state, color, thin, label }: {
  value: number; mark?: number | null; state?: "near" | "over"; color?: string; thin?: boolean; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const style = color ? ({ ["--bar-fill" as string]: color } as CSSProperties) : undefined;
  return (
    <div className={cx("progress", state, thin && "thin")} role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100} style={style}>
      <div className="fill" style={{ width: `${v}%` }} />
      {mark != null && <div className="mark" style={{ left: `calc(${Math.max(0, Math.min(100, mark))}% - 1px)` }} />}
    </div>
  );
}

/* ---- BigNumber : grand chiffre central, unité en gris ---- */
export function BigNumber({ value, label, tone, sign, size, children }: {
  value: number | null | undefined; label?: ReactNode; tone?: "good" | "warn"; sign?: boolean; size?: "md"; children?: ReactNode }) {
  const p = moneyParts(value, sign);
  return (
    <div className="bignum">
      {label && <div className="lab">{label}</div>}
      <div className={cx("big", tone, size)}>{p.value}{p.unit && <small>{p.unit}</small>}</div>
      {children}
    </div>
  );
}

/* ---- Stat : tuile chiffrée (hauteurs égales dans .tiles / .kpis) ---- */
export function Stat({ label, value, unit, hint, tone, className }: { label: string; value: string; unit?: string; hint?: ReactNode; tone?: "pos" | "neg" | "warn"; className?: string }) {
  return (
    <Card className={cx("stat", className)}>
      <div className="k">{label}</div>
      <div className={cx("stat-value", tone)}>{value}{unit && <small>{unit}</small>}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </Card>
  );
}

/* ---- ListItem : ligne verre avec pastille d'initiales ---- */
export function ListItem({ icon, title, meta, amount, sub, subTone, to }: {
  icon?: ReactNode; title: ReactNode; meta?: ReactNode; amount?: ReactNode; sub?: ReactNode; subTone?: "good" | "warn"; to?: string }) {
  const inner = (
    <>
      {icon != null && <div className="ic" aria-hidden>{icon}</div>}
      <div className="t"><b>{title}</b>{meta && <span>{meta}</span>}</div>
      {amount != null && <div className="a num">{amount}{sub && <span className={subTone}>{sub}</span>}</div>}
    </>
  );
  return to ? <Link to={to} className="it">{inner}</Link> : <div className="it">{inner}</div>;
}

/* ---- ActionBar : pilule d'actions, bouton central « + » (menu d'actions réelles) ---- */
export function ActionBar({ left, right, menu }: {
  left: { to: string; label: string; icon: string }; right: { to: string; label: string; icon: string };
  menu: { to: string; label: string; icon: string }[];
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", esc); document.addEventListener("mousedown", away);
    box.current?.querySelector<HTMLElement>("a")?.focus();
    return () => { document.removeEventListener("keydown", esc); document.removeEventListener("mousedown", away); };
  }, [open]);
  return (
    <div className="actionbar" ref={box}>
      <Link to={left.to}><Icon name={left.icon} size={17} />{left.label}</Link>
      <button type="button" className="mid" aria-haspopup="menu" aria-expanded={open} aria-label="Plus d'actions" onClick={() => setOpen((o) => !o)}><Icon name="plus" size={22} /></button>
      <Link to={right.to}>{right.label}<Icon name={right.icon} size={16} /></Link>
      {open && (
        <div className="menu" role="menu" onClick={() => setOpen(false)}>
          {menu.map((m) => <Link key={m.to + m.label} role="menuitem" to={m.to}><Icon name={m.icon} size={18} />{m.label}</Link>)}
        </div>
      )}
    </div>
  );
}

/* ---- États : chargement, erreur (avec Réessayer), vide ---- */
export function Skeleton({ lines = 2 }: { lines?: number }) {
  return <div className="card skel-card" aria-hidden>{Array.from({ length: lines + 1 }, (_, i) => <div key={i} className="skeleton" />)}</div>;
}
export function LoadingState({ label = "Chargement…" }: { label?: string }) {
  return <div role="status" aria-live="polite"><span className="sr">{label}</span><Skeleton /><div className="h-12" /><Skeleton lines={3} /></div>;
}
export function ErrorState({ error, onRetry, what = "ces données" }: { error: string; onRetry?: () => void; what?: string }) {
  return (
    <div className="card state error" role="alert">
      <b>Impossible de charger {what}</b>
      <span className="sub">{error}</span>
      {onRetry && <Button variant="primary" onClick={onRetry}>Réessayer</Button>}
    </div>
  );
}
export function EmptyState({ children }: { children: ReactNode }) { return <div className="card state">{children}</div>; }

/* ---- Alternative textuelle d'un graphique ---- */
export function ChartA11y({ label, summary, children }: { label: string; summary?: string; children: ReactNode }) {
  return <div className="chart" role="img" aria-label={summary ? `${label}. ${summary}` : label}>{children}</div>;
}
