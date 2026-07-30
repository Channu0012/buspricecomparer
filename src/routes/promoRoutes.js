'use strict';

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');

const { readDB, writeDB } = require('../db/dbManager');
const { sanitizeInput } = require('../middleware/validator');
const { submitLimiter } = require('../middleware/rateLimiter');

// POST /api/coupons/validate
router.post('/coupons/validate', (req, res) => {
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

// POST /api/pricelock/create
router.post('/pricelock/create', (req, res) => {
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
    message: `🔐 Ticket price locked at ₹${lock.lockedPrice} for 6 hours! Lock Pass ID: ${lockId}`,
    lock
  });
});

// POST /api/vip/subscribe
router.post('/vip/subscribe', (req, res) => {
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

// GET /api/insurance/quote
router.get('/insurance/quote', (req, res) => {
  const fareAmount = parseFloat(req.query.fare) || 500;
  const insuranceFee = Math.min(49 + Math.round(fareAmount * 0.02), 149);
  res.json({
    quote: {
      baseFare: fareAmount,
      insuranceFee,
      covers: [
        { icon: '🚫', label: 'Trip Cancellation', value: `Up to ₹${fareAmount}` },
        { icon: '🏥', label: 'Medical Emergency', value: 'Up to ₹25,000' },
        { icon: '🧳', label: 'Luggage Loss', value: 'Up to ₹5,000' },
        { icon: '⏰', label: 'Missed Bus Guarantee', value: '100% Refund' }
      ],
      provider: 'Acko Travel Insurance (IRDAI Licensed)',
      validity: '24 hours from departure'
    }
  });
});

// POST /api/insurance/purchase
router.post('/insurance/purchase', submitLimiter, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });
  const { phone, email, busId, fare, insuranceFee } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  const policy = {
    id: `INS-${uuidv4().slice(0,8).toUpperCase()}`,
    phone: sanitizeInput(phone), email: sanitizeInput(email || ''),
    busId: sanitizeInput(busId || ''), fare: parseFloat(fare) || 0,
    insuranceFee: parseFloat(insuranceFee) || 49, status: 'ACTIVE',
    createdAt: new Date().toISOString()
  };
  if (!db.insurancePolicies) db.insurancePolicies = [];
  db.insurancePolicies.push(policy);
  db.admin.insurancePoliciesCount = (db.admin.insurancePoliciesCount || 0) + 1;
  db.admin.insuranceRevenue = (db.admin.insuranceRevenue || 0) + policy.insuranceFee;
  writeDB(db);
  res.json({ success: true, policyId: policy.id, message: `Trip Protection activated! Policy ID: ${policy.id}` });
});

// POST /api/loyalty/earn
router.post('/loyalty/earn', submitLimiter, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });
  const { phone, action } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  const COIN_REWARDS = { search: 2, alert: 5, referral: 50, vip: 25, insurance: 10, review: 15, share: 3 };
  const coins = COIN_REWARDS[action] || 2;
  if (!db.loyaltyUsers) db.loyaltyUsers = [];
  let user = db.loyaltyUsers.find(u => u.phone === phone);
  if (!user) {
    const code = `BHARATBUS-${phone.slice(-4)}-${Math.random().toString(36).substring(2,6).toUpperCase()}`;
    user = { id: `loyalty-${uuidv4().slice(0,8)}`, phone, coins: 0, tier: 'Bronze', referralCode: code, referralCount: 0, joinedAt: new Date().toISOString() };
    db.loyaltyUsers.push(user);
  }
  user.coins += coins;
  if (user.coins >= 1000) user.tier = 'Platinum';
  else if (user.coins >= 500) user.tier = 'Gold';
  else if (user.coins >= 150) user.tier = 'Silver';
  else user.tier = 'Bronze';
  writeDB(db);
  res.json({ success: true, coinsEarned: coins, totalCoins: user.coins, tier: user.tier, referralCode: user.referralCode });
});

