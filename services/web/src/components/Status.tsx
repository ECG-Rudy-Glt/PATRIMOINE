// Pastille de statut : la couleur n'est jamais seule, toujours accompagnée d'un libellé
export type Level = "good" | "warning" | "serious" | "critical";
export default function Status({ level, children }: { level: Level; children: React.ReactNode }) {
  return <span className={`status ${level}`}>{children}</span>;
}
