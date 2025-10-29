import { SOLANA_RPC_URL, VAULT_ADDRESS, AURACLE_MINT, AURACLE_DECIMALS } from "./constants.ts";

interface TransactionVerificationResult {
  isValid: boolean;
  error?: string;
  actualAmount?: number;
  fromAddress?: string;
}

export async function verifyStakeTransaction(
  txSignature: string,
  expectedWallet: string,
  expectedAmount: number
): Promise<TransactionVerificationResult> {
  try {
    console.log('Verifying transaction:', { txSignature, expectedWallet, expectedAmount });

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
      return { isValid: false, error: `Transaction not found: ${data.error.message}` };
    }

    const tx = data.result;

    if (!tx) {
      return { isValid: false, error: 'Transaction not found on blockchain' };
    }

    // Check if transaction was successful
    if (tx.meta?.err) {
      return { isValid: false, error: 'Transaction failed on blockchain' };
    }

    // Parse token transfer instructions
    const instructions = tx.transaction?.message?.instructions || [];
    let tokenTransferFound = false;
    let actualAmount = 0;
    let fromAddress = '';

    for (const instruction of instructions) {
      // Check for SPL token transfer
      if (instruction.program === 'spl-token' && instruction.parsed?.type === 'transfer') {
        const info = instruction.parsed.info;
        
        // Verify it's the correct token mint
        if (info.mint === AURACLE_MINT) {
          // Verify destination is the vault
          if (info.destination && tx.meta?.postTokenBalances) {
            const destBalance = tx.meta.postTokenBalances.find(
              (b: any) => b.accountIndex === instruction.parsed.info.destinationIndex
            );
            
            if (destBalance?.owner === VAULT_ADDRESS) {
              tokenTransferFound = true;
              actualAmount = parseFloat(info.amount) / Math.pow(10, AURACLE_DECIMALS);
              fromAddress = info.authority || info.source;
              
              console.log('Token transfer found:', { actualAmount, fromAddress, expectedAmount, expectedWallet });
              break;
            }
          }
        }
      }

      // Also check for transferChecked instruction
      if (instruction.program === 'spl-token' && instruction.parsed?.type === 'transferChecked') {
        const info = instruction.parsed.info;
        
        if (info.mint === AURACLE_MINT) {
          if (info.destination && tx.meta?.postTokenBalances) {
            const destBalance = tx.meta.postTokenBalances.find(
              (b: any) => b.accountIndex === instruction.parsed.info.destinationIndex
            );
            
            if (destBalance?.owner === VAULT_ADDRESS) {
              tokenTransferFound = true;
              actualAmount = parseFloat(info.tokenAmount?.amount || info.amount) / Math.pow(10, AURACLE_DECIMALS);
              fromAddress = info.authority || info.source;
              
              console.log('Token transferChecked found:', { actualAmount, fromAddress, expectedAmount, expectedWallet });
              break;
            }
          }
        }
      }
    }

    if (!tokenTransferFound) {
      return { isValid: false, error: 'No valid AURACLE token transfer to vault found in transaction' };
    }

    // Verify the sender matches expected wallet
    const signers = tx.transaction?.message?.accountKeys?.filter((key: any) => key.signer) || [];
    const txSigner = signers[0]?.pubkey;
    
    if (txSigner !== expectedWallet) {
      console.error('Wallet mismatch:', { txSigner, expectedWallet });
      return { 
        isValid: false, 
        error: 'Transaction signer does not match wallet address' 
      };
    }

    // Verify amount matches (with small tolerance for rounding)
    const tolerance = 0.000001; // 1 lamport tolerance
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
    return { 
      isValid: false, 
      error: `Verification failed: ${error.message}` 
    };
  }
}
