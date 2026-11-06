"""Job quotidien (CronJob) : cours des indices et des actifs détenus (Twelve Data), indicateurs macro (FRED),
puis valorisation des comptes de placement gérés manuellement (PEA/CTO/AV/PER sans synchro bancaire).
Clés : TWELVEDATA_API_KEY, FRED_API_KEY. Sans clé, la source correspondante est ignorée."""
import os
import sys
import time
from datetime import date, timedelta

import httpx
import psycopg

DB = os.environ["DATABASE_URL"]
TD_KEY = os.environ.get("TWELVEDATA_API_KEY", "")
FRED_KEY = os.environ.get("FRED_API_KEY", "")
TD_PAUSE = 8.5   # offre gratuite Twelve Data : 8 requêtes/minute


def twelvedata(h: httpx.Client, symbol: str, outputsize: int) -> list[tuple[date, float]]:
    sym, _, exch = symbol.partition(":")
    params = {"symbol": sym, "interval": "1day", "outputsize": outputsize, "apikey": TD_KEY}
    if exch:
        params["mic_code"] = exch
    r = h.get("https://api.twelvedata.com/time_series", params=params).json()
    if r.get("status") != "ok":
        raise RuntimeError(f"{symbol}: {r.get('message', r)}")
    return [(date.fromisoformat(v["datetime"][:10]), float(v["close"])) for v in r["values"]]


def fred(h: httpx.Client, series: str, start: date) -> list[tuple[date, float]]:
    r = h.get("https://api.stlouisfed.org/fred/series/observations", params={
        "series_id": series, "api_key": FRED_KEY, "file_type": "json", "observation_start": start.isoformat()})
    r.raise_for_status()
    return [(date.fromisoformat(o["date"]), float(o["value"])) for o in r.json()["observations"] if o["value"] != "."]


def main() -> int:
    errors = 0
    with psycopg.connect(DB) as c, httpx.Client(timeout=30) as h:
        # 1. Séries de marché
        for code, source, symbol, last in c.execute(
                """SELECT s.code, s.source, s.symbol, (SELECT max(day) FROM market_points p WHERE p.code = s.code)
                   FROM market_series s WHERE s.active ORDER BY s.source, s.code""").fetchall():
            try:
                if source == "twelvedata":
                    if not TD_KEY:
                        continue
                    pts = twelvedata(h, symbol, 400 if last is None else 10)
                    time.sleep(TD_PAUSE)
                else:
                    if not FRED_KEY:
                        continue
                    pts = fred(h, symbol, (last or date.today() - timedelta(days=800)) - timedelta(days=40))
                with c.cursor() as cur:
                    cur.executemany("""INSERT INTO market_points VALUES (%s,%s,%s)
                                       ON CONFLICT (code, day) DO UPDATE SET value = EXCLUDED.value""",
                                    [(code, d, v) for d, v in pts])
                print(f"{code}: {len(pts)} points")
            except Exception as e:
                errors += 1
                print(f"{code}: ERREUR {e}")
        c.commit()

        # 2. Cours des actifs détenus ayant un symbole
        if TD_KEY:
            for aid, symbol, last in c.execute(
                    """SELECT a.id, a.data_symbol, (SELECT max(day) FROM price_history p WHERE p.asset_id = a.id)
                       FROM assets a WHERE a.data_symbol IS NOT NULL""").fetchall():
                try:
                    pts = twelvedata(h, symbol, 400 if last is None else 10)
                    time.sleep(TD_PAUSE)
                    with c.cursor() as cur:
                        cur.executemany("""INSERT INTO price_history (asset_id, day, close, source) VALUES (%s,%s,%s,'twelvedata')
                                           ON CONFLICT (asset_id, day) DO UPDATE SET close = EXCLUDED.close""",
                                        [(aid, d, v) for d, v in pts])
                    print(f"actif {aid} ({symbol}): {len(pts)} cours")
                except Exception as e:
                    errors += 1
                    print(f"actif {aid} ({symbol}): ERREUR {e}")
            c.commit()

        # 3. Valorisation quotidienne des comptes de placement saisis à la main (le patrimoine total les inclut)
        n = c.execute(
            """INSERT INTO valuations (account_id, day, balance)
               SELECT h.account_id, current_date, sum(h.value) FROM holdings(NULL) h
               JOIN accounts a ON a.id = h.account_id AND a.source = 'manuel' GROUP BY h.account_id
               ON CONFLICT (account_id, day) DO UPDATE SET balance = EXCLUDED.balance""").rowcount
        c.execute("UPDATE accounts SET last_sync_at = now() WHERE source = 'manuel'")
        c.commit()
        print(f"{n} compte(s) de placement valorisé(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
