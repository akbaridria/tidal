from __future__ import annotations

import datetime
import uuid
from typing import Any, Optional

from sqlalchemy import String, Uuid, JSON, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.models.base import Base


class BotLog(Base):
    __tablename__ = "bot_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False, index=True)
    strategy_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True), 
        ForeignKey("strategies.id"),
        nullable=True, 
        index=True
    )
    level: Mapped[str] = mapped_column(String(16), default="INFO") # INFO, ERROR, SIGNAL, TRADE
    message: Mapped[str] = mapped_column(String(1024), nullable=False)
    details: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), 
        server_default=func.now(),
        index=True
    )
