from arq.connections import ArqRedis
from fastapi import Request

from app.core.database import get_db


def get_arq_pool(request: Request) -> ArqRedis:
    pool = getattr(request.app.state, "arq_pool", None)
    if pool is None:
        raise RuntimeError("ARQ Redis pool is not initialized")
    return pool


__all__ = ["get_arq_pool", "get_db"]
