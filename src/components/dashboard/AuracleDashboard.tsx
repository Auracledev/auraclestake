import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useEffect, useState } from 'react';
import StatCard from './StatCard';
import TransactionHistory from './TransactionHistory';
import StakeActions from './StakeActions';
import WebhookStatus from './WebhookStatus';
import ManualPayout from './ManualPayout';
import RewardsCard from './RewardsCard';
import { Users, Coins, Wallet, TrendingUp, Shield } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase, ADMIN_WALLET } from '@/lib/supabase';
import { useToast } from "@/components/ui/use-toast";

interface PlatformStats {
  total_staked: number;
  vault_sol_balance: number;
  weekly_reward_pool: number;
  number_of_stakers: number;
}

interface UserData {
  staked_amount: number;
  estimatedDailyRewards: string;
  pendingRewards: number;
  transactions: any[];
}

export default function AuracleDashboard() {
  const { publicKey, connected } = useWallet();
  const isAdmin = connected && publicKey?.toString() === ADMIN_WALLET;
  const { toast } = useToast();

  const [platformStats, setPlatformStats] = useState<PlatformStats>({
    total_staked: 0,
    vault_sol_balance: 0,
    weekly_reward_pool: 0,
    number_of_stakers: 0,
  });

  const [userData, setUserData] = useState<UserData>({
    staked_amount: 0,
    estimatedDailyRewards: '0',
    pendingRewards: 0,
    transactions: [],
  });

  const [loading, setLoading] = useState(true);

  // Helper to format AURACLE amounts without trailing zeros
  const formatAuracle = (amount: number) => {
    return amount.toLocaleString('en-US', { 
      minimumFractionDigits: 0, 
      maximumFractionDigits: 9 
    });
  };

  useEffect(() => {
    fetchPlatformStats();

    const channel = supabase
      .channel('platform_stats_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_stats' }, () => {
        fetchPlatformStats();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (connected && publicKey) {
      fetchUserData();

      const channel = supabase
        .channel(`user_${publicKey.toString()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'stakers', filter: `wallet_address=eq.${publicKey.toString()}` }, () => {
          fetchUserData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `wallet_address=eq.${publicKey.toString()}` }, () => {
          fetchUserData();
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [connected, publicKey]);

  const fetchPlatformStats = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('supabase-functions-get-platform-stats', {
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      if (error) throw error;
      if (data?.stats) {
        setPlatformStats(data.stats);
      }
    } catch (error) {
      console.error('Error fetching platform stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUserData = async () => {
    if (!publicKey) return;

    try {
      // Use fetch directly to get the full error response
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/supabase-functions-get-user-data`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ walletAddress: publicKey.toString() }),
        }
      );

      const responseText = await response.text();
      console.log('Raw response:', responseText);
      console.log('Response status:', response.status);

      if (!response.ok) {
        console.error('Error response:', responseText);
        throw new Error(`HTTP ${response.status}: ${responseText}`);
      }

      const data = JSON.parse(responseText);
      
      if (data?.error) {
        console.error('Edge function returned error:', data.error);
        throw new Error(data.error);
      }
      
      if (data) {
        const newUserData = {
          staked_amount: data.staker?.staked_amount || 0,
          estimatedDailyRewards: data.estimatedDailyRewards || '0',
          pendingRewards: data.pendingRewards || 0,
          transactions: data.transactions || [],
        };
        console.log('Setting user data:', newUserData);
        setUserData(newUserData);
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
    }
  };

  const handleWithdrawRewards = async () => {
    if (!publicKey) return;

    try {
      const { data, error } = await supabase.functions.invoke('supabase-functions-withdraw-rewards', {
        body: { walletAddress: publicKey.toString() },
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (error) throw error;

      toast({
        title: "Withdrawal successful!",
        description: `Successfully withdrew ${data.amount.toFixed(4)} SOL`,
      });

      fetchUserData();
    } catch (error: any) {
      console.error('Withdraw error:', error);
      toast({
        title: "Withdrawal failed",
        description: error.message || "Failed to withdraw rewards",
        variant: "destructive"
      });
    }
  };

  const handleUnstake = async (amount: number) => {
    console.log('Unstake completed, refreshing data...');
    // Wait longer for the database to update
    setTimeout(() => {
      fetchUserData();
      fetchPlatformStats();
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img 
                src="https://i.imgur.com/LEBBbsS.png" 
                alt="Auracle Logo" 
                className="h-10 w-10 rounded-lg object-contain"
              />
              <div>
                <h1 className="text-2xl font-bold text-white">Auracle Staking</h1>
                <p className="text-sm text-slate-400">Automated SOL Rewards Distribution</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {isAdmin && (
                <Badge className="bg-purple-600 text-white">
                  <Shield className="h-3 w-3 mr-1" />
                  Admin
                </Badge>
              )}
              <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700" />
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Public Statistics */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-white mb-4">Platform Statistics</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <StatCard
              title="Total AURACLE Staked"
              value={loading ? "Loading..." : formatAuracle(platformStats.total_staked)}
              subtitle="Across all stakers"
              icon={<Coins className="h-4 w-4 text-purple-400" />}
            />
            <StatCard
              title="Number of Stakers"
              value={loading ? "Loading..." : platformStats.number_of_stakers.toString()}
              subtitle="Active participants"
              icon={<Users className="h-4 w-4 text-blue-400" />}
            />
          </div>
        </section>

        {/* User Dashboard - Only shown when wallet is connected */}
        {connected && !isAdmin && (
          <section className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4">Your Staking</h2>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <StatCard
                    title="Your Staked AURACLE"
                    value={formatAuracle(userData.staked_amount)}
                    subtitle="Currently earning rewards"
                  />
                  <StatCard
                    title="Est. Daily Rewards"
                    value={`${userData.estimatedDailyRewards} SOL`}
                    subtitle="Based on current pool"
                  />
                </div>
                <RewardsCard 
                  pendingRewards={userData.pendingRewards}
                  estimatedDailyRewards={userData.estimatedDailyRewards}
                  onWithdraw={handleWithdrawRewards}
                />
                <TransactionHistory transactions={userData.transactions.map(tx => ({
                  id: tx.id,
                  type: tx.type,
                  amount: `${tx.amount} ${tx.token}`,
                  timestamp: new Date(tx.created_at).toLocaleString(),
                  status: tx.status
                }))} />
              </div>
              <div>
                <StakeActions 
                  stakedAmount={userData.staked_amount}
                  onStake={async (amount) => {
                    fetchUserData();
                  }}
                  onUnstake={handleUnstake}
                />
              </div>
            </div>
          </section>
        )}

        {/* Admin Dashboard - Only shown for admin wallet */}
        {isAdmin && (
          <section className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <Shield className="h-5 w-5 text-purple-400" />
              Admin Controls
            </h2>
            
            {/* Admin-only vault stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <StatCard
                title="Vault SOL Balance"
                value={`${(platformStats.vault_sol_balance || 0).toFixed(2)} SOL`}
                subtitle="Available for rewards"
                icon={<Wallet className="h-4 w-4 text-green-400" />}
              />
              <StatCard
                title="Weekly Reward Pool"
                value={`${(platformStats.weekly_reward_pool || 0).toFixed(2)} SOL`}
                subtitle="Distributed pro-rata"
                icon={<TrendingUp className="h-4 w-4 text-yellow-400" />}
              />
              <StatCard
                title="Your Staked AURACLE"
                value={formatAuracle(userData.staked_amount || 0)}
                subtitle="Admin wallet stake"
              />
              <StatCard
                title="Your Pending Rewards"
                value={`${(userData.pendingRewards || 0).toFixed(6)} SOL`}
                subtitle="Available to withdraw"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <WebhookStatus />
              <ManualPayout onTriggerPayout={async () => {
                try {
                  const { data, error } = await supabase.functions.invoke('supabase-functions-calculate-rewards', {
                    body: { adminWallet: publicKey?.toString() },
                    headers: {
                      'Content-Type': 'application/json',
                    }
                  });
                  if (error) throw error;
                  toast({
                    title: "Rewards calculated!",
                    description: `Distributed to ${data.summary.totalStakers} stakers`,
                  });
                  fetchUserData();
                } catch (error: any) {
                  toast({
                    title: "Calculation failed",
                    description: error.message,
                    variant: "destructive"
                  });
                }
              }} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              <div className="lg:col-span-2">
                <RewardsCard 
                  pendingRewards={userData.pendingRewards}
                  estimatedDailyRewards={userData.estimatedDailyRewards}
                  onWithdraw={handleWithdrawRewards}
                />
              </div>
              <div>
                <StakeActions 
                  stakedAmount={userData.staked_amount}
                  onStake={async (amount) => {
                    fetchUserData();
                  }}
                  onUnstake={handleUnstake}
                />
              </div>
            </div>
            
            <TransactionHistory transactions={userData.transactions.map(tx => ({
              id: tx.id,
              type: tx.type,
              amount: `${tx.amount} ${tx.token}`,
              timestamp: new Date(tx.created_at).toLocaleString(),
              status: tx.status
            }))} />
          </section>
        )}

        {/* Connect Wallet Prompt */}
        {!connected && (
          <section className="flex flex-col items-center justify-center py-16">
            <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700 rounded-2xl p-12 max-w-md text-center">
              <div className="h-20 w-20 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mx-auto mb-6">
                <Wallet className="h-10 w-10 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">Connect Your Wallet</h3>
              <p className="text-slate-400 mb-6">
                Connect your Solana wallet to view your staking details, manage your stake, and track your rewards.
              </p>
              <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700 !mx-auto" />
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-900/50 mt-16">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-slate-400 text-sm">
              © 2024 Auracle Staking. Automated pro-rata SOL rewards distribution.
            </p>
            <div className="flex items-center gap-4 text-sm text-slate-400">
              <a href="#" className="hover:text-purple-400 transition-colors">Documentation</a>
              <a href="#" className="hover:text-purple-400 transition-colors">Support</a>
              <a href="#" className="hover:text-purple-400 transition-colors">Terms</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}