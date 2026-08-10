"use strict";

const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");

const { readDB, writeDB } = require("../db/dbManager");
const { sanitizeInput } = require("../middleware/validator");
const { submitLimiter } = require("../middleware/rateLimiter");

// POST /api/coupons/validate
router.post("/coupons/validate", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });

  const { code, amount } = req.body;
  if (!code) return res.status(400).json({ error: "Coupon code required" });

  const cleanCode = sanitizeInput(code).toUpperCase();
  const baseAmount = parseInt(amount) || 500;

  const coupons = db.coupons || [
    {
      code: "BUSCOMP100",
      discount: 100,
      type: "flat",
      minSpend: 500,
      description: "Flat ₹100 OFF on all bookings above ₹500",
    },
    {
      code: "SUPERBUS50",
      discount: 50,
      type: "flat",
      minSpend: 250,
      description: "Flat ₹50 OFF on any bus ticket",
    },
    {
      code: "FIRSTBUS150",
      discount: 150,
      type: "flat",
      minSpend: 700,
      description: "₹150 OFF for first time BusCompare users",
    },
    {
      code: "FESTIVE200",
      discount: 200,
      type: "flat",
      minSpend: 1000,
      description: "Flat ₹200 OFF on Luxury & Volvo Sleeper buses",
    },
  ];

  const coupon = coupons.find((c) => c.code === cleanCode);

  if (!coupon) {
    return res
      .status(404)
      .json({
        valid: false,
        error: "Invalid coupon code. Try BUSCOMP100 or SUPERBUS50",
      });
  }

  if (baseAmount < coupon.minSpend) {
    return res
      .status(400)
      .json({
        valid: false,
        error: `Minimum order amount of ₹${coupon.minSpend} required for code ${coupon.code}`,
      });
  }

  const finalAmount = Math.max(0, baseAmount - coupon.discount);

  res.json({
    valid: true,
    code: coupon.code,
    discount: coupon.discount,
    originalAmount: baseAmount,
    finalAmount,
    description: coupon.description,
    message: `🎉 Coupon ${coupon.code} applied! You saved ₹${coupon.discount}.`,
  });
});

// POST /api/pricelock/create
router.post("/pricelock/create", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });

  const { busId, lockedPrice, phone, email } = req.body;
  if (!busId || !phone)
    return res.status(400).json({ error: "busId and phone required" });

  const lockId = `PL-${uuidv4().slice(0, 8).toUpperCase()}`;
  const lock = {
    id: lockId,
    busId,
    lockedPrice: parseInt(lockedPrice) || 499,
    feePaid: 39,
    phone: sanitizeInput(phone),
    email: sanitizeInput(email || ""),
    expiresAt: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
    status: "ACTIVE",
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
    lock,
  });
});

// POST /api/vip/subscribe
router.post("/vip/subscribe", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });

  const { email, phone, plan } = req.body;
  if (!email || !phone)
    return res.status(400).json({ error: "email and phone required" });

  const isAnnual = plan === "annual";
  const price = isAnnual ? 299 : 99;

  const vipId = `VIP-${uuidv4().slice(0, 8).toUpperCase()}`;
  const sub = {
    id: vipId,
    email: sanitizeInput(email),
    phone: sanitizeInput(phone),
    plan: isAnnual ? "Annual Pass (₹299/yr)" : "Monthly Pass (₹99/mo)",
    pricePaid: price,
    createdAt: new Date().toISOString(),
    status: "ACTIVE",
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
    sub,
  });
});

// GET /api/insurance/quote
router.get("/insurance/quote", (req, res) => {
  const fareAmount = parseFloat(req.query.fare) || 500;
  const insuranceFee = Math.min(49 + Math.round(fareAmount * 0.02), 149);
  res.json({
    quote: {
      baseFare: fareAmount,
      insuranceFee,
      covers: [
        {
          icon: "🚫",
          label: "Trip Cancellation",
          value: `Up to ₹${fareAmount}`,
        },
        { icon: "🏥", label: "Medical Emergency", value: "Up to ₹25,000" },
        { icon: "🧳", label: "Luggage Loss", value: "Up to ₹5,000" },
        { icon: "⏰", label: "Missed Bus Guarantee", value: "100% Refund" },
      ],
      provider: "Acko Travel Insurance (IRDAI Licensed)",
      validity: "24 hours from departure",
    },
  });
});

