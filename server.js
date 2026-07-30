'use strict';

const express = require('express');
const path    = require('path');
const os      = require('os');
const helmet  = require('helmet');

const config  = require('./config/env');
const { globalLimiter } = require('./src/middleware/rateLimiter');
const apiRouter = require('./src/routes/api');

const app  = express();

// Helper: Get Local Network IP
function getLanIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// Security & Header Middlewares
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(globalLimiter);
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-pass, x-admin-token');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Serve Static Assets
app.use(express.static(path.join(__dirname, 'public')));

// SPA Router
const serveSPA = (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'index.html'));
};

app.get('/', serveSPA);
app.get('/search', serveSPA);
app.get('/bus/:slug', serveSPA);
app.get('/alerts', serveSPA);
app.get('/privacy', serveSPA);
app.get('/terms', serveSPA);
app.get('/admin', serveSPA);
app.get('/corporate', serveSPA);
app.get('/operators', serveSPA);

// Mount Modular API Routes
app.use('/api', apiRouter);

// Mount Business & Affiliate Routes (/go/* and /sitemap.xml)
const businessRoutes = require('./src/routes/businessRoutes');
app.use('/', businessRoutes);

// Start Listener
app.listen(config.PORT, config.HOST, () => {
  const lan = getLanIP();
  console.log('');
  console.log('  🌐 BharatTravel Super-Platform — Server Running');
  console.log('  ─────────────────────────────────────────────────');
  console.log(`  🌐 Local:      http://localhost:${config.PORT}`);
  console.log(`  📡 Network:    http://${lan}:${config.PORT}`);
  console.log(`  🔍 Search:     http://localhost:${config.PORT}/search?from=Mumbai&to=Goa`);
  console.log(`  💼 Corporate:  http://localhost:${config.PORT}/corporate`);
  console.log(`  🚌 Operators:  http://localhost:${config.PORT}/operators`);
  console.log(`  📊 Admin:      http://localhost:${config.PORT}/admin`);
  console.log('  ─────────────────────────────────────────────────');
  console.log('  💰 Revenue Streams:');
  console.log('     🛡️ Insurance  🏨 Hotels  🪙 BusCoins  🔗 Referrals');
  console.log('     ⭐ Reviews   💼 Corporate  🚌 Operator SaaS');
  console.log('');
  console.log('  ⚠️  Do NOT use VS Code Live Server — always use node server.js');
  console.log('');
});

module.exports = app;
