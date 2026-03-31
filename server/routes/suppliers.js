const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/suppliers
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM suppliers WHERE user_id = ? ORDER BY name ASC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Get suppliers error:', err);
    res.status(500).json({ error: 'Failed to fetch suppliers.' });
  }
});

// POST /api/suppliers
router.post('/', async (req, res) => {
  const { name, contact_person, email, phone, address } = req.body;
  if (!name) return res.status(400).json({ error: 'Supplier name is required.' });

  try {
    const id = uuidv4();
    await pool.query(
      'INSERT INTO suppliers (id, user_id, name, contact_person, email, phone, address) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, req.user.id, name, contact_person || null, email || null, phone || null, address || null]
    );
    const [rows] = await pool.query('SELECT * FROM suppliers WHERE id = ?', [id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create supplier error:', err);
    res.status(500).json({ error: 'Failed to create supplier.' });
  }
});

// PUT /api/suppliers/:id
router.put('/:id', async (req, res) => {
  const { name, contact_person, email, phone, address } = req.body;

  try {
    const [check] = await pool.query('SELECT id FROM suppliers WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (check.length === 0) return res.status(404).json({ error: 'Supplier not found.' });

    await pool.query(
      'UPDATE suppliers SET name=?, contact_person=?, email=?, phone=?, address=?, updated_at=NOW() WHERE id=? AND user_id=?',
      [name, contact_person || null, email || null, phone || null, address || null, req.params.id, req.user.id]
    );
    res.json({ message: 'Supplier updated.' });
  } catch (err) {
    console.error('Update supplier error:', err);
    res.status(500).json({ error: 'Failed to update supplier.' });
  }
});

// DELETE /api/suppliers/:id
router.delete('/:id', async (req, res) => {
  try {
    const [check] = await pool.query('SELECT id FROM suppliers WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (check.length === 0) return res.status(404).json({ error: 'Supplier not found.' });

    await pool.query('DELETE FROM suppliers WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ message: 'Supplier deleted.' });
  } catch (err) {
    console.error('Delete supplier error:', err);
    res.status(500).json({ error: 'Failed to delete supplier.' });
  }
});

module.exports = router;
