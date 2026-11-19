import { ProgressBar } from "./ui";
// Compatibilité des pages non refaites : même API, rendu par la barre unique
export default function Progress({ value, mark, state }: { value: number; mark?: number | null; state?: "near" | "over" }) {
  return <ProgressBar value={value} mark={mark} state={state} />;
}
