const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/predictions
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const [rows] = await pool.query(
      `SELECT * FROM prediction_history
       WHERE user_id = ?
       ORDER BY prediction_date DESC
       LIMIT ?`,
      [req.user.id, limit]
    );
    const history = rows.map(r => ({
      ...r,
      prediction_date: r.prediction_date instanceof Date ? r.prediction_date.toISOString() : r.prediction_date,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    }));
    res.json(history);
  } catch (err) {
    console.error('Get predictions error:', err);
    res.status(500).json({ error: 'Failed to fetch predictions.' });
  }
});

// POST /api/predictions — save prediction rows
router.post('/', async (req, res) => {
  const { predictions } = req.body;
  if (!predictions || !Array.isArray(predictions) || predictions.length === 0) {
    return res.status(400).json({ error: 'predictions array is required.' });
  }

  try {
    const rows = predictions.map(p => [
      uuidv4(),
      req.user.id,
      p.product_id || null,
      p.product_name,
      p.current_stock,
      p.predicted_demand,
      p.reorder_quantity,
      p.risk_level,
      p.reasoning || null,
    ]);

    await pool.query(
      `INSERT INTO prediction_history
       (id, user_id, product_id, product_name, current_stock, predicted_demand, reorder_quantity, risk_level, reasoning)
       VALUES ?`,
      [rows]
    );

    res.status(201).json({ message: `${rows.length} predictions saved.` });
  } catch (err) {
    console.error('Save predictions error:', err);
    res.status(500).json({ error: 'Failed to save predictions.' });
  }
});

// DELETE /api/predictions — clear all history for user
router.delete('/', async (req, res) => {
  try {
    await pool.query('DELETE FROM prediction_history WHERE user_id = ?', [req.user.id]);
    res.json({ message: 'Prediction history cleared.' });
  } catch (err) {
    console.error('Clear predictions error:', err);
    res.status(500).json({ error: 'Failed to clear history.' });
  }
});

// POST /api/predictions/generate — run AI or fallback predictions
router.post('/generate', async (req, res) => {
  try {
    // Fetch last 30 days of sales + all products for this user
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = thirtyDaysAgo.toISOString().slice(0, 10);

    const [products] = await pool.query('SELECT * FROM products WHERE user_id = ?', [req.user.id]);
    const [sales] = await pool.query(
      `SELECT s.*, p.name AS product_name_col
       FROM sales s LEFT JOIN products p ON s.product_id = p.id
       WHERE s.user_id = ? AND s.sale_date >= ?`,
      [req.user.id, dateStr]
    );

    const salesFormatted = sales.map(s => ({
      ...s,
      products: { name: s.product_name_col },
      unit_price: parseFloat(s.unit_price),
      total_price: parseFloat(s.total_price),
      sale_date: s.sale_date instanceof Date ? s.sale_date.toISOString() : s.sale_date,
    }));

    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;

    // Try AI prediction if API key is present
    if (LOVABLE_API_KEY) {
      try {
        const productSummaries = products.map(product => {
          const productSales = salesFormatted.filter(s => s.product_id === product.id);
          const totalSold = productSales.reduce((sum, s) => sum + s.quantity, 0);
          const now = Date.now();
          const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
          const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;
          const recentQty = productSales.filter(s => new Date(s.sale_date).getTime() > oneWeekAgo).reduce((sum, s) => sum + s.quantity, 0);
          const priorQty = productSales.filter(s => { const t = new Date(s.sale_date).getTime(); return t > twoWeeksAgo && t <= oneWeekAgo; }).reduce((sum, s) => sum + s.quantity, 0);
          return { name: product.name, current_stock: product.quantity, low_stock_threshold: product.low_stock_threshold, total_sold_30d: totalSold, sold_last_7d: recentQty, sold_prior_7d: priorQty, sale_count: productSales.length };
        });

        const systemPrompt = `You are an inventory demand forecasting AI that uses a Random Forest ensemble approach. For each product, simulate multiple independent decision trees that analyze different feature subsets:\nTree 1 - Trend Analysis: week-over-week velocity.\nTree 2 - Stock Pressure: stock vs threshold.\nTree 3 - Volume Pattern: 30-day totals.\nTree 4 - Seasonality Heuristic.\nTree 5 - Safety Stock Model.\nAggregate using majority voting for risk_level and averages for quantities. Return JSON only.`;
        const userPrompt = `Analyze the following 30-day inventory data and predict demand for the next 7 days.\n\nProduct data:\n${JSON.stringify(productSummaries, null, 2)}\n\nReturn ONLY valid JSON in this exact format:\n{"predictions":[{"product_name":"...","current_stock":0,"predicted_demand":0,"reorder_quantity":0,"risk_level":"low|medium|high","reasoning":"..."}]}`;

        const aiResp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'google/gemini-3-flash-preview',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            response_format: { type: 'json_object' },
          }),
        });

        if (aiResp.ok) {
          const aiResult = await aiResp.json();
          const content = aiResult.choices?.[0]?.message?.content;
          if (content) {
            const parsed = JSON.parse(content);
            if (parsed.predictions) {
              return res.json({ predictions: parsed.predictions, source: 'ai' });
            }
          }
        }
      } catch (aiErr) {
        console.warn('AI prediction failed, using fallback:', aiErr.message);
      }
    }

    // Fallback: Statistical prediction
    const predictions = products.map(product => {
      const productSales = salesFormatted.filter(s => s.product_id === product.id);
      const totalSold = productSales.reduce((sum, s) => sum + s.quantity, 0);
      const weeklyAvg = Math.ceil((totalSold / 30) * 7);
      const predicted = Math.max(weeklyAvg, 1);
      const reorder = Math.max(predicted * 2 - product.quantity, 0);
      const risk = product.quantity <= product.low_stock_threshold ? 'high'
        : product.quantity <= product.low_stock_threshold * 2 ? 'medium' : 'low';

      return {
        product_name: product.name,
        current_stock: product.quantity,
        predicted_demand: predicted,
        reorder_quantity: reorder,
        risk_level: risk,
        reasoning: `Based on ${totalSold} units sold in 30 days (avg ${weeklyAvg}/week). Statistical fallback model.`,
        product_id: product.id,
      };
    });

    res.json({ predictions, source: 'statistical' });
  } catch (err) {
    console.error('Generate predictions error:', err);
    res.status(500).json({ error: 'Failed to generate predictions.' });
  }
});

module.exports = router;
