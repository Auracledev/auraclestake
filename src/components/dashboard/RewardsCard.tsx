import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Coins, Loader2, TrendingUp } from "lucide-react";
import { useState } from "react";

interface RewardsCardProps {
  pendingRewards?: number;
  onWithdraw?: () => Promise<void>;
}

export default function RewardsCard({ pendingRewards = 0, onWithdraw = async () => {} }: RewardsCardProps) {
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const handleWithdraw = async () => {
    setIsWithdrawing(true);
    try {
      await onWithdraw();
    } finally {
      setIsWithdrawing(false);
    }
  };

  return (
    <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-400" />
            SOL Rewards
          </CardTitle>
          {pendingRewards > 0 && (
            <Badge className="bg-green-600">
              Available
            </Badge>
          )}
        </div>
        <CardDescription className="text-slate-400">
          Your accumulated staking rewards
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Coins className="h-6 w-6 text-green-400" />
            <span className="text-4xl font-bold text-white">
              {pendingRewards.toFixed(4)}
            </span>
            <span className="text-xl text-slate-400">SOL</span>
          </div>
          <p className="text-sm text-slate-400">Pending Rewards</p>
        </div>

        <Button 
          onClick={handleWithdraw}
          disabled={isWithdrawing || pendingRewards <= 0}
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

        {pendingRewards <= 0 && (
          <p className="text-xs text-center text-slate-400">
            No rewards available yet. Keep staking to earn SOL!
          </p>
        )}
      </CardContent>
    </Card>
  );
}
