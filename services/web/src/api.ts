export type Summary = {
  networth: number | null; as_of: string | null; accounts: number; stale: number;
  income_30d: number; expense_30d: number; net_30d: number;
};
export type Account = {
  id: number; name: string; institution: string | null; type: string; currency: string;
  balance: number | null; day: string | null; last_sync_at: string | null; source: string;
  holders: Holder[];
};
export type HaIntegration = { url: string | null; configured: boolean; last_push: string | null; ok: boolean };
export type PushDevice = { id: number; device: string | null; created_at: string; last_ok_at: string | null; failures: number };
export type Person = { id: number; name: string; email: string | null; accounts: number };
export type Holder = { person_id: number; name: string; share: number };
export type Point = { day: string; total: number; courant: number; livret: number; placements: number; estimated: boolean; known: number };
export type Month = { month: string; income: number; expense: number; net: number; savings?: number; transfers?: number };
export type Pay = { person_id: number; name: string; n: number; last_date: string; last_amount: number; avg_amount: number; usual_day: number; next_date: string };
export type Kind = "income" | "fixed" | "variable" | "household" | "internal" | "savings";
export type Tx = {
  id: number; booked_on: string; label: string | null; merchant: string | null; amount: number;
  category: string | null; category_label: string | null; category_source: "rule" | "manual" | null; kind: Kind | null;
  account: string; institution: string | null;
};
export type Slice = { id: number; name: string; institution: string | null; type: string; value: number; holders: string };
export type FlowNode = { name: string; group: string };
export type TransferNode = { key: string; kind: "account" | "external"; name: string; institution: string | null; account_id: number | null };
export type Transfers = {
  cycles: number; months?: number; partial?: boolean; nodes: TransferNode[];
  edges: { source: string; target: string; monthly: number; count: number; last: string; paired: boolean }[];
};
export type Flows = { cycles: number; months?: number; partial?: boolean; nodes: FlowNode[]; links: { source: number; target: number; value: number }[] };
export type AlertRule = {
  id: number; account_id: number | null; account_type: string | null; threshold: number; enabled: boolean; account_name: string | null;
};
export type AlertEvent = {
  id: number; account_id: number; account_name: string; institution: string | null;
  balance: number; threshold: number; fired_at: string; notified: boolean; read_at: string | null;
};
export type Upcoming = { merchant: string; category_label: string; amount: number; next_date: string; account: string };
export type Current = {
  cycle: string; starts: string; ends: string; day_index: number; days: number; days_left: number;
  spent: number; income: number; typical_to_date: number | null; typical_total: number | null;
  upcoming: Upcoming[]; upcoming_total: number;
};
export type Recurring = {
  grp: string; merchant: string; category: string; category_label: string; occurrences: number;
  avg_amount: number; last_amount: number; prev_amount: number | null; first_date: string; last_date: string;
  interval_days: number; next_date: string; is_new: boolean; price_change: number | null;
};
export type Cap = { category: string; label: string; monthly: number; alert_pct: number; spent: number; pct: number; projected: number };
export type GoalItem = { id?: number; label: string; amount: number };
export type GoalAccount = { account_id: number; name?: string; share: number };
export type Goal = {
  id: number; name: string; kind: string; person_id: number | null; person: string | null; target_date: string;
  priority: number; initial: number; status: "active" | "paused" | "done"; notes: string | null;
  items: GoalItem[]; accounts: GoalAccount[];
  target: number; current: number; remaining: number; months_left: number; monthly_needed: number | null;
  pace_monthly: number | null; projected: number; progress_pct: number;
  feasibility: "ok" | "tight" | "out" | null; capacity?: number; cumulative_needed?: number;
};
export type GoalIn = Omit<Goal, "id" | "person" | "target" | "current" | "remaining" | "months_left" | "monthly_needed"
  | "pace_monthly" | "projected" | "progress_pct" | "feasibility" | "capacity" | "cumulative_needed">;
export type Forecast = { account_id: number; name: string; balance: number; upcoming: number; daily_rate: number; days_left: number; projected: number; ends: string; incoming: number; joint: boolean };
export type Household = { complete: boolean; total_contribution: number; persons: {
  person_id: number; name: string; tracked: boolean; income: number; contribution: number;
  income_share: number | null; fair_contribution: number | null; effort_pct: number | null }[] };
