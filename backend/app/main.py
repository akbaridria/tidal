import logging
import sys

# Configure logging at the module level
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    stream=sys.stdout
)

from contextlib import asynccontextmanager

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.core.database import engine
from app.models import bot_wallet, strategy, bot_log, user  # noqa: F401 — register models
from app.models.base import Base


@asynccontextmanager
async def lifespan(app: FastAPI):
    import logging
    logger = logging.getLogger("startup")
    logger.info("Initializing application startup...")
    
    try:
        logger.info("Connecting to database and creating tables...")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database initialized successfully.")
    except Exception as e:
        logger.error("Database initialization failed: %s", e, exc_info=True)
        raise

    try:
        logger.info("Initializing ARQ pool for Redis...")
        app.state.arq_pool = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
        logger.info("Redis initialized successfully.")
    except Exception as e:
        logger.error("Redis initialization failed: %s", e, exc_info=True)
        # We might want to continue even if Redis fails, or crash. 
        # For now, let's keep it required.
        raise
    
    from app.core.database import AsyncSessionLocal
    from sqlalchemy import select
    from app.models.strategy import Strategy
    from app.worker.trading_manager import initialize_bot_for_user
    
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Strategy).where(Strategy.is_active == True))
        active_strategies = result.scalars().all()
        for strategy in active_strategies:
            full_config = {
                "strategy_id": str(strategy.id),
                "symbol": strategy.trading_pair,
                "interval": strategy.config.get("interval", "1m"),
                "conditions": strategy.config.get("conditions"),
                "bot_config": strategy.bot_config,
                "side": strategy.config.get("side", "buy"),
                "allocate_margin": False,
            }
            try:
                await initialize_bot_for_user(strategy.user_id, full_config)
                logger.info("Resumed active bot: %s", strategy.id)
            except Exception as e:
                logger.error("Failed to resume bot %s: %s", strategy.id, e)

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
    
    # Allow all CORS for local development
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    application.include_router(api_router)
    return application


app = create_app()