// GET /api/loyalty/balance
router.get('/loyalty/balance', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });
  const phone = req.query.phone;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  const user = (db.loyaltyUsers || []).find(u => u.phone === phone);
  if (!user) return res.json({ found: false, coins: 0, tier: 'Bronze' });
  res.json({ found: true, coins: user.coins, tier: user.tier, referralCode: user.referralCode, referralCount: user.referralCount });
});

// POST /api/referral/generate
router.post('/referral/generate', submitLimiter, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  if (!db.loyaltyUsers) db.loyaltyUsers = [];
  let user = db.loyaltyUsers.find(u => u.phone === phone);
  if (!user) {
    const code = `BHARATBUS-${phone.slice(-4)}-${Math.random().toString(36).substring(2,6).toUpperCase()}`;
    user = { id: `loyalty-${uuidv4().slice(0,8)}`, phone, coins: 5, tier: 'Bronze', referralCode: code, referralCount: 0, joinedAt: new Date().toISOString() };
    db.loyaltyUsers.push(user);
    writeDB(db);
  }
  res.json({ success: true, referralCode: user.referralCode, shareUrl: `https://buscompare.in?ref=${user.referralCode}`, coinsOnJoin: 50 });
});

// POST /api/review
router.post('/review', submitLimiter, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const { busId, userName, userCity, rating, title, comment, platform } = req.body;

  if (!busId || !userName || !rating || !comment) {
    return res.status(400).json({ error: 'busId, userName, rating, comment are required' });
  }

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

  const busReviews = db.reviews.filter(r => r.busId === busId);
  bus.reviewCount = busReviews.length;
  bus.rating = Math.round(
    (busReviews.reduce((sum, r) => sum + r.rating, 0) / busReviews.length) * 10
  ) / 10;

  db.admin.totalReviews = (db.admin.totalReviews || 0) + 1;
  writeDB(db);

  res.status(201).json({ success: true, review });
});

// POST /api/reviews/submit
router.post('/reviews/submit', submitLimiter, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });
  const { busId, rating, comment, travelerName, route } = req.body;
  if (!busId || !rating) return res.status(400).json({ error: 'busId and rating required' });
  const review = {
    id: `REV-${uuidv4().slice(0,8).toUpperCase()}`,
    busId: sanitizeInput(busId), rating: Math.min(5, Math.max(1, parseInt(rating))),
    comment: sanitizeInput(comment || ''), travelerName: sanitizeInput(travelerName || 'Anonymous Traveler'),
    route: sanitizeInput(route || ''), verified: false, createdAt: new Date().toISOString()
  };
  if (!db.reviews) db.reviews = [];
  db.reviews.push(review);
  db.admin.totalReviews = (db.admin.totalReviews || 0) + 1;
  writeDB(db);
  res.json({ success: true, reviewId: review.id, message: 'Review submitted! Thank you for helping fellow travelers.' });
});

// GET /api/reviews/bus/:busId
router.get('/reviews/bus/:busId', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });
  const busReviews = (db.reviews || []).filter(r => r.busId === req.params.busId);
  const avgRating = busReviews.length ? (busReviews.reduce((s, r) => s + r.rating, 0) / busReviews.length).toFixed(1) : null;
  res.json({ busId: req.params.busId, reviews: busReviews.slice(-10).reverse(), avgRating, totalReviews: busReviews.length });
});

// GET /api/translations/:lang
router.get('/translations/:lang', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });
  const lang = req.params.lang || 'en';
  const t = (db.translations || {})[lang] || (db.translations || {})['en'] || {};
  res.json({ lang, translations: t });
});

// GET /api/hotels/destination
router.get('/hotels/destination', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });
  const dest = (req.query.city || '').toLowerCase();
  const hotels = (db.hotelDeals || []).filter(h => h.destination.toLowerCase().includes(dest));
  const results = hotels.length ? hotels : (db.hotelDeals || []).slice(0, 2);
  res.json({ destination: req.query.city || 'India', hotels: results });
});

module.exports = router;
