// Barre de progression ; `mark` = repère (ex. dépense habituelle au même stade), en % de la barre
export default function Progress({ value, mark, state }: { value: number; mark?: number | null; state?: "near" | "over" }) {
  return (
    <div className={"progress " + (state ?? "")} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className="fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      {mark != null && <div className="mark" style={{ left: `calc(${Math.max(0, Math.min(100, mark))}% - 1px)` }} />}
    </div>
  );
}
