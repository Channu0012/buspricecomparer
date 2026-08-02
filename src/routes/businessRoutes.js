"use strict";

const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");

const { readDB, writeDB } = require("../db/dbManager");
const { sanitizeInput } = require("../middleware/validator");
const { submitLimiter } = require("../middleware/rateLimiter");

// POST /api/corporate/inquire (and /api/corporate/inquiry)
function handleCorporateInquiry(req, res) {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });
  const {
    companyName,
    contactName,
    email,
    phone,
    employees,
    monthlyTrips,
    message,
  } = req.body;
  if (!email || !companyName)
    return res.status(400).json({ error: "Company name and email required" });
  const lead = {
    id: `CORP-${uuidv4().slice(0, 8).toUpperCase()}`,
    companyName: sanitizeInput(companyName),
    contactName: sanitizeInput(contactName || ""),
    email: sanitizeInput(email),
    phone: sanitizeInput(phone || ""),
    employees: sanitizeInput(employees || ""),
    monthlyTrips: sanitizeInput(monthlyTrips || ""),
    message: sanitizeInput(message || ""),
    status: "NEW_LEAD",
    estimatedMRR: parseInt(employees || 10) * 500,
    createdAt: new Date().toISOString(),
  };
  if (!db.corporateLeads) db.corporateLeads = [];
  db.corporateLeads.push(lead);
  writeDB(db);
  res.json({
    success: true,
    leadId: lead.id,
    message:
      "Thank you! Our corporate travel specialist will contact you within 24 hours.",
  });
}

router.post("/api/corporate/inquire", submitLimiter, handleCorporateInquiry);
router.post("/api/corporate/inquiry", submitLimiter, handleCorporateInquiry);

// POST /api/operator/inquire
router.post("/api/operator/inquire", submitLimiter, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });
  const {
    operatorName,
    contactName,
    email,
    phone,
    fleetSize,
    routes,
    message,
  } = req.body;
  if (!email || !operatorName)
    return res.status(400).json({ error: "Operator name and email required" });
  const lead = {
    id: `OPR-${uuidv4().slice(0, 8).toUpperCase()}`,
    operatorName: sanitizeInput(operatorName),
    contactName: sanitizeInput(contactName || ""),
    email: sanitizeInput(email),
    phone: sanitizeInput(phone || ""),
    fleetSize: sanitizeInput(fleetSize || ""),
    routes: sanitizeInput(routes || ""),
    message: sanitizeInput(message || ""),
    status: "NEW_LEAD",
    estimatedPlan:
      parseInt(fleetSize || 5) > 20
        ? "Enterprise (₹15,000/mo)"
        : parseInt(fleetSize || 5) > 5
          ? "Growth (₹7,500/mo)"
          : "Starter (₹2,999/mo)",
    createdAt: new Date().toISOString(),
  };
  if (!db.operatorLeads) db.operatorLeads = [];
  db.operatorLeads.push(lead);
  writeDB(db);
  res.json({
    success: true,
    leadId: lead.id,
    message:
      "Welcome aboard! Our operator success team will onboard you within 48 hours.",
  });
});

// GET /go/flight/:flightId
router.get("/go/flight/:flightId", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });

  const { flightId } = req.params;
  const flight = (db.flights || []).find((f) => f.id === flightId);

  const click = {
    id: `clk-flt-${uuidv4().slice(0, 8)}`,
    platform: "flight_affiliate",
    busId: flightId,
    timestamp: new Date().toISOString(),
    price: flight ? flight.flightPrice : 2499,
    route: flight
      ? `${flight.routeFrom} → ${flight.routeTo} (Plane)`
      : "Flight Deal",
  };

  db.telemetry.push(click);
  if (db.telemetry.length > 500) db.telemetry = db.telemetry.slice(-500);

  db.admin.flightClicks = (db.admin.flightClicks || 0) + 1;
  db.admin.flightAffiliateRevenue =
    (db.admin.flightAffiliateRevenue || 0) + 450;
  db.admin.revenueEstimate = (db.admin.revenueEstimate || 0) + 450;

  writeDB(db);

  const redirectUrl = flight
    ? flight.affiliateUrl
    : "https://www.makemytrip.com/flights/?affid=buscompare_crazyplane";
  res.redirect(302, redirectUrl);
});

// GET /go/:platform/:busId
router.get("/go/:platform/:busId", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });

  const { platform, busId } = req.params;
  const bus = db.buses.find((b) => b.id === busId);

  const click = {
    id: `clk-${uuidv4().slice(0, 8)}`,
    platform,
    busId,
    timestamp: new Date().toISOString(),
    price: bus ? bus.prices[platform] : null,
    route: bus ? `${bus.route.from} → ${bus.route.to}` : "unknown",
  };

  db.telemetry.push(click);
  if (db.telemetry.length > 500) db.telemetry = db.telemetry.slice(-500);
  db.admin.totalClicks = (db.admin.totalClicks || 0) + 1;

  db.admin.busAffiliateRevenue = (db.admin.busAffiliateRevenue || 0) + 80;
  db.admin.revenueEstimate = (db.admin.revenueEstimate || 0) + 80;

  writeDB(db);

  const affiliateUrls = {
    redbus: `https://www.redbus.in/bus-tickets/${bus ? bus.route.from.toLowerCase() : ""}-to-${bus ? bus.route.to.toLowerCase() : ""}?src=buscompare`,
    abhibus: `https://www.abhibus.com/bus_search/${bus ? bus.route.from : ""}/${bus ? bus.route.to : ""}/today?ref=buscompare`,
    makemytrip: `https://www.makemytrip.com/bus-tickets/${bus ? bus.route.from.toLowerCase() : ""}-to-${bus ? bus.route.to.toLowerCase() : ""}?affid=buscompare`,
    yatra: `https://www.yatra.com/buses/${bus ? bus.route.from.toLowerCase() : ""}-to-${bus ? bus.route.to.toLowerCase() : ""}?aff=buscompare`,
    direct: `https://www.redbus.in/bus-tickets/${bus ? bus.route.from.toLowerCase() : ""}-to-${bus ? bus.route.to.toLowerCase() : ""}`,
  };

  const redirectUrl = affiliateUrls[platform] || affiliateUrls.redbus;
  res.redirect(302, redirectUrl);
});

// GET /sitemap.xml
router.get("/sitemap.xml", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).send("Error");
  const baseUrl = "https://buscompare.in";
  const today = new Date().toISOString().split("T")[0];
  const staticUrls = ["/", "/alerts", "/corporate", "/operators"]
    .map(
      (u) => `
  <url><loc>${baseUrl}${u}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>`,
    )
    .join("");
  const routeUrls = db.routes
    .map(
      (r) => `
  <url><loc>${baseUrl}/search?from=${r.from}&amp;to=${r.to}</loc><lastmod>${today}</lastmod><changefreq>hourly</changefreq><priority>0.8</priority></url>`,
    )
    .join("");
  const busUrls = db.buses
    .map(
      (b) => `
  <url><loc>${baseUrl}/bus/${b.slug}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>`,
    )
    .join("");
  res.header("Content-Type", "application/xml");
  res.send(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${staticUrls}${routeUrls}${busUrls}</urlset>`,
  );
});

module.exports = router;