// POST /api/insurance/purchase
router.post("/insurance/purchase", submitLimiter, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });
  const { phone, email, busId, fare, insuranceFee } = req.body;
  if (!phone) return res.status(400).json({ error: "Phone required" });
  const policy = {
    id: `INS-${uuidv4().slice(0, 8).toUpperCase()}`,
    phone: sanitizeInput(phone),
    email: sanitizeInput(email || ""),
    busId: sanitizeInput(busId || ""),
    fare: parseFloat(fare) || 0,
    insuranceFee: parseFloat(insuranceFee) || 49,
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
  };
  if (!db.insurancePolicies) db.insurancePolicies = [];
  db.insurancePolicies.push(policy);
  db.admin.insurancePoliciesCount = (db.admin.insurancePoliciesCount || 0) + 1;
  db.admin.insuranceRevenue =
    (db.admin.insuranceRevenue || 0) + policy.insuranceFee;
  writeDB(db);
  res.json({
    success: true,
    policyId: policy.id,
    message: `Trip Protection activated! Policy ID: ${policy.id}`,
  });
});

// POST /api/loyalty/earn
router.post("/loyalty/earn", submitLimiter, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });
  const { phone, action } = req.body;
  if (!phone) return res.status(400).json({ error: "Phone required" });
  const COIN_REWARDS = {
    search: 2,
    alert: 5,
    referral: 50,
    vip: 25,
    insurance: 10,
    review: 15,
    share: 3,
  };
  const coins = COIN_REWARDS[action] || 2;
  if (!db.loyaltyUsers) db.loyaltyUsers = [];
  let user = db.loyaltyUsers.find((u) => u.phone === phone);
  if (!user) {
    const code = `BHARATBUS-${phone.slice(-4)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    user = {
      id: `loyalty-${uuidv4().slice(0, 8)}`,
      phone,
      coins: 0,
      tier: "Bronze",
      referralCode: code,
      referralCount: 0,
      joinedAt: new Date().toISOString(),
    };
    db.loyaltyUsers.push(user);
  }
  user.coins += coins;
  if (user.coins >= 1000) user.tier = "Platinum";
  else if (user.coins >= 500) user.tier = "Gold";
  else if (user.coins >= 150) user.tier = "Silver";
  else user.tier = "Bronze";
  writeDB(db);
  res.json({
    success: true,
    coinsEarned: coins,
    totalCoins: user.coins,
    tier: user.tier,
    referralCode: user.referralCode,
  });
});

// GET /api/loyalty/balance
router.get("/loyalty/balance", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });
  const phone = req.query.phone;
  if (!phone) return res.status(400).json({ error: "Phone required" });
  const user = (db.loyaltyUsers || []).find((u) => u.phone === phone);
  if (!user) return res.json({ found: false, coins: 0, tier: "Bronze" });
  res.json({
    found: true,
    coins: user.coins,
    tier: user.tier,
    referralCode: user.referralCode,
    referralCount: user.referralCount,
  });
});

// POST /api/referral/generate
router.post("/referral/generate", submitLimiter, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Phone required" });
  if (!db.loyaltyUsers) db.loyaltyUsers = [];
  let user = db.loyaltyUsers.find((u) => u.phone === phone);
  if (!user) {
    const code = `BHARATBUS-${phone.slice(-4)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    user = {
      id: `loyalty-${uuidv4().slice(0, 8)}`,
      phone,
      coins: 5,
      tier: "Bronze",
      referralCode: code,
      referralCount: 0,
      joinedAt: new Date().toISOString(),
    };
    db.loyaltyUsers.push(user);
    writeDB(db);
  }
  res.json({
    success: true,
    referralCode: user.referralCode,
    shareUrl: `https://buscompare.in?ref=${user.referralCode}`,
    coinsOnJoin: 50,
  });
});

