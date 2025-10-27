import { Connection, PublicKey, Transaction, SystemProgram, TransactionInstruction, ComputeBudgetProgram } from '@solana/web3.js';
import { 
  getAssociatedTokenAddress, 
  createTransferInstruction,
  TOKEN_PROGRAM_ID 
} from '@solana/spl-token';
import { VAULT_WALLET, AURACLE_MINT } from './supabase';

const MAINNET_RPC = 'https://mainnet.helius-rpc.com/?api-key=e9ab9721-93fa-4533-b148-7e240bd38192';

export const connection = new Connection(MAINNET_RPC, 'confirmed');

// Create a memo instruction to add context to transactions
function createMemoInstruction(memo: string, signer: PublicKey): TransactionInstruction {
  const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
  return new TransactionInstruction({
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo, 'utf-8'),
  });
}

export async function createStakeTransaction(
  walletPublicKey: PublicKey,
  amount: number
): Promise<Transaction> {
  const transaction = new Transaction();
  
  // Add compute budget to ensure transaction has enough compute units
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 200_000
  });
  transaction.add(computeBudgetIx);
  
  // Add priority fee to help with transaction landing
  const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1000
  });
  transaction.add(priorityFeeIx);
  
  // Add memo instruction for transparency
  const memoInstruction = createMemoInstruction(
    `Auracle Staking: Stake ${amount} AURACLE`,
    walletPublicKey
  );
  transaction.add(memoInstruction);
  
  const mintPublicKey = new PublicKey(AURACLE_MINT);
  const vaultPublicKey = new PublicKey(VAULT_WALLET);
  
  const fromTokenAccount = await getAssociatedTokenAddress(
    mintPublicKey,
    walletPublicKey
  );
  
  const toTokenAccount = await getAssociatedTokenAddress(
    mintPublicKey,
    vaultPublicKey
  );
  
  const transferInstruction = createTransferInstruction(
    fromTokenAccount,
    toTokenAccount,
    walletPublicKey,
    amount * Math.pow(10, 9),
    [],
    TOKEN_PROGRAM_ID
  );
  
  transaction.add(transferInstruction);
  
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = walletPublicKey;
  
  return transaction;
}

export async function createUnstakeTransaction(
  walletPublicKey: PublicKey,
  amount: number
): Promise<Transaction> {
  const transaction = new Transaction();
  
  // Add compute budget to ensure transaction has enough compute units
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 200_000
  });
  transaction.add(computeBudgetIx);
  
  // Add priority fee to help with transaction landing
  const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1000
  });
  transaction.add(priorityFeeIx);
  
  // Add memo instruction for transparency
  const memoInstruction = createMemoInstruction(
    `Auracle Staking: Unstake ${amount} AURACLE`,
    walletPublicKey
  );
  transaction.add(memoInstruction);
  
  const mintPublicKey = new PublicKey(AURACLE_MINT);
  const vaultPublicKey = new PublicKey(VAULT_WALLET);
  
  const fromTokenAccount = await getAssociatedTokenAddress(
    mintPublicKey,
    vaultPublicKey
  );
  
  const toTokenAccount = await getAssociatedTokenAddress(
    mintPublicKey,
    walletPublicKey
  );
  
  const transferInstruction = createTransferInstruction(
    fromTokenAccount,
    toTokenAccount,
    vaultPublicKey,
    amount * Math.pow(10, 9),
    [],
    TOKEN_PROGRAM_ID
  );
  
  transaction.add(transferInstruction);
  
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = walletPublicKey;
  
  return transaction;
}

export async function getTokenBalance(walletPublicKey: PublicKey): Promise<number> {
  try {
    const mintPublicKey = new PublicKey(AURACLE_MINT);
    const tokenAccount = await getAssociatedTokenAddress(
      mintPublicKey,
      walletPublicKey
    );
    
    const balance = await connection.getTokenAccountBalance(tokenAccount);
    return parseFloat(balance.value.uiAmount?.toString() || '0');
  } catch (error) {
    console.error('Error fetching token balance:', error);
    return 0;
  }
}