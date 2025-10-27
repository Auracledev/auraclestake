import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowDownRight, ArrowUpRight, Clock, Inbox } from "lucide-react";

interface Transaction {
  id: string;
  type: "stake" | "unstake" | "reward";
  amount: string;
  timestamp: string;
  status: "completed" | "pending" | "failed";
}

interface TransactionHistoryProps {
  transactions?: Transaction[];
}

export default function TransactionHistory({ transactions = [] }: TransactionHistoryProps) {
  const getTypeIcon = (type: string) => {
    if (type === "stake") return <ArrowDownRight className="h-4 w-4 text-green-400" />;
    if (type === "unstake") return <ArrowUpRight className="h-4 w-4 text-orange-400" />;
    return <Clock className="h-4 w-4 text-purple-400" />;
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      completed: "bg-green-600",
      pending: "bg-yellow-600",
      failed: "bg-red-600",
    };
    return (
      <Badge className={variants[status as keyof typeof variants] || "bg-gray-600"}>
        {status}
      </Badge>
    );
  };

  return (
    <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
      <CardHeader>
        <CardTitle className="text-white">Transaction History</CardTitle>
        <CardDescription className="text-slate-400">
          Your recent staking activity and rewards
        </CardDescription>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Inbox className="h-12 w-12 text-slate-600 mb-4" />
            <p className="text-slate-400 text-sm">No transactions yet</p>
            <p className="text-slate-500 text-xs mt-1">Your staking activity will appear here</p>
          </div>
        ) : (
          <ScrollArea className="h-[300px]">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700 hover:bg-slate-800/50">
                  <TableHead className="text-slate-300">Type</TableHead>
                  <TableHead className="text-slate-300">Amount</TableHead>
                  <TableHead className="text-slate-300">Time</TableHead>
                  <TableHead className="text-slate-300">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id} className="border-slate-700 hover:bg-slate-800/50">
                    <TableCell className="font-medium text-white">
                      <div className="flex items-center gap-2">
                        {getTypeIcon(tx.type)}
                        <span className="capitalize">{tx.type}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-300">{tx.amount}</TableCell>
                    <TableCell className="text-slate-400">{tx.timestamp}</TableCell>
                    <TableCell>{getStatusBadge(tx.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}