import { SOLANA_RPC_URL, VAULT_ADDRESS, AURACLE_MINT, AURACLE_DECIMALS } from "./constants.ts";

interface TransactionVerificationResult {
  isValid: boolean;
  error?: string;
  actualAmount?: number;
  fromAddress?: string;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function verifyStakeTransaction(
  txSignature: string,
  expectedWallet: string,
  expectedAmount: number
): Promise<TransactionVerificationResult> {
  // Retry with exponential backoff: 2s, 4s, 8s (total 14s max wait)
  const retryDelays = [2000, 4000, 8000];
  
  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    try {
      console.log(`Verifying transaction (attempt ${attempt + 1}/${retryDelays.length + 1}):`, { txSignature, expectedWallet, expectedAmount });

      // Fetch transaction details from Helius
      const response = await fetch(SOLANA_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'verify-tx',
          method: 'getTransaction',
          params: [
            txSignature,
            {
              encoding: 'jsonParsed',
              maxSupportedTransactionVersion: 0
            }
          ]
        })
      });

      const data = await response.json();

      if (data.error) {
        console.error('RPC error:', data.error);
        
        // If transaction not found and we have retries left, wait and retry
        if (attempt < retryDelays.length) {
          console.log(`Transaction not found, retrying in ${retryDelays[attempt]}ms...`);
          await sleep(retryDelays[attempt]);
          continue;
        }
        
        return { isValid: false, error: `Transaction not found: ${data.error.message}` };
      }

      const tx = data.result;

      if (!tx) {
        // If transaction not found and we have retries left, wait and retry
        if (attempt < retryDelays.length) {
          console.log(`Transaction not indexed yet, retrying in ${retryDelays[attempt]}ms...`);
          await sleep(retryDelays[attempt]);
          continue;
        }
        
        return { isValid: false, error: 'Transaction not found on blockchain' };
      }

      // Check if transaction was successful
      if (tx.meta?.err) {
        return { isValid: false, error: 'Transaction failed on blockchain' };
      }

      // Verify the signer matches expected wallet
      const accountKeys = tx.transaction?.message?.accountKeys || [];
      const signers = accountKeys.filter((key: any) => key.signer);
      const txSigner = signers[0]?.pubkey;
      
      if (txSigner !== expectedWallet) {
        console.error('Wallet mismatch:', { txSigner, expectedWallet });
        return { 
          isValid: false, 
          error: 'Transaction signer does not match wallet address' 
        };
      }

      // Check token balance changes to verify the transfer
      const preBalances = tx.meta?.preTokenBalances || [];
      const postBalances = tx.meta?.postTokenBalances || [];
      
      console.log('Token balances:', { preBalances, postBalances });

      // Find the vault's token account in post balances
      const vaultPostBalance = postBalances.find((b: any) => b.owner === VAULT_ADDRESS && b.mint === AURACLE_MINT);
      const vaultPreBalance = preBalances.find((b: any) => b.owner === VAULT_ADDRESS && b.mint === AURACLE_MINT);

      if (!vaultPostBalance) {
        console.error('Vault token account not found in transaction');
        return { isValid: false, error: 'No AURACLE transfer to vault found in transaction' };
      }

      // Calculate the amount transferred
      const preAmount = vaultPreBalance ? parseFloat(vaultPreBalance.uiTokenAmount?.uiAmount || 0) : 0;
      const postAmount = parseFloat(vaultPostBalance.uiTokenAmount?.uiAmount || 0);
      const actualAmount = postAmount - preAmount;

      console.log('Amount verification:', { preAmount, postAmount, actualAmount, expectedAmount });

      // Verify amount matches (with small tolerance for rounding)
      const tolerance = 0.000001;
      if (Math.abs(actualAmount - expectedAmount) > tolerance) {
        console.error('Amount mismatch:', { actualAmount, expectedAmount, diff: Math.abs(actualAmount - expectedAmount) });
        return { 
          isValid: false, 
          error: `Amount mismatch: expected ${expectedAmount}, got ${actualAmount}` 
        };
      }

      console.log('Transaction verified successfully');
      return { 
        isValid: true, 
        actualAmount,
        fromAddress: txSigner
      };

    } catch (error) {
      console.error('Transaction verification error:', error);
      
      // If we have retries left, wait and retry
      if (attempt < retryDelays.length) {
        console.log(`Verification error, retrying in ${retryDelays[attempt]}ms...`);
        await sleep(retryDelays[attempt]);
        continue;
      }
      
      return { 
        isValid: false, 
        error: `Verification failed: ${error.message}` 
      };
    }
  }
  
  // Should never reach here, but just in case
  return { isValid: false, error: 'Transaction verification timed out' };
}