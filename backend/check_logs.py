import asyncio
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.bot_log import BotLog

async def main():
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(BotLog).order_by(BotLog.created_at.desc()).limit(10))
        logs = result.scalars().all()
        for log in logs:
            print(f"[{log.created_at}] {log.level}: {log.message} - {log.details}")

if __name__ == "__main__":
    asyncio.run(main())
