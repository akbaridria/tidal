import os
import time
import asyncio
import base58
import httpx
from dotenv import load_dotenv
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.system_program import TransferParams as SolTransferParams, transfer as sol_transfer
from solders.transaction import Transaction
from solders.message import Message
from solana.rpc.async_api import AsyncClient
from solana.rpc.types import TxOpts
from spl.token.instructions import (
    transfer as token_transfer, 
    TransferParams as TokenTransferParams,
    get_associated_token_address,
    create_associated_token_account
)

# Load environment variables from .env if present
load_dotenv()

# --- Configuration ---
API_BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:8000")
RPC_URL = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com")
PRIVATE_KEY_B58 = os.getenv("WALLET_PRIVATE_KEY")
# Read mint from .env or fallback to USDP Devnet
USDC_MINT_STR = os.getenv("USDC_MINT", "USDPqRbLidFGufty2s3oizmDEKdqx7ePTqzDMbf5ZKM")
USDC_MINT = Pubkey.from_string(USDC_MINT_STR) 

if not PRIVATE_KEY_B58:
    print("❌ ERROR: WALLET_PRIVATE_KEY environment variable is not set.")
    exit(1)

main_keypair = Keypair.from_base58_string(PRIVATE_KEY_B58)
main_pubkey = main_keypair.pubkey()

async def get_all_balances(client, sol_client, headers, main_pubkey, bot_pubkey):
    # Main Wallet Balances (directly from RPC)
    main_sol = (await sol_client.get_balance(main_pubkey)).value / 1e9
    
    main_usdc = 0.0
    try:
        main_ata = get_associated_token_address(main_pubkey, USDC_MINT)
        res = await sol_client.get_token_account_balance(main_ata)
        if res.value:
            main_usdc = float(res.value.ui_amount_string)
    except:
        pass

    # Bot & Pacifica Balances (from API)
    r = await client.get(f"{API_BASE_URL}/wallet/balances", headers=headers)
    api_data = r.json() if r.status_code == 200 else {}
    
    bot_sol = float(api_data.get("bot_wallet_balance", {}).get("sol") or 0.0)
    bot_usdc = float(api_data.get("bot_wallet_balance", {}).get("usdc") or 0.0)
    pac_margin = float(api_data.get("pacifica_balance", {}).get("available_margin_collateral") or 0.0)

    return {
        "main": {"sol": float(main_sol), "usdc": float(main_usdc)},
        "bot": {"sol": float(bot_sol), "usdc": float(bot_usdc)},
        "pacifica": {"margin": float(pac_margin)}
    }

def print_balance_table(title, balances):
    print(f"\n📊 {title}")
    print(f"{'Wallet':<12} | {'SOL':<10} | {'USDP':<10} | {'Pacifica':<10}")
    print("-" * 50)
    print(f"{'Main':<12} | {balances['main']['sol']:<10.4f} | {balances['main']['usdc']:<10.2f} | {'-':<10}")
    print(f"{'Bot':<12} | {balances['bot']['sol']:<10.4f} | {balances['bot']['usdc']:<10.2f} | {balances['pacifica']['margin']:<10.2f}")

async def poll_balance(client, headers, target="pacifica", expected_min=0.1, timeout=300):
    start = time.time()
    print(f"⏳ Polling {target} balance (waiting for at least: {expected_min:.4f})...")
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
            
            if val >= expected_min: 
                print(f"   ✅ Target reached! Current {target}: {val:.4f}")
                return True
            print(f"   > Current {target}: {val:.4f} (waiting for {expected_min:.4f})")
        await asyncio.sleep(5)
    return False

