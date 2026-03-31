import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Brain, Loader2, TrendingUp, History, Trash2 } from "lucide-react";
import { format } from "date-fns";

type Prediction = {
  product_name: string;
  current_stock: number;
  predicted_demand: number;
  reorder_quantity: number;
  risk_level: "low" | "medium" | "high";
  reasoning?: string;
  product_id?: string;
};

type HistoryEntry = {
  id: string;
  product_name: string;
  current_stock: number;
  predicted_demand: number;
  reorder_quantity: number;
  risk_level: string;
  reasoning: string | null;
  prediction_date: string;
  product_id: string;
  actual_sold?: number;
};

const Predictions = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("current");

  useEffect(() => {
    if (user) fetchHistory();
  }, [user]);

  const fetchHistory = async () => {
    try {
      const data = await api.get<HistoryEntry[]>("/predictions");
      if (!data) return setHistory([]);

      // Fetch actual sales since each prediction date to compare accuracy
      const sales = await api.get<any[]>("/sales");
      const enriched = data.map((entry) => {
        const actualSold = sales
          .filter((s) => s.product_id === entry.product_id && s.sale_date >= entry.prediction_date)
          .reduce((sum, s) => sum + s.quantity, 0);
        return { ...entry, actual_sold: actualSold };
      });

      setHistory(enriched);
    } catch (err: any) {
      console.error("Failed to fetch history:", err.message);
      setHistory([]);
    }
  };

  const generatePredictions = async () => {
    if (!user) return;
    setLoading(true);

    try {
      const result = await api.post<{ predictions: Prediction[]; source: string }>("/predictions/generate");
      const preds = result.predictions || [];
      setPredictions(preds);

      // Save to history
      if (preds.length > 0) {
        await api.post("/predictions", { predictions: preds });
        fetchHistory();
      }

      const sourceLabel = result.source === "ai" ? "Powered by AI" : "Statistical model (fallback)";
      toast({ title: "Predictions generated & saved!", description: sourceLabel });
    } catch (err: any) {
      toast({ title: "Prediction failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    try {
      await api.delete("/predictions");
      setHistory([]);
      toast({ title: "History cleared" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  // Group history by prediction_date
  const groupedHistory = history.reduce<Record<string, HistoryEntry[]>>((acc, entry) => {
    const dateKey = format(new Date(entry.prediction_date), "MMM dd, yyyy HH:mm");
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(entry);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">AI Demand Predictions</h1>
          <p className="text-muted-foreground mt-1 text-sm">Predict next week's demand and get reorder recommendations</p>
        </div>
        <Button onClick={generatePredictions} disabled={loading} className="shrink-0">
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Brain className="mr-2 h-4 w-4" />}
          {loading ? "Analyzing..." : "Generate Predictions"}
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="current" className="gap-1.5">
            <TrendingUp className="h-4 w-4" /> Current
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="h-4 w-4" /> History
            {history.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">{Object.keys(groupedHistory).length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="current" className="mt-4">
          {predictions.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  Weekly Demand Forecast
                </CardTitle>
                <CardDescription>Based on your last 30 days of sales data</CardDescription>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-[500px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Current Stock</TableHead>
                      <TableHead>Predicted Demand</TableHead>
                      <TableHead>Reorder Qty</TableHead>
                      <TableHead>Risk</TableHead>
                      <TableHead className="hidden md:table-cell">AI Reasoning</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {predictions.map((p, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{p.product_name}</TableCell>
                        <TableCell>{p.current_stock}</TableCell>
                        <TableCell>{p.predicted_demand}</TableCell>
                        <TableCell className="font-medium">{p.reorder_quantity > 0 ? p.reorder_quantity : "—"}</TableCell>
                        <TableCell>
                          <Badge
                            variant={p.risk_level === "high" ? "destructive" : "secondary"}
                            className={p.risk_level === "medium" ? "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]" : ""}
                          >
                            {p.risk_level}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground max-w-[250px] truncate" title={p.reasoning}>
                          {p.reasoning || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <Card className="flex flex-col items-center justify-center py-16">
              <Brain className="h-16 w-16 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-semibold">No predictions yet</h3>
              <p className="text-muted-foreground text-sm mt-1">Click "Generate Predictions" to analyze your sales data</p>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-4">
          {Object.keys(groupedHistory).length > 0 ? (
            <>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={clearHistory}>
                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Clear History
                </Button>
              </div>
              {Object.entries(groupedHistory).map(([dateKey, entries]) => (
                <Card key={dateKey}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <History className="h-4 w-4 text-primary" />
                      {dateKey}
                    </CardTitle>
                    <CardDescription>Forecast vs actual sales since prediction</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0 overflow-x-auto">
                    <Table className="min-w-[550px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead>Stock at Time</TableHead>
                          <TableHead>Predicted</TableHead>
                          <TableHead>Actual Sold</TableHead>
                          <TableHead>Accuracy</TableHead>
                          <TableHead>Risk</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {entries.map((e) => {
                          const accuracy = e.actual_sold !== undefined && e.predicted_demand > 0
                            ? Math.max(0, 100 - Math.abs(e.predicted_demand - e.actual_sold) / e.predicted_demand * 100)
                            : null;
                          return (
                            <TableRow key={e.id}>
                              <TableCell className="font-medium">{e.product_name}</TableCell>
                              <TableCell>{e.current_stock}</TableCell>
                              <TableCell>{e.predicted_demand}</TableCell>
                              <TableCell className="font-medium">{e.actual_sold ?? "—"}</TableCell>
                              <TableCell>
                                {accuracy !== null ? (
                                  <Badge variant={accuracy >= 70 ? "secondary" : "destructive"} className={accuracy >= 70 ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : ""}>
                                    {accuracy.toFixed(0)}%
                                  </Badge>
                                ) : "—"}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={e.risk_level === "high" ? "destructive" : "secondary"}
                                  className={e.risk_level === "medium" ? "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]" : ""}
                                >
                                  {e.risk_level}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ))}
            </>
          ) : (
            <Card className="flex flex-col items-center justify-center py-16">
              <History className="h-16 w-16 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-semibold">No history yet</h3>
              <p className="text-muted-foreground text-sm mt-1">Generate predictions to start tracking accuracy over time</p>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Predictions;
