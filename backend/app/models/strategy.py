from __future__ import annotations

import uuid
from typing import Optional, Any

from sqlalchemy import String, Uuid, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Strategy(Base):
    __tablename__ = "strategies"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False, index=True)
    trading_pair: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    config: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    bot_config: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(default=False, index=True)
    
    subaccount_pubkey: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    subaccount_encrypted_pk: Mapped[Optional[bytes]] = mapped_column(nullable=True)
