-- Patrimoine : données de référence génériques (catégories, barèmes, réglages par défaut).
-- Aucune donnée personnelle. Les personnes ci-dessous sont des exemples.

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
-- Data for Name: advisor_context; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.advisor_context (id, content, updated_at) VALUES (1, '', '2026-11-06 14:22:00.796966+00');


--
-- Data for Name: advisor_docs; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.advisor_docs (kind, content, meta, updated_at) VALUES ('notes_marche', '', '{}', '2026-11-06 14:22:00.969286+00');
INSERT INTO public.advisor_docs (kind, content, meta, updated_at) VALUES ('hypotheses', '', '{}', '2026-11-06 14:22:00.969286+00');
INSERT INTO public.advisor_docs (kind, content, meta, updated_at) VALUES ('strategie', '', '{}', '2026-11-06 14:22:00.969286+00');


--
-- Data for Name: alert_rules; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.alert_rules (id, account_id, account_type, threshold, enabled, created_at) VALUES (1, NULL, 'courant', 200.00, true, '2026-11-06 14:21:59.538491+00');
INSERT INTO public.alert_rules (id, account_id, account_type, threshold, enabled, created_at) VALUES (2, NULL, 'courant', 100.00, true, '2026-11-06 14:21:59.538491+00');
INSERT INTO public.alert_rules (id, account_id, account_type, threshold, enabled, created_at) VALUES (3, NULL, 'courant', 0.00, true, '2026-11-06 14:21:59.538491+00');


--
-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.categories (code, label, kind) VALUES ('salaire', 'Salaire', 'income');
INSERT INTO public.categories (code, label, kind) VALUES ('famille', 'Virements famille', 'income');
INSERT INTO public.categories (code, label, kind) VALUES ('autres_revenus', 'Autres revenus', 'income');
INSERT INTO public.categories (code, label, kind) VALUES ('logement', 'Logement', 'fixed');
INSERT INTO public.categories (code, label, kind) VALUES ('energie', 'Énergie & eau', 'fixed');
INSERT INTO public.categories (code, label, kind) VALUES ('assurances', 'Assurances', 'fixed');
INSERT INTO public.categories (code, label, kind) VALUES ('telecom', 'Téléphone & internet', 'fixed');
INSERT INTO public.categories (code, label, kind) VALUES ('abonnements', 'Abonnements', 'fixed');
INSERT INTO public.categories (code, label, kind) VALUES ('frais_bancaires', 'Frais bancaires', 'fixed');
INSERT INTO public.categories (code, label, kind) VALUES ('commun', 'Contribution compte commun', 'household');
INSERT INTO public.categories (code, label, kind) VALUES ('courses', 'Courses', 'variable');
INSERT INTO public.categories (code, label, kind) VALUES ('restaurants', 'Restaurants & bars', 'variable');
INSERT INTO public.categories (code, label, kind) VALUES ('achats_en_ligne', 'Achats en ligne', 'variable');
INSERT INTO public.categories (code, label, kind) VALUES ('shopping', 'Shopping & équipement', 'variable');
INSERT INTO public.categories (code, label, kind) VALUES ('maison', 'Maison & bricolage', 'variable');
INSERT INTO public.categories (code, label, kind) VALUES ('loisirs', 'Loisirs & sorties', 'variable');
INSERT INTO public.categories (code, label, kind) VALUES ('voyages', 'Voyages', 'variable');
INSERT INTO public.categories (code, label, kind) VALUES ('transport', 'Transport', 'variable');
INSERT INTO public.categories (code, label, kind) VALUES ('sante', 'Santé', 'variable');
INSERT INTO public.categories (code, label, kind) VALUES ('education', 'Études & formation', 'variable');
INSERT INTO public.categories (code, label, kind) VALUES ('cadeaux_dons', 'Cadeaux & dons', 'variable');
INSERT INTO public.categories (code, label, kind) VALUES ('especes', 'Retraits d''espèces', 'variable');
INSERT INTO public.categories (code, label, kind) VALUES ('virement_interne', 'Virements entre nous', 'internal');
INSERT INTO public.categories (code, label, kind) VALUES ('epargne', 'Épargne', 'savings');
INSERT INTO public.categories (code, label, kind) VALUES ('divers', 'Autre', 'variable');
INSERT INTO public.categories (code, label, kind) VALUES ('plaisir', 'Plaisir', 'variable');
INSERT INTO public.categories (code, label, kind) VALUES ('impots', 'Impôts', 'fixed');
INSERT INTO public.categories (code, label, kind) VALUES ('animaux', 'Animaux', 'variable');
INSERT INTO public.categories (code, label, kind) VALUES ('virements_tiers', 'Virements à des tiers', 'variable');


