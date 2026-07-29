'use strict';

const express   = require('express');
const fs        = require('fs');
const path      = require('path');
const os        = require('os');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const crypto    = require('crypto');

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

// ─── INPUT SANITIZER (ANTI-XSS) ──────────────────────────────────────────────
function sanitizeInput(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').trim();
}

// ─── SECURITY MIDDLEWARE ──────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP. Please try again later.' }
});

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: 'Submission limit reached. Please wait an hour before submitting again.' }
});

app.use(globalLimiter);
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-pass');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// In-memory cache & atomic queued writer to prevent file corruption / race conditions
let dbMemoryCache = null;
let isWriting = false;
let pendingWrite = false;

function readDB() {
  if (dbMemoryCache) return dbMemoryCache;
  try {
    dbMemoryCache = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    return dbMemoryCache;
  } catch (e) {
    console.error('[DB] Read error:', e.message);
    return null;
  }
}

function writeDB(data) {
  dbMemoryCache = data; // Update in-memory cache instantly
  if (isWriting) {
    pendingWrite = true;
    return true;
  }
  isWriting = true;
  setImmediate(() => {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(dbMemoryCache, null, 2), 'utf8');
    } catch (e) {
      console.error('[DB] Write error:', e.message);
    } finally {
      isWriting = false;
      if (pendingWrite) {
        pendingWrite = false;
        writeDB(dbMemoryCache);
      }
    }
  });
  return true;
}

// ─── UNIFIED SINGLE PAGE APPLICATION (SPA) SERVING ───────────────────────────
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
// ─── CITY NORMALIZATION HELPER ──────────────────────────────────────────────
const CITY_ALIASES = {
  'bengaluru': 'bangalore', 'madras': 'chennai', 'bombay': 'mumbai',
  'poona': 'pune', 'calcutta': 'kolkata', 'gurugram': 'gurgaon',
  'baroda': 'vadodara', 'trivandrum': 'thiruvananthapuram', 'vizag': 'visakhapatnam'
};

function normalizeCity(name) {
  if (!name) return '';
  const clean = name.trim().toLowerCase();
  return CITY_ALIASES[clean] || clean;
}

// ─── API: SEARCH ──────────────────────────────────────────────────────────────
app.get('/api/search', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const { from, to, date, busType, operator, minPrice, maxPrice, departure, sort, amenities } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: 'From and To cities are required' });
  }

  const normFrom = normalizeCity(from);
  const normTo   = normalizeCity(to);

  // Increment search counter
  db.admin.totalSearches = (db.admin.totalSearches || 0) + 1;
  writeDB(db);

  // Smart filter buses by route (exact or normalized alias match)
  let results = db.buses.filter(bus => {
    const bFrom = normalizeCity(bus.route.from);
    const bTo   = normalizeCity(bus.route.to);
    return bFrom === normFrom && bTo === normTo;
  });

  // Fallback: If no exact/alias match, try partial includes match
  if (results.length === 0) {
    results = db.buses.filter(bus => {
      const bFrom = normalizeCity(bus.route.from);
      const bTo   = normalizeCity(bus.route.to);
      return (bFrom.includes(normFrom) || normFrom.includes(bFrom)) &&
             (bTo.includes(normTo) || normTo.includes(bTo));
    });
  }

  // Filter by bus type
  if (busType && busType !== 'all') {
    results = results.filter(b => b.busTypeCode === busType);
  }

  // Filter by operator
  if (operator && operator !== 'all') {
    results = results.filter(b => b.operatorCode === operator);
  }

  // Dynamic Date Demand Multiplier (Weekend surge +20%, Midweek discount -10%)
  let dateMultiplier = 1.0;
  if (date) {
    const dayOfWeek = new Date(date + 'T00:00:00').getDay();
    if (dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0) {
      dateMultiplier = 1.20; // Weekend surge
    } else if (dayOfWeek === 2 || dayOfWeek === 3) {
      dateMultiplier = 0.90; // Midweek discount
    }
  }

  // Map results with date demand price adjustment
  results = results.map(b => {
    const adjustedPrices = {};
    Object.entries(b.prices || {}).forEach(([p, val]) => {
      adjustedPrices[p] = val ? Math.round(val * dateMultiplier) : null;
    });
    const lowP = Math.round(b.lowestPrice * dateMultiplier);
    const highP = Math.round(b.highestPrice * dateMultiplier);

    return {
      ...b,
      prices: adjustedPrices,
      lowestPrice: lowP,
      highestPrice: highP
    };
  });

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
    coupons: db.coupons || [],
    priceHistory: route ? route.priceHistory : null,
    query: { from, to, date, busType, operator, sort }
  });
});

