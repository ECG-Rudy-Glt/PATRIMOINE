-- Patrimoine : schéma de la base (structure uniquement).
-- Généré à partir de l'historique des migrations de la version privée ; aucune donnée personnelle.
-- Les futures évolutions s'ajoutent en 003_*.sql, 004_*.sql… (appliquées par le ledger au démarrage).

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15 (Debian 16.15-1.pgdg13+2)
-- Dumped by pg_dump version 16.15 (Debian 16.15-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: account_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.account_type AS ENUM (
    'courant',
    'livret',
    'pea',
    'assurance_vie',
    'per',
    'cto',
    'immobilier',
    'autre'
);


--
-- Name: asset_class; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.asset_class AS ENUM (
    'cash',
    'action',
    'obligation',
    'etf',
    'fonds_euro',
    'immobilier',
    'crypto',
    'autre'
);


--
-- Name: reco_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.reco_status AS ENUM (
    'proposee',
    'acceptee',
    'rejetee',
    'expiree'
);


--
-- Name: account_weights(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.account_weights(p_person integer) RETURNS TABLE(account_id integer, w numeric)
    LANGUAGE sql STABLE
    AS $$
  SELECT id, 1::numeric FROM accounts WHERE active AND p_person IS NULL
  UNION ALL
  SELECT a.id, 1::numeric FROM accounts a
   WHERE a.active AND p_person = -1 AND (SELECT count(*) FROM account_holders h WHERE h.account_id = a.id) > 1
  UNION ALL
  SELECT h.account_id, 1::numeric FROM account_holders h JOIN accounts a ON a.id = h.account_id
   WHERE a.active AND p_person > 0 AND h.person_id = p_person
     AND (SELECT count(*) FROM account_holders h2 WHERE h2.account_id = h.account_id) = 1
$$;


--
-- Name: allocation_current(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.allocation_current(p_person integer) RETURNS TABLE(exposure text, value numeric, pct numeric, target_pct numeric, band_pct numeric, drift_pct numeric, out_of_band boolean)
    LANGUAGE sql STABLE
    AS $$
  WITH v AS (
    SELECT h.exposure, sum(h.value) AS value FROM holdings(p_person) h GROUP BY 1
    UNION ALL
    SELECT 'liquidites', sum(val.balance * w.w)
    FROM account_weights(p_person) w JOIN accounts a ON a.id = w.account_id AND a.type IN ('courant','livret')
    JOIN LATERAL (SELECT balance FROM valuations WHERE account_id = a.id AND NOT estimated ORDER BY day DESC LIMIT 1) val ON true
  ),
  agg AS (SELECT exposure, sum(value) AS value FROM v GROUP BY 1),
  tot AS (SELECT NULLIF(sum(value), 0) AS t FROM agg),
  allx AS (SELECT exposure FROM agg UNION SELECT exposure FROM allocation_targets)
  SELECT x.exposure, round(COALESCE(g.value, 0), 2),
         round(100 * COALESCE(g.value, 0) / (SELECT t FROM tot), 2),
         t.target_pct, t.band_pct,
         round(100 * COALESCE(g.value, 0) / (SELECT t FROM tot) - t.target_pct, 2),
         abs(100 * COALESCE(g.value, 0) / (SELECT t FROM tot) - t.target_pct) > t.band_pct
  FROM allx x LEFT JOIN agg g USING (exposure) LEFT JOIN allocation_targets t USING (exposure)
  ORDER BY 2 DESC
$$;


--
-- Name: backfill_valuations(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.backfill_valuations(p_account integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  ref_day DATE; ref_balance NUMERIC; first_tx DATE; n INT;
BEGIN
  SELECT day, balance INTO ref_day, ref_balance FROM valuations
   WHERE account_id = p_account AND NOT estimated ORDER BY day DESC LIMIT 1;
  SELECT min(booked_on) INTO first_tx FROM transactions WHERE account_id = p_account;
  IF ref_day IS NULL OR first_tx IS NULL THEN RETURN 0; END IF;

  INSERT INTO valuations (account_id, day, balance, estimated)
  SELECT p_account, d::date,
         ref_balance - COALESCE((SELECT sum(amount) FROM transactions
                                  WHERE account_id = p_account AND booked_on > d::date AND booked_on <= ref_day), 0),
         TRUE
  FROM generate_series(first_tx - 1, ref_day - 1, interval '1 day') d
  ON CONFLICT (account_id, day) DO UPDATE SET balance = EXCLUDED.balance
    WHERE valuations.estimated;          -- ne jamais écraser un solde réel
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;


--
-- Name: balance_forecast(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.balance_forecast(p_person integer) RETURNS TABLE(account_id integer, name text, balance numeric, upcoming numeric, daily_rate numeric, days_left integer, projected numeric, ends date, incoming numeric, joint boolean, next_pay date)
    LANGUAGE sql STABLE
    AS $$
  WITH b AS (SELECT (cycle_bounds(budget_cycle(current_date))).*),
  acc AS (
    SELECT a.id, a.name, w.w,
           (SELECT balance FROM valuations v WHERE v.account_id = a.id AND NOT v.estimated ORDER BY day DESC LIMIT 1) AS bal,
           (SELECT count(*) FROM account_holders h WHERE h.account_id = a.id) > 1 AS joint
    FROM account_weights(p_person) w JOIN accounts a ON a.id = w.account_id WHERE a.type = 'courant'
  ),
  pp AS (SELECT * FROM pay_profile()),
  hz AS (
    SELECT acc.id AS account_id,
           (SELECT max(pp.next_date) FROM pp JOIN account_holders h ON h.person_id = pp.person_id
            WHERE h.account_id = acc.id) AS pay
    FROM acc
  ),
  lim AS (SELECT acc.id AS account_id, COALESCE(hz.pay - 1, (SELECT ends FROM b)) AS ends, hz.pay AS next_pay
          FROM acc JOIN hz ON hz.account_id = acc.id),
  rec AS (SELECT * FROM recurring(p_person)),
  daily AS (
    SELECT acc.id AS account_id, d::date AS day, COALESCE(sum(-t.amount) FILTER (WHERE t.id IS NOT NULL), 0) AS spent
    FROM acc CROSS JOIN LATERAL generate_series(
           GREATEST(current_date - 90, (SELECT min(x.booked_on) FROM transactions x WHERE x.account_id = acc.id)),
           current_date - 1, '1 day') d
    LEFT JOIN transactions t ON t.account_id = acc.id AND t.booked_on = d::date AND t.amount < 0
         AND t.category IN (SELECT code FROM categories WHERE kind = 'variable')
         AND merchant_group(t.label) NOT IN (SELECT grp FROM rec WHERE rec.account_id = acc.id)
    GROUP BY acc.id, d
  ),
  rate AS (SELECT acc.id, avg(daily.spent) AS r FROM acc LEFT JOIN daily ON daily.account_id = acc.id GROUP BY acc.id),
  inc AS (
    SELECT acc.id AS account_id,
           COALESCE((SELECT sum(e.amount) FROM expected_transfers_in(acc.id) e
                     WHERE e.next_date <= (SELECT l.ends FROM lim l WHERE l.account_id = acc.id)), 0) AS v
    FROM acc WHERE acc.joint
  ),
  due AS (
    SELECT acc.id AS account_id,
           COALESCE((SELECT sum(r.last_amount) FROM rec r
                     WHERE r.account_id = acc.id AND r.next_date > current_date
                       AND r.next_date <= (SELECT l.ends FROM lim l WHERE l.account_id = acc.id)), 0) AS v
    FROM acc
  )
  SELECT acc.id, acc.name, round(acc.bal * acc.w, 2), round(due.v, 2), round(COALESCE(rate.r, 0) * acc.w, 2),
         (lim.ends - current_date)::int,
         round(acc.bal * acc.w + COALESCE(inc.v, 0) * acc.w - due.v
               - COALESCE(rate.r, 0) * acc.w * GREATEST(lim.ends - current_date, 0), 2),
         lim.ends, round(COALESCE(inc.v, 0) * acc.w, 2), acc.joint, lim.next_pay
  FROM acc JOIN lim ON lim.account_id = acc.id LEFT JOIN rate ON rate.id = acc.id
       LEFT JOIN inc ON inc.account_id = acc.id LEFT JOIN due ON due.account_id = acc.id
$$;


--
-- Name: budget_cycle(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.budget_cycle(d date) RETURNS date
    LANGUAGE sql STABLE
    AS $$
  SELECT date_trunc('month', d + interval '1 month' - make_interval(days => s.value::int - 1))::date
  FROM settings s WHERE s.key = 'cycle_start_day' AND s.value > 1
  UNION ALL SELECT date_trunc('month', d)::date
  WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'cycle_start_day' AND value > 1)
$$;


--
-- Name: budget_monthly(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.budget_monthly(p_person integer) RETURNS TABLE(cycle date, starts date, ends date, complete boolean, income numeric, fixed numeric, variable numeric, internal_net numeric, savings numeric, available numeric)
    LANGUAGE sql STABLE
    AS $$
  WITH scope AS (
    SELECT EXISTS (SELECT 1 FROM account_holders GROUP BY account_id HAVING count(*) > 1) AS joint_tracked,
           NOT EXISTS (SELECT 1 FROM persons p WHERE NOT EXISTS
                         (SELECT 1 FROM account_holders h WHERE h.person_id = p.id)) AS all_tracked,
           (SELECT max(f) FROM (SELECT min(t.booked_on) AS f FROM transactions t
                                JOIN account_weights(p_person) w USING (account_id) GROUP BY t.account_id) x) AS first_day
  ),
  x AS (
    SELECT budget_cycle(t.booked_on) AS cycle, c.kind, t.amount * w.w AS amt, t.label AS lbl
    FROM transactions t
    JOIN account_weights(p_person) w USING (account_id)
    JOIN categories c ON c.code = t.category
  ),
  m AS (
    SELECT cycle,
      -- foyer (compte commun) : les contributions des membres sont ses revenus
      COALESCE(sum(amt) FILTER (WHERE kind = 'income'
               OR (p_person = -1 AND kind = 'internal' AND amt > 0 AND lbl ~* member_re())), 0) AS income,
      COALESCE(-sum(amt) FILTER (WHERE kind = 'fixed'
               OR (kind = 'household' AND (p_person IS NOT NULL OR NOT s.joint_tracked))), 0) AS fixed,
      COALESCE(-sum(amt) FILTER (WHERE kind = 'variable'), 0) AS variable,
      COALESCE(sum(amt) FILTER (WHERE kind = 'internal' AND (p_person IS NOT NULL OR NOT s.all_tracked)
               AND NOT (p_person = -1 AND amt > 0 AND lbl ~* member_re())), 0) AS internal_net,
      COALESCE(-sum(amt) FILTER (WHERE kind = 'savings'), 0) AS savings
    FROM x, scope s GROUP BY cycle
  )
  SELECT m.cycle, b.starts, b.ends,
         b.ends < current_date AND b.starts >= s.first_day - 3,   -- cycle entièrement couvert par les données
         round(income,2), round(fixed,2), round(variable,2), round(internal_net,2), round(savings,2),
         round(income + internal_net - fixed - variable, 2)
  FROM m, scope s, LATERAL cycle_bounds(m.cycle) b ORDER BY m.cycle
$$;


--
-- Name: caps_status(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.caps_status(p_person integer) RETURNS TABLE(category text, label text, monthly numeric, alert_pct integer, spent numeric, pct numeric, projected numeric)
    LANGUAGE sql STABLE
    AS $$
  WITH cur AS (SELECT budget_cycle(current_date) AS cycle),
  b AS (SELECT (cycle_bounds(cycle)).* FROM cur),
  f AS (SELECT (current_date - b.starts + 1)::numeric / (b.ends - b.starts + 1) AS frac FROM b)
  SELECT k.category, c.label, round(k.monthly * COALESCE(sw.share, 1), 2), k.alert_pct,
         round(COALESCE(-sum(t.amount * w.w), 0), 2),
         round(100 * COALESCE(-sum(t.amount * w.w), 0) / (k.monthly * COALESCE(sw.share, 1)), 0),
         round(COALESCE(-sum(t.amount * w.w), 0) / GREATEST((SELECT frac FROM f), 0.1), 2)
  FROM category_caps k JOIN categories c ON c.code = k.category
  LEFT JOIN (SELECT 1::numeric AS share WHERE p_person IS NULL) sw ON true
  LEFT JOIN transactions t ON t.category = k.category AND budget_cycle(t.booked_on) = (SELECT cycle FROM cur)
  LEFT JOIN account_weights(p_person) w ON w.account_id = t.account_id
  WHERE t.id IS NULL OR w.account_id IS NOT NULL
  GROUP BY k.category, c.label, k.monthly, k.alert_pct, sw.share
  ORDER BY 6 DESC
$$;


--
-- Name: categorize(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.categorize(p_force boolean DEFAULT false) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE n INT;
BEGIN
  UPDATE transactions t SET category = m.category, category_source = 'rule'
  FROM (
    SELECT DISTINCT ON (t2.id) t2.id, r.category
    FROM transactions t2
    JOIN category_rules r ON COALESCE(t2.label,'') ~* r.pattern
     AND (r.direction = 'any' OR (r.direction = 'in') = (t2.amount > 0))
    WHERE t2.category_source IS DISTINCT FROM 'manual' AND (p_force OR t2.category IS NULL)
    ORDER BY t2.id, r.priority, r.id
  ) m
  WHERE t.id = m.id AND t.category IS DISTINCT FROM m.category;
  GET DIAGNOSTICS n = ROW_COUNT;
  n := n + neutralize_roundtrips();
  PERFORM refresh_cycle_start();
  RETURN n;
END $$;


--
-- Name: current_cycle(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_cycle(p_person integer) RETURNS TABLE(cycle date, starts date, ends date, day_index integer, days integer, days_left integer, spent numeric, income numeric, typical_to_date numeric, typical_total numeric)
    LANGUAGE sql STABLE
    AS $$
  WITH cur AS (SELECT budget_cycle(current_date) AS cycle),
  b AS (SELECT cur.cycle, (cycle_bounds(cur.cycle)).* FROM cur),
  x AS (
    SELECT budget_cycle(t.booked_on) AS cycle, t.booked_on - (cycle_bounds(budget_cycle(t.booked_on))).starts AS d,
           c.kind, t.amount * w.w AS amt
    FROM transactions t JOIN account_weights(p_person) w USING (account_id) JOIN categories c ON c.code = t.category
  ),
  spend AS (  -- dépenses réelles : fixes + variables + contribution au commun (vue personne ou commun non suivi)
    SELECT cycle, d, -amt AS amt FROM x WHERE kind IN ('fixed', 'variable', 'household')
  ),
  past AS (SELECT m.cycle FROM budget_monthly(p_person) m WHERE m.complete ORDER BY m.cycle DESC LIMIT 3)
  SELECT b.cycle, b.starts, b.ends, (current_date - b.starts + 1)::int, (b.ends - b.starts + 1)::int, (b.ends - current_date)::int,
         round(COALESCE((SELECT sum(amt) FROM spend WHERE spend.cycle = b.cycle), 0), 2),
         round(COALESCE((SELECT sum(amt) FROM x WHERE x.cycle = b.cycle AND kind = 'income'), 0), 2),
         round((SELECT sum(amt) FROM spend WHERE spend.cycle IN (SELECT cycle FROM past) AND d <= current_date - b.starts)
               / NULLIF((SELECT count(*) FROM past), 0), 2),
         round((SELECT sum(amt) FROM spend WHERE spend.cycle IN (SELECT cycle FROM past)) / NULLIF((SELECT count(*) FROM past), 0), 2)
  FROM b
$$;


--
-- Name: cycle_bounds(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cycle_bounds(p_cycle date, OUT starts date, OUT ends date) RETURNS record
    LANGUAGE sql STABLE
    AS $$
  SELECT CASE WHEN s.value > 1 THEN (p_cycle - interval '1 month')::date + (s.value::int - 1) ELSE p_cycle END,
         CASE WHEN s.value > 1 THEN p_cycle + (s.value::int - 2) ELSE (p_cycle + interval '1 month')::date - 1 END
  FROM settings s WHERE s.key = 'cycle_start_day'
$$;


--
-- Name: detect_anomalies(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_anomalies(p_since timestamp with time zone) RETURNS TABLE(tx_id bigint, reason text, reference numeric)
    LANGUAGE sql STABLE
    AS $$
  SELECT t.id,
         CASE WHEN m.n >= 3 THEN 'marchand' ELSE 'categorie' END,
         round((CASE WHEN m.n >= 3 THEN m.med ELSE k.p90 END)::numeric, 2)
  FROM transactions t
  LEFT JOIN LATERAL (SELECT count(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY -o.amount) AS med
                     FROM transactions o WHERE o.amount < 0 AND o.id <> t.id AND o.booked_on < t.booked_on
                       AND merchant_group(o.label) = merchant_group(t.label)) m ON true
  LEFT JOIN LATERAL (SELECT count(*) AS n, percentile_cont(0.9) WITHIN GROUP (ORDER BY -o.amount) AS p90
                     FROM transactions o WHERE o.amount < 0 AND o.id <> t.id AND o.booked_on < t.booked_on
                       AND o.category = t.category) k ON true
  JOIN categories c ON c.code = t.category
  WHERE t.inserted_at >= p_since AND t.amount <= -50 AND c.kind = 'variable'
    AND t.booked_on >= current_date - 7                     -- jamais d'alerte sur un import d'historique
    AND ((m.n >= 3 AND -t.amount > 3 * m.med) OR (m.n < 3 AND k.n >= 10 AND -t.amount > 2 * k.p90))
$$;


--
-- Name: detect_cycle_start(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_cycle_start() RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  SELECT GREATEST(1, min(extract(day FROM t.booked_on))::int - 2)
  FROM transactions t
  WHERE t.category = 'salaire' AND t.amount > 0 AND t.booked_on > current_date - 190
  HAVING count(*) >= 2
$$;


--
-- Name: envelope_allows(public.account_type, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.envelope_allows(p_type public.account_type, p_exposure text, p_pea_eligible boolean) RETURNS TABLE(allowed boolean, reason text)
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN p_type = 'pea' THEN p_pea_eligible
    WHEN p_type IN ('assurance_vie','per') THEN p_exposure NOT IN ('crypto','liquidites')
    WHEN p_type = 'cto' THEN p_exposure NOT IN ('fonds_euro','liquidites')
    WHEN p_type IN ('livret','courant') THEN p_exposure = 'liquidites'
    ELSE FALSE END,
  CASE
    WHEN p_type = 'pea' AND NOT p_pea_eligible THEN 'PEA : uniquement des titres éligibles (actions UE ou ETF éligibles PEA)'
    WHEN p_type IN ('assurance_vie','per') AND p_exposure IN ('crypto','liquidites') THEN 'Non proposé en assurance-vie / PER'
    WHEN p_type = 'cto' AND p_exposure = 'fonds_euro' THEN 'Le fonds euros n''existe qu''en assurance-vie / PER'
    WHEN p_type IN ('livret','courant') AND p_exposure <> 'liquidites' THEN 'Un livret ou un compte courant ne détient que des liquidités'
    ELSE NULL END
$$;


--
-- Name: expected_transfers_in(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expected_transfers_in(p_account integer) RETURNS TABLE(who text, amount numeric, usual_day integer, next_date date)
    LANGUAGE sql STABLE
    AS $$
  WITH t AS (
    SELECT CASE WHEN t.label ~* 'SAM' THEN 'SAM' WHEN t.label ~* 'ALEX' THEN 'ALEX' END AS who,
           t.booked_on, t.amount
    FROM transactions t JOIN categories c ON c.code = t.category
    WHERE t.account_id = p_account AND t.amount >= 50 AND c.kind = 'internal' AND t.label ~* member_re()
      AND t.booked_on > current_date - 190
  ),
  g AS (
    SELECT who, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(day FROM booked_on)))::int AS day,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS amt
    FROM t WHERE who IS NOT NULL GROUP BY who
    HAVING count(DISTINCT date_trunc('month', booked_on)) >= 3
  )
  SELECT g.who, round(g.amt::numeric, 2), g.day, next_monthly_date(g.day, FALSE) FROM g
$$;


--
-- Name: goals_plan(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.goals_plan() RETURNS TABLE(id integer, target numeric, current numeric, remaining numeric, months_left numeric, monthly_needed numeric, pace_monthly numeric, projected numeric, progress_pct numeric)
    LANGUAGE sql STABLE
    AS $$
  WITH t AS (SELECT g.id, COALESCE(sum(i.amount), 0) AS target FROM goals g LEFT JOIN goal_items i ON i.goal_id = g.id GROUP BY g.id),
  bal AS (
    SELECT ga.goal_id,
           sum(ga.share * (SELECT balance FROM valuations v WHERE v.account_id = ga.account_id AND NOT v.estimated ORDER BY day DESC LIMIT 1)) AS now_val,
           sum(ga.share * (SELECT balance FROM valuations v WHERE v.account_id = ga.account_id AND v.day <= current_date - 90 ORDER BY day DESC LIMIT 1)) AS then_val
    FROM goal_accounts ga GROUP BY ga.goal_id
  ),
  x AS (
    SELECT g.id, t.target, g.initial + COALESCE(b.now_val, 0) AS current,
           GREATEST((g.target_date - current_date) / 30.44, 0) AS months_left,
           CASE WHEN b.then_val IS NOT NULL THEN (b.now_val - b.then_val) / 3 END AS pace
    FROM goals g JOIN t USING (id) LEFT JOIN bal b ON b.goal_id = g.id
  )
  SELECT id, round(target, 2), round(current, 2), round(GREATEST(target - current, 0), 2), round(months_left, 1),
         round(CASE WHEN months_left > 0 THEN GREATEST(target - current, 0) / months_left END, 2),
         round(pace, 2),
         round(current + COALESCE(pace, 0) * months_left, 2),
         round(CASE WHEN target > 0 THEN LEAST(100 * current / target, 100) ELSE 0 END, 1)
  FROM x
$$;


--
-- Name: holdings(integer, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.holdings(p_person integer, p_day date DEFAULT CURRENT_DATE) RETURNS TABLE(account_id integer, account text, account_type public.account_type, asset_id integer, asset text, isin text, exposure text, pea_eligible boolean, quantity numeric, pru numeric, invested numeric, price numeric, price_day date, value numeric, gain numeric, gain_pct numeric, dividends numeric)
    LANGUAGE sql STABLE
    AS $$
  WITH t AS (
    SELECT tr.account_id, tr.asset_id,
           sum(CASE tr.kind WHEN 'achat' THEN tr.quantity WHEN 'vente' THEN -tr.quantity ELSE 0 END) AS qty,
           sum(tr.quantity * tr.price + tr.fees) FILTER (WHERE tr.kind = 'achat') AS buy_cost,
           sum(tr.quantity) FILTER (WHERE tr.kind = 'achat') AS buy_qty,
           COALESCE(sum(tr.quantity * tr.price) FILTER (WHERE tr.kind = 'dividende'), 0) AS divs
    FROM trades tr WHERE tr.day <= p_day GROUP BY 1, 2
  )
  SELECT a.id, a.name, a.type, s.id, s.name, s.isin, s.exposure, s.pea_eligible,
         t.qty * w.w,
         round(t.buy_cost / NULLIF(t.buy_qty, 0), 4),
         round(t.qty * t.buy_cost / NULLIF(t.buy_qty, 0) * w.w, 2),
         px.close, px.day,
         round(t.qty * px.close * w.w, 2),
         round((t.qty * px.close - t.qty * t.buy_cost / NULLIF(t.buy_qty, 0)) * w.w, 2),
         round(100 * (px.close / NULLIF(t.buy_cost / NULLIF(t.buy_qty, 0), 0) - 1), 2),
         round(t.divs * w.w, 2)
  FROM t JOIN account_weights(p_person) w ON w.account_id = t.account_id
  JOIN accounts a ON a.id = t.account_id JOIN assets s ON s.id = t.asset_id
  LEFT JOIN LATERAL (SELECT close, day FROM price_history WHERE asset_id = s.id AND day <= p_day ORDER BY day DESC LIMIT 1) px ON true
  WHERE t.qty <> 0
$$;


--
-- Name: household_split(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.household_split() RETURNS TABLE(person_id integer, name text, tracked boolean, income numeric, contribution numeric)
    LANGUAGE sql STABLE
    AS $$
  WITH cyc AS (SELECT cycle FROM budget_monthly(NULL) WHERE complete ORDER BY cycle DESC LIMIT 3),
  n AS (SELECT GREATEST(count(*), 1) AS n FROM cyc)
  SELECT p.id, p.name, EXISTS (SELECT 1 FROM account_holders h WHERE h.person_id = p.id),
         round(COALESCE(sum(t.amount * h.share) FILTER (WHERE c.kind = 'income'), 0) / (SELECT n FROM n), 2),
         round(COALESCE(-sum(t.amount * h.share) FILTER (WHERE c.kind = 'household'), 0) / (SELECT n FROM n), 2)
  FROM persons p
  LEFT JOIN account_holders h ON h.person_id = p.id
  LEFT JOIN transactions t ON t.account_id = h.account_id AND budget_cycle(t.booked_on) IN (SELECT cycle FROM cyc)
       -- seuls les comptes personnels (un seul titulaire) : les flux du compte joint ne sont pas des versements
       AND (SELECT count(*) FROM account_holders h2 WHERE h2.account_id = h.account_id) = 1
  LEFT JOIN categories c ON c.code = t.category
  GROUP BY p.id ORDER BY p.id
$$;


--
-- Name: macro_indicators(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.macro_indicators() RETURNS TABLE(code text, label text, day date, value numeric, unit text)
    LANGUAGE sql STABLE
    AS $$
  SELECT s.code, s.label, l.day, round(l.value, 2), s.unit
  FROM market_series s
  JOIN LATERAL (SELECT day, value FROM market_points WHERE code = s.code ORDER BY day DESC LIMIT 1) l ON true
  WHERE s.kind = 'taux'
  UNION ALL
  SELECT 'inflation_fr', 'Inflation France (IPCH, sur 1 an)', l.day,
         round(100 * (l.value / y.value - 1), 2), '%'
  FROM (SELECT day, value FROM market_points WHERE code = 'hicp_fr' ORDER BY day DESC LIMIT 1) l
  JOIN LATERAL (SELECT value FROM market_points WHERE code = 'hicp_fr' AND day <= l.day - 360 ORDER BY day DESC LIMIT 1) y ON true
$$;


--
-- Name: market_signals(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.market_signals() RETURNS TABLE(code text, label text, last_day date, last numeric, ma50 numeric, ma200 numeric, vs_ma200_pct numeric, drawdown_pct numeric, perf_3m_pct numeric, perf_12m_pct numeric, vol_20d_pct numeric, trend text)
    LANGUAGE sql STABLE
    AS $$
  WITH p AS (
    SELECT m.code, m.day, m.value,
           row_number() OVER (PARTITION BY m.code ORDER BY m.day DESC) AS rn,
           ln(m.value / lag(m.value) OVER (PARTITION BY m.code ORDER BY m.day)) AS lr
    FROM market_points m JOIN market_series s ON s.code = m.code AND s.kind = 'indice'
  ),
  agg AS (
    SELECT code,
           max(day) FILTER (WHERE rn = 1) AS last_day,
           max(value) FILTER (WHERE rn = 1) AS last,
           avg(value) FILTER (WHERE rn <= 50) AS ma50,
           avg(value) FILTER (WHERE rn <= 200) AS ma200,
           max(value) FILTER (WHERE rn <= 252) AS hi,
           max(value) FILTER (WHERE rn = 64) AS v3m,
           max(value) FILTER (WHERE rn = 253) AS v12m,
           stddev_samp(lr) FILTER (WHERE rn <= 20) AS sd,
           count(*) AS n
    FROM p GROUP BY code
  )
  SELECT a.code, s.label, a.last_day, round(a.last, 2), round(a.ma50, 2), round(a.ma200, 2),
         round(100 * (a.last / a.ma200 - 1), 2),
         round(100 * (a.last / a.hi - 1), 2),
         round(100 * (a.last / a.v3m - 1), 2),
         round(100 * (a.last / a.v12m - 1), 2),
         round((100 * a.sd * sqrt(252))::numeric, 2),
         CASE WHEN a.n < 200 THEN 'historique insuffisant'
              WHEN a.last > a.ma200 AND a.ma50 > a.ma200 THEN 'haussière'
              WHEN a.last < a.ma200 AND a.ma50 < a.ma200 THEN 'baissière'
              ELSE 'indécise' END
  FROM agg a JOIN market_series s USING (code)
  ORDER BY s.code
$$;


--
-- Name: member_re(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.member_re() RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT '^VIR.*(SAM|ALEX)'
$$;


--
-- Name: merchant_group(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merchant_group(label text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT left(regexp_replace(upper(merchant_of(label)), '[^A-Z]', '', 'g'), 6)
$$;


--
-- Name: merchant_of(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merchant_of(label text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT NULLIF(trim(regexp_replace(
           regexp_replace(COALESCE(label, ''),
             '^(\*COM CB INT|\*COM RT INT|PAIEMENT(\s+(PSC|CB))?(\s+\d{4})?|CB|PRLV SEPA|PRLV|VIR SEPA|VIR INST|VIR|\*)\s+', '', 'i'),
           '\s+FACT\s.*|\s+CARTE\s+\d+.*|\s\d{6,}.*|\s\d{2}-\d{2}-.*|\s\d{5}\s.*', '', 'i')), '')
$$;


--
-- Name: neutralize_roundtrips(integer, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.neutralize_roundtrips(p_days integer DEFAULT 3, p_min numeric DEFAULT 50) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE n INT;
BEGIN
  WITH cand AS (
    SELECT t.id, t.account_id, t.booked_on, t.amount
    FROM transactions t JOIN categories c ON c.code = t.category
    WHERE t.category_source IS DISTINCT FROM 'manual'
      AND abs(t.amount) >= p_min AND c.kind IN ('income', 'variable')
      AND COALESCE(t.label, '') ~* '^(VIR|TRANSFERT)'
  ),
  best AS (   -- pour chaque débit, le crédit de même montant le plus proche dans le temps
    SELECT DISTINCT ON (o.id) o.id AS out_id, i.id AS in_id
    FROM cand o JOIN cand i ON i.account_id = o.account_id AND i.amount = -o.amount AND i.amount > 0
                           AND abs(i.booked_on - o.booked_on) <= p_days
    WHERE o.amount < 0
    ORDER BY o.id, abs(i.booked_on - o.booked_on), i.id
  ),
  uniq AS (   -- un crédit ne sert qu'une fois
    SELECT DISTINCT ON (in_id) out_id, in_id FROM best ORDER BY in_id, out_id
  )
  UPDATE transactions t SET category = 'virement_interne', category_source = 'rule'
  WHERE t.id IN (SELECT out_id FROM uniq UNION SELECT in_id FROM uniq)
    AND t.category IS DISTINCT FROM 'virement_interne';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;


--
-- Name: next_monthly_date(integer, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_monthly_date(p_day integer, p_shift_weekend boolean DEFAULT false) RETURNS date
    LANGUAGE sql STABLE
    AS $$
  SELECT x.d FROM (
    SELECT CASE WHEN p_shift_weekend
                THEN m.raw - CASE extract(isodow FROM m.raw)::int WHEN 6 THEN 1 WHEN 7 THEN 2 ELSE 0 END
                ELSE m.raw END AS d
    FROM (SELECT (date_trunc('month', current_date) + make_interval(months => k))::date
                 + (LEAST(p_day, extract(day FROM (date_trunc('month', current_date) + make_interval(months => k + 1)
                                                   - interval '1 day'))::int) - 1) AS raw
          FROM generate_series(0, 2) k) m
  ) x WHERE x.d > current_date ORDER BY x.d LIMIT 1
$$;


--
-- Name: pay_profile(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_profile() RETURNS TABLE(person_id integer, name text, n integer, last_date date, last_amount numeric, avg_amount numeric, usual_day integer, next_date date)
    LANGUAGE sql STABLE
    AS $$
  WITH s AS (
    SELECT h.person_id, t.booked_on, t.amount
    FROM transactions t JOIN account_holders h ON h.account_id = t.account_id
    WHERE t.category = 'salaire' AND t.amount > 0 AND t.booked_on > current_date - 190
      AND (SELECT count(*) FROM account_holders h2 WHERE h2.account_id = h.account_id) = 1
  ),
  a AS (
    SELECT s.person_id, count(*)::int AS n, max(s.booked_on) AS last_date,
           (array_agg(s.amount ORDER BY s.booked_on DESC))[1] AS last_amount,
           avg(s.amount) FILTER (WHERE s.booked_on > current_date - 100) AS avg_amount,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(day FROM s.booked_on)))::int AS usual_day
    FROM s GROUP BY s.person_id
  )
  SELECT a.person_id, p.name, a.n, a.last_date, a.last_amount, round(COALESCE(a.avg_amount, a.last_amount), 2),
         a.usual_day, next_monthly_date(a.usual_day, TRUE)
  FROM a JOIN persons p ON p.id = a.person_id ORDER BY a.person_id
$$;


--
-- Name: portfolio_history(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portfolio_history(p_person integer, p_days integer DEFAULT 365) RETURNS TABLE(day date, value numeric, invested numeric)
    LANGUAGE sql STABLE
    AS $$
  SELECT d::date,
         round(COALESCE(sum(h.value), 0), 2),
         round(COALESCE(sum(h.invested), 0), 2)
  FROM generate_series(GREATEST(current_date - p_days, (SELECT COALESCE(min(day), current_date) FROM trades)),
                       current_date, '1 day') d
  LEFT JOIN LATERAL holdings(p_person, d::date) h ON true
  GROUP BY d ORDER BY d
$$;


--
-- Name: price_at(integer, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.price_at(p_asset integer, p_day date) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
  SELECT close FROM price_history WHERE asset_id = p_asset AND day <= p_day ORDER BY day DESC LIMIT 1
$$;


--
-- Name: recurring(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recurring(p_person integer, p_account integer DEFAULT NULL::integer) RETURNS TABLE(grp text, merchant text, category text, category_label text, occurrences integer, avg_amount numeric, last_amount numeric, prev_amount numeric, first_date date, last_date date, interval_days integer, next_date date, is_new boolean, price_change numeric, account_id integer, account text)
    LANGUAGE sql STABLE
    AS $$
  WITH t AS (
    SELECT merchant_group(t.label) AS grp, t.merchant, t.category, t.booked_on, -t.amount * w.w AS amt,
           budget_cycle(t.booked_on) AS cycle, t.account_id
    FROM transactions t JOIN account_weights(p_person) w USING (account_id)
    JOIN categories c ON c.code = t.category
    WHERE t.amount < 0 AND c.kind IN ('fixed', 'variable') AND t.booked_on > current_date - 400
  ),
  g AS (
    SELECT grp, category, count(*) AS n, count(DISTINCT cycle) AS cycles, avg(amt) AS avg_amt,
           COALESCE(stddev_samp(amt), 0) / NULLIF(avg(amt), 0) AS cv,
           min(booked_on) AS first_date, max(booked_on) AS last_date,
           (array_agg(amt ORDER BY booked_on DESC))[1] AS last_amt,
           (array_agg(amt ORDER BY booked_on DESC))[2] AS prev_amt,
           (array_agg(merchant ORDER BY booked_on DESC))[1] AS merchant,
           (array_agg(account_id ORDER BY booked_on DESC))[1] AS account_id
    FROM t WHERE grp <> '' GROUP BY grp, category
  ),
  gaps AS (
    SELECT grp, category, percentile_cont(0.5) WITHIN GROUP (ORDER BY gap) AS med_gap
    FROM (SELECT grp, category, booked_on - lag(booked_on) OVER (PARTITION BY grp, category ORDER BY booked_on) AS gap FROM t) x
    WHERE gap IS NOT NULL GROUP BY grp, category
  )
  SELECT g.grp, g.merchant, g.category, c.label, g.n::int, round(g.avg_amt, 2), round(g.last_amt, 2), round(g.prev_amt, 2),
         g.first_date, g.last_date, round(gp.med_gap)::int, g.last_date + round(gp.med_gap)::int,
         -- nouveau = vu pour la première fois il y a moins de 45 jours ALORS QUE le compte existait déjà depuis plus de 45 jours
         -- (sur un compte récent, tout est « nouveau » : ce n'est pas un nouvel abonnement)
         g.first_date > current_date - 45
           AND g.first_date > (SELECT min(x.booked_on) FROM transactions x WHERE x.account_id = g.account_id) + 45,
         CASE WHEN g.prev_amt > 0 AND abs(g.last_amt - g.prev_amt) >= 0.5 THEN round(g.last_amt - g.prev_amt, 2) END,
         g.account_id, a.name
  FROM g JOIN gaps gp USING (grp, category) JOIN categories c ON c.code = g.category
       JOIN accounts a ON a.id = g.account_id
  WHERE g.cycles >= 2 AND g.n = g.cycles AND g.cv < 0.2 AND gp.med_gap BETWEEN 25 AND 35
    AND (p_account IS NULL OR g.account_id = p_account)
  ORDER BY g.avg_amt DESC
$$;


--
-- Name: refresh_cycle_start(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_cycle_start() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE d INT;
BEGIN
  IF (SELECT value FROM settings WHERE key = 'cycle_auto') = 1 THEN
    d := detect_cycle_start();
    IF d IS NOT NULL THEN
      UPDATE settings SET value = d WHERE key = 'cycle_start_day' AND value <> d;
    END IF;
  END IF;
  RETURN (SELECT value::int FROM settings WHERE key = 'cycle_start_day');
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account_fees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_fees (
    account_id integer NOT NULL,
    mgmt_pct numeric(5,3) DEFAULT 0 NOT NULL,
    entry_pct numeric(5,3) DEFAULT 0 NOT NULL,
    switch_pct numeric(5,3) DEFAULT 0 NOT NULL,
    switch_eur numeric(10,2) DEFAULT 0 NOT NULL,
    switches_per_year numeric(5,1) DEFAULT 0 NOT NULL,
    switch_amount_eur numeric(14,2),
    custody_eur numeric(10,2) DEFAULT 0 NOT NULL,
    monthly_contribution numeric(12,2),
    note text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_fees_custody_eur_check CHECK ((custody_eur >= (0)::numeric)),
    CONSTRAINT account_fees_entry_pct_check CHECK (((entry_pct >= (0)::numeric) AND (entry_pct <= (10)::numeric))),
    CONSTRAINT account_fees_mgmt_pct_check CHECK (((mgmt_pct >= (0)::numeric) AND (mgmt_pct <= (10)::numeric))),
    CONSTRAINT account_fees_monthly_contribution_check CHECK ((monthly_contribution >= (0)::numeric)),
    CONSTRAINT account_fees_switch_amount_eur_check CHECK ((switch_amount_eur >= (0)::numeric)),
    CONSTRAINT account_fees_switch_eur_check CHECK ((switch_eur >= (0)::numeric)),
    CONSTRAINT account_fees_switch_pct_check CHECK (((switch_pct >= (0)::numeric) AND (switch_pct <= (10)::numeric))),
    CONSTRAINT account_fees_switches_per_year_check CHECK ((switches_per_year >= (0)::numeric))
);


--
-- Name: account_holders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_holders (
    account_id integer NOT NULL,
    person_id integer NOT NULL,
    share numeric(4,3) DEFAULT 1 NOT NULL,
    CONSTRAINT account_holders_share_check CHECK (((share > (0)::numeric) AND (share <= (1)::numeric)))
);


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id integer NOT NULL,
    external_id text,
    source text DEFAULT 'enablebanking'::text NOT NULL,
    institution text,
    name text NOT NULL,
    type public.account_type NOT NULL,
    currency character(3) DEFAULT 'EUR'::bpchar NOT NULL,
    opened_on date,
    active boolean DEFAULT true NOT NULL,
    last_sync_at timestamp with time zone,
    savings_kind text,
    name_locked boolean DEFAULT false NOT NULL,
    CONSTRAINT accounts_savings_kind_check CHECK ((savings_kind = ANY (ARRAY['livret_a'::text, 'ldds'::text, 'lep'::text, 'autre'::text])))
);


--
-- Name: accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.accounts_id_seq OWNED BY public.accounts.id;


--
-- Name: advisor_context; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.advisor_context (
    id integer NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT advisor_context_id_check CHECK ((id = 1))
);


--
-- Name: advisor_docs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.advisor_docs (
    kind text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: advisor_savings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.advisor_savings (
    id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    model text NOT NULL,
    payload jsonb NOT NULL,
    inputs jsonb NOT NULL,
    usage jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: advisor_savings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.advisor_savings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: advisor_savings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.advisor_savings_id_seq OWNED BY public.advisor_savings.id;


--
-- Name: alert_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_events (
    id bigint NOT NULL,
    rule_id integer,
    account_id integer NOT NULL,
    balance numeric(14,2) NOT NULL,
    threshold numeric(14,2) NOT NULL,
    fired_at timestamp with time zone DEFAULT now() NOT NULL,
    notified boolean DEFAULT false NOT NULL,
    read_at timestamp with time zone
);


--
-- Name: alert_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alert_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: alert_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alert_events_id_seq OWNED BY public.alert_events.id;


--
-- Name: alert_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_rules (
    id integer NOT NULL,
    account_id integer,
    account_type public.account_type,
    threshold numeric(14,2) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT alert_rules_check CHECK (((account_id IS NULL) <> (account_type IS NULL)))
);


--
-- Name: alert_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alert_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: alert_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alert_rules_id_seq OWNED BY public.alert_rules.id;


--
-- Name: alert_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_state (
    rule_id integer NOT NULL,
    account_id integer NOT NULL,
    below boolean NOT NULL
);


--
-- Name: allocation_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.allocation_snapshot (
    day date NOT NULL,
    asset_class public.asset_class NOT NULL,
    value numeric(14,2) NOT NULL,
    pct numeric(5,2) NOT NULL,
    drift_pct numeric(6,2)
);


--
-- Name: allocation_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.allocation_targets (
    exposure text NOT NULL,
    target_pct numeric(5,2) NOT NULL,
    band_pct numeric(5,2) DEFAULT 5 NOT NULL,
    CONSTRAINT allocation_targets_target_pct_check CHECK (((target_pct >= (0)::numeric) AND (target_pct <= (100)::numeric)))
);


--
-- Name: anomalies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.anomalies (
    tx_id bigint NOT NULL,
    reason text NOT NULL,
    reference numeric(14,2),
    notified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: api_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_usage (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    purpose text NOT NULL,
    model text NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    cache_read integer DEFAULT 0 NOT NULL,
    cache_write integer DEFAULT 0 NOT NULL,
    web_searches integer DEFAULT 0 NOT NULL,
    cost_usd numeric(10,4) NOT NULL
);


--
-- Name: api_usage_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.api_usage_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: api_usage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.api_usage_id_seq OWNED BY public.api_usage.id;


--
-- Name: assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assets (
    id integer NOT NULL,
    isin text,
    ticker text,
    name text NOT NULL,
    asset_class public.asset_class NOT NULL,
    currency character(3) DEFAULT 'EUR'::bpchar NOT NULL,
    exposure text DEFAULT 'autre'::text NOT NULL,
    pea_eligible boolean DEFAULT false NOT NULL,
    data_symbol text,
    ter numeric(5,3),
    CONSTRAINT assets_exposure_check CHECK ((exposure = ANY (ARRAY['actions_monde'::text, 'actions_europe'::text, 'actions_usa'::text, 'actions_emergents'::text, 'obligations'::text, 'fonds_euro'::text, 'monetaire'::text, 'or'::text, 'immobilier'::text, 'crypto'::text, 'liquidites'::text, 'autre'::text])))
);


--
-- Name: assets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.assets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: assets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.assets_id_seq OWNED BY public.assets.id;


--
-- Name: bank_auth_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_auth_states (
    state_hash text NOT NULL,
    bank text NOT NULL,
    country character(2) NOT NULL,
    holders jsonb DEFAULT '{}'::jsonb NOT NULL,
    renew_of text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:15:00'::interval) NOT NULL,
    used_at timestamp with time zone
);


--
-- Name: bank_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_sessions (
    session_id text NOT NULL,
    bank text NOT NULL,
    country character(2) DEFAULT 'FR'::bpchar NOT NULL,
    valid_until timestamp with time zone NOT NULL,
    accounts jsonb DEFAULT '[]'::jsonb NOT NULL,
    holders jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    source text DEFAULT 'web'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_sync_at timestamp with time zone,
    last_error text,
    expiry_notified_at timestamp with time zone,
    CONSTRAINT bank_sessions_source_check CHECK ((source = ANY (ARRAY['web'::text, 'cli'::text, 'fichier'::text]))),
    CONSTRAINT bank_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'remplacee'::text])))
);


--
-- Name: cap_alert_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cap_alert_state (
    category text NOT NULL,
    cycle date NOT NULL,
    level integer NOT NULL
);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    code text NOT NULL,
    label text NOT NULL,
    kind text NOT NULL,
    CONSTRAINT categories_kind_check CHECK ((kind = ANY (ARRAY['income'::text, 'fixed'::text, 'variable'::text, 'household'::text, 'internal'::text, 'savings'::text])))
);


--
-- Name: category_caps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.category_caps (
    category text NOT NULL,
    monthly numeric(10,2) NOT NULL,
    alert_pct integer DEFAULT 80 NOT NULL,
    CONSTRAINT category_caps_alert_pct_check CHECK (((alert_pct >= 1) AND (alert_pct <= 100))),
    CONSTRAINT category_caps_monthly_check CHECK ((monthly > (0)::numeric))
);


--
-- Name: category_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.category_rules (
    id integer NOT NULL,
    pattern text NOT NULL,
    direction text DEFAULT 'any'::text NOT NULL,
    category text NOT NULL,
    priority integer DEFAULT 50 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT category_rules_direction_check CHECK ((direction = ANY (ARRAY['in'::text, 'out'::text, 'any'::text])))
);


--
-- Name: category_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.category_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: category_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.category_rules_id_seq OWNED BY public.category_rules.id;


--
-- Name: envelope_preference; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.envelope_preference (
    exposure text NOT NULL,
    account_type public.account_type NOT NULL,
    rank integer NOT NULL,
    why text NOT NULL
);


--
-- Name: fee_benchmarks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_benchmarks (
    account_type public.account_type NOT NULL,
    label text NOT NULL,
    mgmt_pct numeric(5,3) DEFAULT 0 NOT NULL,
    entry_pct numeric(5,3) DEFAULT 0 NOT NULL,
    custody_eur numeric(10,2) DEFAULT 0 NOT NULL,
    ter_pct numeric(5,3),
    CONSTRAINT fee_benchmarks_account_type_check CHECK ((account_type = ANY (ARRAY['pea'::public.account_type, 'cto'::public.account_type, 'assurance_vie'::public.account_type, 'per'::public.account_type])))
);


--
-- Name: forecast_alert_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forecast_alert_state (
    account_id integer NOT NULL,
    cycle date NOT NULL
);


--
-- Name: goal_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goal_accounts (
    goal_id integer NOT NULL,
    account_id integer NOT NULL,
    share numeric(4,3) DEFAULT 1 NOT NULL,
    CONSTRAINT goal_accounts_share_check CHECK (((share > (0)::numeric) AND (share <= (1)::numeric)))
);


--
-- Name: goal_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goal_items (
    id integer NOT NULL,
    goal_id integer NOT NULL,
    label text NOT NULL,
    amount numeric(14,2) NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    CONSTRAINT goal_items_amount_check CHECK ((amount >= (0)::numeric))
);


--
-- Name: goal_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.goal_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: goal_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.goal_items_id_seq OWNED BY public.goal_items.id;


--
-- Name: goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goals (
    id integer NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'autre'::text NOT NULL,
    person_id integer,
    target_date date NOT NULL,
    priority integer DEFAULT 1 NOT NULL,
    initial numeric(14,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT goals_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'done'::text])))
);


--
-- Name: goals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.goals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: goals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.goals_id_seq OWNED BY public.goals.id;


--
-- Name: integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integrations (
    kind text NOT NULL,
    last_ok timestamp with time zone,
    detail text
);


--
-- Name: macro_context; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.macro_context (
    month date NOT NULL,
    summary text NOT NULL,
    sources jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: market_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_points (
    code text NOT NULL,
    day date NOT NULL,
    value numeric(18,6) NOT NULL
);


--
-- Name: market_series; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_series (
    code text NOT NULL,
    label text NOT NULL,
    source text NOT NULL,
    symbol text NOT NULL,
    kind text NOT NULL,
    unit text DEFAULT ''::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT market_series_kind_check CHECK ((kind = ANY (ARRAY['indice'::text, 'taux'::text, 'inflation'::text]))),
    CONSTRAINT market_series_source_check CHECK ((source = ANY (ARRAY['twelvedata'::text, 'fred'::text])))
);


--
-- Name: monthly_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monthly_reports (
    month text NOT NULL,
    filename text NOT NULL,
    content bytea NOT NULL,
    size_bytes integer GENERATED ALWAYS AS (octet_length(content)) STORED,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT monthly_reports_month_check CHECK ((month ~ '^[0-9]{4}-[0-9]{2}$'::text))
);


--
-- Name: valuations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.valuations (
    account_id integer NOT NULL,
    day date NOT NULL,
    balance numeric(14,2) NOT NULL,
    estimated boolean DEFAULT false NOT NULL
);


--
-- Name: networth_daily; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.networth_daily AS
 SELECT day,
    sum(balance) AS total
   FROM public.valuations
  GROUP BY day
  ORDER BY day;


--
-- Name: persons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.persons (
    id integer NOT NULL,
    name text NOT NULL,
    email text
);


--
-- Name: persons_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.persons_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: persons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.persons_id_seq OWNED BY public.persons.id;


--
-- Name: positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.positions (
    account_id integer NOT NULL,
    asset_id integer NOT NULL,
    quantity numeric(20,6) NOT NULL,
    cost_basis numeric(14,2),
    as_of date NOT NULL
);


--
-- Name: price_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_history (
    asset_id integer NOT NULL,
    day date NOT NULL,
    close numeric(18,6) NOT NULL,
    source text
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id bigint NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    device text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_ok_at timestamp with time zone,
    failures integer DEFAULT 0 NOT NULL
);


--
-- Name: push_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.push_subscriptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: push_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.push_subscriptions_id_seq OWNED BY public.push_subscriptions.id;


--
-- Name: recommendation_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recommendation_items (
    id bigint NOT NULL,
    reco_id bigint NOT NULL,
    "position" integer NOT NULL,
    item jsonb NOT NULL,
    status public.reco_status DEFAULT 'proposee'::public.reco_status NOT NULL,
    decided_at timestamp with time zone,
    decided_by text,
    feedback text
);


--
-- Name: recommendation_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.recommendation_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: recommendation_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.recommendation_items_id_seq OWNED BY public.recommendation_items.id;


--
-- Name: recommendations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recommendations (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    trigger text NOT NULL,
    payload jsonb NOT NULL,
    status public.reco_status DEFAULT 'proposee'::public.reco_status NOT NULL,
    decided_at timestamp with time zone,
    feedback text,
    person_id integer,
    model text,
    facts jsonb,
    usage jsonb,
    warnings jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: recommendations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.recommendations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: recommendations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.recommendations_id_seq OWNED BY public.recommendations.id;


--
-- Name: savings_flows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.savings_flows (
    month date NOT NULL,
    income numeric(14,2),
    fixed_exp numeric(14,2),
    var_exp numeric(14,2),
    buffer numeric(14,2),
    available numeric(14,2)
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key text NOT NULL,
    value numeric NOT NULL
);


--
-- Name: shared_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shared_items (
    tx_id bigint NOT NULL,
    kind text NOT NULL,
    share_other numeric(4,3) DEFAULT 0.5 NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shared_items_kind_check CHECK ((kind = ANY (ARRAY['depense'::text, 'remboursement'::text, 'ignore'::text]))),
    CONSTRAINT shared_items_share_other_check CHECK (((share_other >= (0)::numeric) AND (share_other <= (1)::numeric)))
);


--
-- Name: stale_accounts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.stale_accounts AS
 SELECT id,
    name,
    institution,
    last_sync_at
   FROM public.accounts
  WHERE (active AND (source IS DISTINCT FROM 'manuel'::text) AND ((last_sync_at IS NULL) OR (last_sync_at < (now() - '48:00:00'::interval))));


--
-- Name: target_allocation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.target_allocation (
    id integer NOT NULL,
    asset_class public.asset_class NOT NULL,
    target_pct numeric(5,2) NOT NULL,
    band_pct numeric(5,2) DEFAULT 5 NOT NULL,
    valid_from date DEFAULT CURRENT_DATE NOT NULL,
    CONSTRAINT target_allocation_target_pct_check CHECK (((target_pct >= (0)::numeric) AND (target_pct <= (100)::numeric)))
);


--
-- Name: target_allocation_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.target_allocation_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: target_allocation_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.target_allocation_id_seq OWNED BY public.target_allocation.id;


--
-- Name: tax_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_profile (
    id integer NOT NULL,
    income_year integer NOT NULL,
    person_id integer,
    rfr numeric(14,2),
    parts numeric(4,2),
    earned_income numeric(14,2),
    per_ceiling_notice numeric(14,2),
    per_paid numeric(14,2),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tax_profile_earned_income_check CHECK ((earned_income >= (0)::numeric)),
    CONSTRAINT tax_profile_income_year_check CHECK (((income_year >= 2000) AND (income_year <= 2100))),
    CONSTRAINT tax_profile_parts_check CHECK ((parts >= (1)::numeric)),
    CONSTRAINT tax_profile_per_ceiling_notice_check CHECK ((per_ceiling_notice >= (0)::numeric)),
    CONSTRAINT tax_profile_per_paid_check CHECK ((per_paid >= (0)::numeric)),
    CONSTRAINT tax_profile_rfr_check CHECK ((rfr >= (0)::numeric))
);


--
-- Name: tax_profile_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tax_profile_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tax_profile_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tax_profile_id_seq OWNED BY public.tax_profile.id;


--
-- Name: tax_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_rules (
    year integer NOT NULL,
    key text NOT NULL,
    value numeric(14,4) NOT NULL,
    unit text NOT NULL,
    label text NOT NULL,
    source text NOT NULL,
    verified boolean DEFAULT true NOT NULL
);


--
-- Name: trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trades (
    id bigint NOT NULL,
    account_id integer NOT NULL,
    asset_id integer NOT NULL,
    day date NOT NULL,
    kind text NOT NULL,
    quantity numeric(20,6) DEFAULT 0 NOT NULL,
    price numeric(18,6),
    fees numeric(14,2) DEFAULT 0 NOT NULL,
    source text DEFAULT 'manuel'::text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trades_kind_check CHECK ((kind = ANY (ARRAY['achat'::text, 'vente'::text, 'dividende'::text, 'frais'::text])))
);


--
-- Name: trades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trades_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trades_id_seq OWNED BY public.trades.id;


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id bigint NOT NULL,
    account_id integer NOT NULL,
    external_id text,
    booked_on date NOT NULL,
    amount numeric(14,2) NOT NULL,
    label text,
    category text,
    category_source text,
    inserted_at timestamp with time zone DEFAULT now() NOT NULL,
    merchant text GENERATED ALWAYS AS (public.merchant_of(label)) STORED,
    CONSTRAINT transactions_category_source_check CHECK ((category_source = ANY (ARRAY['rule'::text, 'manual'::text])))
);


--
-- Name: transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transactions_id_seq OWNED BY public.transactions.id;


--
-- Name: accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts ALTER COLUMN id SET DEFAULT nextval('public.accounts_id_seq'::regclass);


--
-- Name: advisor_savings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.advisor_savings ALTER COLUMN id SET DEFAULT nextval('public.advisor_savings_id_seq'::regclass);


--
-- Name: alert_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_events ALTER COLUMN id SET DEFAULT nextval('public.alert_events_id_seq'::regclass);


--
-- Name: alert_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_rules ALTER COLUMN id SET DEFAULT nextval('public.alert_rules_id_seq'::regclass);


--
-- Name: api_usage id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_usage ALTER COLUMN id SET DEFAULT nextval('public.api_usage_id_seq'::regclass);


--
-- Name: assets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets ALTER COLUMN id SET DEFAULT nextval('public.assets_id_seq'::regclass);


--
-- Name: category_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_rules ALTER COLUMN id SET DEFAULT nextval('public.category_rules_id_seq'::regclass);


--
-- Name: goal_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_items ALTER COLUMN id SET DEFAULT nextval('public.goal_items_id_seq'::regclass);


--
-- Name: goals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goals ALTER COLUMN id SET DEFAULT nextval('public.goals_id_seq'::regclass);


--
-- Name: persons id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persons ALTER COLUMN id SET DEFAULT nextval('public.persons_id_seq'::regclass);


--
-- Name: push_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.push_subscriptions_id_seq'::regclass);


--
-- Name: recommendation_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_items ALTER COLUMN id SET DEFAULT nextval('public.recommendation_items_id_seq'::regclass);


--
-- Name: recommendations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendations ALTER COLUMN id SET DEFAULT nextval('public.recommendations_id_seq'::regclass);


--
-- Name: target_allocation id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.target_allocation ALTER COLUMN id SET DEFAULT nextval('public.target_allocation_id_seq'::regclass);


--
-- Name: tax_profile id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_profile ALTER COLUMN id SET DEFAULT nextval('public.tax_profile_id_seq'::regclass);


--
-- Name: trades id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades ALTER COLUMN id SET DEFAULT nextval('public.trades_id_seq'::regclass);


--
-- Name: transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions ALTER COLUMN id SET DEFAULT nextval('public.transactions_id_seq'::regclass);


--
-- Name: account_fees account_fees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_fees
    ADD CONSTRAINT account_fees_pkey PRIMARY KEY (account_id);


--
-- Name: account_holders account_holders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_holders
    ADD CONSTRAINT account_holders_pkey PRIMARY KEY (account_id, person_id);


--
-- Name: accounts accounts_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_external_id_key UNIQUE (external_id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: advisor_context advisor_context_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.advisor_context
    ADD CONSTRAINT advisor_context_pkey PRIMARY KEY (id);


--
-- Name: advisor_docs advisor_docs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.advisor_docs
    ADD CONSTRAINT advisor_docs_pkey PRIMARY KEY (kind);


--
-- Name: advisor_savings advisor_savings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.advisor_savings
    ADD CONSTRAINT advisor_savings_pkey PRIMARY KEY (id);


--
-- Name: alert_events alert_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_events
    ADD CONSTRAINT alert_events_pkey PRIMARY KEY (id);


--
-- Name: alert_rules alert_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_rules
    ADD CONSTRAINT alert_rules_pkey PRIMARY KEY (id);


--
-- Name: alert_state alert_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_state
    ADD CONSTRAINT alert_state_pkey PRIMARY KEY (rule_id, account_id);


--
-- Name: allocation_snapshot allocation_snapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.allocation_snapshot
    ADD CONSTRAINT allocation_snapshot_pkey PRIMARY KEY (day, asset_class);


--
-- Name: allocation_targets allocation_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.allocation_targets
    ADD CONSTRAINT allocation_targets_pkey PRIMARY KEY (exposure);


--
-- Name: anomalies anomalies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anomalies
    ADD CONSTRAINT anomalies_pkey PRIMARY KEY (tx_id);


--
-- Name: api_usage api_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_usage
    ADD CONSTRAINT api_usage_pkey PRIMARY KEY (id);


--
-- Name: assets assets_isin_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_isin_key UNIQUE (isin);


--
-- Name: assets assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (id);


--
-- Name: bank_auth_states bank_auth_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_auth_states
    ADD CONSTRAINT bank_auth_states_pkey PRIMARY KEY (state_hash);


--
-- Name: bank_sessions bank_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_sessions
    ADD CONSTRAINT bank_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: cap_alert_state cap_alert_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_alert_state
    ADD CONSTRAINT cap_alert_state_pkey PRIMARY KEY (category, cycle);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (code);


--
-- Name: category_caps category_caps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_caps
    ADD CONSTRAINT category_caps_pkey PRIMARY KEY (category);


--
-- Name: category_rules category_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_rules
    ADD CONSTRAINT category_rules_pkey PRIMARY KEY (id);


--
-- Name: envelope_preference envelope_preference_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.envelope_preference
    ADD CONSTRAINT envelope_preference_pkey PRIMARY KEY (exposure, account_type);


--
-- Name: fee_benchmarks fee_benchmarks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_benchmarks
    ADD CONSTRAINT fee_benchmarks_pkey PRIMARY KEY (account_type);


--
-- Name: forecast_alert_state forecast_alert_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forecast_alert_state
    ADD CONSTRAINT forecast_alert_state_pkey PRIMARY KEY (account_id, cycle);


--
-- Name: goal_accounts goal_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_accounts
    ADD CONSTRAINT goal_accounts_pkey PRIMARY KEY (goal_id, account_id);


--
-- Name: goal_items goal_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_items
    ADD CONSTRAINT goal_items_pkey PRIMARY KEY (id);


--
-- Name: goals goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_pkey PRIMARY KEY (id);


--
-- Name: integrations integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_pkey PRIMARY KEY (kind);


--
-- Name: macro_context macro_context_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.macro_context
    ADD CONSTRAINT macro_context_pkey PRIMARY KEY (month);


--
-- Name: market_points market_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_points
    ADD CONSTRAINT market_points_pkey PRIMARY KEY (code, day);


--
-- Name: market_series market_series_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_series
    ADD CONSTRAINT market_series_pkey PRIMARY KEY (code);


--
-- Name: monthly_reports monthly_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_reports
    ADD CONSTRAINT monthly_reports_pkey PRIMARY KEY (month);


--
-- Name: persons persons_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persons
    ADD CONSTRAINT persons_name_key UNIQUE (name);


--
-- Name: persons persons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persons
    ADD CONSTRAINT persons_pkey PRIMARY KEY (id);


--
-- Name: positions positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_pkey PRIMARY KEY (account_id, asset_id, as_of);


--
-- Name: price_history price_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history
    ADD CONSTRAINT price_history_pkey PRIMARY KEY (asset_id, day);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: recommendation_items recommendation_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_items
    ADD CONSTRAINT recommendation_items_pkey PRIMARY KEY (id);


--
-- Name: recommendations recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendations
    ADD CONSTRAINT recommendations_pkey PRIMARY KEY (id);


--
-- Name: savings_flows savings_flows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.savings_flows
    ADD CONSTRAINT savings_flows_pkey PRIMARY KEY (month);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: shared_items shared_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_items
    ADD CONSTRAINT shared_items_pkey PRIMARY KEY (tx_id);


--
-- Name: target_allocation target_allocation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.target_allocation
    ADD CONSTRAINT target_allocation_pkey PRIMARY KEY (id);


--
-- Name: tax_profile tax_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_profile
    ADD CONSTRAINT tax_profile_pkey PRIMARY KEY (id);


--
-- Name: tax_rules tax_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_rules
    ADD CONSTRAINT tax_rules_pkey PRIMARY KEY (year, key);


--
-- Name: trades trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_account_id_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_account_id_external_id_key UNIQUE (account_id, external_id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: valuations valuations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.valuations
    ADD CONSTRAINT valuations_pkey PRIMARY KEY (account_id, day);


--
-- Name: api_usage_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX api_usage_month ON public.api_usage USING btree (created_at);


--
-- Name: bank_sessions_bank; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bank_sessions_bank ON public.bank_sessions USING btree (bank, country) WHERE (status = 'active'::text);


--
-- Name: tax_profile_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tax_profile_scope ON public.tax_profile USING btree (income_year, COALESCE(person_id, 0));


--
-- Name: trades_account_id_asset_id_day_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trades_account_id_asset_id_day_idx ON public.trades USING btree (account_id, asset_id, day);


--
-- Name: transactions_account_id_booked_on_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transactions_account_id_booked_on_idx ON public.transactions USING btree (account_id, booked_on);


--
-- Name: account_fees account_fees_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_fees
    ADD CONSTRAINT account_fees_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: account_holders account_holders_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_holders
    ADD CONSTRAINT account_holders_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: account_holders account_holders_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_holders
    ADD CONSTRAINT account_holders_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE CASCADE;


--
-- Name: alert_events alert_events_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_events
    ADD CONSTRAINT alert_events_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: alert_events alert_events_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_events
    ADD CONSTRAINT alert_events_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.alert_rules(id) ON DELETE SET NULL;


--
-- Name: alert_rules alert_rules_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_rules
    ADD CONSTRAINT alert_rules_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: alert_state alert_state_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_state
    ADD CONSTRAINT alert_state_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: alert_state alert_state_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_state
    ADD CONSTRAINT alert_state_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.alert_rules(id) ON DELETE CASCADE;


--
-- Name: anomalies anomalies_tx_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anomalies
    ADD CONSTRAINT anomalies_tx_id_fkey FOREIGN KEY (tx_id) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: bank_auth_states bank_auth_states_renew_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_auth_states
    ADD CONSTRAINT bank_auth_states_renew_of_fkey FOREIGN KEY (renew_of) REFERENCES public.bank_sessions(session_id) ON DELETE SET NULL;


--
-- Name: cap_alert_state cap_alert_state_category_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_alert_state
    ADD CONSTRAINT cap_alert_state_category_fkey FOREIGN KEY (category) REFERENCES public.category_caps(category) ON DELETE CASCADE;


--
-- Name: category_caps category_caps_category_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_caps
    ADD CONSTRAINT category_caps_category_fkey FOREIGN KEY (category) REFERENCES public.categories(code) ON DELETE CASCADE;


--
-- Name: category_rules category_rules_category_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_rules
    ADD CONSTRAINT category_rules_category_fkey FOREIGN KEY (category) REFERENCES public.categories(code);


--
-- Name: forecast_alert_state forecast_alert_state_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forecast_alert_state
    ADD CONSTRAINT forecast_alert_state_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: goal_accounts goal_accounts_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_accounts
    ADD CONSTRAINT goal_accounts_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: goal_accounts goal_accounts_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_accounts
    ADD CONSTRAINT goal_accounts_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.goals(id) ON DELETE CASCADE;


--
-- Name: goal_items goal_items_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_items
    ADD CONSTRAINT goal_items_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.goals(id) ON DELETE CASCADE;


--
-- Name: goals goals_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE SET NULL;


--
-- Name: market_points market_points_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_points
    ADD CONSTRAINT market_points_code_fkey FOREIGN KEY (code) REFERENCES public.market_series(code) ON DELETE CASCADE;


--
-- Name: positions positions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: positions positions_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id);


--
-- Name: price_history price_history_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history
    ADD CONSTRAINT price_history_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id);


--
-- Name: recommendation_items recommendation_items_reco_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_items
    ADD CONSTRAINT recommendation_items_reco_id_fkey FOREIGN KEY (reco_id) REFERENCES public.recommendations(id) ON DELETE CASCADE;


--
-- Name: recommendations recommendations_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendations
    ADD CONSTRAINT recommendations_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE SET NULL;


--
-- Name: shared_items shared_items_tx_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_items
    ADD CONSTRAINT shared_items_tx_id_fkey FOREIGN KEY (tx_id) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: tax_profile tax_profile_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_profile
    ADD CONSTRAINT tax_profile_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE CASCADE;


--
-- Name: trades trades_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: trades trades_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id);


--
-- Name: transactions transactions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: transactions transactions_category_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_category_fk FOREIGN KEY (category) REFERENCES public.categories(code);


--
-- Name: valuations valuations_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.valuations
    ADD CONSTRAINT valuations_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- PostgreSQL database dump complete
--


