import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Zap, TrendingUp } from "lucide-react";

interface BoostLevelCardProps {
  firstStakedAt?: string;
}

function calculateStakingDays(firstStakedAt: string): number {
  const firstStaked = new Date(firstStakedAt);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - firstStaked.getTime());
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

function getLoyaltyBoost(stakingDays: number): { multiplier: number; level: string; color: string } {
  if (stakingDays >= 90) return { multiplier: 1.5, level: "Diamond", color: "bg-cyan-500" };
  if (stakingDays >= 60) return { multiplier: 1.4, level: "Platinum", color: "bg-purple-500" };
  if (stakingDays >= 30) return { multiplier: 1.3, level: "Gold", color: "bg-yellow-500" };
  if (stakingDays >= 7) return { multiplier: 1.1, level: "Silver", color: "bg-slate-400" };
  return { multiplier: 1.0, level: "Bronze", color: "bg-orange-600" };
}

function getNextTier(stakingDays: number): { days: number; level: string; multiplier: number } | null {
  if (stakingDays < 7) return { days: 7, level: "Silver", multiplier: 1.1 };
  if (stakingDays < 30) return { days: 30, level: "Gold", multiplier: 1.3 };
  if (stakingDays < 60) return { days: 60, level: "Platinum", multiplier: 1.4 };
  if (stakingDays < 90) return { days: 90, level: "Diamond", multiplier: 1.5 };
  return null;
}

export default function BoostLevelCard({ firstStakedAt }: BoostLevelCardProps) {
  if (!firstStakedAt) {
    return (
      <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-400" />
            Loyalty Boost
          </CardTitle>
          <CardDescription className="text-slate-400">
            Stake to start earning boost rewards
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-400">
            Stake AURACLE to unlock loyalty boost multipliers and earn more SOL rewards!
          </p>
        </CardContent>
      </Card>
    );
  }

  const stakingDays = calculateStakingDays(firstStakedAt);
  const currentBoost = getLoyaltyBoost(stakingDays);
  const nextTier = getNextTier(stakingDays);

  const boostPercentage = ((currentBoost.multiplier - 1) * 100).toFixed(0);
  
  let progressValue = 0;
  let daysUntilNext = 0;
  
  if (nextTier) {
    const previousTierDays = stakingDays < 7 ? 0 : stakingDays < 30 ? 7 : stakingDays < 60 ? 30 : 60;
    const tierRange = nextTier.days - previousTierDays;
    const daysIntoTier = stakingDays - previousTierDays;
    progressValue = (daysIntoTier / tierRange) * 100;
    daysUntilNext = nextTier.days - stakingDays;
  } else {
    progressValue = 100;
  }

  return (
    <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-400" />
            Loyalty Boost
          </CardTitle>
          <Badge className={`${currentBoost.color} text-white font-bold`}>
            {currentBoost.level}
          </Badge>
        </div>
        <CardDescription className="text-slate-400">
          Continuous staking rewards multiplier
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Boost */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-400">Current Multiplier</span>
            <span className="text-2xl font-bold text-green-400">
              {currentBoost.multiplier}x
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">Staking Days</span>
            <span className="text-sm font-semibold text-white">{stakingDays} days</span>
          </div>
          {boostPercentage !== "0" && (
            <div className="mt-2 flex items-center gap-1 text-xs text-green-400">
              <TrendingUp className="h-3 w-3" />
              +{boostPercentage}% bonus rewards
            </div>
          )}
        </div>

        {/* Progress to Next Tier */}
        {nextTier ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Next: {nextTier.level}</span>
              <span className="text-slate-300 font-semibold">{nextTier.multiplier}x</span>
            </div>
            <Progress value={progressValue} className="h-2" />
            <p className="text-xs text-slate-500 text-center">
              {daysUntilNext} days until {nextTier.level} tier
            </p>
          </div>
        ) : (
          <div className="bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border border-cyan-500/30 rounded-lg p-3 text-center">
            <p className="text-sm font-semibold text-cyan-400">🎉 Max Tier Reached!</p>
            <p className="text-xs text-slate-400 mt-1">You're earning maximum rewards</p>
          </div>
        )}

        {/* Tier Breakdown */}
        <div className="border-t border-slate-700 pt-3 space-y-1">
          <p className="text-xs font-semibold text-slate-400 mb-2">Boost Tiers:</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">7 days:</span>
              <span className="text-slate-300">1.1x (Silver)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">30 days:</span>
              <span className="text-slate-300">1.3x (Gold)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">60 days:</span>
              <span className="text-slate-300">1.4x (Platinum)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">90 days:</span>
              <span className="text-slate-300">1.5x (Diamond)</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
