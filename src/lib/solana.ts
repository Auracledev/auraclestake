import { 
  Connection, 
  PublicKey, 
  Transaction, 
  TransactionInstruction, 
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction
} from '@solana/web3.js';
import { 
  getAssociatedTokenAddress, 
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  getAccount
} from '@solana/spl-token';
import { VAULT_WALLET, AURACLE_MINT } from './supabase';

const MAINNET_RPC = 'https://mainnet.helius-rpc.com/?api-key=e9ab9721-93fa-4533-b148-7e240bd38192';

export const connection = new Connection(MAINNET_RPC, 'confirmed');

export async function createStakeTransaction(
  walletPublicKey: PublicKey,
  amount: number
): Promise<Transaction> {
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

  // Check if user has token account and balance
  try {
    const accountInfo = await getAccount(connection, fromTokenAccount);
    const balance = Number(accountInfo.amount) / Math.pow(10, 9);
    
    if (balance < amount) {
      throw new Error(`Insufficient balance. You have ${balance.toFixed(2)} AURACLE but tried to stake ${amount}`);
    }
  } catch (error: any) {
    if (error.message.includes('Insufficient balance')) {
      throw error;
    }
    throw new Error('Token account not found. Please ensure you have AURACLE tokens in your wallet.');
  }

  const instructions: TransactionInstruction[] = [];
  
  // 1. Set compute unit limit (helps with simulation)
  instructions.push(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: 100_000
    })
  );
  
  // 2. Set compute unit price (priority fee)
  instructions.push(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 5000
    })
  );
  
  // 3. Main transfer instruction
  instructions.push(
    createTransferInstruction(
      fromTokenAccount,
      toTokenAccount,
      walletPublicKey,
      BigInt(Math.floor(amount * Math.pow(10, 9))),
      [],
      TOKEN_PROGRAM_ID
    )
  );
  
  // Create transaction with proper structure
  const transaction = new Transaction();
  transaction.add(...instructions);
  
  // Get latest blockhash with confirmed commitment
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = walletPublicKey;
  
  return transaction;
}

export async function createUnstakeTransaction(
  walletPublicKey: PublicKey,
  amount: number
): Promise<Transaction> {
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

  const instructions: TransactionInstruction[] = [];
  
  // 1. Set compute unit limit
  instructions.push(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: 100_000
    })
  );
  
  // 2. Set compute unit price
  instructions.push(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 5000
    })
  );
  
  // 3. Main transfer instruction
  instructions.push(
    createTransferInstruction(
      fromTokenAccount,
      toTokenAccount,
      vaultPublicKey,
      BigInt(Math.floor(amount * Math.pow(10, 9))),
      [],
      TOKEN_PROGRAM_ID
    )
  );
  
  const transaction = new Transaction();
  transaction.add(...instructions);
  
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
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