// POST /api/review
router.post("/review", submitLimiter, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });

  const { busId, userName, userCity, rating, title, comment, platform } =
    req.body;

  if (!busId || !userName || !rating || !comment) {
    return res
      .status(400)
      .json({ error: "busId, userName, rating, comment are required" });
  }

  if (userName.length > 50)
    return res.status(400).json({ error: "Name must be under 50 characters" });
  if (comment.length > 1000)
    return res
      .status(400)
      .json({ error: "Review comment must be under 1000 characters" });

  const bus = db.buses.find((b) => b.id === busId);
  if (!bus) return res.status(404).json({ error: "Bus not found" });

  const review = {
    id: `rev-${uuidv4().slice(0, 8)}`,
    busId: sanitizeInput(busId).slice(0, 50),
    userName: sanitizeInput(userName).slice(0, 50),
    userCity: sanitizeInput(userCity).slice(0, 50),
    rating: Math.min(5, Math.max(1, parseInt(rating))),
    title: sanitizeInput(title).slice(0, 100),
    comment: sanitizeInput(comment).slice(0, 1000),
    date: new Date().toISOString().split("T")[0],
    helpfulCount: 0,
    verified: false,
    platform: sanitizeInput(platform).slice(0, 30) || "buscompare",
  };

  db.reviews.push(review);

  const busReviews = db.reviews.filter((r) => r.busId === busId);
  bus.reviewCount = busReviews.length;
  bus.rating =
    Math.round(
      (busReviews.reduce((sum, r) => sum + r.rating, 0) / busReviews.length) *
        10,
    ) / 10;

  db.admin.totalReviews = (db.admin.totalReviews || 0) + 1;
  writeDB(db);

  res.status(201).json({ success: true, review });
});

// POST /api/reviews/submit
router.post("/reviews/submit", submitLimiter, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });
  const { busId, rating, comment, travelerName, route } = req.body;
  if (!busId || !rating)
    return res.status(400).json({ error: "busId and rating required" });
  const review = {
    id: `REV-${uuidv4().slice(0, 8).toUpperCase()}`,
    busId: sanitizeInput(busId),
    rating: Math.min(5, Math.max(1, parseInt(rating))),
    comment: sanitizeInput(comment || ""),
    travelerName: sanitizeInput(travelerName || "Anonymous Traveler"),
    route: sanitizeInput(route || ""),
    verified: false,
    createdAt: new Date().toISOString(),
  };
  if (!db.reviews) db.reviews = [];
  db.reviews.push(review);
  db.admin.totalReviews = (db.admin.totalReviews || 0) + 1;
  writeDB(db);
  res.json({
    success: true,
    reviewId: review.id,
    message: "Review submitted! Thank you for helping fellow travelers.",
  });
});

// GET /api/reviews/bus/:busId
router.get("/reviews/bus/:busId", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });
  const busReviews = (db.reviews || []).filter(
    (r) => r.busId === req.params.busId,
  );
  const avgRating = busReviews.length
    ? (
        busReviews.reduce((s, r) => s + r.rating, 0) / busReviews.length
      ).toFixed(1)
    : null;
  res.json({
    busId: req.params.busId,
    reviews: busReviews.slice(-10).reverse(),
    avgRating,
    totalReviews: busReviews.length,
  });
});

// GET /api/translations/:lang
router.get("/translations/:lang", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });
  const lang = req.params.lang || "en";
  const t =
    (db.translations || {})[lang] || (db.translations || {})["en"] || {};
  res.json({ lang, translations: t });
});