export type Anomaly = { tx_id: number; reason: string; reference: number; notified: boolean; booked_on: string; merchant: string; amount: number; category_label: string };
export type Sim = { goal_id: number; target_date?: string; target_delta?: number; extra_monthly?: number };
export type Fact = { label: string; value: number | string; unit: string };
export type RecoItem = {
  titre: string; categorie: string; priorite: "haute" | "moyenne" | "basse"; horizon: string;
  constat: string; action: string; vigilance: string; faits: string[];
};
export type Analysis = {
  id: number; created_at: string; trigger: string; person_id: number | null; person: string | null; model: string;
  payload: { synthese: string; recommandations: RecoItem[]; questions: string[]; sources?: { title: string; url: string }[] };
  facts: Record<string, Fact>; warnings: string[]; usage: { input: number; output: number };
  items: { id: number; item: RecoItem; status: "proposee" | "acceptee" | "rejetee"; feedback: string | null; decided_at: string | null }[];
};
export type AdvisorDoc = { content: string; meta: { model?: string; cost_usd?: number; usage?: { input: number; output: number } }; updated_at: string };
export type AdvisorContext = { content: string; updated_at: string; map: string };
export type AdvisorStatus = { configured: boolean; model: string; spend: { spent: number; budget: number; blocked: boolean } | null; scopes: { person_id: number | null; last: string | null; pending_triggers: string[] }[] };
export type Holding = {
  account_id: number; account: string; account_type: string; asset_id: number; asset: string; isin: string | null;
  exposure: string; pea_eligible: boolean; quantity: number; pru: number | null; invested: number | null; price: number | null;
  price_day: string | null; value: number | null; gain: number | null; gain_pct: number | null; dividends: number;
  envelope_ok: boolean; envelope_issue: string | null;
};
export type Holdings = { total: number; invested: number; gain: number; gain_pct: number | null; items: Holding[] };
export type AllocRow = { exposure: string; label: string; value: number; pct: number | null; target_pct: number | null;
  band_pct: number | null; drift_pct: number | null; out_of_band: boolean | null };
export type PlanItem = { exposure: string; label: string; amount: number; envelope: string | null; envelope_why: string | null;
  to_open: string | null; to_open_why: string | null };
export type Plan = { monthly: number; source: string; total_before?: number; items: PlanItem[]; note?: string };
export type Signal = { code: string; label: string; last_day: string; last: number; ma50: number; ma200: number;
  vs_ma200_pct: number; drawdown_pct: number; perf_3m_pct: number | null; perf_12m_pct: number | null; vol_20d_pct: number; trend: string };
