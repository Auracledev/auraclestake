import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { 
  getAssociatedTokenAddress, 
  createTransferInstruction,
  TOKEN_PROGRAM_ID 
} from '@solana/spl-token';
import { VAULT_WALLET, AURACLE_MINT } from './supabase';

const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

export const connection = new Connection(MAINNET_RPC, 'confirmed');

export async function createStakeTransaction(
  walletPublicKey: PublicKey,
  amount: number
): Promise<Transaction> {
  const transaction = new Transaction();
  
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
  
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = walletPublicKey;
  
  return transaction;
}

export async function createUnstakeTransaction(
  walletPublicKey: PublicKey,
  amount: number
): Promise<Transaction> {
  const transaction = new Transaction();
  
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
  
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
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