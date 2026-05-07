"""yfinance-backed stock service with daily caching."""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime
from typing import Any, Optional

import yfinance as yf

from services import cache

log = logging.getLogger("crrnt.stock")

VALID_RANGES = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "5y"}

# Intraday ranges use a smaller candle interval
INTRADAY_INTERVALS = {
    "1d": "5m",
    "5d": "1h",
}


def _today() -> str:
    return date.today().isoformat()


def _cache_key(ticker: str, rng: str) -> str:
    return f"stock:{ticker.upper()}:{rng}:{_today()}"


async def get_history(ticker: str, rng: str = "1y") -> Optional[dict[str, Any]]:
    if rng not in VALID_RANGES:
        rng = "1y"
    ticker = ticker.upper().strip()
    if not ticker:
        return None

    key = _cache_key(ticker, rng)
    cached = cache.get(key)
    if cached:
        return cached

    payload = await asyncio.to_thread(_fetch_sync, ticker, rng)
    if payload:
        cache.set(key, payload)
    return payload


def _fetch_sync(ticker: str, rng: str) -> Optional[dict[str, Any]]:
    interval = INTRADAY_INTERVALS.get(rng, "1d")
    try:
        t = yf.Ticker(ticker)
        hist = t.history(period=rng, interval=interval, auto_adjust=False)
    except Exception as exc:  # noqa: BLE001
        log.info("yfinance.history failed for %s: %s", ticker, exc)
        return None

    if hist is None or hist.empty:
        return None

    is_intraday = rng in INTRADAY_INTERVALS
    points: list[dict[str, Any]] = []
    for idx, row in hist.iterrows():
        try:
            close = float(row["Close"])
        except (KeyError, TypeError, ValueError):
            continue
        if is_intraday:
            # Preserve time for intraday — strip timezone, keep YYYY-MM-DDTHH:MM
            d = str(idx)[:16].replace(" ", "T")
        else:
            d = idx.date().isoformat() if hasattr(idx, "date") else str(idx)
        points.append({"date": d, "close": round(close, 4)})

    if not points:
        return None

    currency = ""
    try:
        info = t.fast_info
        currency = (info.get("currency") if hasattr(info, "get") else getattr(info, "currency", "")) or ""
    except Exception:  # noqa: BLE001
        currency = ""

    latest = points[-1]["close"]
    previous = points[-2]["close"] if len(points) >= 2 else latest

    return {
        "ticker": ticker,
        "currency": currency or "USD",
        "range": rng,
        "points": points,
        "latestPrice": latest,
        "previousClose": previous,
        "cachedAt": datetime.utcnow().isoformat() + "Z",
    }


async def simulate_investment(
    ticker: str,
    amount: float,
    start_date: str,
) -> Optional[dict[str, Any]]:
    """Simulate buying `amount` USD of `ticker` on `start_date`.

    Uses the cached 5y history (which includes start_date for any reasonable
    request). Falls back to fetching fresh if not cached.
    """
    history = await get_history(ticker, "5y")
    if not history or not history.get("points"):
        return None

    points: list[dict[str, Any]] = history["points"]
    start_point = _find_on_or_after(points, start_date)
    if not start_point:
        return None

    start_price = float(start_point["close"])
    current_price = float(points[-1]["close"])
    if start_price <= 0:
        return None

    shares = amount / start_price
    current_value = shares * current_price
    profit_loss = current_value - amount
    percent_change = (profit_loss / amount) * 100 if amount > 0 else 0.0

    return {
        "ticker": ticker.upper(),
        "startDate": start_point["date"],
        "amount": round(amount, 2),
        "startPrice": round(start_price, 4),
        "currentPrice": round(current_price, 4),
        "sharesPurchased": round(shares, 6),
        "currentValue": round(current_value, 2),
        "profitLoss": round(profit_loss, 2),
        "percentChange": round(percent_change, 2),
    }


def _find_on_or_after(
    points: list[dict[str, Any]], target_iso: str
) -> Optional[dict[str, Any]]:
    try:
        target = datetime.fromisoformat(target_iso).date()
    except ValueError:
        return None
    for p in points:
        try:
            d = datetime.fromisoformat(p["date"]).date()
        except (KeyError, ValueError):
            continue
        if d >= target:
            return p
    return None