export type Macro = { code: string; label: string; day: string; value: number; unit: string };
export type Series = { code: string; label: string; source: string; symbol: string; kind: string; unit: string; points: number; last_day: string | null };
export type Markets = { signals: Signal[]; macro: Macro[]; series: Series[] };
export type SeriesPoint = { code: string; day: string; value: number; ma200: number };
export type Asset = { id: number; name: string; isin: string | null; exposure: string; pea_eligible: boolean; data_symbol: string | null; ter?: number | null };
export type FeeSchedule = {
  mgmt_pct: number; entry_pct: number; switch_pct: number; switch_eur: number; switches_per_year: number;
  switch_amount_eur: number | null; custody_eur: number; monthly_contribution: number | null; note: string | null;
};
export type FeeProjection = { sans_frais: number; avec_frais: number; repere: number; verse: number; manque: number; vs_repere: number | null };
export type FeeAccount = {
  account_id: number; name: string; type: string; envelope: string; institution: string | null; weight: number; value: number;
  schedule: FeeSchedule | null; monthly_contribution: number; contribution_source: string; ter_pct: number; ter_missing: string[];
  annual: { gestion: number; supports: number; versements: number; arbitrages: number; tenue: number };
  annual_total: number; annual_pct: number | null;
  benchmark: { label: string | null; mgmt_pct: number; entry_pct: number; custody_eur: number; ter_pct: number; annual_total: number };
  projection: Record<string, FeeProjection>; notes: string[];
};
export type Fees = {
  gross_return_pct: number; horizons: number[]; accounts: FeeAccount[];
  totals: Record<string, number | null>; bank: { available: boolean; monthly: number | null; annual: number | null };
};
export type FeeBenchmark = { account_type: string; label: string; mgmt_pct: number; entry_pct: number; custody_eur: number; ter_pct: number | null };
export type Trade = { id: number; day: string; kind: string; quantity: number; price: number | null; fees: number; asset: string; account: string; source: string };
export type Category = { code: string; label: string; kind: Kind };
export type Cycle = {
  cycle: string; starts: string; ends: string; complete: boolean;
  income: number; fixed: number; variable: number; internal_net: number; savings: number; available: number;
};
export type BudgetSummary = {
  cycles: number; from_day?: string; to_day?: string;
  income?: number; fixed?: number; variable?: number; internal_net?: number; available?: number; monthly_spend?: number;
  buffer?: { months: number; target: number; liquid: number; shortfall: number; refill_per_month: number; refill_months: number };
  investable?: number;
  uncategorized: { n: number; amount: number };
};
export type AvoidItem = {
  category: string; label: string; n: number; hint: string; total: number; monthly: number; annual: number;
  top: { merchant: string; n: number; total: number }[]; recurring: { merchant: string; amount: number; next: string; annual: number }[];
};
export type MonthlyReport = { month: string; filename: string; size_bytes: number; created_at: string };
export type SavingAlt = { fournisseur: string; offre: string; prix_mensuel: number; prix_apres_promo: number | null; engagement: string | null;
  conditions: string | null; source_url: string; date_constat: string | null; economie_annuelle: number | null; economie_estimee?: boolean };
export type SavingItem = { contrat: { id: string; categorie: string; libelle: string; mensuel: number; annuel: number; approx?: boolean };
  alternatives: SavingAlt[]; pistes: string[]; prudence: string };
export type Savings = { id?: number; created_at?: string; model?: string; usage?: { cost_usd: number };
  payload?: { items: SavingItem[]; avertissements: string[]; rejetees: number; contrats: number; sources_consultees: number; note: string } };
export type SharedRow = { tx_id: number; booked_on: string; amount: number; label: string; account: string; payer: string | null;
  kind?: string; share_other?: number; suggested?: string };
export type Settlement = { a: string; b: string; solde: number; phrase: string; note: string;
  lignes: { date: string | null; libelle: string; type: string; montant: number; effet: number }[] };
export type Avoidable = { months: number; days: number; note: string; groups: { key: string; title: string; monthly: number; annual: number; items: AvoidItem[] }[] };
export type BreakdownRow = { code: string; label: string; kind: Kind; n: number; amount: number };
export type TxPage = { total: number; items: Tx[] };
// --- Fiscalité (L2)
export type TaxPerson = { person_id: number; name?: string; rfr: number | null; parts: number | null;
  earned_income: number | null; per_ceiling_notice: number | null; per_paid: number | null };
export type TaxProfile = { income_year: number | null; joint: boolean; rfr: number | null; parts: number | null; persons: TaxPerson[] };
export type TaxRule = { year: number; key: string; value: number; unit: string; label: string; source: string; verified: boolean };
export type LepRow = { person_id: number; name: string; income_year: number | null; basis: "foyer" | "individuel";
  rfr: number | null; parts: number | null; ceiling: number | null; margin: number | null; eligible: boolean | null };
export type PerRow = { person_id: number; name: string; ceiling: number; source: "avis" | "estimation" | "plancher";
  paid: number; paid_source: "saisi" | "opérations"; remaining: number };
export type FiscalEnvelope = { id: number; name: string; institution: string | null; type: string; opened_on: string | null;
  holders: string | null; years: number | null; threshold_years: number | null; threshold_date: string | null;
  reached: boolean | null; days_left: number | null };
export type FiscalLivret = { id: number; name: string; institution: string | null; savings_kind: string | null;
  opened_on: string | null; balance: number | null; day: string | null; holder_ids: number[] };
