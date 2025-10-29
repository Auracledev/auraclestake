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
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  getAccount
} from '@solana/spl-token';
import { VAULT_WALLET, AURACLE_MINT } from './supabase';

const MAINNET_RPC = 'https://mainnet.helius-rpc.com/?api-key=e9ab9721-93fa-4533-b148-7e240bd38192';

// AURACLE token has 6 decimals
const AURACLE_DECIMALS = 6;

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
    const balance = Number(accountInfo.amount) / Math.pow(10, AURACLE_DECIMALS);
    
    if (balance < amount) {
      throw new Error(`Insufficient balance. You have ${balance.toLocaleString()} AURACLE but tried to stake ${amount}`);
    }
  } catch (error: any) {
    if (error.message.includes('Insufficient balance')) {
      throw error;
    }
    throw new Error('Token account not found. Please ensure you have AURACLE tokens in your wallet.');
  }

  const transaction = new Transaction();

  // Add memo instruction to explain the transaction
  const memoInstruction = new TransactionInstruction({
    keys: [],
    programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
    data: Buffer.from(`Auracle Staking: Stake ${amount} AURACLE to earn SOL rewards`)
  });
  transaction.add(memoInstruction);

  // Check if vault token account exists, if not create it
  try {
    await getAccount(connection, toTokenAccount);
  } catch (error) {
    // Account doesn't exist, add instruction to create it
    const createAccountIx = createAssociatedTokenAccountInstruction(
      walletPublicKey, // payer
      toTokenAccount, // account to create
      vaultPublicKey, // owner
      mintPublicKey // mint
    );
    transaction.add(createAccountIx);
  }

  // Add transfer instruction
  const transferInstruction = createTransferInstruction(
    fromTokenAccount,
    toTokenAccount,
    walletPublicKey,
    BigInt(Math.floor(amount * Math.pow(10, AURACLE_DECIMALS))),
    [],
    TOKEN_PROGRAM_ID
  );
  
  transaction.add(transferInstruction);
  
  // Get latest blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = walletPublicKey;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  
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

  const transaction = new Transaction();

  // Check if user's token account exists, if not create it
  try {
    await getAccount(connection, toTokenAccount);
  } catch (error) {
    // Account doesn't exist, add instruction to create it
    const createAccountIx = createAssociatedTokenAccountInstruction(
      walletPublicKey, // payer (user pays for account creation)
      toTokenAccount,
      walletPublicKey,
      mintPublicKey
    );
    transaction.add(createAccountIx);
  }

  // Create transfer instruction - vault is the authority but user initiates
  const transferInstruction = createTransferInstruction(
    fromTokenAccount,
    toTokenAccount,
    vaultPublicKey, // vault is the authority (will be signed by backend)
    BigInt(Math.floor(amount * Math.pow(10, AURACLE_DECIMALS))),
    [],
    TOKEN_PROGRAM_ID
  );
  
  transaction.add(transferInstruction);
  
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = walletPublicKey; // User pays fees
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  
  return transaction;
}

export async function getTokenBalance(walletPublicKey: PublicKey): Promise<number> {
  try {
    const mintPublicKey = new PublicKey(AURACLE_MINT);
    const tokenAccount = await getAssociatedTokenAddress(
      mintPublicKey,
      walletPublicKey
    );
    
    const accountInfo = await getAccount(connection, tokenAccount);
    // Convert BigInt to string first to preserve precision
    const rawAmount = accountInfo.amount.toString();
    console.log('Raw token amount:', rawAmount);
    const balance = parseFloat(rawAmount) / Math.pow(10, AURACLE_DECIMALS);
    console.log('Calculated balance:', balance);
    return balance;
  } catch (error) {
    console.error('Error fetching token balance:', error);
    return 0;
  }
}