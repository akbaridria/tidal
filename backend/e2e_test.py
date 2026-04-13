import os
import time
import asyncio
import base58
import httpx
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.system_program import TransferParams, transfer
from solders.transaction import Transaction
from solders.message import Message
from solana.rpc.async_api import AsyncClient
from solana.rpc.types import TxOpts
from spl.token.instructions import transfer_checked, TransferCheckedParams, get_associated_token_address

# --- Configuration ---
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000/api/v1")
RPC_URL = os.getenv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
PRIVATE_KEY_B58 = os.getenv("WALLET_PRIVATE_KEY")
# USDC Mint (Standard Mainnet: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)
USDC_MINT = Pubkey.from_string("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") 

if not PRIVATE_KEY_B58:
    print("❌ ERROR: WALLET_PRIVATE_KEY environment variable is not set.")
    exit(1)

main_keypair = Keypair.from_base58_string(PRIVATE_KEY_B58)
main_pubkey = main_keypair.pubkey()

async def poll_balance(client, headers, target="pacifica", min_amount=0.1, timeout=300):
    start = time.time()
    print(f"⏳ Polling {target} balance (target min: {min_amount})...")
    while time.time() - start < timeout:
        r = await client.get(f"{API_BASE_URL}/wallet/balances", headers=headers)
        if r.status_code == 200:
            data = r.json()
            if target == "sol":
                val = float(data["bot_wallet_balance"]["sol"])
            elif target == "usdc":
                val = float(data["bot_wallet_balance"]["usdc"])
            else:
                val = float(data["pacifica_balance"]["available_margin_collateral"] or 0)
            
            print(f"   > Current {target}: {val}")
            if val >= min_amount: return True
        await asyncio.sleep(10)
    return False

async def run_e2e():
    sol_client = AsyncClient(RPC_URL)
    async with httpx.AsyncClient(timeout=60.0) as client:
        # 1. AUTHENTICATION
        print("\n--- 1. Auth ---")
        challenge = (await client.get(f"{API_BASE_URL}/auth/challenge", params={"public_key": str(main_pubkey)})).json()["nonce"]
        sig = main_keypair.sign_message(challenge.encode())
        token = (await client.post(f"{API_BASE_URL}/auth/login", json={
            "public_key": str(main_pubkey), "signature": str(sig), "message": challenge
        })).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        print(f"✅ Logged in as: {main_pubkey}")

        # 2. GET BOT WALLET
        print("\n--- 2. Bot Wallet Setup ---")
        balances = await client.get(f"{API_BASE_URL}/wallet/balances", headers=headers)
        if balances.status_code == 404:
            bot_pubkey_str = (await client.post(f"{API_BASE_URL}/generate-wallet", headers=headers)).json()["public_key"]
        else:
            bot_pubkey_str = balances.json()["public_key"]
        bot_pubkey = Pubkey.from_string(bot_pubkey_str)
        print(f"Bot Wallet: {bot_pubkey_str}")

        # 3. FUNDING BOT WALLET
        print("\n--- 3. Funding Bot Wallet (Main -> Bot) ---")
        print("Sending 0.01 SOL for gas...")
        blockhash = (await sol_client.get_latest_blockhash()).value.blockhash
        ix = transfer(TransferParams(from_pubkey=main_pubkey, to_pubkey=bot_pubkey, lamports=10_000_000))
        tx = Transaction([main_keypair], Message([ix], main_pubkey), blockhash)
        await sol_client.send_transaction(tx, opts=TxOpts(skip_preflight=True))
        await poll_balance(client, headers, target="sol", min_amount=0.009)

        print("Sending 5 USDC for capital...")
        main_ata = get_associated_token_address(main_pubkey, USDC_MINT)
        bot_ata = get_associated_token_address(bot_pubkey, USDC_MINT)
        ix_usdc = transfer_checked(TransferCheckedParams(
            program_id=Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
            source=main_ata, mint=USDC_MINT, dest=bot_ata, owner=main_pubkey,
            amount=5_000_000, decimals=6
        ))
        tx_usdc = Transaction([main_keypair], Message([ix_usdc], main_pubkey), (await sol_client.get_latest_blockhash()).value.blockhash)
        await sol_client.send_transaction(tx_usdc)
        await poll_balance(client, headers, target="usdc", min_amount=4.9)

        # 4. DEPOSIT TO PACIFICA
        print("\n--- 4. Depositing to Pacifica Margin ---")
        await client.post(f"{API_BASE_URL}/wallet/deposit-to-pacifica", json={"amount": 4.0}, headers=headers)
        await poll_balance(client, headers, target="pacifica", min_amount=3.9)

        # 5. EXECUTION
        print("\n--- 5. Strategy Execution ---")
        strat = (await client.post(f"{API_BASE_URL}/strategies/from-preset", 
                                   json={"trading_pair": "BTC-PERP", "preset_id": "rsi_oversold"}, 
                                   headers=headers)).json()["id"]
        await client.post(f"{API_BASE_URL}/start-bot", json={"strategy_id": strat}, headers=headers)
        print("🚀 Bot is live. Waiting 30s...")
        await asyncio.sleep(30)
        await client.post(f"{API_BASE_URL}/stop-bot", json={"strategy_id": strat}, headers=headers)
        print("✅ Bot stopped.")

        # 6. WITHDRAWAL (The "Exit" Flow)
        print("\n--- 6. Withdrawal (Pacifica -> Bot -> Main) ---")
        
        print("Step A: Withdrawing from Pacifica to Bot Wallet...")
        withdraw_p = await client.post(f"{API_BASE_URL}/wallet/withdraw-from-pacifica", json={"amount": 3.5}, headers=headers)
        withdraw_p.raise_for_status()
        print(f"   > Withdrawal request sent. TX: {withdraw_p.json().get('transaction_hash')}")
        # Wait for funds to return to Bot Wallet USDC balance
        await poll_balance(client, headers, target="usdc", min_amount=3.4)

        print("Step B: Sending funds from Bot Wallet back to Main Wallet...")
        withdraw_m = await client.post(f"{API_BASE_URL}/wallet/withdraw-to-user", 
                                       json={"amount": 3.0, "destination_address": str(main_pubkey)}, 
                                       headers=headers)
        withdraw_m.raise_for_status()
        print(f"✅ Final Transfer Complete! TX: {withdraw_m.json().get('transaction_signature')}")

        print("\n🏁 E2E Test Completed Successfully!")

if __name__ == "__main__":
    asyncio.run(run_e2e())