export type RegulatedRow = { kind: string; label: string; person_id: number; name: string; ceiling: number; held: boolean;
  accounts: number[]; balance: number | null; remaining: number | null; can_open: boolean | null };
export type FiscalSummary = {
  rules_year: number | null; unverified_rules: string[]; profile_year: number | null; joint: boolean;
  lep: LepRow[]; per: { pass: number; floor: number; cap: number; items: PerRow[] }; envelopes: FiscalEnvelope[];
  av_allowance: { basis: "couple" | "seul" | null; value: number | null };
  livrets: { accounts: FiscalLivret[]; items: RegulatedRow[];
    totals: { kind: string; label: string; ceiling: number; held: number; remaining_held: number; openable: number }[] };
  warnings: string[];
};

export type ImportPreview = {
  format: "csv" | "ofx"; mode: "extend" | "all"; dry_run: boolean; account: string;
  read: number; new: number; skipped: number; skipped_reasons: { code: string; label: string; n: number }[];
  period: { from: string; to: string }; first_known: string | null;
  examples: { booked_on: string; amount: number; label: string; new: boolean }[];
  warnings: string[];
  result?: { received: number; inserted: number; backfilled: number; categorized: number };
};
export type Aspsp = { name: string; country: string; logo: string | null; max_days: number; beta: boolean };
export type BankSession = {
  session_id: string; bank: string; country: string; valid_until: string; status: "active" | "remplacee"; source: string;
  created_at: string; last_sync_at: string | null; last_error: string | null; active: boolean; days_left: number;
  holders: Record<string, string>;
  accounts: { uid: string; name: string | null; account_id: number | null; type: string | null; last_sync_at: string | null; holders: string | null }[];
};

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`/api${path}`);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}

const who = (person: number | null) => (person ? `&person=${person}` : "");