// ─── API: PRICE TRENDS ────────────────────────────────────────────────────────
app.get('/api/price-trends', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });

  const route = db.routes.find(r =>
    normalizeCity(r.from) === normalizeCity(from) &&
    normalizeCity(r.to) === normalizeCity(to)
  );

  const basePrice = route ? route.minPrice : 450;
  const history = route && route.priceHistory ? route.priceHistory : [
    { day: "Mon", price: Math.round(basePrice * 0.95) },
    { day: "Tue", price: Math.round(basePrice * 0.90) },
    { day: "Wed", price: Math.round(basePrice * 0.92) },
    { day: "Thu", price: Math.round(basePrice * 1.00) },
    { day: "Fri", price: Math.round(basePrice * 1.25) },
    { day: "Sat", price: Math.round(basePrice * 1.30) },
    { day: "Sun", price: Math.round(basePrice * 1.15) }
  ];

  const avgPrice = Math.round(history.reduce((s, h) => s + h.price, 0) / history.length);
  const minDay = history.reduce((min, h) => h.price < min.price ? h : min, history[0]);

  res.json({
    from,
    to,
    history,
    avgPrice,
    cheapestDay: minDay.day,
    cheapestPrice: minDay.price,
    recommendation: `Prices are lowest on ${minDay.day}s (₹${minDay.price}). High demand on Fridays & Saturdays!`
  });
});

