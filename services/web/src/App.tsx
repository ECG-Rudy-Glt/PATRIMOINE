import { Link, Route, Routes, useLocation } from "react-router-dom";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { LoadingState } from "./components/ui";
import Dashboard from "./pages/Dashboard";
import Icon from "./components/Icon";
import { BottomNav, MoreSheet, NavItem, Scope, ScopeSwitcher, Sidebar, ThemeButton } from "./components/Nav";
import { api } from "./api";
import { usePerson } from "./person";
import { useFetch } from "./useFetch";
import { applyTheme, savedTheme, Theme } from "./theme";


// Pages chargées à la demande (le bundle initial ne contient que l'accueil et la coque)
const Accounts = lazy(() => import("./pages/Accounts"));
const Transactions = lazy(() => import("./pages/Transactions"));
const Budget = lazy(() => import("./pages/Budget"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Goals = lazy(() => import("./pages/Goals"));
const Advice = lazy(() => import("./pages/Advice"));
const Invest = lazy(() => import("./pages/Invest"));
const Export = lazy(() => import("./pages/Export"));
const Fiscal = lazy(() => import("./pages/Fiscal"));
const Banks = lazy(() => import("./pages/Banks"));

const NAV: NavItem[] = [
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
  { to: "/alertes", label: "Alertes", icon: "bell" },
];

// Barre du bas : les 4 pages du quotidien + « Plus » qui ouvre le reste dans une feuille
const TABS = ["/", "/comptes", "/budget", "/conseils"];

export default function App() {
  const { person, setPerson } = usePerson();
  const [more, setMore] = useState(false);
  const loc = useLocation();
  const main = useRef<HTMLElement>(null);
  const prev = useRef(loc.pathname);
  useEffect(() => {
    setMore(false);
    // navigation : le focus revient au contenu (lecteurs d'écran, clavier) sauf au premier affichage
    if (prev.current === loc.pathname) return;
    prev.current = loc.pathname;
    main.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);
  const persons = useFetch(api.persons);
  const events = useFetch(api.alertEvents);
  const ha = useFetch(api.haIntegration);
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const pickTheme = (t: Theme) => { setTheme(t); applyTheme(t); };
  const closeMore = useCallback(() => setMore(false), []);
  const unread = events.data?.unread;
  // Foyer = le compte commun seul ; chaque personne = ses comptes personnels, séparés ; Tous = vue d'ensemble
  const scopes: Scope[] = [
    { id: -1, name: "Foyer", hint: "Le compte commun" },
    ...(persons.data ?? []).map((p) => ({ id: p.id as number | null, name: p.name, hint: `Comptes personnels de ${p.name}` })),
    { id: null, name: "Tous", hint: "Tous les comptes ensemble (virements entre comptes neutralisés)" },
  ];
  const haUrl = ha.data?.url ?? null;

  return (
    <div className="layout">
      <a className="skip" href="#contenu">Aller au contenu</a>
      <Sidebar items={NAV} unread={unread} haUrl={haUrl} theme={theme} onTheme={pickTheme} />
      <div className="content">
        <div className="topbar">
          <ScopeSwitcher scopes={scopes} value={person} onChange={setPerson} />
          <div className="topbar-end">
          <ThemeButton theme={theme} onChange={pickTheme} />
          <Link to="/alertes" className="topbar-ico" aria-label={unread ? `Alertes, ${unread} non lue(s)` : "Alertes"}>
            <Icon name="bell" size={20} />{!!unread && <span className="count" aria-hidden>{unread}</span>}
          </Link>
          </div>
        </div>
        <main id="contenu" ref={main} tabIndex={-1}>
          <Suspense fallback={<LoadingState />}>
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
            <Route path="*" element={<div className="card state"><b>Page introuvable</b><Link to="/" className="btn primary">Retour à l'accueil</Link></div>} />
          </Routes>
          </Suspense>
        </main>
      </div>
      <BottomNav tabs={NAV.filter((n) => TABS.includes(n.to)).map((n) => ({ ...n, label: n.label.replace(" & flux", "") }))}
        moreOpen={more} onMore={() => setMore((m) => !m)} unread={unread} />
      {more && <MoreSheet unread={unread} items={NAV.filter((n) => !TABS.includes(n.to))} haUrl={haUrl} theme={theme} onTheme={pickTheme} onClose={closeMore} />}
    </div>
  );
}
