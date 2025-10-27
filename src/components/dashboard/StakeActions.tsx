import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect } from "react";
import { ArrowDownRight, ArrowUpRight, Loader2, RefreshCw } from "lucide-react";
import { useWallet } from '@solana/wallet-adapter-react';
import { createStakeTransaction, createUnstakeTransaction, getTokenBalance, connection } from '@/lib/solana';
import { supabase } from '@/lib/supabase';
import { useToast } from "@/components/ui/use-toast";

interface StakeActionsProps {
  stakedAmount?: number;
  onStake?: (amount: number) => void;
  onUnstake?: (amount: number) => void;
}

export default function StakeActions({ 
  stakedAmount = 0, 
  onStake = () => {}, 
  onUnstake = () => {} 
}: StakeActionsProps) {
  const [stakeAmount, setStakeAmount] = useState("");
  const [unstakeAmount, setUnstakeAmount] = useState("");
  const [isStaking, setIsStaking] = useState(false);
  const [isUnstaking, setIsUnstaking] = useState(false);
  const [availableBalance, setAvailableBalance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const { publicKey, signTransaction } = useWallet();
  const { toast } = useToast();

  useEffect(() => {
    if (publicKey) {
      fetchBalance();
    }
  }, [publicKey]);

  const fetchBalance = async () => {
    if (!publicKey) return;
    setIsRefreshing(true);
    const balance = await getTokenBalance(publicKey);
    console.log('Fetched balance:', balance);
    setAvailableBalance(balance);
    setIsRefreshing(false);
  };

  // Helper to format AURACLE amounts without trailing zeros
  const formatAuracle = (amount: number) => {
    return amount.toLocaleString('en-US', { 
      minimumFractionDigits: 0, 
      maximumFractionDigits: 9 
    });
  };

  const handleStake = async () => {
    if (!publicKey || !signTransaction) {
      toast({
        title: "Wallet not connected",
        description: "Please connect your wallet to stake",
        variant: "destructive"
      });
      return;
    }

    const amount = parseFloat(stakeAmount);
    if (amount <= 0 || amount > availableBalance) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid amount to stake",
        variant: "destructive"
      });
      return;
    }

    setIsStaking(true);
    try {
      // Create and sign transaction
      const transaction = await createStakeTransaction(publicKey, amount);
      const signedTx = await signTransaction(transaction);
      
      // Send with proper options
      const signature = await connection.sendRawTransaction(
        signedTx.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 3
        }
      );
      
      // Wait for confirmation
      const confirmation = await connection.confirmTransaction({
        signature,
        blockhash: transaction.recentBlockhash!,
        lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight
      }, 'confirmed');

      if (confirmation.value.err) {
        throw new Error('Transaction failed');
      }

      console.log('Transaction confirmed, recording stake...');

      // Record stake in database - use direct fetch since Supabase client has issues
      try {
        const recordResponse = await fetch(`https://lnckpccymikurkirqdwz.supabase.co/functions/v1/supabase-functions-record-stake`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify({
            walletAddress: publicKey.toString(),
            amount,
            type: 'stake',
            txSignature: signature
          })
        });

        const recordData = await recordResponse.json();
        console.log('Record stake response:', recordData);

        if (recordData.success) {
          toast({
            title: "Stake successful!",
            description: `Successfully staked ${amount} AURACLE`,
          });
        } else {
          throw new Error(recordData.error || 'Failed to record stake');
        }
      } catch (recordError) {
        console.error('Failed to record stake:', recordError);
        toast({
          title: "Warning",
          description: "Stake succeeded but failed to record in database. Please refresh.",
          variant: "destructive"
        });
      }

      setStakeAmount("");
      onStake(amount);
      fetchBalance();
    } catch (error: any) {
      console.error('Stake error:', error);
      toast({
        title: "Stake failed",
        description: error.message || "Failed to stake tokens",
        variant: "destructive"
      });
    } finally {
      setIsStaking(false);
    }
  };

  const handleUnstake = async () => {
    if (!publicKey || !signTransaction) {
      toast({
        title: "Wallet not connected",
        description: "Please connect your wallet to unstake",
        variant: "destructive"
      });
      return;
    }

    const amount = parseFloat(unstakeAmount);
    if (amount <= 0 || amount > stakedAmount) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid amount to unstake",
        variant: "destructive"
      });
      return;
    }

    setIsUnstaking(true);
    try {
      // Create transaction (user signs, vault will co-sign on backend)
      const transaction = await createUnstakeTransaction(publicKey, amount);
      const signedTx = await signTransaction(transaction);
      
      // Send to backend for vault signature and processing
      const { data, error } = await supabase.functions.invoke('supabase-functions-process-unstake', {
        body: {
          walletAddress: publicKey.toString(),
          amount,
          serializedTransaction: Buffer.from(signedTx.serialize()).toString('base64')
        },
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (error) throw error;

      toast({
        title: "Unstake successful!",
        description: `Successfully unstaked ${amount} AURACLE`,
      });

      setUnstakeAmount("");
      onUnstake(amount);
      fetchBalance();
    } catch (error: any) {
      console.error('Unstake error:', error);
      toast({
        title: "Unstake failed",
        description: error.message || "Failed to unstake tokens",
        variant: "destructive"
      });
    } finally {
      setIsUnstaking(false);
    }
  };

  return (
    <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
      <CardHeader>
        <CardTitle className="text-white">Manage Stake</CardTitle>
        <CardDescription className="text-slate-400">
          Stake or unstake your AURACLE tokens
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="stake" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-slate-800">
            <TabsTrigger value="stake" className="data-[state=active]:bg-purple-600">
              <ArrowDownRight className="h-4 w-4 mr-2" />
              Stake
            </TabsTrigger>
            <TabsTrigger value="unstake" className="data-[state=active]:bg-purple-600">
              <ArrowUpRight className="h-4 w-4 mr-2" />
              Unstake
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="stake" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="stake-amount" className="text-slate-300">Amount (AURACLE)</Label>
              <Input
                id="stake-amount"
                type="number"
                placeholder="0.00"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
                disabled={isStaking}
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">Available: {formatAuracle(availableBalance)} AURACLE</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={fetchBalance}
                  disabled={isRefreshing}
                  className="h-6 px-2 text-xs text-slate-400 hover:text-white"
                >
                  <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>
            <Button 
              onClick={handleStake} 
              className="w-full bg-purple-600 hover:bg-purple-700"
              disabled={!stakeAmount || parseFloat(stakeAmount) <= 0 || isStaking || parseFloat(stakeAmount) > availableBalance}
            >
              {isStaking ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Staking...
                </>
              ) : (
                'Stake AURACLE'
              )}
            </Button>
          </TabsContent>
          
          <TabsContent value="unstake" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="unstake-amount" className="text-slate-300">Amount (AURACLE)</Label>
              <Input
                id="unstake-amount"
                type="number"
                placeholder="0.00"
                value={unstakeAmount}
                onChange={(e) => setUnstakeAmount(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
                disabled={isUnstaking}
              />
              <p className="text-xs text-slate-400">Staked: {formatAuracle(stakedAmount)} AURACLE</p>
            </div>
            <Button 
              onClick={handleUnstake} 
              className="w-full bg-orange-600 hover:bg-orange-700"
              disabled={!unstakeAmount || parseFloat(unstakeAmount) <= 0 || isUnstaking || parseFloat(unstakeAmount) > stakedAmount}
            >
              {isUnstaking ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Unstaking...
                </>
              ) : (
                'Unstake AURACLE'
              )}
            </Button>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}