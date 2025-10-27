import { PublicKey } from 'npm:@solana/web3.js@1.87.6';
import nacl from 'npm:tweetnacl@1.0.3';
import bs58 from 'npm:bs58@5.0.0';

export async function verifyWalletSignature(
  walletAddress: string,
  signature: string,
  message: string
): Promise<boolean> {
  try {
    const publicKey = new PublicKey(walletAddress);
    const signatureBytes = bs58.decode(signature);
    const messageBytes = new TextEncoder().encode(message);
    
    return nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKey.toBytes()
    );
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

export function generateVerificationMessage(walletAddress: string, action: string): string {
  const timestamp = Date.now();
  return `Auracle Staking - ${action}\nWallet: ${walletAddress}\nTimestamp: ${timestamp}`;
}
