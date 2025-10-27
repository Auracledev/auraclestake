import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "@shared/cors.ts";
import { Connection, PublicKey, Transaction, Keypair, SystemProgram, LAMPORTS_PER_SOL } from 'npm:@solana/web3.js@1.87.6';
import { VAULT_WALLET } from "@shared/constants.ts";

const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const SECONDS_PER_WEEK = 7 * 24 * 60 * 60;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { walletAddress } = await req.json();

    if (!walletAddress) {
      throw new Error('Wallet address is required');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_KEY') ?? ''
    );

    // Get staker data with staked amount
    const { data: staker, error: stakerError } = await supabaseClient
      .from('stakers')
      .select('*')
      .eq('wallet_address', walletAddress)
      .single();

    if (stakerError || !staker) {
      throw new Error('Staker not found');
    }

    // Calculate real-time accrued rewards
    let totalRewards = parseFloat(staker.pending_rewards || 0);

    if (staker.staked_amount > 0) {
      // Get vault balance
      const connection = new Connection(MAINNET_RPC, 'confirmed');
      const vaultPublicKey = new PublicKey(VAULT_WALLET);
      const vaultBalance = await connection.getBalance(vaultPublicKey);
      const vaultSOL = vaultBalance / LAMPORTS_PER_SOL;

      // Get total staked
      const { data: allStakers } = await supabaseClient
        .from('stakers')
        .select('staked_amount')
        .gt('staked_amount', 0);

      const totalStaked = allStakers?.reduce((sum, s) => sum + parseFloat(s.staked_amount), 0) || 0;

      if (totalStaked > 0) {
        const stakedAmount = parseFloat(staker.staked_amount);
        const stakerShare = stakedAmount / totalStaked;
        
        // Calculate rewards per second
        const weeklyVaultDistribution = vaultSOL * 0.5;
        const userWeeklyReward = weeklyVaultDistribution * stakerShare;
        const rewardsPerSecond = userWeeklyReward / SECONDS_PER_WEEK;
        
        // Calculate time since last update
        const lastUpdated = new Date(staker.last_updated || staker.created_at);
        const now = new Date();
        const secondsSinceUpdate = (now.getTime() - lastUpdated.getTime()) / 1000;
        
        // Add accrued rewards
        const accruedRewards = rewardsPerSecond * secondsSinceUpdate;
        totalRewards += accruedRewards;
      }
    }

    if (totalRewards <= 0) {
      throw new Error('No rewards available to withdraw');
    }

    const vaultPrivateKey = Deno.env.get('VAULT_PRIVATE_KEY');
    if (!vaultPrivateKey) {
      throw new Error('Vault private key not configured');
    }

    const connection = new Connection(MAINNET_RPC, 'confirmed');
    const vaultKeypair = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(vaultPrivateKey))
    );

    const userPublicKey = new PublicKey(walletAddress);
    const lamports = Math.floor(totalRewards * LAMPORTS_PER_SOL);

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

    const signature = await connection.sendRawTransaction(transaction.serialize());
    await connection.confirmTransaction(signature, 'confirmed');

    // Reset pending rewards and update timestamp
    await supabaseClient
      .from('stakers')
      .update({ 
        pending_rewards: 0,
        last_updated: new Date().toISOString()
      })
      .eq('wallet_address', walletAddress);

    await supabaseClient
      .from('transactions')
      .insert({
        wallet_address: walletAddress,
        type: 'reward',
        amount: totalRewards,
        token: 'SOL',
        tx_signature: signature,
        status: 'completed'
      });

    await supabaseClient
      .from('rewards')
      .insert({
        wallet_address: walletAddress,
        amount: totalRewards,
        distribution_date: new Date().toISOString().split('T')[0],
        tx_signature: signature
      });

    return new Response(
      JSON.stringify({ 
        success: true, 
        signature,
        amount: totalRewards
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});