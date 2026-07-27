'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';   // bind to all interfaces
const DB_PATH = path.join(__dirname, 'database.json');

// ─── GET LOCAL NETWORK IP ──────────────────────────────────────────────────────
function getLanIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// ─── MIDDLEWARE ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS — allow requests from any origin (Live Server, other devices, deployed domain)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── DATABASE HELPERS ────────────────────────────────────────────────────────
function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    console.error('[DB] Read error:', e.message);
    return null;
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[DB] Write error:', e.message);
    return false;
  }
}

// ─── TEMPLATE SERVING ────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'index.html'));
});

app.get('/search', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'search.html'));
});

app.get('/bus/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'bus.html'));
});

app.get('/alerts', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'alerts.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ─── API: CITIES ─────────────────────────────────────────────────────────────
app.get('/api/cities', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });
  const q = (req.query.q || '').toLowerCase();
  const cities = q
    ? db.cities.filter(c => c.name.toLowerCase().includes(q))
    : db.cities;
  res.json({ cities });
});

// ─── API: POPULAR ROUTES ──────────────────────────────────────────────────────
app.get('/api/popular', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const popular = db.popularRoutes.map(pr => {
    const route = db.routes.find(r => r.id === pr.routeId);
    const buses = db.buses.filter(b => b.route.routeId === pr.routeId);
    const minPrice = buses.length > 0 ? Math.min(...buses.map(b => b.lowestPrice)) : 0;
    return {
      ...route,
      searches: pr.searches,
      bookings: pr.bookings,
      minPrice,
      busCount: buses.length
    };
  });

  res.json({ popular });
});

// ─── API: ALL ROUTES ──────────────────────────────────────────────────────────
app.get('/api/routes', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });
  res.json({ routes: db.routes });
});

// ─── API: SEARCH ──────────────────────────────────────────────────────────────
app.get('/api/search', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const { from, to, date, busType, operator, minPrice, maxPrice, departure, sort, amenities } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: 'From and To cities are required' });
  }

  // Increment search counter
  db.admin.totalSearches = (db.admin.totalSearches || 0) + 1;
  writeDB(db);

  // Filter buses by route
  let results = db.buses.filter(bus => {
    const fromMatch = bus.route.from.toLowerCase() === from.toLowerCase();
    const toMatch = bus.route.to.toLowerCase() === to.toLowerCase();
    return fromMatch && toMatch;
  });

  // Filter by bus type
  if (busType && busType !== 'all') {
    results = results.filter(b => b.busTypeCode === busType);
  }

  // Filter by operator
  if (operator && operator !== 'all') {
    results = results.filter(b => b.operatorCode === operator);
  }

  // Filter by price
  if (minPrice) {
    results = results.filter(b => b.lowestPrice >= parseInt(minPrice));
  }
  if (maxPrice) {
    results = results.filter(b => b.lowestPrice <= parseInt(maxPrice));
  }

  // Filter by departure time
  if (departure && departure !== 'all') {
    results = results.filter(bus => {
      const hour = parseInt(bus.route.departureTime.split(':')[0]);
      switch (departure) {
        case 'morning':   return hour >= 6 && hour < 12;
        case 'afternoon': return hour >= 12 && hour < 17;
        case 'evening':   return hour >= 17 && hour < 21;
        case 'night':     return hour >= 21 || hour < 6;
        default: return true;
      }
    });
  }

  // Filter by amenities
  if (amenities) {
    const requiredAmenities = amenities.split(',');
    results = results.filter(b =>
      requiredAmenities.every(a => b.amenities.includes(a))
    );
  }

  // Sort results
  switch (sort) {
    case 'price-asc':
      results.sort((a, b) => a.lowestPrice - b.lowestPrice);
      break;
    case 'price-desc':
      results.sort((a, b) => b.lowestPrice - a.lowestPrice);
      break;
    case 'rating':
      results.sort((a, b) => b.rating - a.rating);
      break;
    case 'duration':
      results.sort((a, b) => a.route.durationMinutes - b.route.durationMinutes);
      break;
    case 'departure':
      results.sort((a, b) => a.route.departureTime.localeCompare(b.route.departureTime));
      break;
    default:
      // Default: featured first, then price
      results.sort((a, b) => {
        if (b.featured !== a.featured) return b.featured ? 1 : -1;
        return a.lowestPrice - b.lowestPrice;
      });
  }

  // Get the route info
  const route = db.routes.find(r =>
    r.from.toLowerCase() === from.toLowerCase() &&
    r.to.toLowerCase() === to.toLowerCase()
  );

  // Get available operators for this search
  const availableOperators = [...new Set(results.map(b => b.operatorCode))].map(code => {
    const op = db.operators.find(o => o.code === code);
    return op ? { code: op.code, name: op.name } : { code, name: code };
  });

  res.json({
    results,
    total: results.length,
    route: route || null,
    availableOperators,
    query: { from, to, date, busType, operator, sort }
  });
});

