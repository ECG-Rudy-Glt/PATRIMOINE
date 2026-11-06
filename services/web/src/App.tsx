import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Accounts from "./pages/Accounts";
import Transactions from "./pages/Transactions";
import Budget from "./pages/Budget";
import Alerts from "./pages/Alerts";
import Goals from "./pages/Goals";
import Advice from "./pages/Advice";
import Invest from "./pages/Invest";
import Export from "./pages/Export";
import Fiscal from "./pages/Fiscal";
import Banks from "./pages/Banks";
import Icon from "./components/Icon";
import { api } from "./api";
import { usePerson } from "./person";
import { useFetch } from "./useFetch";
import { useEffect, useState } from "react";
import { applyTheme, savedTheme, Theme } from "./theme";

const NAV = [
  { to: "/", label: "Accueil", icon: "home" },
  { to: "/comptes", label: "Comptes & flux", icon: "accounts" },
  { to: "/transactions", label: "Transactions", icon: "tx" },
  { to: "/budget", label: "Budget", icon: "budget" },
  { to: "/objectifs", label: "Objectifs", icon: "goal" },
  { to: "/placements", label: "Placements", icon: "alloc" },
  { to: "/fiscalite", label: "Fiscalité", icon: "tax" },
  { to: "/conseils", label: "Conseils", icon: "reco" },
  { to: "/export", label: "Export", icon: "export" },
  { to: "/banques", label: "Banques", icon: "bank" },
];

// Barre d'onglets du bas (mobile) : les 4 pages du quotidien + « Plus » qui ouvre le reste dans une feuille
const TABS = ["/", "/comptes", "/budget", "/conseils"];

export default function App() {
  const { person, setPerson } = usePerson();
  const [more, setMore] = useState(false);
  const loc = useLocation();
  useEffect(() => setMore(false), [loc.pathname]);
  const persons = useFetch(api.persons);
  const events = useFetch(api.alertEvents);
  const ha = useFetch(api.haIntegration);
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const pickTheme = (t: Theme) => { setTheme(t); applyTheme(t); };
  const link = ({ isActive }: { isActive: boolean }) => "nav-link" + (isActive ? " active" : "");
  // Foyer = le compte commun seul ; Alex et Sam = leurs comptes personnels, séparés ; Tous = vue d'ensemble
  const scopes = [
    { id: -1 as number | null, name: "Foyer", hint: "Le compte commun" },
    ...(persons.data ?? []).map((p) => ({ id: p.id as number | null, name: p.name, hint: `Comptes personnels de ${p.name}` })),
    { id: null as number | null, name: "Tous", hint: "Tous les comptes ensemble (virements entre comptes neutralisés)" },
  ];

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand"><span className="brand-dot" />Patrimoine</div>
        <div className="scope" role="radiogroup" aria-label="Périmètre d'analyse">
          {scopes.map((s) => (
            <button key={s.name} role="radio" aria-checked={person === s.id}
              className={person === s.id ? "on" : ""} title={s.hint} onClick={() => setPerson(s.id)}>{s.name}</button>
          ))}
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} className={link}>
              <Icon name={n.icon} /><span>{n.label}</span>
            </NavLink>
          ))}
          <NavLink to="/alertes" className={link}>
            <Icon name="bell" /><span>Alertes</span>
            {!!events.data?.unread && <span className="count">{events.data.unread}</span>}
          </NavLink>
          {ha.data?.url && (
            <a className="nav-link" href={ha.data.url} target="_blank" rel="noopener noreferrer" title="Ouvrir le tableau de bord Patrimoine dans Home Assistant">
              <Icon name="ha" /><span>Home Assistant</span>
            </a>
          )}
        </nav>
        <div className="sidebar-foot">
          <div className="theme" role="radiogroup" aria-label="Thème">
            {([["auto", "Auto"], ["light", "Clair"], ["dark", "Sombre"]] as [Theme, string][]).map(([t, l]) => (
              <button key={t} role="radio" aria-checked={theme === t} className={theme === t ? "on" : ""}
                onClick={() => pickTheme(t)}>{l}</button>
            ))}
          </div>
          <p style={{ margin: 0 }}>Outil personnel — aucune opération n'est exécutée automatiquement.</p>
        </div>
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/comptes" element={<Accounts />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/budget" element={<Budget />} />
          <Route path="/alertes" element={<Alerts />} />
          <Route path="/objectifs" element={<Goals />} />
          <Route path="/conseils" element={<Advice />} />
          <Route path="/placements" element={<Invest />} />
          <Route path="/export" element={<Export />} />
          <Route path="/fiscalite" element={<Fiscal />} />
          <Route path="/banques" element={<Banks />} />
        </Routes>
      </main>

      <nav className="tabbar" aria-label="Navigation principale">
        {NAV.filter((n) => TABS.includes(n.to)).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => "tab" + (isActive ? " active" : "")}>
            <Icon name={n.icon} /><span>{n.label.replace(" & flux", "")}</span>
          </NavLink>
        ))}
        <button className={"tab" + (more ? " active" : "")} aria-expanded={more} onClick={() => setMore((m) => !m)}>
          <Icon name="more" /><span>Plus</span>
          {!!events.data?.unread && <span className="count tab-count">{events.data.unread}</span>}
        </button>
      </nav>
      {more && (
        <>
          <div className="sheet-backdrop" onClick={() => setMore(false)} />
          <div className="sheet" role="dialog" aria-label="Autres pages">
            <div className="sheet-grip" />
            <div className="sheet-grid">
              {[...NAV.filter((n) => !TABS.includes(n.to)), { to: "/alertes", label: "Alertes", icon: "bell" }].map((n) => (
                <NavLink key={n.to} to={n.to} className="sheet-item"><Icon name={n.icon} /><span>{n.label}</span></NavLink>
              ))}
              {ha.data?.url && <a className="sheet-item" href={ha.data.url} target="_blank" rel="noopener noreferrer"><Icon name="ha" /><span>Home Assistant</span></a>}
            </div>
            <div className="theme" role="radiogroup" aria-label="Thème" style={{ display: "grid" }}>
              {([["auto", "Auto"], ["light", "Clair"], ["dark", "Sombre"]] as [Theme, string][]).map(([t, l]) => (
                <button key={t} role="radio" aria-checked={theme === t} className={theme === t ? "on" : ""} onClick={() => pickTheme(t)}>{l}</button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
