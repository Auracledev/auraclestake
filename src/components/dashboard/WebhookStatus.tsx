import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, CheckCircle2, XCircle } from "lucide-react";

interface WebhookStatusProps {
  isActive?: boolean;
  lastPing?: string;
}

export default function WebhookStatus({ isActive = true, lastPing = "2 minutes ago" }: WebhookStatusProps) {
  return (
    <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white flex items-center gap-2">
            <Activity className="h-5 w-5 text-purple-400" />
            Webhook Status
          </CardTitle>
          <Badge variant={isActive ? "default" : "destructive"} className={isActive ? "bg-green-600" : ""}>
            {isActive ? (
              <>
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Active
              </>
            ) : (
              <>
                <XCircle className="h-3 w-3 mr-1" />
                Inactive
              </>
            )}
          </Badge>
        </div>
        <CardDescription className="text-slate-400">
          Monitoring AURACLE token stakes to vault wallet
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Last Ping:</span>
            <span className="text-white font-medium">{lastPing}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Endpoint:</span>
            <span className="text-purple-400 font-mono text-xs">/api/webhook/helius</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}