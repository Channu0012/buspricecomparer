'use strict';

const fs = require('fs');
const config = require('../../config/env');

let dbMemoryCache = null;
let isWriting = false;
let pendingWrite = false;

function readDB() {
  if (dbMemoryCache) return dbMemoryCache;
  try {
    if (!fs.existsSync(config.DATABASE_PATH)) {
      console.warn(`[DB] Database file not found at ${config.DATABASE_PATH}, returning empty database structure.`);
      return { buses: [], routes: [], priceLocks: [], alerts: [], vipSubscriptions: [], insurancePolicies: [], loyaltyUsers: [], reviews: [], corporateLeads: [], operatorLeads: [], analytics: { searches: 0, platformClicks: {}, topRoutes: {}, recentClicks: [] } };
    }
    dbMemoryCache = JSON.parse(fs.readFileSync(config.DATABASE_PATH, 'utf8'));
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
      fs.writeFileSync(config.DATABASE_PATH, JSON.stringify(dbMemoryCache, null, 2), 'utf8');
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

module.exports = {
  readDB,
  writeDB
};
