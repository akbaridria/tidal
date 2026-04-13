from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/", summary="Service info")
async def root() -> dict[str, str]:
    return {"service": "tidal-trading-api", "docs": "/docs"}


@router.get("/health", summary="Liveness / readiness probe")
async def health() -> dict[str, str]:
    return {"status": "ok"}