// ─── API: SEAT MAP ────────────────────────────────────────────────────────────
app.get('/api/seat-map/:busId', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const bus = db.buses.find(b => b.id === req.params.busId);
  if (!bus) return res.status(404).json({ error: 'Bus not found' });

  const isSleeper = bus.busTypeCode ? bus.busTypeCode.includes('sleeper') : true;
  const basePrice = bus.lowestPrice;

  let decks = {};

  if (isSleeper) {
    decks = {
      isSleeper: true,
      lowerDeck: [
        [ { id: 'L1', no: '1L', type: 'single', status: 'available', price: basePrice + 50, isWindow: true }, { id: 'L2', no: '2L', type: 'double', status: 'booked', price: basePrice, isWindow: false }, { id: 'L3', no: '3L', type: 'double', status: 'available', price: basePrice + 50, isWindow: true } ],
        [ { id: 'L4', no: '4L', type: 'single', status: 'female', price: basePrice + 50, isWindow: true }, { id: 'L5', no: '5L', type: 'double', status: 'available', price: basePrice, isWindow: false }, { id: 'L6', no: '6L', type: 'double', status: 'available', price: basePrice + 50, isWindow: true } ],
        [ { id: 'L7', no: '7L', type: 'single', status: 'available', price: basePrice + 50, isWindow: true }, { id: 'L8', no: '8L', type: 'double', status: 'booked', price: basePrice, isWindow: false }, { id: 'L9', no: '9L', type: 'double', status: 'female', price: basePrice + 50, isWindow: true } ],
        [ { id: 'L10', no: '10L', type: 'single', status: 'available', price: basePrice + 50, isWindow: true }, { id: 'L11', no: '11L', type: 'double', status: 'available', price: basePrice, isWindow: false }, { id: 'L12', no: '12L', type: 'double', status: 'available', price: basePrice + 50, isWindow: true } ]
      ],
      upperDeck: [
        [ { id: 'U1', no: '1U', type: 'single', status: 'available', price: basePrice, isWindow: true }, { id: 'U2', no: '2U', type: 'double', status: 'available', price: basePrice - 30, isWindow: false }, { id: 'U3', no: '3U', type: 'double', status: 'booked', price: basePrice, isWindow: true } ],
        [ { id: 'U4', no: '4U', type: 'single', status: 'booked', price: basePrice, isWindow: true }, { id: 'U5', no: '5U', type: 'double', status: 'available', price: basePrice - 30, isWindow: false }, { id: 'U6', no: '6U', type: 'double', status: 'available', price: basePrice, isWindow: true } ],
        [ { id: 'U7', no: '7U', type: 'single', status: 'female', price: basePrice, isWindow: true }, { id: 'U8', no: '8U', type: 'double', status: 'available', price: basePrice - 30, isWindow: false }, { id: 'U9', no: '9U', type: 'double', status: 'available', price: basePrice, isWindow: true } ],
        [ { id: 'U10', no: '10U', type: 'single', status: 'available', price: basePrice, isWindow: true }, { id: 'U11', no: '11U', type: 'double', status: 'booked', price: basePrice - 30, isWindow: false }, { id: 'U12', no: '12U', type: 'double', status: 'available', price: basePrice, isWindow: true } ]
      ]
    };
  } else {
    decks = {
      isSleeper: false,
      lowerDeck: [
        [ { id: 'S1', no: 'A1', type: 'seat', status: 'available', price: basePrice + 30, isWindow: true }, { id: 'S2', no: 'A2', type: 'seat', status: 'available', price: basePrice, isWindow: false }, { id: 'S3', no: 'A3', type: 'seat', status: 'booked', price: basePrice, isWindow: false }, { id: 'S4', no: 'A4', type: 'seat', status: 'available', price: basePrice + 30, isWindow: true } ],
        [ { id: 'S5', no: 'B1', type: 'seat', status: 'female', price: basePrice + 30, isWindow: true }, { id: 'S6', no: 'B2', type: 'seat', status: 'available', price: basePrice, isWindow: false }, { id: 'S7', no: 'B3', type: 'seat', status: 'available', price: basePrice, isWindow: false }, { id: 'S8', no: 'B4', type: 'seat', status: 'available', price: basePrice + 30, isWindow: true } ],
        [ { id: 'S9', no: 'C1', type: 'seat', status: 'available', price: basePrice + 30, isWindow: true }, { id: 'S10', no: 'C2', type: 'seat', status: 'booked', price: basePrice, isWindow: false }, { id: 'S11', no: 'C3', type: 'seat', status: 'booked', price: basePrice, isWindow: false }, { id: 'S12', no: 'C4', type: 'seat', status: 'available', price: basePrice + 30, isWindow: true } ],
        [ { id: 'S13', no: 'D1', type: 'seat', status: 'available', price: basePrice + 30, isWindow: true }, { id: 'S14', no: 'D2', type: 'seat', status: 'available', price: basePrice, isWindow: false }, { id: 'S15', no: 'D3', type: 'seat', status: 'female', price: basePrice, isWindow: false }, { id: 'S16', no: 'D4', type: 'seat', status: 'available', price: basePrice + 30, isWindow: true } ]
      ]
    };
  }

  res.json({
    busId: bus.id,
    busName: bus.operator,
    busType: bus.busType,
    totalSeats: bus.totalSeats,
    seatsLeft: bus.seatsLeft,
    basePrice,
    decks
  });
});

