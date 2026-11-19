// Icônes inline (traits 1.75px, 20x20) — pas de dépendance externe
const PATHS: Record<string, string> = {
  home: "M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1z",
  accounts: "M3 7h14M3 7l7-4 7 4M5 7v7m3.3-7v7m3.4-7v7M15 7v7M3 16h14",
  tx: "M4 6h12M4 6l3-3M4 6l3 3m9 5H4m12 0-3-3m3 3-3 3",
  budget: "M10 3v7l5 5M17 10a7 7 0 1 1-7-7",
  bell: "M5 14V9a5 5 0 0 1 10 0v5l1.5 2h-13zM8.5 18.5a1.8 1.8 0 0 0 3 0",
  alloc: "M10 3a7 7 0 1 0 7 7h-7z M12 1.5v6.5h6.5A6.5 6.5 0 0 0 12 1.5",
  goal: "M10 17.5a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15zm0-4a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zm0-3.5h.01",
  export: "M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5M4 14v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2",
  ha: "M3 10 10 3l7 7M5 8.5V16a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8.5M8 17v-4a2 2 0 0 1 4 0v4",
  reco:"M10 2.5l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 7.8l5-.7z",
  more: "M4 10a1 1 0 1 0 2 0 1 1 0 1 0-2 0M9 10a1 1 0 1 0 2 0 1 1 0 1 0-2 0M14 10a1 1 0 1 0 2 0 1 1 0 1 0-2 0",
  tax: "M5 2.5h7l3.5 3.5v11.5H5zM12 2.5V6h3.5M7.5 14.5l5-5M8 10h.01M12 14h.01",
  sync: "M16.5 9A6.5 6.5 0 0 0 5 5.5M4 3v3.5h3.5M3.5 11A6.5 6.5 0 0 0 15 14.5M16 17v-3.5h-3.5",
  plus: "M10 4v12M4 10h12",
  sun: "M10 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.3 4.3l1 1M14.7 14.7l1 1M4.3 15.7l1-1M14.7 5.3l1-1",
  moon: "M16.5 11.5A6.5 6.5 0 1 1 8.5 3.5a5.2 5.2 0 0 0 8 8z",
  auto: "M10 17.5a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15zM10 2.5v15",
  arrow: "M6 14 14 6M7.5 6H14v6.5",
  bank: "M4 3.5h12a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM3 7.5h14M6 12h3",
};
export default function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
