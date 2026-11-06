export default function Kpi({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: "pos" | "neg" | "warn";
}) {
  return (
    <div className="card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}
