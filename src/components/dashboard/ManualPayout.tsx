import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Loader2, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/lib/supabase";

interface ManualPayoutProps {
  onPayoutComplete?: () => void;
  onTriggerPayout?: () => Promise<void>;
}

export default function ManualPayout({ onPayoutComplete, onTriggerPayout }: ManualPayoutProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastPayout, setLastPayout] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLastPayout();
  }, []);

  const fetchLastPayout = async () => {
    try {
      setLoading(true);
      
      // Fetch the most recent reward transaction
      const { data, error } = await supabase
        .from('transactions')
        .select('created_at')
        .eq('type', 'reward')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error fetching last payout:', error);
        setLastPayout('Unknown');
        return;
      }

      if (data?.created_at) {
        const payoutDate = new Date(data.created_at);
        const now = new Date();
        const diffMs = now.getTime() - payoutDate.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) {
          setLastPayout('Just now');
        } else if (diffMins < 60) {
          setLastPayout(`${diffMins} minute${diffMins > 1 ? 's' : ''} ago`);
        } else if (diffHours < 24) {
          setLastPayout(`${diffHours} hour${diffHours > 1 ? 's' : ''} ago`);
        } else {
          setLastPayout(`${diffDays} day${diffDays > 1 ? 's' : ''} ago`);
        }
      } else {
        setLastPayout('Never');
      }
    } catch (error) {
      console.error('Error fetching last payout:', error);
      setLastPayout('Unknown');
    } finally {
      setLoading(false);
    }
  };

  const handleManualPayout = async () => {
    setIsProcessing(true);
    try {
      // If custom trigger function is provided, use it
      if (onTriggerPayout) {
        await onTriggerPayout();
      } else {
        // Default behavior: call the calculate-rewards edge function
        const { data, error } = await supabase.functions.invoke('supabase-functions-calculate-rewards', {
          body: { manual: true }
        });

        if (error) throw error;
      }

      // Refresh the last payout time
      await fetchLastPayout();
      
      if (onPayoutComplete) {
        onPayoutComplete();
      }
    } catch (error) {
      console.error('Error processing manual payout:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Card className="bg-gradient-to-br from-purple-900/20 to-pink-900/20 border-purple-700/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white">Manual Payout</CardTitle>
          <Badge className="bg-purple-600">Admin Only</Badge>
        </div>
        <CardDescription className="text-slate-400">
          Trigger immediate reward distribution to all stakers
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className="bg-yellow-900/20 border-yellow-700/50">
          <AlertCircle className="h-4 w-4 text-yellow-400" />
          <AlertDescription className="text-yellow-200 text-sm">
            This will calculate and distribute rewards to all active stakers based on their current stake.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <CheckCircle2 className="h-4 w-4 text-green-400" />
            <span>Verify vault has sufficient SOL balance</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <CheckCircle2 className="h-4 w-4 text-green-400" />
            <span>Confirm all stakers are eligible</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <CheckCircle2 className="h-4 w-4 text-green-400" />
            <span>Review transaction logs after completion</span>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-700">
          <div className="flex items-center justify-between text-sm mb-3">
            <span className="text-slate-400">Last Payout:</span>
            <span className="text-white font-medium">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin inline" />
              ) : (
                lastPayout || 'Never'
              )}
            </span>
          </div>
          
          <Button
            onClick={handleManualPayout}
            disabled={isProcessing || loading}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing Payout...
              </>
            ) : (
              'Trigger Manual Payout'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}