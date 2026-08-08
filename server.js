"use strict";

const express = require("express");
const path = require("path");
const os = require("os");
const helmet = require("helmet");

const config = require("./config/env");
const { globalLimiter } = require("./src/middleware/rateLimiter");
const apiRouter = require("./src/routes/api");

// Process-level crash prevention
process.on("uncaughtException", (err) => {
  console.error("⚠️ Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled Rejection:", reason);
});

const app = express();

// Helper: Get Local Network IP
function getLanIP() {
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === "IPv4" && !iface.internal) return iface.address;
      }
    }
  } catch (e) {}
  return "localhost";
}

// Security & Header Middlewares
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use("/api", globalLimiter);

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-admin-pass, x-admin-token",
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Serve Static Assets
app.use(express.static(path.join(__dirname, "public")));

// Dedicated HTML Page Routers
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "templates", "index.html"));
});

app.get("/search", (req, res) => {
  res.sendFile(path.join(__dirname, "templates", "search.html"));
});

app.get("/bus/:slug", (req, res) => {
  res.sendFile(path.join(__dirname, "templates", "bus.html"));
});

app.get("/alerts", (req, res) => {
  res.sendFile(path.join(__dirname, "templates", "alerts.html"));
});

app.get("/privacy", (req, res) => {
  res.sendFile(path.join(__dirname, "templates", "privacy.html"));
});

app.get("/terms", (req, res) => {
  res.sendFile(path.join(__dirname, "templates", "terms.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/corporate", (req, res) => {
  res.sendFile(path.join(__dirname, "templates", "index.html"));
});

app.get("/operators", (req, res) => {
  res.sendFile(path.join(__dirname, "templates", "index.html"));
});

// Mount Modular API Routes
app.use("/api", apiRouter);

// Mount Business & Affiliate Routes (/go/* and /sitemap.xml)
const businessRoutes = require("./src/routes/businessRoutes");
app.use("/", businessRoutes);

// Fallback 404 Route - Send index.html safely
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "templates", "index.html"));
});

// Global Error Handler Middleware
app.use((err, req, res, next) => {
  console.error("⚠️ Express Global Error:", err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
});

// Start Listener
app.listen(config.PORT, config.HOST, () => {
  const lan = getLanIP();
  console.log("");
  console.log("  🌐 BharatTravel Super-Platform — Server Running");
  console.log("  ─────────────────────────────────────────────────");
  console.log(`  🌐 Local:      http://localhost:${config.PORT}`);
  console.log(`  📡 Network:    http://${lan}:${config.PORT}`);
  console.log(
    `  🔍 Search:     http://localhost:${config.PORT}/search?from=Mumbai&to=Goa`,
  );
  console.log(`  💼 Corporate:  http://localhost:${config.PORT}/corporate`);
  console.log(`  🚌 Operators:  http://localhost:${config.PORT}/operators`);
  console.log(`  📊 Admin:      http://localhost:${config.PORT}/admin`);
  console.log("  ─────────────────────────────────────────────────");
  console.log("  💰 Revenue Streams:");
  console.log("     🛡️ Insurance  🏨 Hotels  🪙 BusCoins  🔗 Referrals");
  console.log("     ⭐ Reviews   💼 Corporate  🚌 Operator SaaS");
  console.log("");
  console.log(
    "  ⚠️  Do NOT use VS Code Live Server — always use node server.js",
  );
  console.log("");
});

module.exports = app;