// ─── API: COUPON VALIDATION ───────────────────────────────────────────────────
app.post('/api/coupons/validate', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const { code, amount } = req.body;
  if (!code) return res.status(400).json({ error: 'Coupon code required' });

  const cleanCode = sanitizeInput(code).toUpperCase();
  const baseAmount = parseInt(amount) || 500;

  const coupons = db.coupons || [
    { code: "BUSCOMP100", discount: 100, type: "flat", minSpend: 500, description: "Flat ₹100 OFF on all bookings above ₹500" },
    { code: "SUPERBUS50", discount: 50, type: "flat", minSpend: 250, description: "Flat ₹50 OFF on any bus ticket" },
    { code: "FIRSTBUS150", discount: 150, type: "flat", minSpend: 700, description: "₹150 OFF for first time BusCompare users" },
    { code: "FESTIVE200", discount: 200, type: "flat", minSpend: 1000, description: "Flat ₹200 OFF on Luxury & Volvo Sleeper buses" }
  ];

  const coupon = coupons.find(c => c.code === cleanCode);

  if (!coupon) {
    return res.status(404).json({ valid: false, error: 'Invalid coupon code. Try BUSCOMP100 or SUPERBUS50' });
  }

  if (baseAmount < coupon.minSpend) {
    return res.status(400).json({ valid: false, error: `Minimum order amount of ₹${coupon.minSpend} required for code ${coupon.code}` });
  }

  const finalAmount = Math.max(0, baseAmount - coupon.discount);

  res.json({
    valid: true,
    code: coupon.code,
    discount: coupon.discount,
    originalAmount: baseAmount,
    finalAmount,
    description: coupon.description,
    message: `🎉 Coupon ${coupon.code} applied! You saved ₹${coupon.discount}.`
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

// Founder password hash (SHA-256 of "001200")
const ADMIN_HASH = '0b8e34c0992231f59dd2407b5168c5247bffe7b87b6e493a72f15db5d293685e';

// ─── API: ADMIN LOGIN ─────────────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ success: false, error: 'Password required' });

  const hash = crypto.createHash('sha256').update(password).digest('hex');
  if (hash === ADMIN_HASH) {
    const token = crypto.createHash('sha256').update(password + Date.now()).digest('hex');
    return res.json({ success: true, token });
  }

  res.status(401).json({ success: false, error: 'Invalid password' });
});

// ─── API: SUBMIT REVIEW ───────────────────────────────────────────────────────
app.post('/api/review', submitLimiter, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const { busId, userName, userCity, rating, title, comment, platform } = req.body;

  if (!busId || !userName || !rating || !comment) {
    return res.status(400).json({ error: 'busId, userName, rating, comment are required' });
  }

  // Strict character length boundaries
  if (userName.length > 50) return res.status(400).json({ error: 'Name must be under 50 characters' });
  if (comment.length > 1000) return res.status(400).json({ error: 'Review comment must be under 1000 characters' });

  const bus = db.buses.find(b => b.id === busId);
  if (!bus) return res.status(404).json({ error: 'Bus not found' });

  const review = {
    id: `rev-${uuidv4().slice(0, 8)}`,
    busId: sanitizeInput(busId).slice(0, 50),
    userName: sanitizeInput(userName).slice(0, 50),
    userCity: sanitizeInput(userCity).slice(0, 50),
    rating: Math.min(5, Math.max(1, parseInt(rating))),
    title: sanitizeInput(title).slice(0, 100),
    comment: sanitizeInput(comment).slice(0, 1000),
    date: new Date().toISOString().split('T')[0],
    helpfulCount: 0,
    verified: false,
    platform: sanitizeInput(platform).slice(0, 30) || 'buscompare'
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
app.post('/api/alert', submitLimiter, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const { email, whatsapp, routeFrom, routeTo, maxPrice, tier } = req.body;

  const cleanEmail = sanitizeInput(email);
  const cleanFrom = sanitizeInput(routeFrom);
  const cleanTo = sanitizeInput(routeTo);

  if (!cleanEmail || !cleanFrom || !cleanTo) {
    return res.status(400).json({ error: 'Email, routeFrom, routeTo are required' });
  }

  // Check duplicate
  const existing = db.alerts.find(a => a.email === cleanEmail && a.routeFrom === cleanFrom && a.routeTo === cleanTo);
  if (existing) {
    return res.status(409).json({ error: 'Alert already exists for this route and email', existing });
  }

  const alert = {
    id: `alert-${uuidv4().slice(0, 8)}`,
    email: cleanEmail,
    whatsapp: sanitizeInput(whatsapp),
    routeFrom: cleanFrom,
    routeTo: cleanTo,
    maxPrice: maxPrice ? parseInt(maxPrice) : null,
    tier: sanitizeInput(tier) || 'free',
    active: true,
    createdAt: new Date().toISOString(),
    triggeredCount: 0
  };

  db.alerts.push(alert);
  db.admin.totalAlerts = (db.admin.totalAlerts || 0) + 1;
  writeDB(db);

  res.status(201).json({ success: true, alert });
});


// ─── API: CRAZY PLANE / FLIGHT SEARCH (BUS VS FLIGHT INTERMODAL) ───────────────
app.get('/api/flights/search', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'From and To required' });

  const normFrom = normalizeCity(from);
  const normTo   = normalizeCity(to);

  // Search exact or alias matching flight deal
  let flight = (db.flights || []).find(f =>
    normalizeCity(f.routeFrom) === normFrom && normalizeCity(f.routeTo) === normTo
  );

  // Fallback: If no pre-configured flight deal for city pair, auto-generate dynamic flight deal
  if (!flight) {
    const busMatch = db.buses.find(b =>
      normalizeCity(b.route.from) === normFrom && normalizeCity(b.route.to) === normTo
    );
    const busPrice = busMatch ? busMatch.lowestPrice : 500;
    const busDur = busMatch ? busMatch.route.duration : '8h 00m';

    flight = {
      id: `flt-dyn-${uuidv4().slice(0,6)}`,
      routeFrom: from,
      routeTo: to,
      airline: 'IndiGo Express',
      flightNumber: '6E-' + Math.floor(100 + Math.random() * 900),
      departureTime: '08:30',
      arrivalTime: '09:45',
      duration: '1h 15m',
      busDuration: busDur,
      hoursSaved: 6.75,
      busMinPrice: busPrice,
      flightPrice: Math.max(1799, Math.round(busPrice * 2.8)),
      commissionEst: 450,
      affiliateUrl: `https://www.makemytrip.com/flights/?affid=buscompare_crazyplane`,
      badge: '✈️ CRAZY PLANE DEAL (SAVE ~7 HOURS)',
      seatsLeft: Math.floor(2 + Math.random() * 5)
    };
  }

  res.json({ flight });
});

