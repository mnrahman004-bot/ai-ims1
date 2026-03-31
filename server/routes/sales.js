const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/sales?gte=YYYY-MM-DD&lte=YYYY-MM-DD
router.get('/', async (req, res) => {
  try {
    const { gte, lte, order = 'desc', limit } = req.query;
    let query = `
      SELECT s.*, p.name AS product_name
      FROM sales s
      LEFT JOIN products p ON s.product_id = p.id
      WHERE s.user_id = ?
    `;
    const params = [req.user.id];

    if (gte) {
      query += ' AND s.sale_date >= ?';
      params.push(gte);
    }
    if (lte) {
      query += ' AND s.sale_date <= ?';
      params.push(lte);
    }

    query += ` ORDER BY s.sale_date ${order === 'asc' ? 'ASC' : 'DESC'}`;

    if (limit) {
      query += ' LIMIT ?';
      params.push(parseInt(limit));
    }

    const [rows] = await pool.query(query, params);

    // Reshape to match old Supabase shape: products: { name }
    const sales = rows.map(r => ({
      ...r,
      unit_price: parseFloat(r.unit_price),
      total_price: parseFloat(r.total_price),
      sale_date: r.sale_date instanceof Date ? r.sale_date.toISOString() : r.sale_date,
      products: r.product_name ? { name: r.product_name } : null,
      product_name: undefined,
    }));

    res.json(sales);
  } catch (err) {
    console.error('Get sales error:', err);
    res.status(500).json({ error: 'Failed to fetch sales.' });
  }
});

// POST /api/sales — records sale + reduces stock + logs inventory change atomically
router.post('/', async (req, res) => {
  const { product_id, quantity } = req.body;
  if (!product_id || !quantity) return res.status(400).json({ error: 'product_id and quantity are required.' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Get product
    const [products] = await conn.query(
      'SELECT * FROM products WHERE id = ? AND user_id = ? FOR UPDATE',
      [product_id, req.user.id]
    );
    if (products.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Product not found.' });
    }
    const product = products[0];
    const qty = parseInt(quantity);

    if (qty > product.quantity) {
      await conn.rollback();
      return res.status(400).json({ error: `Not enough stock. Only ${product.quantity} available.` });
    }

    const totalPrice = qty * parseFloat(product.price);
    const saleId = uuidv4();
    const logId = uuidv4();
    const newQty = product.quantity - qty;

    // Insert sale
    await conn.query(
      'INSERT INTO sales (id, user_id, product_id, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?)',
      [saleId, req.user.id, product_id, qty, product.price, totalPrice]
    );

    // Update product quantity
    await conn.query('UPDATE products SET quantity = ?, updated_at = NOW() WHERE id = ?', [newQty, product_id]);

    // Log the inventory change
    await conn.query(
      'INSERT INTO inventory_logs (id, user_id, product_id, change_type, quantity_change, previous_quantity, new_quantity, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [logId, req.user.id, product_id, 'sale', -qty, product.quantity, newQty, `Sale of ${qty} unit(s)`]
    );

    await conn.commit();
    res.status(201).json({ id: saleId, message: 'Sale recorded.' });
  } catch (err) {
    await conn.rollback();
    console.error('Create sale error:', err);
    res.status(500).json({ error: 'Failed to record sale.' });
  } finally {
    conn.release();
  }
});

module.exports = router;
