const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/inventory-logs?limit=50
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const [rows] = await pool.query(
      `SELECT il.*, p.name AS product_name
       FROM inventory_logs il
       LEFT JOIN products p ON il.product_id = p.id
       WHERE il.user_id = ?
       ORDER BY il.created_at DESC
       LIMIT ?`,
      [req.user.id, limit]
    );

    const logs = rows.map(r => ({
      ...r,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      products: r.product_name ? { name: r.product_name } : null,
      product_name: undefined,
    }));

    res.json(logs);
  } catch (err) {
    console.error('Get inventory logs error:', err);
    res.status(500).json({ error: 'Failed to fetch inventory logs.' });
  }
});

// POST /api/inventory-logs — update stock + create log
router.post('/', async (req, res) => {
  const { product_id, change_type, quantity, notes } = req.body;
  if (!product_id || !change_type || quantity === undefined) {
    return res.status(400).json({ error: 'product_id, change_type, and quantity are required.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

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
    const change = change_type === 'reduction' ? -qty : qty;
    const newQty = product.quantity + change;

    if (newQty < 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'Cannot reduce stock below 0.' });
    }

    const logId = uuidv4();
    await conn.query('UPDATE products SET quantity = ?, updated_at = NOW() WHERE id = ?', [newQty, product_id]);
    await conn.query(
      'INSERT INTO inventory_logs (id, user_id, product_id, change_type, quantity_change, previous_quantity, new_quantity, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [logId, req.user.id, product_id, change_type, change, product.quantity, newQty, notes || null]
    );

    await conn.commit();
    res.status(201).json({ id: logId, message: 'Stock updated.' });
  } catch (err) {
    await conn.rollback();
    console.error('Update inventory error:', err);
    res.status(500).json({ error: 'Failed to update inventory.' });
  } finally {
    conn.release();
  }
});

module.exports = router;