// ─── API: 4-WAY MULTI-MODAL TRAVEL CALCULATOR ──────────────────────────────────
app.get('/api/multimodal/calculate', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });

  const normFrom = normalizeCity(from);
  const normTo   = normalizeCity(to);

  const route = db.routes.find(r => normalizeCity(r.from) === normFrom && normalizeCity(r.to) === normTo);
  const busMatch = db.buses.find(b => normalizeCity(b.route.from) === normFrom && normalizeCity(b.route.to) === normTo);
  
  const distance = route ? route.distance : 350;
  const busMinPrice = busMatch ? busMatch.lowestPrice : 399;
  const busDuration = busMatch ? busMatch.route.duration : '6h 30m';

  // 4-Way calculation
  const multimodal = {
    from,
    to,
    distanceKm: distance,
    bus: {
      mode: 'Bus (Volvo AC Sleeper)',
      price: busMinPrice,
      duration: busDuration,
      effectiveTime: busDuration,
      doorToDoorCost: busMinPrice,
      rating: '4.5 ★',
      badge: '💰 CHEAPEST & COMFY',
      icon: '🚌'
    },
    flight: {
      mode: 'Flight (Economy Air)',
      price: Math.max(1899, Math.round(busMinPrice * 2.9)),
      airfareOnly: Math.max(1899, Math.round(busMinPrice * 2.9)),
      duration: '1h 15m',
      airportTaxiCost: 650,
      effectiveTime: '3h 45m (incl. 2h airport check-in)',
      doorToDoorCost: Math.max(1899, Math.round(busMinPrice * 2.9)) + 650,
      badge: '⚡ FASTEST DOOR-TO-DOOR',
      icon: '✈️'
    },
    train: {
      mode: 'Train (IRCTC 3AC / Sleeper)',
      price: Math.max(220, Math.round(busMinPrice * 0.7)),
      duration: '7h 00m',
      effectiveTime: '7h 30m',
      doorToDoorCost: Math.max(220, Math.round(busMinPrice * 0.7)),
      availabilityNote: '⚠️ Waitlist high on weekends',
      badge: '🚆 BUDGET CHOICE',
      icon: '🚆'
    },
    cab: {
      mode: 'Intercity SUV Cab (Private/Shared)',
      price: Math.round(distance * 14),
      perSeatPrice: Math.round((distance * 14) / 4),
      duration: '5h 30m',
      effectiveTime: '5h 30m',
      doorToDoorCost: Math.round(distance * 14),
      badge: '🚗 DOOR-TO-DOOR CONVENIENCE',
      icon: '🚗'
    }
  };

  res.json({ multimodal });
});