// GET /api/hotels/destination
router.get("/hotels/destination", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });
  const dest = (req.query.city || "").toLowerCase();
  const hotels = (db.hotelDeals || []).filter((h) =>
    h.destination.toLowerCase().includes(dest),
  );
  const results = hotels.length ? hotels : (db.hotelDeals || []).slice(0, 2);
  res.json({ destination: req.query.city || "India", hotels: results });
});

// ─── MONETIZATION: Premium WhatsApp Alerts (₹29/mo) ────────────────────────
router.post("/premium-alert/subscribe", submitLimiter, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });
  const { phone, email, routes } = req.body;
  if (!phone) return res.status(400).json({ error: "Phone number required" });

  const subId = `PA-${uuidv4().slice(0, 8).toUpperCase()}`;
  const sub = {
    id: subId,
    phone: sanitizeInput(phone),
    email: sanitizeInput(email || ""),
    routes: routes || ["Mumbai-Goa", "Delhi-Jaipur"],
    plan: "Premium WhatsApp Alerts (₹29/mo)",
    pricePaid: 29,
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
  };

  if (!db.premiumAlerts) db.premiumAlerts = [];
  db.premiumAlerts.push(sub);
  db.admin.premiumAlertRevenue = (db.admin.premiumAlertRevenue || 0) + 29;
  db.admin.revenueEstimate = (db.admin.revenueEstimate || 0) + 29;
  writeDB(db);

  res.json({
    success: true,
    subscriptionId: subId,
    message: "📱 Premium WhatsApp Alerts activated! You'll get instant price drop notifications.",
    subscription: sub,
  });
});

// ─── MONETIZATION: Hotel Cross-Sell Commission (₹200/lead) ──────────────────
router.post("/hotel/book", submitLimiter, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });
  const { destination, hotelName, phone, email, checkIn, nights } = req.body;
  if (!destination || !phone) return res.status(400).json({ error: "Destination and phone required" });

  const bookingId = `HTL-${uuidv4().slice(0, 8).toUpperCase()}`;
  const booking = {
    id: bookingId,
    destination: sanitizeInput(destination),
    hotelName: sanitizeInput(hotelName || "Partner Hotel"),
    phone: sanitizeInput(phone),
    email: sanitizeInput(email || ""),
    checkIn: checkIn || new Date().toISOString().split("T")[0],
    nights: parseInt(nights) || 1,
    commission: 200,
    status: "LEAD_SENT",
    createdAt: new Date().toISOString(),
  };

  if (!db.hotelBookings) db.hotelBookings = [];
  db.hotelBookings.push(booking);
  db.admin.hotelCommission = (db.admin.hotelCommission || 0) + 200;
  db.admin.revenueEstimate = (db.admin.revenueEstimate || 0) + 200;
  writeDB(db);

  res.json({
    success: true,
    bookingId,
    message: `🏨 Hotel inquiry sent! Our partner hotel in ${destination} will confirm within 2 hours.`,
    booking,
  });
});

// ─── MONETIZATION: Route Analytics Reports for Operators (₹999/report) ──────
router.post("/analytics/purchase", submitLimiter, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });
  const { operatorName, email, route, reportType } = req.body;
  if (!email || !route) return res.status(400).json({ error: "Email and route required" });

  const reportId = `RPT-${uuidv4().slice(0, 8).toUpperCase()}`;
  const report = {
    id: reportId,
    operatorName: sanitizeInput(operatorName || "Unknown"),
    email: sanitizeInput(email),
    route: sanitizeInput(route),
    reportType: reportType || "demand_pricing",
    price: 999,
    status: "GENERATING",
    createdAt: new Date().toISOString(),
  };

  if (!db.analyticsReports) db.analyticsReports = [];
  db.analyticsReports.push(report);
  db.admin.analyticsRevenue = (db.admin.analyticsRevenue || 0) + 999;
  db.admin.revenueEstimate = (db.admin.revenueEstimate || 0) + 999;
  writeDB(db);

  res.json({
    success: true,
    reportId,
    message: `📊 Route Analytics Report for "${route}" is being generated. Delivery to ${email} within 24 hours.`,
    report,
  });
});

