"use strict";

const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");

const { readDB, writeDB } = require("../db/dbManager");
const { sanitizeInput } = require("../middleware/validator");
const { submitLimiter } = require("../middleware/rateLimiter");

// POST /api/alert
router.post("/alert", submitLimiter, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });

  const { email, whatsapp, routeFrom, routeTo, maxPrice, tier } = req.body;

  const cleanEmail = sanitizeInput(email);
  const cleanFrom = sanitizeInput(routeFrom);
  const cleanTo = sanitizeInput(routeTo);

  if (!cleanEmail || !cleanFrom || !cleanTo) {
    return res
      .status(400)
      .json({ error: "Email, routeFrom, routeTo are required" });
  }

  const existing = db.alerts.find(
    (a) =>
      a.email === cleanEmail &&
      a.routeFrom === cleanFrom &&
      a.routeTo === cleanTo,
  );
  if (existing) {
    return res
      .status(409)
      .json({
        error: "Alert already exists for this route and email",
        existing,
      });
  }

  const alert = {
    id: `alert-${uuidv4().slice(0, 8)}`,
    email: cleanEmail,
    whatsapp: sanitizeInput(whatsapp),
    routeFrom: cleanFrom,
    routeTo: cleanTo,
    maxPrice: maxPrice ? parseInt(maxPrice) : null,
    tier: sanitizeInput(tier) || "free",
    active: true,
    createdAt: new Date().toISOString(),
    triggeredCount: 0,
  };

  db.alerts.push(alert);
  db.admin.totalAlerts = (db.admin.totalAlerts || 0) + 1;
  writeDB(db);

  res.status(201).json({ success: true, alert });
});

module.exports = router;