// ─── API: DETAILED BOARDING & DROPPING POINTS + MAP LINKS ──────────────────────
app.get('/api/buses/boarding-points/:busId', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const bus = db.buses.find(b => b.id === req.params.busId);
  if (!bus) return res.status(404).json({ error: 'Bus not found' });

  const depTime = bus.route.departureTime;
  const arrTime = bus.route.arrivalTime;
  const fromCity = bus.route.from;
  const toCity = bus.route.to;

  const boardingPoints = [
    {
      time: depTime,
      location: `${fromCity} Central Bus Station / Main Stand`,
      landmark: 'Gate 4, Opposite Railway Station',
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fromCity + ' Central Bus Stand')}`
    },
    {
      time: addMinutesToTime(depTime, 25),
      location: `${fromCity} Highway Toll Plaza / Bypass Junction`,
      landmark: 'Near Shell Petrol Pump & Food Mall',
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fromCity + ' Highway Toll Plaza')}`
    }
  ];

  const droppingPoints = [
    {
      time: subtractMinutesFromTime(arrTime, 20),
      location: `${toCity} Outer Ring Road Drop Point`,
      landmark: 'Bypass Flyover Stop',
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(toCity + ' Bypass Junction')}`
    },
    {
      time: arrTime,
      location: `${toCity} Main Bus Terminal / Railway Station Drop`,
      landmark: 'Platform 1 Taxi Stand Exit',
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(toCity + ' Railway Station Drop')}`
    }
  ];

  const restStops = [
    {
      name: '🍱 Highway Food Express Plaza',
      duration: '30 mins',
      timing: 'Mid-route (around 3 hours into journey)',
      features: ['Food Court (Veg/Non-Veg)', 'Clean Washrooms', 'ATM & Coffee Shop']
    }
  ];

  res.json({
    busId: bus.id,
    operator: bus.operator,
    busType: bus.busType,
    boardingPoints,
    droppingPoints,
    restStops
  });
});

function addMinutesToTime(timeStr, minsToAdd) {
  try {
    const [h, m] = timeStr.split(':').map(Number);
    const date = new Date();
    date.setHours(h, m + minsToAdd);
    return date.toTimeString().slice(0, 5);
  } catch(e) { return timeStr; }
}

function subtractMinutesFromTime(timeStr, minsToSub) {
  try {
    const [h, m] = timeStr.split(':').map(Number);
    const date = new Date();
    date.setHours(h, m - minsToSub);
    return date.toTimeString().slice(0, 5);
  } catch(e) { return timeStr; }
}

