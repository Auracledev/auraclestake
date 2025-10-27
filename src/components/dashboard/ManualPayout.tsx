import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Zap, AlertCircle } from "lucide-react";
import { useState } from "react";

interface ManualPayoutProps {
  onTriggerPayout?: () => void;
}

export default function ManualPayout({ onTriggerPayout = () => {} }: ManualPayoutProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastPayout, setLastPayout] = useState("3 hours ago");

  const handleTriggerPayout = async () => {
    setIsProcessing(true);
    await onTriggerPayout();
    setLastPayout("Just now");
    setTimeout(() => setIsProcessing(false), 2000);
  };

  return (
    <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-400" />
            Manual Payout
          </CardTitle>
          <Badge variant="outline" className="border-yellow-600 text-yellow-400">
            Admin Only
          </Badge>
        </div>
        <CardDescription className="text-slate-400">
          Trigger pro-rata SOL distribution manually
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-yellow-400 mt-0.5" />
            <div className="text-sm text-slate-300">
              <p className="font-medium">Before triggering:</p>
              <ul className="list-disc list-inside text-slate-400 mt-1 space-y-1">
                <li>Ensure vault has sufficient SOL balance</li>
                <li>Verify all stakers are eligible</li>
                <li>Check transaction logs for errors</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Last Manual Payout:</span>
          <span className="text-white font-medium">{lastPayout}</span>
        </div>

        <Button 
          onClick={handleTriggerPayout}
          disabled={isProcessing}
          className="w-full bg-yellow-600 hover:bg-yellow-700 text-black font-semibold"
        >
          {isProcessing ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-black mr-2" />
              Processing...
            </>
          ) : (
            <>
              <Zap className="h-4 w-4 mr-2" />
              Trigger Payout Now
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
