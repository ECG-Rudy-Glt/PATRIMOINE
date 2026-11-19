import { ReactNode, useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import Icon from "./Icon";
import { Segmented } from "./ui";
import { Theme } from "../theme";

export type NavItem = { to: string; label: string; icon: string };
export type Scope = { id: number | null; name: string; hint: string };

export function ScopeSwitcher({ scopes, value, onChange }: { scopes: Scope[]; value: number | null; onChange: (id: number | null) => void }) {
  return (
    <Segmented label="Périmètre d'analyse" value={value} onChange={onChange}
      options={scopes.map((s) => ({ value: s.id, label: s.name, title: s.hint }))} />
  );
}

const THEMES: { value: Theme; label: string }[] = [{ value: "auto", label: "Auto" }, { value: "light", label: "Perle" }, { value: "dark", label: "Nuit" }];
export function ThemeSwitcher({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  return <Segmented fill label="Thème" value={theme} onChange={onChange} options={THEMES} />;
}

const NEXT: Record<Theme, Theme> = { light: "dark", dark: "auto", auto: "light" };
const T_LABEL: Record<Theme, string> = { light: "Perle", dark: "Nuit", auto: "Auto" };
const T_ICON: Record<Theme, string> = { light: "sun", dark: "moon", auto: "auto" };
// Bouton de la barre du haut : un tap change de thème (Perle, Nuit, Auto) ; l'état courant est écrit et dessiné
export function ThemeButton({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  return (
    <button type="button" className="theme-btn" onClick={() => onChange(NEXT[theme])}
      aria-label={`Thème : ${T_LABEL[theme]}. Changer pour ${T_LABEL[NEXT[theme]]}`} title={`Thème : ${T_LABEL[theme]} (toucher pour changer)`}>
      <Icon name={T_ICON[theme]} size={20} /><span className="theme-btn-label">{T_LABEL[theme]}</span>
    </button>
  );
}

const Unread = ({ n }: { n?: number }) => (n ? <span className="count" aria-label={`${n} alerte(s) non lue(s)`}>{n}</span> : null);

export function Sidebar({ items, unread, haUrl, theme, onTheme }: { items: NavItem[]; unread?: number; haUrl?: string | null; theme: Theme; onTheme: (t: Theme) => void }) {
  const link = ({ isActive }: { isActive: boolean }) => "nav-link" + (isActive ? " active" : "");
  return (
    <aside className="sidebar">
      <div className="sidebar-card">
        <div className="brand"><img className="brand-logo" src="/icons/icon.svg?v=2" alt="" width="28" height="28" />Patrimoine</div>
        <nav className="nav" aria-label="Navigation principale">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} className={link}>
              <Icon name={n.icon} /><span>{n.label}</span>{n.to === "/alertes" && <Unread n={unread} />}
            </NavLink>
          ))}
          {haUrl && (
            <a className="nav-link" href={haUrl} target="_blank" rel="noopener noreferrer" title="Ouvrir le tableau de bord Patrimoine dans Home Assistant">
              <Icon name="ha" /><span>Home Assistant</span>
            </a>
          )}
        </nav>
        <div className="sidebar-foot">
          <ThemeSwitcher theme={theme} onChange={onTheme} />
          <p className="m-0">Outil personnel — aucune opération n'est exécutée automatiquement.</p>
        </div>
      </div>
    </aside>
  );
}

export function BottomNav({ tabs, moreOpen, onMore, unread }: { tabs: NavItem[]; moreOpen: boolean; onMore: () => void; unread?: number }) {
  return (
    <nav className="tabbar" aria-label="Navigation principale">
      {tabs.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => "tab" + (isActive ? " active" : "")}>
          <Icon name={n.icon} size={20} /><span>{n.label}</span>
        </NavLink>
      ))}
      <button type="button" className={"tab" + (moreOpen ? " active" : "")} aria-haspopup="dialog" aria-expanded={moreOpen} onClick={onMore}>
        <Icon name="more" size={20} /><span>Plus</span><Unread n={unread} />
      </button>
    </nav>
  );
}

// Feuille « Plus » : focus piégé, Échap et clic sur le fond ferment, le focus revient sur le bouton d'origine
export function MoreSheet({ items, unread, haUrl, theme, onTheme, onClose, children }: {
  items: NavItem[]; unread?: number; haUrl?: string | null; theme: Theme; onTheme: (t: Theme) => void; onClose: () => void; children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
    focusables()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab") return;
      const f = focusables(); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = ""; prev?.focus?.(); };
  }, [onClose]);
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" ref={ref} role="dialog" aria-modal="true" aria-label="Autres pages">
        <div className="sheet-head"><b>Plus</b><button type="button" className="ghost icon" aria-label="Fermer" onClick={onClose}><Icon name="plus" size={20} /></button></div>
        <div className="sheet-grid">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => "sheet-item" + (isActive ? " active" : "")}>
              <Icon name={n.icon} size={22} /><span>{n.label}</span>{n.to === "/alertes" && <Unread n={unread} />}
            </NavLink>
          ))}
          {haUrl && <a className="sheet-item" href={haUrl} target="_blank" rel="noopener noreferrer"><Icon name="ha" size={22} /><span>Home Assistant</span></a>}
        </div>
        <ThemeSwitcher theme={theme} onChange={onTheme} />
        {children}
      </div>
    </>
  );
}
