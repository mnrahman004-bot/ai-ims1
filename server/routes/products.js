const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/products
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, s.name AS supplier_name
       FROM products p
       LEFT JOIN suppliers s ON p.supplier_id = s.id
       WHERE p.user_id = ?
       ORDER BY p.name ASC`,
      [req.user.id]
    );
    // Reshape to match old Supabase shape: suppliers: { name }
    const products = rows.map(r => ({
      ...r,
      price: parseFloat(r.price),
      suppliers: r.supplier_name ? { name: r.supplier_name } : null,
      supplier_name: undefined,
    }));
    res.json(products);
  } catch (err) {
    console.error('Get products error:', err);
    res.status(500).json({ error: 'Failed to fetch products.' });
  }
});

// POST /api/products
router.post('/', async (req, res) => {
  const { name, category, price, quantity, low_stock_threshold, supplier_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Product name is required.' });

  try {
    const id = uuidv4();
    await pool.query(
      `INSERT INTO products (id, user_id, name, category, price, quantity, low_stock_threshold, supplier_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.user.id,
        name,
        category || 'General',
        parseFloat(price) || 0,
        parseInt(quantity) || 0,
        parseInt(low_stock_threshold) || 10,
        supplier_id || null,
      ]
    );
    const [rows] = await pool.query(
      `SELECT p.*, s.name AS supplier_name FROM products p LEFT JOIN suppliers s ON p.supplier_id = s.id WHERE p.id = ?`,
      [id]
    );
    const p = rows[0];
    res.status(201).json({ ...p, price: parseFloat(p.price), suppliers: p.supplier_name ? { name: p.supplier_name } : null });
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ error: 'Failed to create product.' });
  }
});

// PUT /api/products/:id
router.put('/:id', async (req, res) => {
  const { name, category, price, quantity, low_stock_threshold, supplier_id } = req.body;

  try {
    const [check] = await pool.query('SELECT id FROM products WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (check.length === 0) return res.status(404).json({ error: 'Product not found.' });

    await pool.query(
      `UPDATE products SET name=?, category=?, price=?, quantity=?, low_stock_threshold=?, supplier_id=?, updated_at=NOW()
       WHERE id = ? AND user_id = ?`,
      [
        name,
        category || 'General',
        parseFloat(price) || 0,
        parseInt(quantity) || 0,
        parseInt(low_stock_threshold) || 10,
        supplier_id || null,
        req.params.id,
        req.user.id,
      ]
    );
    res.json({ message: 'Product updated.' });
  } catch (err) {
    console.error('Update product error:', err);
    res.status(500).json({ error: 'Failed to update product.' });
  }
});

// DELETE /api/products/:id
router.delete('/:id', async (req, res) => {
  try {
    const [check] = await pool.query('SELECT id FROM products WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (check.length === 0) return res.status(404).json({ error: 'Product not found.' });

    await pool.query('DELETE FROM products WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ message: 'Product deleted.' });
  } catch (err) {
    console.error('Delete product error:', err);
    res.status(500).json({ error: 'Failed to delete product.' });
  }
});

module.exports = router;