async def run_e2e():
    sol_client = AsyncClient(RPC_URL)
    async with httpx.AsyncClient(timeout=60.0) as client:
        # 1. AUTHENTICATION
        print("\n--- 1. Auth ---")
        r_challenge = await client.get(f"{API_BASE_URL}/auth/challenge", params={"public_key": str(main_pubkey)})
        r_challenge.raise_for_status()
        challenge = r_challenge.json()["nonce"]
        
        sig = main_keypair.sign_message(challenge.encode())
        r_login = await client.post(f"{API_BASE_URL}/auth/login", json={
            "public_key": str(main_pubkey), "signature": str(sig), "message": challenge
        })
        r_login.raise_for_status()
        token = r_login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        print(f"✅ Logged in as: {main_pubkey}")

        # 2. GET BOT WALLET
        print("\n--- 2. Bot Wallet Setup ---")
        balances_res = await client.get(f"{API_BASE_URL}/wallet/balances", headers=headers)
        if balances_res.status_code == 404:
            gen_res = await client.post(f"{API_BASE_URL}/generate-wallet", headers=headers)
            gen_res.raise_for_status()
            bot_pubkey_str = gen_res.json()["public_key"]
        else:
            bot_pubkey_str = balances_res.json()["public_key"]
        
        bot_pubkey = Pubkey.from_string(bot_pubkey_str)
        print(f"Bot Wallet: {bot_pubkey_str}")

        # INITIAL STATE
        current_balances = await get_all_balances(client, sol_client, headers, main_pubkey, bot_pubkey)
        print_balance_table("Initial State", current_balances)

        # 3. FUNDING BOT WALLET
        print("\n--- 3. Funding Bot Wallet (Main -> Bot) ---")
        
        print("Sending 0.01 SOL for gas...")
        target_sol = current_balances["bot"]["sol"] + 0.009 # Accounting for a tiny bit of fee if any
        blockhash = (await sol_client.get_latest_blockhash()).value.blockhash
        ix = sol_transfer(SolTransferParams(from_pubkey=main_pubkey, to_pubkey=bot_pubkey, lamports=10_000_000))
        tx = Transaction([main_keypair], Message([ix], main_pubkey), blockhash)
        await sol_client.send_transaction(tx, opts=TxOpts(skip_preflight=True))
        await poll_balance(client, headers, target="sol", expected_min=target_sol)

        print("Sending 25 USDP for capital...")
        target_usdp = current_balances["bot"]["usdc"] + 25.0
        main_ata = get_associated_token_address(main_pubkey, USDC_MINT)
        bot_ata = get_associated_token_address(bot_pubkey, USDC_MINT)

        # Check if bot_ata exists, if not create it
        ata_info = await sol_client.get_account_info(bot_ata)
        ixs_usdc = []
        if ata_info.value is None:
             print("   (Creating bot USDP ATA...)")
             ixs_usdc.append(create_associated_token_account(main_pubkey, bot_pubkey, USDC_MINT))

        ix_usdc = token_transfer(TokenTransferParams(
            program_id=Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
            source=main_ata, dest=bot_ata, owner=main_pubkey,
            amount=25_000_000
        ))
        ixs_usdc.append(ix_usdc)

        tx_usdc = Transaction([main_keypair], Message(ixs_usdc, main_pubkey), (await sol_client.get_latest_blockhash()).value.blockhash)
        await sol_client.send_transaction(tx_usdc)
        await poll_balance(client, headers, target="usdc", expected_min=target_usdp)

        current_balances = await get_all_balances(client, sol_client, headers, main_pubkey, bot_pubkey)
        print_balance_table("Post-Funding State", current_balances)

        # 4. DEPOSIT TO PACIFICA
        print("\n--- 4. Depositing to Pacifica Margin ---")
        target_pac = current_balances["pacifica"]["margin"] + 21.9
        dep_res = await client.post(f"{API_BASE_URL}/wallet/deposit-to-pacifica", json={"amount": 22.0}, headers=headers)
        dep_res.raise_for_status()
        await poll_balance(client, headers, target="pacifica", expected_min=target_pac)

        current_balances = await get_all_balances(client, sol_client, headers, main_pubkey, bot_pubkey)
        print_balance_table("Post-Deposit State", current_balances)

        # 5. EXECUTION
        print("\n--- 5. Strategy Execution ---")
        strat_res = await client.post(f"{API_BASE_URL}/strategies/from-preset", 
                                   json={"trading_pair": "BTC-PERP", "preset_id": "rsi_oversold"}, 
                                   headers=headers)
        strat_res.raise_for_status()
        strat = strat_res.json()["id"]
        
        start_res = await client.post(f"{API_BASE_URL}/start-bot", json={"strategy_id": strat}, headers=headers)
        start_res.raise_for_status()
        print("🚀 Bot is live.")
        
        # 5b. MANUAL SIGNAL INJECTION
        print("\n--- 5b. Manual Signal Injection ---")
        print("Injecting manual BUY signal...")
        sig_res = await client.post(f"{API_BASE_URL}/signal", 
                                json={"strategy_id": strat, "side": "buy"}, 
                                headers=headers)
        sig_res.raise_for_status()
        print(f"   > {sig_res.json()['message']}")

        # 5c. VERIFY TRADE LOG
        print("\n--- 5c. Verifying Trade Execution ---")
        for _ in range(12):
            await asyncio.sleep(5)
            logs_res = await client.get(f"{API_BASE_URL}/logs", 
                                    params={"strategy_id": strat, "limit": 5}, 
                                    headers=headers)
            logs = logs_res.json()
            
            # Print any new logs
            for l in logs:
                 print(f"   > [LOG] {l['level']}: {l['message']}")
                 
            trade_log = next((l for l in logs if l["level"] == "TRADE"), None)
            if trade_log:
                print(f"✅ Trade Executed Found: {trade_log['message']}")
                break
            
            error_log = next((l for l in logs if l["level"] == "ERROR"), None)
            if error_log:
                print(f"❌ Trade Error Found: {error_log['message']}")
                break
                
            print("   > Waiting for trade log...")
        else:
            print("⚠️ Timeout waiting for trade execution log.")

        await asyncio.sleep(5)
        stop_res = await client.post(f"{API_BASE_URL}/stop-bot", json={"strategy_id": strat}, headers=headers)
        stop_res.raise_for_status()
        print("✅ Bot stopped.")

        # 6. WITHDRAWAL (The "Exit" Flow)
        print("\n--- 6. Withdrawal (Pacifica -> Bot -> Main) ---")
        
        # Get balances before withdraw to set target
        pre_withdraw_balances = await get_all_balances(client, sol_client, headers, main_pubkey, bot_pubkey)
        # Any increase in balance means the withdrawal arrived (accounting for fees)
        target_bot_usdc = pre_withdraw_balances["bot"]["usdc"] + 0.1

        print("Step A: Withdrawing from Pacifica to Bot Wallet...")
        withdraw_p = await client.post(f"{API_BASE_URL}/wallet/withdraw-from-pacifica", json={"amount": 21.5}, headers=headers)
        withdraw_p.raise_for_status()
        print(f"   > Withdrawal request sent. TX: {withdraw_p.json().get('transaction_hash')}")
        
        # Wait for funds to return to Bot Wallet USDP balance
        await poll_balance(client, headers, target="usdc", expected_min=target_bot_usdc)

        current_balances = await get_all_balances(client, sol_client, headers, main_pubkey, bot_pubkey)
        print_balance_table("Post-Pacifica-Withdraw State", current_balances)

        print("Step B: Sending funds from Bot Wallet back to Main Wallet...")
        # Get main balance before final transfer to verify
        main_usdc_before = current_balances["main"]["usdc"]
        
        # Determine exactly how much the bot wallet can send back (leave some for dust if necessary)
        available_to_withdraw = current_balances["bot"]["usdc"]
        withdraw_amount = min(21.0, available_to_withdraw)
        
        withdraw_m = await client.post(f"{API_BASE_URL}/wallet/withdraw-to-user", 
                                    json={"amount": withdraw_amount, "destination_address": str(main_pubkey)}, 
                                    headers=headers)
        withdraw_m.raise_for_status()
        
        print("\n🏁 Final State Verification:")
        # Poll main wallet balance via RPC to confirm receipt (expect at least some increase)
        target_main_usdc = main_usdc_before + (withdraw_amount - 0.5) # Account for potential minor fees
        print(f"⏳ Waiting for {main_pubkey} to receive at least {withdraw_amount - 0.5:.2f} USDP...")
        for _ in range(12):
            await asyncio.sleep(5)
            main_ata = get_associated_token_address(main_pubkey, USDC_MINT)
            res = await sol_client.get_token_account_balance(main_ata)
            if res.value and float(res.value.ui_amount_string) >= target_main_usdc:
                print(f"   ✅ Main wallet received funds! New balance: {res.value.ui_amount_string}")
                break
        
        final_balances = await get_all_balances(client, sol_client, headers, main_pubkey, bot_pubkey)
        print_balance_table("Final State", final_balances)
        
        print(f"\n✅ E2E Test Completed Successfully! TX: {withdraw_m.json().get('transaction_signature')}")


if __name__ == "__main__":
    asyncio.run(run_e2e())
