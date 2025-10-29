import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "@shared/cors.ts";
import { checkRateLimit, RATE_LIMIT_CONFIGS } from "@shared/rate-limiter.ts";
import { checkTransactionDuplicate } from "@shared/transaction-dedup.ts";
import { Connection, PublicKey, Transaction, Keypair, SystemProgram, LAMPORTS_PER_SOL } from 'npm:@solana/web3.js@1.87.6';
import { VAULT_ADDRESS, SIGNATURE_EXPIRY_MS } from "@shared/constants.ts";
import nacl from 'npm:tweetnacl@1.0.3';

const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const SECONDS_PER_WEEK = 7 * 24 * 60 * 60;
const WITHDRAWAL_LOCK_TIMEOUT = 30000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_KEY')) ?? ''
  );

  let walletAddress = '';

  try {
    const body = await req.json();
    const { walletAddress: wallet, message, signature, timestamp } = body;
    walletAddress = wallet;

    console.log('Withdrawal request:', { walletAddress, hasMessage: !!message, hasSignature: !!signature, timestamp });

    if (!walletAddress || !message || !signature) {
      throw new Error('Wallet address, message, and signature are required');
    }

    // Validate timestamp (5-minute expiry)
    if (timestamp) {
      const requestTime = new Date(timestamp).getTime();
      const now = Date.now();
      if (now - requestTime > SIGNATURE_EXPIRY_MS) {
        console.error('Signature expired:', { timestamp, now, diff: now - requestTime });
        return new Response(
          JSON.stringify({ error: 'Signature expired. Please try again.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Verify wallet signature
    try {
      console.log('Verifying signature...');
      const publicKey = new PublicKey(walletAddress);
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
      
      console.log('Message:', message);
      console.log('Signature length:', signatureBytes.length);
      
      const verified = nacl.sign.detached.verify(
        messageBytes,
        signatureBytes,
        publicKey.toBytes()
      );

      if (!verified) {
        console.error('Signature verification failed - signature does not match');
        throw new Error('Invalid signature');
      }

      console.log('Signature verified successfully');
    } catch (verifyError) {
      console.error('Signature verification failed:', verifyError);
      return new Response(
        JSON.stringify({ error: `Invalid wallet signature: ${verifyError.message}` }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check rate limit
    const rateLimitResult = await checkRateLimit(
      supabaseClient,
      `withdraw:${walletAddress}`,
      RATE_LIMIT_CONFIGS.withdraw
    );

    if (!rateLimitResult.allowed) {
      return new Response(
        JSON.stringify({ 
          error: `Rate limit exceeded. Please try again in ${rateLimitResult.retryAfter} seconds.` 
        }),
        { 
          status: 429, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json',
            'Retry-After': rateLimitResult.retryAfter?.toString() || '60'
          } 
        }
      );
    }

    await supabaseClient
      .from('withdrawal_locks')
      .delete()
      .lt('expires_at', new Date().toISOString());

    const { data: existingLock } = await supabaseClient
      .from('withdrawal_locks')
      .select('*')
      .eq('wallet_address', walletAddress)
      .single();

    if (existingLock) {
      throw new Error('Withdrawal already in progress. Please wait 30 seconds before trying again.');
    }

    const lockExpiry = new Date(Date.now() + WITHDRAWAL_LOCK_TIMEOUT);
    const { error: lockError } = await supabaseClient
      .from('withdrawal_locks')
      .insert({
        wallet_address: walletAddress,
        expires_at: lockExpiry.toISOString()
      });

    if (lockError) {
      if (lockError.code === '23505') {
        throw new Error('Withdrawal already in progress. Please wait 30 seconds before trying again.');
      }
      throw lockError;
    }

    let totalRewards = 0;
    let txSignature = '';
    let currentVersion = 0;

    try {
      const { data: staker, error: stakerError } = await supabaseClient
        .from('stakers')
        .select('*')
        .eq('wallet_address', walletAddress)
        .single();

      if (stakerError || !staker) {
        throw new Error('Staker not found');
      }

      currentVersion = staker.version || 1;
      totalRewards = parseFloat(staker.pending_rewards || 0);

      if (staker.staked_amount > 0) {
        const connection = new Connection(MAINNET_RPC, 'confirmed');
        const vaultPublicKey = new PublicKey(VAULT_ADDRESS);
        const vaultBalance = await connection.getBalance(vaultPublicKey);
        const vaultSOL = vaultBalance / LAMPORTS_PER_SOL;

        const { data: allStakers } = await supabaseClient
          .from('stakers')
          .select('staked_amount')
          .gt('staked_amount', 0);

        const totalStaked = allStakers?.reduce((sum, s) => sum + parseFloat(s.staked_amount), 0) || 0;

        if (totalStaked > 0) {
          const stakedAmount = parseFloat(staker.staked_amount);
          const stakerShare = stakedAmount / totalStaked;
          
          const weeklyVaultDistribution = vaultSOL * 0.5;
          const userWeeklyReward = weeklyVaultDistribution * stakerShare;
          const rewardsPerSecond = userWeeklyReward / SECONDS_PER_WEEK;
          
          const lastUpdated = new Date(staker.last_updated || staker.created_at);
          const now = new Date();
          const secondsSinceUpdate = (now.getTime() - lastUpdated.getTime()) / 1000;
          
          const accruedRewards = rewardsPerSecond * secondsSinceUpdate;
          totalRewards += accruedRewards;
        }
      }

      if (totalRewards <= 0) {
        throw new Error('No rewards available to withdraw');
      }

      const connection = new Connection(MAINNET_RPC, 'confirmed');
      const vaultPublicKey = new PublicKey(VAULT_ADDRESS);
      const vaultBalance = await connection.getBalance(vaultPublicKey);
      const vaultSOL = vaultBalance / LAMPORTS_PER_SOL;

      const lamports = Math.floor(totalRewards * LAMPORTS_PER_SOL);
      const requiredSOL = totalRewards + 0.001;

      if (vaultSOL < requiredSOL) {
        throw new Error(`Insufficient vault balance. Vault has ${vaultSOL.toFixed(4)} SOL but needs ${requiredSOL.toFixed(4)} SOL (including gas fees)`);
      }

      // CRITICAL FIX: Update database FIRST before sending SOL
      const { error: updateError } = await supabaseClient
        .from('stakers')
        .update({ 
          pending_rewards: 0,
          last_updated: new Date().toISOString(),
          version: currentVersion + 1
        })
        .eq('wallet_address', walletAddress)
        .eq('version', currentVersion);

      if (updateError) {
        console.error('Failed to update staker before withdrawal:', updateError);
        throw new Error('Failed to process withdrawal. Please try again.');
      }

      // Now send SOL after database is updated
      const vaultPrivateKey = Deno.env.get('VAULT_PRIVATE_KEY');
      if (!vaultPrivateKey) {
        throw new Error('Vault private key not configured');
      }

      console.log('Creating vault keypair...');
      let vaultKeypair;
      try {
        vaultKeypair = Keypair.fromSecretKey(
          new Uint8Array(JSON.parse(vaultPrivateKey))
        );
        console.log('Vault keypair created. Public key:', vaultKeypair.publicKey.toString());
        console.log('Expected vault address:', VAULT_ADDRESS);
        
        if (vaultKeypair.publicKey.toString() !== VAULT_ADDRESS) {
          throw new Error(`Vault keypair mismatch! Generated: ${vaultKeypair.publicKey.toString()}, Expected: ${VAULT_ADDRESS}`);
        }
      } catch (err) {
        throw new Error(`Failed to create vault keypair: ${err.message}`);
      }

      const userPublicKey = new PublicKey(walletAddress);
      console.log('Sending', totalRewards, 'SOL to:', walletAddress);

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: vaultKeypair.publicKey,
          toPubkey: userPublicKey,
          lamports,
        })
      );

      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = vaultKeypair.publicKey;
      transaction.sign(vaultKeypair);

      txSignature = await connection.sendRawTransaction(transaction.serialize());
      await connection.confirmTransaction(txSignature, 'confirmed');

      // Check if this transaction was already recorded
      const dedupResult = await checkTransactionDuplicate(supabaseClient, txSignature);
      if (dedupResult.isDuplicate) {
        console.log('Withdrawal transaction already recorded:', txSignature);
        return new Response(
          JSON.stringify({ 
            success: true,
            signature: txSignature,
            amount: totalRewards,
            message: 'Withdrawal already processed',
            existingTransaction: dedupResult.existingTx
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      await supabaseClient
        .from('transactions')
        .insert({
          wallet_address: walletAddress,
          type: 'reward',
          amount: totalRewards,
          token: 'SOL',
          tx_signature: txSignature,
          status: 'completed'
        });

      await supabaseClient
        .from('rewards')
        .insert({
          wallet_address: walletAddress,
          amount: totalRewards,
          distribution_date: new Date().toISOString().split('T')[0],
          tx_signature: txSignature
        });

    } finally {
      await supabaseClient
        .from('withdrawal_locks')
        .delete()
        .eq('wallet_address', walletAddress);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        signature: txSignature,
        amount: totalRewards
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    await supabaseClient
      .from('withdrawal_locks')
      .delete()
      .eq('wallet_address', walletAddress);

    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});