// ─── MONETIZATION: White-Label API License (₹9,999/mo) ──────────────────────
router.post("/whitelabel/subscribe", submitLimiter, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });
  const { companyName, email, phone, useCase } = req.body;
  if (!email || !companyName) return res.status(400).json({ error: "Company name and email required" });

  const licenseId = `WL-${uuidv4().slice(0, 8).toUpperCase()}`;
  const apiKey = `bc_live_${uuidv4().replace(/-/g, "").slice(0, 32)}`;
  const license = {
    id: licenseId,
    apiKey,
    companyName: sanitizeInput(companyName),
    email: sanitizeInput(email),
    phone: sanitizeInput(phone || ""),
    useCase: sanitizeInput(useCase || "travel_app"),
    plan: "White-Label API (₹9,999/mo)",
    monthlyFee: 9999,
    requestsPerDay: 10000,
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
  };

  if (!db.whitelabelLicenses) db.whitelabelLicenses = [];
  db.whitelabelLicenses.push(license);
  db.admin.whitelabelRevenue = (db.admin.whitelabelRevenue || 0) + 9999;
  db.admin.revenueEstimate = (db.admin.revenueEstimate || 0) + 9999;
  writeDB(db);

  res.json({
    success: true,
    licenseId,
    apiKey,
    message: `🔑 White-Label API License activated! Your API key: ${apiKey}. 10,000 requests/day included.`,
    license,
  });
});

// ─── MONETIZATION: Operator SaaS Tier Subscription (₹2,999-15,000/mo) ───────
router.post("/operator/subscribe", submitLimiter, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });
  const { operatorName, email, phone, plan } = req.body;
  if (!email || !operatorName) return res.status(400).json({ error: "Operator name and email required" });

  const PLANS = {
    starter: { name: "Starter", price: 2999, buses: 10, features: ["Basic listing", "Monthly reports", "Email support"] },
    growth: { name: "Growth", price: 7500, buses: 50, features: ["Featured listing", "Weekly reports", "Priority support", "Dynamic pricing"] },
    enterprise: { name: "Enterprise", price: 15000, buses: 500, features: ["Top placement", "Real-time analytics", "Dedicated manager", "API access", "Custom branding"] },
  };

  const selected = PLANS[plan] || PLANS.starter;
  const subId = `OPSAAS-${uuidv4().slice(0, 8).toUpperCase()}`;
  const subscription = {
    id: subId,
    operatorName: sanitizeInput(operatorName),
    email: sanitizeInput(email),
    phone: sanitizeInput(phone || ""),
    plan: selected.name,
    monthlyFee: selected.price,
    maxBuses: selected.buses,
    features: selected.features,
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
  };

  if (!db.operatorSubscriptions) db.operatorSubscriptions = [];
  db.operatorSubscriptions.push(subscription);
  db.admin.operatorSaasRevenue = (db.admin.operatorSaasRevenue || 0) + selected.price;
  db.admin.revenueEstimate = (db.admin.revenueEstimate || 0) + selected.price;
  writeDB(db);

  res.json({
    success: true,
    subscriptionId: subId,
    message: `🚌 ${selected.name} Plan activated for ${operatorName}! List up to ${selected.buses} buses.`,
    subscription,
  });
});

// ─── MONETIZATION: Sponsored Listing Impression Track (₹50/impression) ──────
router.post("/sponsored/track", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });
  const { busId, position } = req.body;

  db.admin.sponsoredImpressions = (db.admin.sponsoredImpressions || 0) + 1;
  db.admin.sponsoredRevenue = (db.admin.sponsoredRevenue || 0) + 50;
  db.admin.revenueEstimate = (db.admin.revenueEstimate || 0) + 50;
  writeDB(db);

  res.json({ success: true, tracked: true, busId, position });
});

module.exports = router;

