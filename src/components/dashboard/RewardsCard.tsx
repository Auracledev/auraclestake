import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Coins, Loader2, TrendingUp, AlertTriangle } from "lucide-react";
import { useState, useEffect } from "react";

interface RewardsCardProps {
  pendingRewards?: number;
  estimatedDailyRewards?: string;
  rewardsPerSecond?: number;
  onWithdraw?: () => Promise<void>;
}

export default function RewardsCard({ 
  pendingRewards = 0, 
  estimatedDailyRewards = "0",
  rewardsPerSecond = 0,
  onWithdraw = async () => {} 
}: RewardsCardProps) {
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [liveRewards, setLiveRewards] = useState(pendingRewards);
  const [actualRate, setActualRate] = useState(rewardsPerSecond);

  // Track actual accumulation rate
  useEffect(() => {
    const startRewards = pendingRewards || 0;
    const startTime = Date.now();
    setLiveRewards(startRewards);
    
    if (rewardsPerSecond > 0) {
      const interval = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000; // seconds elapsed
        const accumulated = rewardsPerSecond * 10; // 10 seconds worth
        setLiveRewards(startRewards + (rewardsPerSecond * elapsed));
        
        // Calculate actual rate based on accumulation
        if (elapsed >= 10) {
          const measuredRate = accumulated / 10;
          setActualRate(measuredRate);
        }
      }, 10000); // Update every 10 seconds

      return () => clearInterval(interval);
    }
  }, [pendingRewards, rewardsPerSecond]);

  const handleWithdraw = async () => {
    setIsWithdrawing(true);
    try {
      await onWithdraw();
    } catch (error) {
      console.error('Withdrawal error:', error);
      alert(error instanceof Error ? error.message : 'Failed to withdraw rewards');
    } finally {
      setIsWithdrawing(false);
    }
  };

  // Safe display value
  const displayRewards = isNaN(liveRewards) ? 0 : liveRewards;
  const rewardsPerMinute = actualRate * 60;

  return (
    <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-400" />
            SOL Rewards
          </CardTitle>
          {displayRewards > 0 && (
            <Badge className="bg-green-600 animate-pulse">
              Live
            </Badge>
          )}
        </div>
        <CardDescription className="text-slate-400">
          Your accumulated staking rewards
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-center min-h-[120px] flex flex-col justify-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Coins className="h-6 w-6 text-green-400 flex-shrink-0" />
            <span className="text-4xl font-bold text-white tabular-nums leading-none">
              {displayRewards.toFixed(6)}
            </span>
            <span className="text-xl text-slate-400 flex-shrink-0">SOL</span>
          </div>
          <p className="text-sm text-slate-400">Pending Rewards</p>
          {rewardsPerMinute > 0 && (
            <p className="text-xs text-green-400 mt-2 tabular-nums">
              +{rewardsPerMinute.toFixed(8)} SOL/min
            </p>
          )}
        </div>

        <Button 
          onClick={handleWithdraw}
          disabled={isWithdrawing || displayRewards <= 0}
          className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold"
        >
          {isWithdrawing ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Withdrawing...
            </>
          ) : (
            <>
              <Coins className="h-4 w-4 mr-2" />
              Withdraw Rewards
            </>
          )}
        </Button>

        {displayRewards > 0 && (
          <Alert className="bg-yellow-900/20 border-yellow-600/50">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            <AlertDescription className="text-yellow-200 text-xs">
              ⚠️ Remember to claim your SOL rewards before unstaking!
            </AlertDescription>
          </Alert>
        )}

        {displayRewards <= 0 && (
          <p className="text-xs text-center text-slate-400">
            No rewards available yet. Keep staking to earn SOL!
          </p>
        )}
      </CardContent>
    </Card>
  );
}