// ─── API: BUS DETAIL ─────────────────────────────────────────────────────────
app.get('/api/bus/:slug', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const bus = db.buses.find(b => b.slug === req.params.slug);
  if (!bus) return res.status(404).json({ error: 'Bus not found' });

  const reviews = db.reviews.filter(r => r.busId === bus.id);
  const route = db.routes.find(r => r.id === bus.route.routeId);
  const operator = db.operators.find(o => o.code === bus.operatorCode);

  // Related buses (same route, different operator)
  const related = db.buses
    .filter(b => b.route.routeId === bus.route.routeId && b.id !== bus.id)
    .slice(0, 3);

  res.json({ bus, reviews, route, operator, related });
});

// ─── API: SUBMIT REVIEW ───────────────────────────────────────────────────────
app.post('/api/review', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const { busId, userName, userCity, rating, title, comment, platform } = req.body;

  if (!busId || !userName || !rating || !comment) {
    return res.status(400).json({ error: 'busId, userName, rating, comment are required' });
  }

  const bus = db.buses.find(b => b.id === busId);
  if (!bus) return res.status(404).json({ error: 'Bus not found' });

  const review = {
    id: `rev-${uuidv4().slice(0, 8)}`,
    busId,
    userName: userName.trim(),
    userCity: (userCity || '').trim(),
    rating: Math.min(5, Math.max(1, parseInt(rating))),
    title: (title || '').trim(),
    comment: comment.trim(),
    date: new Date().toISOString().split('T')[0],
    helpfulCount: 0,
    verified: false,
    platform: platform || 'buscompare'
  };

  db.reviews.push(review);

  // Update bus rating (running average)
  const busReviews = db.reviews.filter(r => r.busId === busId);
  bus.reviewCount = busReviews.length;
  bus.rating = Math.round(
    (busReviews.reduce((sum, r) => sum + r.rating, 0) / busReviews.length) * 10
  ) / 10;

  db.admin.totalReviews = (db.admin.totalReviews || 0) + 1;
  writeDB(db);

  res.status(201).json({ success: true, review });
});

// ─── API: PRICE ALERT SUBSCRIPTION ───────────────────────────────────────────
app.post('/api/alert', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const { email, whatsapp, routeFrom, routeTo, maxPrice, tier } = req.body;

  if (!email || !routeFrom || !routeTo) {
    return res.status(400).json({ error: 'Email, routeFrom, routeTo are required' });
  }

  // Check duplicate
  const existing = db.alerts.find(a => a.email === email && a.routeFrom === routeFrom && a.routeTo === routeTo);
  if (existing) {
    return res.status(409).json({ error: 'Alert already exists for this route and email', existing });
  }

  const alert = {
    id: `alert-${uuidv4().slice(0, 8)}`,
    email: email.trim(),
    whatsapp: (whatsapp || '').trim(),
    routeFrom: routeFrom.trim(),
    routeTo: routeTo.trim(),
    maxPrice: maxPrice ? parseInt(maxPrice) : null,
    tier: tier || 'free',
    active: true,
    createdAt: new Date().toISOString(),
    triggeredCount: 0
  };

  db.alerts.push(alert);
  db.admin.totalAlerts = (db.admin.totalAlerts || 0) + 1;
  writeDB(db);

  res.status(201).json({ success: true, alert });
});

