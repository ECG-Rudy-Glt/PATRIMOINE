import { createContext, ReactNode, useContext, useState } from "react";

// null = foyer (tous les comptes à 100 %), sinon id de la personne (quote-part de chaque compte)
type Ctx = { person: number | null; setPerson: (p: number | null) => void };
const PersonCtx = createContext<Ctx>({ person: null, setPerson: () => {} });

function initial(): number | null {
  try {
    // lien direct vers un périmètre : ?scope=1 (Alex), ?scope=2 (Sam), ?scope=-1 (foyer), ?scope=all (tous)
    const q = new URLSearchParams(window.location.search).get("scope");
    if (q) return q === "all" ? null : Number(q);
    const v = localStorage.getItem("person");
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function PersonProvider({ children }: { children: ReactNode }) {
  const [person, set] = useState<number | null>(initial);
  const setPerson = (p: number | null) => {
    set(p);
    try { p ? localStorage.setItem("person", String(p)) : localStorage.removeItem("person"); } catch { /* navigation privée */ }
  };
  return <PersonCtx.Provider value={{ person, setPerson }}>{children}</PersonCtx.Provider>;
}

export const usePerson = () => useContext(PersonCtx);
