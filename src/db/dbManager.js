"use strict";

const fs = require("fs");
const config = require("../../config/env");

let dbMemoryCache = null;
let isWriting = false;
let pendingWrite = false;

function getDefaultDB() {
  return {
    buses: [],
    routes: [],
    cities: [],
    popularRoutes: [],
    coupons: [],
    priceLocks: [],
    alerts: [],
    vipSubscriptions: [],
    insurancePolicies: [],
    loyaltyUsers: [],
    reviews: [],
    corporateLeads: [],
    operatorLeads: [],
    admin: { totalSearches: 0, totalClicks: 0 },
    analytics: {
      searches: 0,
      platformClicks: {},
      topRoutes: {},
      recentClicks: [],
    },
  };
}

function readDB() {
  if (dbMemoryCache) return dbMemoryCache;
  try {
    if (!fs.existsSync(config.DATABASE_PATH)) {
      console.warn(
        `[DB] Database file not found at ${config.DATABASE_PATH}, returning empty database structure.`,
      );
      dbMemoryCache = getDefaultDB();
      return dbMemoryCache;
    }
    dbMemoryCache = JSON.parse(fs.readFileSync(config.DATABASE_PATH, "utf8"));
    if (!dbMemoryCache.cities) dbMemoryCache.cities = [];
    if (!dbMemoryCache.buses) dbMemoryCache.buses = [];
    if (!dbMemoryCache.routes) dbMemoryCache.routes = [];
    if (!dbMemoryCache.popularRoutes) dbMemoryCache.popularRoutes = [];
    if (!dbMemoryCache.admin) dbMemoryCache.admin = { totalSearches: 0, totalClicks: 0 };
    return dbMemoryCache;
  } catch (e) {
    console.error("[DB] Read error:", e.message);
    return dbMemoryCache || getDefaultDB();
  }
}

function writeDB(data) {
  dbMemoryCache = data || dbMemoryCache || getDefaultDB(); // Update in-memory cache instantly
  if (isWriting) {
    pendingWrite = true;
    return true;
  }
  isWriting = true;
  setImmediate(() => {
    try {
      fs.writeFileSync(
        config.DATABASE_PATH,
        JSON.stringify(dbMemoryCache, null, 2),
        "utf8",
      );
    } catch (e) {
      console.error("[DB] Write error:", e.message);
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

module.exports = {
  readDB,
  writeDB,
};
