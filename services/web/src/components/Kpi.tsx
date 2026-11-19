import { Stat } from "./ui";
export default function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "pos" | "neg" | "warn" }) {
  return <Stat label={label} value={value} hint={hint} tone={tone} />;
}