export const api = {
  persons: () => get<Person[]>("/persons"),
  haIntegration: () => get<HaIntegration>("/integrations/ha"),
  settlement: () => get<Settlement>("/budget/settlement"),
  shared: () => get<{ items: SharedRow[]; candidates: SharedRow[] }>("/budget/shared"),
  setShared: (tx: number, kind: string, share = 0.5) => send<{ ok: boolean }>("PUT", `/budget/shared/${tx}`, { kind, share_other: share }),
  unsetShared: (tx: number) => send<{ ok: boolean }>("DELETE", `/budget/shared/${tx}`),
  savings: () => get<Savings>("/advisor/savings"),
  runSavings: () => send<{ ok: boolean; items: number; cost_usd: number }>("POST", "/advisor/savings"),
  reports: () => get<MonthlyReport[]>("/reports"),
  generateReport: () => send<{ month: string; size: number }>("POST", "/export/monthly/generate"),
  summary: (person: number | null) => get<Summary>(`/summary?${who(person)}`),
  accounts: () => get<Account[]>("/accounts"),
  history: (person: number | null, days = 365) => get<Point[]>(`/networth/history?days=${days}${who(person)}`),
  cashflow: (person: number | null, months = 12) => get<Month[]>(`/budget/cashflow?months=${months}${who(person)}`),
  pay: () => get<Pay[]>("/budget/pay"),
  breakdownAccounts: (person: number | null) => get<Slice[]>(`/networth/breakdown?${who(person)}`),
  flows: (person: number | null) => get<Flows>(`/budget/flows?${who(person)}`),
  transfers: (person: number | null) => get<Transfers>(`/budget/transfers?${who(person)}`),
  alertRules: () => get<AlertRule[]>("/alerts/rules"),
  addAlertRule: (r: { threshold: number; account_id?: number; account_type?: string }) => send<AlertRule>("POST", "/alerts/rules", r),
  toggleAlertRule: (id: number, enabled: boolean) => send("PATCH", `/alerts/rules/${id}?enabled=${enabled}`),
  deleteAlertRule: (id: number) => send("DELETE", `/alerts/rules/${id}`),
  alertEvents: () => get<{ unread: number; items: AlertEvent[] }>("/alerts/events"),
  markAlertsRead: () => send("POST", "/alerts/events/read"),
  alertChannel: () => get<{ ntfy: boolean; server: string | null; webpush: boolean; devices: number }>("/alerts/channel"),
  pushDevices: () => get<PushDevice[]>("/push/devices"),
  deletePushDevice: (id: number) => send("DELETE", `/push/devices/${id}`),
  alertTest: () => send("POST", "/alerts/test"),
  avoidable: (person: number | null) => get<Avoidable>(`/budget/avoidable?${who(person)}`),
  current: (person: number | null) => get<Current>(`/budget/current?${who(person)}`),
  recurring: (person: number | null) => get<{ monthly_total: number; items: Recurring[] }>(`/budget/recurring?${who(person)}`),
  caps: (person: number | null) => get<Cap[]>(`/budget/caps?${who(person)}`),
  setCap: (category: string, monthly: number, alert_pct = 80) => send("PUT", `/budget/caps/${category}`, { monthly, alert_pct }),
  deleteCap: (category: string) => send("DELETE", `/budget/caps/${category}`),
  goals: () => get<Goal[]>("/budget/goals"),
  createGoal: (g: GoalIn) => send<{ id: number }>("POST", "/budget/goals", g),
  updateGoal: (id: number, g: GoalIn) => send<{ id: number }>("PUT", `/budget/goals/${id}`, g),
  deleteGoal: (id: number) => send("DELETE", `/budget/goals/${id}`),
  forecast: (person: number | null) => get<Forecast[]>(`/budget/forecast?${who(person)}`),
  household: () => get<Household>("/budget/household"),
  anomalies: () => get<Anomaly[]>("/budget/anomalies"),
  simulate: (s: Sim) => send<Goal[]>("POST", "/budget/goals/simulate", s),
  updatePerson: (id: number, name: string, email: string) => send("PUT", `/persons/${id}`, { name, email }),
  digestSend: () => send<{ sent: string[] }>("POST", "/digest/send"),
  advisorDocs: () => get<Record<string, AdvisorDoc>>("/advisor/docs"),
  saveAdvisorDoc: (kind: string, content: string) => send("PUT", `/advisor/docs/${kind}`, { content }),
  writeStrategy: () => send<{ ok: boolean; cost_usd: number; chars: number }>("POST", "/advisor/strategy"),
  advisorContext: () => get<AdvisorContext>("/advisor/context"),
  saveAdvisorContext: (content: string) => send("PUT", "/advisor/context", { content }),
  advisorStatus: () => get<AdvisorStatus>("/advisor/status"),
  analyses: () => get<Analysis[]>("/advisor/recommendations"),
  runAdvisor: (person_id: number | null) => send<{ id?: number; skipped?: boolean; reason?: string; warnings?: string[] }>(
    "POST", "/advisor/run", { person_id, force: true }),
  decide: (id: number, status: string, feedback?: string) => send("PUT", `/advisor/items/${id}`, { status, feedback }),
  holdings: (person: number | null) => get<Holdings>(`/alloc/holdings?${who(person)}`),
  portfolioHistory: (person: number | null) => get<{ day: string; value: number; invested: number }[]>(`/alloc/portfolio/history?${who(person)}`),
  allocation: (person: number | null) => get<AllocRow[]>(`/alloc/current?${who(person)}`),
  exposures: () => get<Record<string, string>>("/alloc/exposures"),
  setTargets: (items: { exposure: string; target_pct: number; band_pct: number }[]) => send("PUT", "/alloc/targets", items),
  plan: (person: number | null, monthly?: number) => get<Plan>(`/alloc/plan?${who(person)}${monthly != null ? `&monthly=${monthly}` : ""}`),
  markets: () => get<Markets>("/alloc/markets"),
  marketSeries: (codes: string[], days = 365) => get<SeriesPoint[]>(`/alloc/markets/series?codes=${codes.join(",")}&days=${days}`),
  assets: () => get<Asset[]>("/alloc/assets"),
  addAsset: (a: Partial<Asset> & { name: string; exposure: string }) => send<Asset>("POST", "/alloc/assets", a),
  addInvestAccount: (a: { name: string; type: string; institution?: string; holders: Record<number, number> }) => send<{ id: number }>("POST", "/alloc/accounts", a),
  trades: () => get<Trade[]>("/alloc/trades"),
  fees: (person: number | null) => get<Fees>(`/alloc/fees?${who(person)}`),
  setFees: (account_id: number, f: FeeSchedule) => send("PUT", `/alloc/fees/accounts/${account_id}`, f),
  feeParams: () => get<{ gross_return_pct: number; benchmarks: FeeBenchmark[] }>("/alloc/fees/params"),
  setFeeParams: (p: { gross_return_pct: number; benchmarks: FeeBenchmark[] }) => send("PUT", "/alloc/fees/params", p),
  setTer: (asset_id: number, ter: number | null) => send("PUT", `/alloc/assets/${asset_id}/ter`, { ter }),
  addTrade: (t: { account_id: number; asset_id: number; day: string; kind: string; quantity: number; price?: number; fees?: number }) =>
    send<{ id: number }>("POST", "/alloc/trades", t),
  deleteTrade: (id: number) => send("DELETE", `/alloc/trades/${id}`),
  importTrades: async (account_id: number, csv: string) => {
    const r = await fetch(`/api/alloc/trades/import?account_id=${account_id}`, { method: "POST", headers: { "content-type": "text/plain" }, body: csv });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json() as Promise<{ imported: number; errors: string[] }>;
  },
  // import d'un export bancaire : octets bruts du fichier (l'encodage, souvent cp1252, est géré côté serveur)
  importHistory: async (account_id: number, file: ArrayBuffer, filename: string, mode: "extend" | "all", dry_run: boolean) => {
    const r = await fetch(`/api/accounts/${account_id}/import?mode=${mode}&dry_run=${dry_run ? 1 : 0}&filename=${encodeURIComponent(filename)}`,
      { method: "POST", headers: { "content-type": "application/octet-stream" }, body: file });
    if (!r.ok) {
      let msg = await r.text();
      try { msg = JSON.parse(msg).detail ?? msg; } catch { /* texte brut */ }
      throw new Error(r.status === 413 ? "Fichier trop volumineux (8 Mo maximum)" : String(msg));
    }
    return r.json() as Promise<ImportPreview>;
  },
  aspsps: (country = "FR") => get<Aspsp[]>(`/bank/aspsps?country=${country}`),
  bankSessions: () => get<BankSession[]>("/bank/sessions"),
  bankAuth: (bank: string, holders: number[], country = "FR") => send<{ url: string }>("POST", "/bank/auth", { bank, country, holders }),
  bankRenew: (sessionId: string) => send<{ url: string }>("POST", `/bank/sessions/${encodeURIComponent(sessionId)}/renew`),
  categories: () => get<Category[]>("/budget/categories"),
  budgetSummary: (person: number | null) => get<BudgetSummary>(`/budget/summary?${who(person)}`),
  budgetMonthly: (person: number | null) => get<Cycle[]>(`/budget/monthly?${who(person)}`),
  breakdown: (person: number | null, cycle?: string) =>
    get<BreakdownRow[]>(`/budget/breakdown?${cycle ? `cycle=${cycle}` : ""}${who(person)}`),
  setCategory: (id: number, category: string, remember: boolean) =>
    send<{ ok: boolean; rule: { pattern: string; updated: number } | null }>(
      "PUT", `/budget/transactions/${id}/category`, { category, remember }),
  fiscalSummary: (person: number | null) => get<FiscalSummary>(`/budget/fiscal/summary?${who(person)}`),
  fiscalProfile: () => get<TaxProfile>("/budget/fiscal/profile"),
  saveFiscalProfile: (p: TaxProfile) => send<TaxProfile>("PUT", "/budget/fiscal/profile", p),
  fiscalRules: () => get<{ year: number | null; items: TaxRule[] }>("/budget/fiscal/rules"),
  setFiscalAccount: (id: number, body: { opened_on?: string | null; savings_kind?: string | null }) =>
    send("PUT", `/budget/fiscal/accounts/${id}`, body),
  transactions: (p: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    Object.entries(p).forEach(([k, v]) => v !== undefined && v !== "" && qs.set(k, String(v)));
    return get<TxPage>(`/transactions?${qs}`);
  },
};
