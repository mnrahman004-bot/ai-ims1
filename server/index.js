require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./db');

// Route imports
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const supplierRoutes = require('./routes/suppliers');
const salesRoutes = require('./routes/sales');
const inventoryRoutes = require('./routes/inventory');
const predictionRoutes = require('./routes/predictions');

const app = express();
module.exports = app; // Export for Vercel
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true,
}));
app.use(express.json());

// Serve static frontend in production
const DIST_PATH = path.join(__dirname, '../dist');
app.use(express.static(DIST_PATH));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/predictions', predictionRoutes);

// Catch-all route for SPA (React) — serves index.html for any route not starting with /api
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
  }
  res.sendFile(path.join(DIST_PATH, 'index.html'));
});

// 404 handler for API (not needed thanks to catch-all, but good for completeness)
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// Start server only if run directly (not as a serverless function)
if (require.main === module) {
  async function start() {
    try {
      await initDatabase();
      app.listen(PORT, () => {
        console.log(`🚀 Server running at http://localhost:${PORT}`);
        console.log(`📦 Database: ${process.env.DB_NAME || 'inventory_db'} @ ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 3306}`);
      });
    } catch (err) {
      console.error('❌ Failed to start server:', err.message);
      console.error('\nMake sure MySQL is running and your .env credentials are correct.');
      process.exit(1);
    }
  }
  start();
} else {
  // Cloud environments often handle database initialization via serverless hooks or on first request
  // Let's ensure the DB is initialized at least once if being run on Vercel
  initDatabase().catch(err => console.error('DB init failed:', err.message));
}
