from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from services import stock_service

router = APIRouter(tags=["stocks"])


class SimulateBody(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=12)
    amount: float = Field(..., gt=0)
    startDate: str = Field(..., description="ISO date YYYY-MM-DD")


@router.get("/stock/{ticker}")
async def get_stock(
    ticker: str,
    range: Optional[str] = Query(default="1y"),
) -> dict:
    history = await stock_service.get_history(ticker, range or "1y")
    if not history:
        raise HTTPException(status_code=404, detail="Ticker not available")
    return history


@router.post("/simulate")
async def simulate(body: SimulateBody) -> dict:
    result = await stock_service.simulate_investment(
        body.ticker, body.amount, body.startDate
    )
    if not result:
        raise HTTPException(
            status_code=400,
            detail="Could not simulate — ticker or start date invalid",
        )
    return result