// ─── API: ADMIN LEAD EXPORT (CSV / JSON) ──────────────────────────────────────
app.get('/api/admin/leads/export', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const format = req.query.format || 'json';

  const alerts = (db.alerts || []).map(a => ({ type: 'PRICE_ALERT', email: a.email, phone: a.whatsapp || 'N/A', route: `${a.routeFrom} → ${a.routeTo}`, date: a.createdAt }));
  const locks = (db.priceLocks || []).map(l => ({ type: 'PRICE_LOCK', email: l.email || 'N/A', phone: l.phone, route: `Bus ID ${l.busId}`, date: l.expiresAt }));
  const vip = (db.vipSubscriptions || []).map(v => ({ type: 'VIP_PASS', email: v.email, phone: v.phone, route: v.plan, date: v.createdAt }));

  const allLeads = [...alerts, ...locks, ...vip];

  if (format === 'csv') {
    let csv = 'Type,Email,Phone,Route/Plan,Date\n';
    allLeads.forEach(l => {
      csv += `"${l.type}","${l.email}","${l.phone}","${l.route}","${l.date}"\n`;
    });
    res.header('Content-Type', 'text/csv');
    res.attachment('buscompare_leads.csv');
    return res.send(csv);
  }

  res.json({ totalLeads: allLeads.length, leads: allLeads });
});

// ─── FLIGHT AFFILIATE REDIRECT (HIGH COMMISSION ₹450+) ────────────────────────
app.get('/go/flight/:flightId', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const { flightId } = req.params;
  const flight = (db.flights || []).find(f => f.id === flightId);

  const click = {
    id: `clk-flt-${uuidv4().slice(0, 8)}`,
    platform: 'flight_affiliate',
    busId: flightId,
    timestamp: new Date().toISOString(),
    price: flight ? flight.flightPrice : 2499,
    route: flight ? `${flight.routeFrom} → ${flight.routeTo} (Plane)` : 'Flight Deal'
  };

  db.telemetry.push(click);
  if (db.telemetry.length > 500) db.telemetry = db.telemetry.slice(-500);

  db.admin.flightClicks = (db.admin.flightClicks || 0) + 1;
  db.admin.flightAffiliateRevenue = (db.admin.flightAffiliateRevenue || 0) + 450;
  db.admin.revenueEstimate = (db.admin.revenueEstimate || 0) + 450;

  writeDB(db);

  const redirectUrl = flight ? flight.affiliateUrl : 'https://www.makemytrip.com/flights/?affid=buscompare_crazyplane';
  res.redirect(302, redirectUrl);
});

// ─── API: PRICE LOCK MICRO-MONETIZATION (₹39 FEE) ──────────────────────────────
app.post('/api/pricelock/create', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const { busId, lockedPrice, phone, email } = req.body;
  if (!busId || !phone) return res.status(400).json({ error: 'busId and phone required' });

  const lockId = `PL-${uuidv4().slice(0, 8).toUpperCase()}`;
  const lock = {
    id: lockId,
    busId,
    lockedPrice: parseInt(lockedPrice) || 499,
    feePaid: 39,
    phone: sanitizeInput(phone),
    email: sanitizeInput(email || ''),
    expiresAt: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
    status: 'ACTIVE'
  };

  if (!db.priceLocks) db.priceLocks = [];
  db.priceLocks.push(lock);

  db.admin.priceLocksCount = (db.admin.priceLocksCount || 0) + 1;
  db.admin.priceLockRevenue = (db.admin.priceLockRevenue || 0) + 39;
  db.admin.revenueEstimate = (db.admin.revenueEstimate || 0) + 39;

  writeDB(db);

  res.json({
    success: true,
    lockId,
    message: `🔒 Ticket price locked at ₹${lock.lockedPrice} for 6 hours! Lock Pass ID: ${lockId}`,
    lock
  });
});

