# Tidal Trading

Tidal is an algorithmic trading platform built on the Solana blockchain, specifically integrating with the **Pacifica Protocol** for perpetual futures trading. It allows users to define technical analysis strategies (like RSI or MACD crossovers), fund a dedicated on-chain bot wallet, and automatically execute trades in isolated margin subaccounts.

## Architecture & Margin Isolation

To ensure that different trading strategies do not interfere with each other (e.g., conflicting positions on the same trading pair) and to provide isolated risk management, Tidal uses a multi-tiered wallet architecture:

1. **User's Main Wallet**: The user's personal Solana wallet (e.g., Phantom).
2. **Bot Wallet (1 per User)**: A dedicated Solana Keypair managed by the Tidal backend. It acts as the central treasury for the user's trading operations. The user deposits USDP from their Main Wallet to this Bot Wallet, and then deposits it into the Pacifica Protocol's main margin account.
3. **Strategy Subaccounts (1 per Strategy)**: Whenever a user starts a new trading strategy, Tidal creates an isolated **Pacifica Subaccount** under the main Bot Wallet. Funds are transferred from the main margin to the subaccount. This ensures:
    * **Position Isolation**: Strategy A trading BTC-PERP will not block Strategy B from trading BTC-PERP.
    * **Risk Isolation**: If a strategy gets liquidated, it only affects the funds allocated to that specific subaccount.

## User Journey

```mermaid
journey
    title Tidal Trading User Journey
    section Authentication & Setup
      User connects Main Wallet: 5: User
      Backend issues challenge: 5: Backend
      User signs challenge (Login): 5: User
      Backend generates Bot Wallet: 5: Backend
    section Funding
      Transfer USDP (Main -> Bot): 4: User, Solana
      Deposit USDP to Pacifica: 4: Bot Wallet, Pacifica
    section Strategy Execution
      User selects/creates Strategy: 5: User
      Backend creates Pacifica Subaccount: 5: Backend, Pacifica
      Backend funds Subaccount: 5: Backend, Pacifica
      Bot evaluates market data (WebSocket): 5: Backend, Pacifica
      Bot executes Market Order: 5: Backend, Pacifica
    section Withdrawal
      Stop Strategy & return funds to Bot: 4: User, Backend
      Withdraw from Pacifica to Bot Wallet: 4: Bot Wallet, Pacifica
      Withdraw from Bot Wallet to Main: 4: User, Solana
```

## Local Development Setup

### Prerequisites
- Python 3.12+
- PostgreSQL
- Redis

### 1. Virtual Environment
Navigate to the `backend` directory and set up a virtual environment:
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Environment Variables
Ensure you have a `.env` file in the `backend/` directory. Example:
```env
PROJECT_NAME="Tidal Trading"
SECRET_KEY="your_jwt_secret"
SYMMETRIC_ENCRYPTION_KEY="your_fernet_key" # Run: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

DATABASE_URL="postgresql+asyncpg://user:password@localhost:5432/tidal"
REDIS_URL="redis://localhost:6379/0"

SOLANA_RPC_URL="https://api.devnet.solana.com"
USDC_MINT="USDPqRbLidFGufty2s3oizmDEKdqx7ePTqzDMbf5ZKM" # Devnet USDP

PACIFICA_API_BASE_URL="https://test-api.pacifica.fi"
PACIFICA_PROGRAM_ID="peRPsYCcB1J9jvrs29jiGdjkytxs8uHLmSPLKKP9ptm"
PACIFICA_DEPOSIT_CENTRAL_STATE="2zPRq1Qvdq5A4Ld6WsH7usgCge4ApZRYfhhf5VAjfXxv"
PACIFICA_DEPOSIT_VAULT="5SDFdHZGTZbyRYu54CgmRkCGnPHC5pYaN27p7XGLqnBs"
TRADING_MIN_MARGIN_USD="10"

# Only for E2E Test script
WALLET_PRIVATE_KEY="your_base58_private_key"
```

### 3. Running the Server
```bash
uvicorn main:app --reload
```

## End-to-End Testing

Tidal includes a comprehensive E2E test script that simulates the entire lifecycle of a user, from authentication and funding, to isolated strategy execution and withdrawal.

To run the test (ensure the FastAPI server is running in another terminal):
```bash
cd backend
source .venv/bin/activate
python e2e_test.py
```
This script will output a detailed balance table at each step, verifying the correct flow of funds across the Main Wallet, Bot Wallet, and Pacifica Margin.