// ─── AFFILIATE REDIRECT (CLICK TRACKING) ─────────────────────────────────────
app.get('/go/:platform/:busId', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const { platform, busId } = req.params;
  const bus = db.buses.find(b => b.id === busId);

  // Track click telemetry
  const click = {
    id: `clk-${uuidv4().slice(0, 8)}`,
    platform,
    busId,
    timestamp: new Date().toISOString(),
    price: bus ? bus.prices[platform] : null,
    route: bus ? `${bus.route.from} → ${bus.route.to}` : 'unknown'
  };

  db.telemetry.push(click);
  db.admin.totalClicks = (db.admin.totalClicks || 0) + 1;

  // Estimate revenue (₹80 avg commission)
  db.admin.revenueEstimate = (db.admin.revenueEstimate || 0) + 80;

  writeDB(db);

  // Affiliate redirect URLs
  const affiliateUrls = {
    redbus: `https://www.redbus.in/bus-tickets/${bus ? bus.route.from.toLowerCase() : ''}-to-${bus ? bus.route.to.toLowerCase() : ''}?src=buscompare`,
    abhibus: `https://www.abhibus.com/bus_search/${bus ? bus.route.from : ''}/${bus ? bus.route.to : ''}/today?ref=buscompare`,
    makemytrip: `https://www.makemytrip.com/bus-tickets/${bus ? bus.route.from.toLowerCase() : ''}-to-${bus ? bus.route.to.toLowerCase() : ''}?affid=buscompare`,
    yatra: `https://www.yatra.com/buses/${bus ? bus.route.from.toLowerCase() : ''}-to-${bus ? bus.route.to.toLowerCase() : ''}?aff=buscompare`,
    direct: `https://www.redbus.in/bus-tickets/${bus ? bus.route.from.toLowerCase() : ''}-to-${bus ? bus.route.to.toLowerCase() : ''}`
  };

  const redirectUrl = affiliateUrls[platform] || affiliateUrls.redbus;
  res.redirect(302, redirectUrl);
});

// ─── API: ADMIN STATS ─────────────────────────────────────────────────────────
app.get('/api/admin/stats', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  // Click breakdown by platform
  const clicksByPlatform = db.telemetry.reduce((acc, click) => {
    acc[click.platform] = (acc[click.platform] || 0) + 1;
    return acc;
  }, {});

  // Click breakdown by route
  const clicksByRoute = db.telemetry.reduce((acc, click) => {
    if (click.route) {
      acc[click.route] = (acc[click.route] || 0) + 1;
    }
    return acc;
  }, {});

  // Top 5 routes by clicks
  const topRoutes = Object.entries(clicksByRoute)
    .sort(([,a],[,b]) => b - a)
    .slice(0, 5)
    .map(([route, clicks]) => ({ route, clicks }));

  // Recent clicks (last 10)
  const recentClicks = db.telemetry.slice(-10).reverse();

  // Review stats
  const avgRating = db.reviews.length > 0
    ? (db.reviews.reduce((s, r) => s + r.rating, 0) / db.reviews.length).toFixed(1)
    : 0;

  // Recent alerts
  const recentAlerts = db.alerts.slice(-5).reverse();

  // Recent reviews
  const recentReviews = db.reviews.slice(-5).reverse();

  res.json({
    overview: {
      totalClicks: db.admin.totalClicks || 0,
      totalSearches: db.admin.totalSearches || 0,
      totalReviews: db.admin.totalReviews || db.reviews.length,
      totalAlerts: db.admin.totalAlerts || db.alerts.length,
      revenueEstimate: db.admin.revenueEstimate || 0,
      totalBuses: db.buses.length,
      totalRoutes: db.routes.length
    },
    clicksByPlatform,
    topRoutes,
    recentClicks,
    avgRating,
    recentAlerts,
    recentReviews,
    lastUpdated: new Date().toISOString()
  });
});

// ─── SEO: SITEMAP ─────────────────────────────────────────────────────────────
app.get('/sitemap.xml', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).send('Error');

  const baseUrl = 'https://buscompare.in';
  const today = new Date().toISOString().split('T')[0];

  const staticUrls = ['/', '/alerts'].map(u => `
  <url>
    <loc>${baseUrl}${u}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>`).join('');

  const routeUrls = db.routes.map(r => `
  <url>
    <loc>${baseUrl}/search?from=${r.from}&amp;to=${r.to}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>0.8</priority>
  </url>`).join('');

  const busUrls = db.buses.map(b => `
  <url>
    <loc>${baseUrl}/bus/${b.slug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>`).join('');

  res.header('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticUrls}
${routeUrls}
${busUrls}
</urlset>`);
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
app.listen(PORT, HOST, () => {
  const lan = getLanIP();
  console.log('');
  console.log('  🚌 BusCompare India — Server Running');
  console.log('  ─────────────────────────────────────────────────────');
  console.log(`  🌐 Local:    http://localhost:${PORT}`);
  console.log(`  📡 Network:  http://${lan}:${PORT}   ← open on any device on WiFi`);
  console.log(`  🔍 Search:   http://localhost:${PORT}/search?from=Mumbai&to=Pune`);
  console.log(`  📊 Admin:    http://localhost:${PORT}/admin`);
  console.log(`  ⚡ Alerts:   http://localhost:${PORT}/alerts`);
  console.log('  ─────────────────────────────────────────────────────');
  console.log(`  🗂️  DB:      ${DB_PATH}`);
  console.log('');
  console.log('  ⚠️  Do NOT use VS Code Live Server — always use node server.js');
  console.log('');
});