// ─── API: BUSPASS VIP SUBSCRIPTION (RECURRING MRR) ──────────────────────────────
app.post('/api/vip/subscribe', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const { email, phone, plan } = req.body;
  if (!email || !phone) return res.status(400).json({ error: 'email and phone required' });

  const isAnnual = plan === 'annual';
  const price = isAnnual ? 299 : 99;

  const vipId = `VIP-${uuidv4().slice(0, 8).toUpperCase()}`;
  const sub = {
    id: vipId,
    email: sanitizeInput(email),
    phone: sanitizeInput(phone),
    plan: isAnnual ? 'Annual Pass (₹299/yr)' : 'Monthly Pass (₹99/mo)',
    pricePaid: price,
    createdAt: new Date().toISOString(),
    status: 'ACTIVE'
  };

  if (!db.vipSubscriptions) db.vipSubscriptions = [];
  db.vipSubscriptions.push(sub);

  db.admin.vipSubscriptionsCount = (db.admin.vipSubscriptionsCount || 0) + 1;
  db.admin.vipRevenue = (db.admin.vipRevenue || 0) + price;
  db.admin.revenueEstimate = (db.admin.revenueEstimate || 0) + price;

  writeDB(db);

  res.json({
    success: true,
    vipId,
    message: `👑 Welcome to BusPass VIP! Unlimited Instant Price Alerts & 0 Booking Fees unlocked.`,
    sub
  });
});

// ─── API: ADMIN TOGGLE SPONSORED LISTING ──────────────────────────────────────
app.post('/api/admin/toggle-sponsor', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const { busId, sponsored } = req.body;
  const bus = db.buses.find(b => b.id === busId);
  if (!bus) return res.status(404).json({ error: 'Bus not found' });

  bus.sponsored = !!sponsored;
  if (bus.sponsored) {
    db.admin.sponsoredRevenue = (db.admin.sponsoredRevenue || 0) + 1500;
    db.admin.revenueEstimate = (db.admin.revenueEstimate || 0) + 1500;
  }

  writeDB(db);
  res.json({ success: true, busId, sponsored: bus.sponsored });
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
  if (db.telemetry.length > 500) db.telemetry = db.telemetry.slice(-500);
  db.admin.totalClicks = (db.admin.totalClicks || 0) + 1;

  // Estimate revenue (₹80 avg commission)
  db.admin.busAffiliateRevenue = (db.admin.busAffiliateRevenue || 0) + 80;
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

  // Multi-channel Revenue calculation
  const busClicks = db.admin.totalClicks || 0;
  const flightClicks = db.admin.flightClicks || 0;
  const priceLocks = db.admin.priceLocksCount || (db.priceLocks ? db.priceLocks.length : 0);
  const vipSubs = db.admin.vipSubscriptionsCount || (db.vipSubscriptions ? db.vipSubscriptions.length : 0);

  const busAffiliateRevenue = busClicks * 80;
  const flightAffiliateRevenue = flightClicks * 450;
  const priceLockRevenue = priceLocks * 39;
  const vipRevenue = (db.vipSubscriptions || []).reduce((sum, s) => sum + (s.pricePaid || 99), 0);
  const sponsoredRevenue = db.admin.sponsoredRevenue || 0;

  const grandTotalRevenue = busAffiliateRevenue + flightAffiliateRevenue + priceLockRevenue + vipRevenue + sponsoredRevenue;
  db.admin.revenueEstimate = grandTotalRevenue;

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
      totalClicks: busClicks,
      flightClicks,
      totalSearches: db.admin.totalSearches || 0,
      totalReviews: db.admin.totalReviews || db.reviews.length,
      totalAlerts: db.admin.totalAlerts || db.alerts.length,
      priceLocksCount: priceLocks,
      vipSubscriptionsCount: vipSubs,
      revenueBreakdown: {
        busAffiliate: busAffiliateRevenue,
        flightAffiliate: flightAffiliateRevenue,
        priceLockFees: priceLockRevenue,
        vipSubscriptions: vipRevenue,
        sponsoredAds: sponsoredRevenue
      },
      revenueEstimate: grandTotalRevenue,
      totalBuses: db.buses.length,
      totalRoutes: db.routes.length
    },
    clicksByPlatform,
    topRoutes,
    recentClicks,
    avgRating,
    recentAlerts,
    recentReviews,
    priceLocks: (db.priceLocks || []).slice(-5).reverse(),
    vipSubscriptions: (db.vipSubscriptions || []).slice(-5).reverse(),
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
