import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, FileText } from "lucide-react";
import { format } from "date-fns";

const Sales = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [sales, setSales] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ product_id: "", quantity: "1" });

  const fetchSales = async () => {
    const data = await api.get<any[]>("/sales", { order: "desc" });
    setSales(data);
  };

  const fetchProducts = async () => {
    const data = await api.get<any[]>("/products");
    setProducts(data);
  };

  useEffect(() => {
    if (user) { fetchSales(); fetchProducts(); }
  }, [user]);

  const handleSale = async () => {
    if (!form.product_id) return;
    try {
      await api.post("/sales", {
        product_id: form.product_id,
        quantity: parseInt(form.quantity),
      });
      toast({ title: "Sale recorded!" });
      setOpen(false);
      setForm({ product_id: "", quantity: "1" });
      fetchSales();
      fetchProducts();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const generateInvoice = (sale: any) => {
    const invoiceText = `
INVOICE
====================
Date: ${format(new Date(sale.sale_date), "PPP")}
Product: ${sale.products?.name}
Quantity: ${sale.quantity}
Unit Price: $${Number(sale.unit_price).toFixed(2)}
Total: $${Number(sale.total_price).toFixed(2)}
====================
    `.trim();

    const blob = new Blob([invoiceText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-${sale.id.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedProduct = products.find((p) => p.id === form.product_id);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl sm:text-3xl font-bold">Sales</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Record Sale</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Record New Sale</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Product</Label>
                <Select value={form.product_id} onValueChange={(v) => setForm({ ...form, product_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} (Stock: {p.quantity}, ${Number(p.price).toFixed(2)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Quantity</Label><Input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
              {form.product_id && selectedProduct && (
                <div className="rounded-lg bg-muted p-3 text-sm">
                  <strong>Total:</strong> ${(parseInt(form.quantity || "0") * Number(selectedProduct.price || 0)).toFixed(2)}
                </div>
              )}
              <Button onClick={handleSale} className="w-full">Record Sale</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[600px]">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Unit Price</TableHead>
                <TableHead>Total</TableHead>
                <TableHead className="text-right">Invoice</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{format(new Date(s.sale_date), "MMM dd, yyyy")}</TableCell>
                  <TableCell className="font-medium">{s.products?.name}</TableCell>
                  <TableCell>{s.quantity}</TableCell>
                  <TableCell>${Number(s.unit_price).toFixed(2)}</TableCell>
                  <TableCell className="font-medium">${Number(s.total_price).toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => generateInvoice(s)}>
                      <FileText className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {sales.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No sales recorded yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default Sales;
