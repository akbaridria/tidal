from __future__ import annotations

import datetime
import uuid
from typing import Any

import base58
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from solders.pubkey import Pubkey

from app.api.deps import get_db
from app.core.auth import create_access_token
from app.models.user import User

router = APIRouter(tags=["auth"])


class ChallengeResponse(BaseModel):
    nonce: str


class LoginBody(BaseModel):
    public_key: str = Field(..., description="Solana public key (base58)")
    signature: str = Field(..., description="Signature of the nonce (base58)")
    message: str = Field(..., description="The original message containing the nonce")


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str


@router.get("/challenge", response_model=ChallengeResponse)
async def get_challenge(
    public_key: str,
    db: AsyncSession = Depends(get_db)
) -> ChallengeResponse:
    # Validate public key
    try:
        Pubkey.from_string(public_key)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid public key")

    # Get or create user
    result = await db.execute(select(User).where(User.public_key == public_key))
    user = result.scalar_one_or_none()
    
    if not user:
        user = User(public_key=public_key)
        db.add(user)
    
    nonce = f"Sign this message to login to Tidal: {uuid.uuid4()}"
    user.nonce = nonce
    await db.commit()
    
    return ChallengeResponse(nonce=nonce)


def verify_solana_signature(public_key_str: str, signature_b58: str, message: str) -> bool:
    try:
        pubkey = Pubkey.from_string(public_key_str)
        signature_bytes = base58.b58decode(signature_b58)
        message_bytes = message.encode("utf-8")
        
        # solders Verify signature
        # verify(signature, message, public_key)
        from solders.signature import Signature
        sig = Signature.from_bytes(signature_bytes)
        return sig.verify(pubkey, message_bytes)
    except Exception:
        return False


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginBody,
    db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    result = await db.execute(select(User).where(User.public_key == body.public_key))
    user = result.scalar_one_or_none()
    
    if not user or not user.nonce:
        raise HTTPException(status_code=400, detail="Challenge not found. Call /challenge first.")
    
    # Check if the message matches the stored nonce
    if body.message != user.nonce:
        raise HTTPException(status_code=400, detail="Message mismatch")

    # Verify signature
    if not verify_solana_signature(body.public_key, body.signature, body.message):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature")

    # Success - Update last login and clear nonce
    user.last_login = datetime.datetime.utcnow()
    user.nonce = None
    await db.commit()
    
    # Create JWT
    access_token = create_access_token(data={"sub": str(user.id), "pubkey": user.public_key})
    
    return TokenResponse(
        access_token=access_token,
        user_id=str(user.id)
    )
