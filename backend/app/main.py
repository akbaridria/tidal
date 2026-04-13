from contextlib import asynccontextmanager

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import FastAPI

from app.api.router import api_router
from app.core.config import settings
from app.core.database import engine
from app.models import bot_wallet, strategy, bot_log, user  # noqa: F401 — register models
from app.models.base import Base


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    app.state.arq_pool = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
    try:
        yield
    finally:
        await app.state.arq_pool.close()
        await engine.dispose()


def create_app() -> FastAPI:
    application = FastAPI(
        title=settings.PROJECT_NAME,
        lifespan=lifespan,
    )
    application.include_router(api_router)
    return application


app = create_app()