--
-- Data for Name: category_rules; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (1, '^VIR.*\mCOMMUN\M', 'out', 'commun', 10, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (3, '^VIR.*(LIVRET|LDDS|LEP|EPARGNE|PEA|ASSURANCE VIE)', 'out', 'epargne', 10, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (6, '^\*|COTISATION|REMISE SERVICES|FRAIS|COMMISSION', 'any', 'frais_bancaires', 30, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (7, 'MAIF|MACIF|MATMUT|\mAXA\M|ALLIANZ|GROUPAMA', 'any', 'assurances', 30, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (8, 'BOUYGUES|FREE MOBILE|\mSFR\M|ORANGE|SOSH|RED BY SFR|SAILY', 'any', 'telecom', 30, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (9, 'SPOTIFY|ANTHROPIC|APPLE\.COM|NETFLIX|DISNEY|DEEZER|CANAL\+|YOUTUBE|OPENAI|PRIME VIDEO', 'any', 'abonnements', 30, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (10, 'LOYER|FONCIA|NEXITY|CITYA', 'any', 'logement', 30, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (11, '\mEDF\M|ENGIE|TOTALENERGIES|VEOLIA|SAUR', 'any', 'energie', 30, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (12, 'CARREFOUR|AUCHAN|LECLERC|\mLIDL|INTERMARCHE|SUPER U|HYPER U|MONOPRIX|FRANPRIX|\mALDI|PICARD|BIOCOOP|BOULANGERIE', 'any', 'courses', 40, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (13, 'MAC ?DO|BURGER|KFC|BISTROT|CERVOISERIE|\mBAR\M|RESTAU|BRASSERIE|UBER ?EATS|DELIVEROO', 'any', 'restaurants', 40, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (14, 'AMAZON|CDISCOUNT|ALIEXPRESS|VINTED', 'any', 'achats_en_ligne', 40, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (15, 'MANGO|DECATHLON|INTERSPORT|ZARA|H&M|KIABI|UNIQLO|SEPHORA', 'any', 'shopping', 40, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (16, 'LMFR|LEROY|IKEA|CASTORAMA|BRICO', 'any', 'maison', 40, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (17, 'PUY DU FOU|CINE|CULTURA|FNAC|CHATEAU|MUSEE', 'any', 'loisirs', 40, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (18, 'KIWI\.COM|BEAUVAIS|AIRBNB|BOOKING|RYANAIR|EASYJET|WIZZ|TRANSAVIA|AIR FRANCE|HOTEL', 'any', 'voyages', 40, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (19, 'SNCF|\mTOTAL\M|ESSO|SHELL|PEAGE|VINCI|APRR|\mUBER\M|BLABLACAR', 'any', 'transport', 40, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (20, 'PHARMACIE|\mDR |DOCTEUR|MEDECIN|DENTISTE|HENNER|LABO|OPTIC', 'any', 'sante', 40, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (21, 'CROUS|UNIVERSITE|ECOLE', 'any', 'education', 40, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (22, 'FONDATION|FLEURS|\mDON\M', 'any', 'cadeaux_dons', 40, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (23, 'RETRAIT', 'out', 'especes', 40, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (24, '.', 'out', 'divers', 99, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (25, '.', 'in', 'autres_revenus', 99, '2026-11-06 14:21:59.355792+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (30, 'REGLEMENT SALAIRE|\mSALAIRE\M', 'in', 'salaire', 20, '2026-11-06 14:22:00.413882+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (32, '\mGMF\M|\mCAMA\M|\mPACIFICA\M', 'out', 'assurances', 30, '2026-11-06 14:22:00.47338+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (33, '^PRLV.*DIRECTION GENERALE (DES FINA|DE [0-9])|\mDGFIP\M', 'out', 'impots', 30, '2026-11-06 14:22:00.685683+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (34, 'CANAL PLUS|CANAL \+', 'any', 'abonnements', 30, '2026-11-06 14:22:00.685683+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (35, 'MAXI ZOO|FRESSNAPF|ANIMALERIE', 'any', 'animaux', 40, '2026-11-06 14:22:00.685683+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (37, 'LEBONCOIN|ZALANDO|YVES ROCHER|ADIDAS', 'any', 'shopping', 40, '2026-11-06 14:22:00.685683+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (38, 'NORAUTO|COFIROUTE|\mASF\M|\mAVIA\M', 'any', 'transport', 40, '2026-11-06 14:22:00.685683+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (39, 'SUSHI|OSTERIA|CAMPANILE|TICKET RES', 'any', 'restaurants', 40, '2026-11-06 14:22:00.685683+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (40, '^VIR INST ', 'out', 'virements_tiers', 45, '2026-11-06 14:22:00.685683+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (42, 'GRAND FRAIS', 'any', 'courses', 25, '2026-11-06 14:22:00.912345+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (43, 'RETRO F COTIS|F COTIS|COTIS CB', 'any', 'frais_bancaires', 25, '2026-11-06 14:22:00.912345+00');
INSERT INTO public.category_rules (id, pattern, direction, category, priority, created_at) VALUES (44, 'PROTECTION JURIDIQUE', 'any', 'assurances', 30, '2026-11-06 14:22:00.912345+00');


--
-- Data for Name: envelope_preference; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('actions_monde', 'pea', 1, 'ETF éligible PEA : gains exonérés d''impôt après 5 ans (prélèvements sociaux seuls)');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('actions_monde', 'assurance_vie', 2, 'Unités de compte : fiscalité allégée après 8 ans, transmission');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('actions_monde', 'cto', 3, 'Flat tax 30 %, sans plafond ni blocage');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('actions_europe', 'pea', 1, 'Éligible PEA par nature');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('actions_europe', 'assurance_vie', 2, 'Unités de compte');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('actions_europe', 'cto', 3, 'Flat tax 30 %');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('actions_usa', 'pea', 1, 'Uniquement via un ETF éligible PEA (réplication synthétique)');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('actions_usa', 'assurance_vie', 2, 'Unités de compte');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('actions_usa', 'cto', 3, 'Flat tax 30 %');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('actions_emergents', 'pea', 1, 'Uniquement via un ETF éligible PEA');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('actions_emergents', 'assurance_vie', 2, 'Unités de compte');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('actions_emergents', 'cto', 3, 'Flat tax 30 %');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('obligations', 'assurance_vie', 1, 'Fiscalité assurance-vie plus douce que la flat tax sur les coupons');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('obligations', 'cto', 2, 'Flat tax 30 %');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('fonds_euro', 'assurance_vie', 1, 'Capital garanti, uniquement en assurance-vie');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('monetaire', 'livret', 1, 'Livrets réglementés défiscalisés en priorité');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('monetaire', 'assurance_vie', 2, 'Fonds monétaire en unités de compte');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('liquidites', 'livret', 1, 'Livret A / LDDS / LEP : disponibles et défiscalisés');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('or', 'cto', 1, 'ETC or non éligible PEA');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('or', 'assurance_vie', 2, 'Selon les contrats');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('immobilier', 'assurance_vie', 1, 'SCPI / SCI en unités de compte');
INSERT INTO public.envelope_preference (exposure, account_type, rank, why) VALUES ('crypto', 'cto', 1, 'Seule enveloppe possible (hors wallet)');


--
-- Data for Name: fee_benchmarks; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.fee_benchmarks (account_type, label, mgmt_pct, entry_pct, custody_eur, ter_pct) VALUES ('assurance_vie', 'Assurance-vie en ligne à frais réduits', 0.500, 0.000, 0.00, NULL);
INSERT INTO public.fee_benchmarks (account_type, label, mgmt_pct, entry_pct, custody_eur, ter_pct) VALUES ('per', 'PER en ligne à frais réduits', 0.500, 0.000, 0.00, NULL);
INSERT INTO public.fee_benchmarks (account_type, label, mgmt_pct, entry_pct, custody_eur, ter_pct) VALUES ('pea', 'PEA chez un courtier en ligne sans droits de garde', 0.000, 0.000, 0.00, NULL);
INSERT INTO public.fee_benchmarks (account_type, label, mgmt_pct, entry_pct, custody_eur, ter_pct) VALUES ('cto', 'Compte-titres chez un courtier en ligne sans droits de garde', 0.000, 0.000, 0.00, NULL);


--
-- Data for Name: market_series; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.market_series (code, label, source, symbol, kind, unit, active) VALUES ('monde', 'Actions monde (MSCI World, proxy URTH)', 'twelvedata', 'URTH', 'indice', '$', true);
INSERT INTO public.market_series (code, label, source, symbol, kind, unit, active) VALUES ('usa', 'Actions USA (S&P 500, proxy SPY)', 'twelvedata', 'SPY', 'indice', '$', true);
INSERT INTO public.market_series (code, label, source, symbol, kind, unit, active) VALUES ('europe', 'Actions zone euro (MSCI EMU, proxy EZU)', 'twelvedata', 'EZU', 'indice', '$', true);
INSERT INTO public.market_series (code, label, source, symbol, kind, unit, active) VALUES ('emergents', 'Actions émergentes (MSCI EM, proxy EEM)', 'twelvedata', 'EEM', 'indice', '$', true);
INSERT INTO public.market_series (code, label, source, symbol, kind, unit, active) VALUES ('obligations', 'Obligations agrégées (proxy AGG)', 'twelvedata', 'AGG', 'indice', '$', true);
INSERT INTO public.market_series (code, label, source, symbol, kind, unit, active) VALUES ('or', 'Or (proxy GLD)', 'twelvedata', 'GLD', 'indice', '$', true);
INSERT INTO public.market_series (code, label, source, symbol, kind, unit, active) VALUES ('bce', 'Taux de dépôt BCE', 'fred', 'ECBDFR', 'taux', '%', true);
INSERT INTO public.market_series (code, label, source, symbol, kind, unit, active) VALUES ('oat10', 'Taux 10 ans France (OAT)', 'fred', 'IRLTLT01FRM156N', 'taux', '%', true);
INSERT INTO public.market_series (code, label, source, symbol, kind, unit, active) VALUES ('us10', 'Taux 10 ans USA', 'fred', 'DGS10', 'taux', '%', true);
INSERT INTO public.market_series (code, label, source, symbol, kind, unit, active) VALUES ('hicp_fr', 'Indice des prix France (IPCH)', 'fred', 'CP0000FRM086NEST', 'inflation', 'indice', true);


--
-- Data for Name: settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.settings (key, value) VALUES ('buffer_months', 3);
INSERT INTO public.settings (key, value) VALUES ('buffer_refill_months', 6);
INSERT INTO public.settings (key, value) VALUES ('cycle_start_day', 25);
INSERT INTO public.settings (key, value) VALUES ('advisor_min_days', 7);
INSERT INTO public.settings (key, value) VALUES ('invest_monthly', 0);
INSERT INTO public.settings (key, value) VALUES ('advisor_monthly_budget_usd', 5);
INSERT INTO public.settings (key, value) VALUES ('fees_gross_return_pct', 5);
INSERT INTO public.settings (key, value) VALUES ('cycle_auto', 1);


--
-- Data for Name: tax_rules; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.tax_rules (year, key, value, unit, label, source, verified) VALUES (2026, 'livret_a.plafond', 22950.0000, '€', 'Plafond du Livret A (personne physique)', 'service-public.fr — Livret A', true);
INSERT INTO public.tax_rules (year, key, value, unit, label, source, verified) VALUES (2026, 'ldds.plafond', 12000.0000, '€', 'Plafond du LDDS', 'service-public.fr — LDDS', true);
INSERT INTO public.tax_rules (year, key, value, unit, label, source, verified) VALUES (2026, 'lep.plafond', 10000.0000, '€', 'Plafond du LEP', 'service-public.fr — LEP', true);
INSERT INTO public.tax_rules (year, key, value, unit, label, source, verified) VALUES (2026, 'lep.rfr.base', 23028.0000, '€', 'RFR maximal pour le LEP — 1 part', 'notes de marché 11/10/2026 (Meilleurtaux, La finance pour tous)', false);
INSERT INTO public.tax_rules (year, key, value, unit, label, source, verified) VALUES (2026, 'lep.rfr.demi_part', 6149.0000, '€', 'RFR maximal pour le LEP — majoration par demi-part', 'notes de marché 11/10/2026 (Meilleurtaux, La finance pour tous)', false);
INSERT INTO public.tax_rules (year, key, value, unit, label, source, verified) VALUES (2026, 'av.duree_ans', 8.0000, 'ans', 'Ancienneté ouvrant la fiscalité allégée de l''assurance-vie', 'impots.gouv.fr — assurance-vie', true);
INSERT INTO public.tax_rules (year, key, value, unit, label, source, verified) VALUES (2026, 'av.abattement.seul', 4600.0000, '€', 'Abattement annuel AV après 8 ans — personne seule', 'impots.gouv.fr — assurance-vie', true);
INSERT INTO public.tax_rules (year, key, value, unit, label, source, verified) VALUES (2026, 'av.abattement.couple', 9200.0000, '€', 'Abattement annuel AV après 8 ans — couple (imposition commune)', 'impots.gouv.fr — assurance-vie', true);
INSERT INTO public.tax_rules (year, key, value, unit, label, source, verified) VALUES (2026, 'pea.duree_ans', 5.0000, 'ans', 'Ancienneté du PEA : gains exonérés d''impôt sur le revenu (prélèvements sociaux dus)', 'service-public.fr — PEA', true);
INSERT INTO public.tax_rules (year, key, value, unit, label, source, verified) VALUES (2026, 'pea.plafond', 150000.0000, '€', 'Plafond de versements du PEA', 'service-public.fr — PEA', true);
INSERT INTO public.tax_rules (year, key, value, unit, label, source, verified) VALUES (2026, 'pfu.ir', 12.8000, '%', 'PFU — part impôt sur le revenu', 'impots.gouv.fr — PFU', true);
INSERT INTO public.tax_rules (year, key, value, unit, label, source, verified) VALUES (2026, 'pfu.ps', 18.6000, '%', 'Prélèvements sociaux sur les revenus du capital (hors assurance-vie)', 'LFSS 2026 — notes de marché 11/10/2026', false);
INSERT INTO public.tax_rules (year, key, value, unit, label, source, verified) VALUES (2026, 'pfu.taux', 31.4000, '%', 'PFU (« flat tax ») total (hors assurance-vie)', 'LFSS 2026 — notes de marché 11/10/2026', false);
INSERT INTO public.tax_rules (year, key, value, unit, label, source, verified) VALUES (2026, 'av.ps', 17.2000, '%', 'Prélèvements sociaux sur les gains d''assurance-vie', 'LFSS 2026 — notes de marché 11/10/2026', false);
INSERT INTO public.tax_rules (year, key, value, unit, label, source, verified) VALUES (2026, 'per.taux', 10.0000, '%', 'PER — part des revenus d''activité déductible', 'impots.gouv.fr — épargne retraite', true);
INSERT INTO public.tax_rules (year, key, value, unit, label, source, verified) VALUES (2026, 'per.pass', 47100.0000, '€', 'PASS de référence (2025) pour les versements PER de 2026', 'service-public.fr — PASS 2025', true);
INSERT INTO public.tax_rules (year, key, value, unit, label, source, verified) VALUES (2026, 'per.plafond_pass', 8.0000, 'PASS', 'PER — plafond : 10 % de N PASS', 'impots.gouv.fr — épargne retraite', true);
INSERT INTO public.tax_rules (year, key, value, unit, label, source, verified) VALUES (2026, 'per.plancher_pass', 1.0000, 'PASS', 'PER — plancher : 10 % de N PASS', 'impots.gouv.fr — épargne retraite', true);


--
-- Name: alert_rules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.alert_rules_id_seq', 3, true);


--
-- Name: category_rules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.category_rules_id_seq', 44, true);


--
-- PostgreSQL database dump complete
--

-- Personnes de démonstration (à renommer depuis l'application ou en SQL : UPDATE persons SET name = '…').
INSERT INTO public.persons (name) VALUES ('Alex'), ('Sam');

-- Règles génériques d'exemple (à adapter à vos libellés bancaires).
INSERT INTO public.category_rules (priority, direction, pattern, category) VALUES
  (10, 'any', '^VIR.*(SAM|ALEX)', 'virement_interne'),
  (40, 'any', '\mGIFI\M|LEROY MERLIN|CASTORAMA|IKEA', 'maison');
