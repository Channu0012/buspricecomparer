'use strict';

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');

const { readDB, writeDB } = require('../db/dbManager');
const { sanitizeInput } = require('../middleware/validator');

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

// GET /api/cities
router.get('/cities', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });
  const q = (req.query.q || '').toLowerCase();
  const cities = q
    ? db.cities.filter(c => c.name.toLowerCase().includes(q))
    : db.cities;
  res.json({ cities });
});

// GET /api/popular
router.get('/popular', (req, res) => {
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

// GET /api/routes
router.get('/routes', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });
  res.json({ routes: db.routes });
});

// Helper: Generate dynamic real-time buses for any city pair when no pre-seeded bus matches
function generateDynamicBuses(from, to, normFrom, normTo, db) {
  const operators = [
    { code: 'VRL', name: 'VRL Travels', rating: 4.5, reviewCount: 3420 },
    { code: 'SRS', name: 'SRS Travels', rating: 4.3, reviewCount: 2150 },
    { code: 'ZNG', name: 'Zingbus Premium', rating: 4.7, reviewCount: 1890 },
    { code: 'ICS', name: 'IntrCity SmartBus', rating: 4.6, reviewCount: 4100 },
    { code: 'ORT', name: 'Orange Travels', rating: 4.4, reviewCount: 1670 },
    { code: 'NEU', name: 'NeuGo Electric Bus', rating: 4.8, reviewCount: 950 }
  ];

  const busTemplates = [
    { type: 'Volvo Multi-Axle AC Sleeper (2+1)', code: 'ac-sleeper', basePrice: 850, dep: '21:00', arr: '06:30', dur: '9h 30m', mins: 570, am: ['AC', 'WiFi', 'Charging Point', 'Blanket', 'Water Bottle', 'Reading Light'] },
    { type: 'Scania Metrolink AC Seater (2+2)', code: 'ac-seater', basePrice: 499, dep: '07:30', arr: '16:00', dur: '8h 30m', mins: 510, am: ['AC', 'Charging Point', 'Water Bottle', 'Entertainment'] },
    { type: 'Luxury AC Sleeper (2+1)', code: 'ac-sleeper', basePrice: 999, dep: '22:15', arr: '07:45', dur: '9h 30m', mins: 570, am: ['AC', 'WiFi', 'Charging Point', 'Blanket', 'Water Bottle', 'Toilet'] },
    { type: 'Express Non-AC Seater (2+2)', code: 'non-ac', basePrice: 350, dep: '06:00', arr: '14:30', dur: '8h 30m', mins: 510, am: ['Water Bottle', 'Reading Light'] },
    { type: 'IntrCity SmartBus AC Sleeper (2+1)', code: 'ac-sleeper', basePrice: 899, dep: '20:30', arr: '06:00', dur: '9h 30m', mins: 570, am: ['AC', 'WiFi', 'Charging Point', 'Blanket', 'Water Bottle', 'Snacks'] },
    { type: 'NeuGo 100% Electric AC Seater (2+2)', code: 'ac-seater', basePrice: 599, dep: '10:00', arr: '18:15', dur: '8h 15m', mins: 495, am: ['AC', 'WiFi', 'Charging Point', 'Water Bottle', 'Quiet Zone'] }
  ];

  const dynamicBuses = [];

  operators.forEach((op, idx) => {
    const tmpl = busTemplates[idx % busTemplates.length];
    const busId = `dyn-bus-${normFrom.slice(0,3)}-${normTo.slice(0,3)}-${op.code.toLowerCase()}-${idx+1}`;
    const slug = `${op.name.toLowerCase().replace(/\s+/g, '-')}-${tmpl.code}-${normFrom}-to-${normTo}`;

    const baseP = tmpl.basePrice + (idx * 50);
    const prices = {
      redbus: Math.round(baseP * 1.08),
      abhibus: Math.round(baseP * 1.04),
      makemytrip: Math.round(baseP * 1.10),
      yatra: Math.round(baseP * 1.12),
      direct: baseP
    };

    const busObj = {
      id: busId,
      slug,
      operator: op.name,
      operatorCode: op.code,
      busType: tmpl.type,
      busTypeCode: tmpl.code,
      rating: op.rating,
      reviewCount: op.reviewCount,
      totalBookings: 12000 + (idx * 3400),
      amenities: tmpl.am,
      route: {
        from: from.charAt(0).toUpperCase() + from.slice(1),
        to: to.charAt(0).toUpperCase() + to.slice(1),
        routeId: `${normFrom.slice(0,3)}-${normTo.slice(0,3)}`,
        departureTime: tmpl.dep,
        arrivalTime: tmpl.arr,
        duration: tmpl.dur,
        durationMinutes: tmpl.mins,
        distance: 380,
        departureStop: `${from} Central Bus Stand`,
        arrivalStop: `${to} Main Bus Terminal`
      },
      prices,
      lowestPrice: baseP,
      highestPrice: prices.yatra,
      seatsLeft: Math.floor(4 + Math.random() * 20),
      totalSeats: 36,
      boardingPoints: [
        { name: `${from} Central Stand`, time: tmpl.dep },
        { name: `${from} Toll Plaza`, time: addMinutesToTime(tmpl.dep, 25) }
      ],
      droppingPoints: [
        { name: `${to} Ring Road`, time: subtractMinutesFromTime(tmpl.arr, 20) },
        { name: `${to} Bus Terminal`, time: tmpl.arr }
      ],
      policies: {
        cancellation: 'Free cancellation up to 12h before departure',
        luggage: '2 bags (max 15kg each)'
      },
      featured: idx === 0 || idx === 2,
      sponsored: idx === 0,
      badges: idx === 0 ? ['featured', 'top-rated'] : ['best-seller']
    };

    dynamicBuses.push(busObj);
  });

  return dynamicBuses;
}

// GET /api/search
router.get('/search', (req, res) => {
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

  let results = db.buses.filter(bus => {
    const bFrom = normalizeCity(bus.route.from);
    const bTo   = normalizeCity(bus.route.to);
    return bFrom === normFrom && bTo === normTo;
  });

  if (results.length === 0) {
    results = db.buses.filter(bus => {
      const bFrom = normalizeCity(bus.route.from);
      const bTo   = normalizeCity(bus.route.to);
      return (bFrom.includes(normFrom) || normFrom.includes(bFrom)) &&
             (bTo.includes(normTo) || normTo.includes(bTo));
    });
  }

  // Dynamic Real-Time Generator Fallback if no static bus exists for city pair
  if (results.length === 0) {
    results = generateDynamicBuses(from, to, normFrom, normTo, db);
  }

  // Filter by bus type (flexible matching)
  if (busType && busType !== 'all') {
    results = results.filter(b => {
      // If the bus has an explicit busTypeCode, match only against it
      if (b.busTypeCode) return b.busTypeCode === busType;
      // Fallback: text-based matching for older/legacy entries without busTypeCode
      const typeLower = (b.busType || '').toLowerCase();
      if (busType === 'ac-sleeper') {
        return typeLower.includes('sleeper') && !typeLower.includes('non-ac') && !typeLower.includes('non ac');
      }
      if (busType === 'ac-seater') {
        return (typeLower.includes('seater') || typeLower.includes('shivneri')) && !typeLower.includes('sleeper') && !typeLower.includes('non-ac') && !typeLower.includes('non ac');
      }
      if (busType === 'luxury-seater') {
        return typeLower.includes('luxury') || typeLower.includes('volvo') || typeLower.includes('premium') || typeLower.includes('scania');
      }
      if (busType === 'non-ac') {
        return typeLower.includes('non-ac') || typeLower.includes('non ac');
      }
      return false;
    });
  }

  // Filter by operator
  if (operator && operator !== 'all') {
    results = results.filter(b => b.operatorCode === operator || b.operator.toLowerCase().includes(operator.toLowerCase()));
  }

  // Dynamic Date Demand Multiplier
  let dateMultiplier = 1.0;
  if (date) {
    const dayOfWeek = new Date(date + 'T00:00:00').getDay();
    if (dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0) {
      dateMultiplier = 1.20;
    } else if (dayOfWeek === 2 || dayOfWeek === 3) {
      dateMultiplier = 0.90;
    }
  }

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

  if (minPrice) {
    results = results.filter(b => b.lowestPrice >= parseInt(minPrice));
  }
  if (maxPrice) {
    results = results.filter(b => b.lowestPrice <= parseInt(maxPrice));
  }

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

  if (amenities) {
    const requiredAmenities = amenities.split(',').map(a => a.trim().toLowerCase());
    results = results.filter(b => {
      const bAmList = (b.amenities || []).map(a => a.toLowerCase());
      return requiredAmenities.every(reqA =>
        bAmList.some(ba => ba.includes(reqA) || reqA.includes(ba))
      );
    });
  }

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
      results.sort((a, b) => {
        if (b.featured !== a.featured) return b.featured ? 1 : -1;
        return a.lowestPrice - b.lowestPrice;
      });
  }

  const route = db.routes.find(r =>
    normalizeCity(r.from) === normFrom &&
    normalizeCity(r.to) === normTo
  );

  const availableOperators = [...new Map(results.map(b => [b.operatorCode || b.operator, { code: b.operatorCode || b.operator, name: b.operator }])).values()];

  res.json({
    results,
    total: results.length,
    route: route || { from, to, distance: 380, avgDuration: '8h 30m', minPrice: Math.min(...results.map(r => r.lowestPrice)) },
    availableOperators,
    coupons: db.coupons || [],
    priceHistory: route ? route.priceHistory : null,
    query: { from, to, date, busType, operator, sort }
  });
});

// GET /api/price-trends
router.get('/price-trends', (req, res) => {
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

// GET /api/seat-map/:busId
router.get('/seat-map/:busId', (req, res) => {
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

// GET /api/bus/:slug
router.get('/bus/:slug', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const bus = db.buses.find(b => b.slug === req.params.slug);
  if (!bus) return res.status(404).json({ error: 'Bus not found' });

  const reviews = db.reviews.filter(r => r.busId === bus.id);
  const route = db.routes.find(r => r.id === bus.route.routeId);
  const operator = db.operators.find(o => o.code === bus.operatorCode);

  const related = db.buses
    .filter(b => b.route.routeId === bus.route.routeId && b.id !== bus.id)
    .slice(0, 3);

  res.json({ bus, reviews, route, operator, related });
});

// GET /api/flights/search
router.get('/flights/search', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: 'DB error' });

  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'From and To required' });

  const normFrom = normalizeCity(from);
  const normTo   = normalizeCity(to);

  let flight = (db.flights || []).find(f =>
    normalizeCity(f.routeFrom) === normFrom && normalizeCity(f.routeTo) === normTo
  );

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

// GET /api/multimodal/calculate
router.get('/multimodal/calculate', (req, res) => {
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
      icon: '✈️ '
    },
    train: {
      mode: 'Train (IRCTC 3AC / Sleeper)',
      price: Math.max(220, Math.round(busMinPrice * 0.7)),
      duration: '7h 00m',
      effectiveTime: '7h 30m',
      doorToDoorCost: Math.max(220, Math.round(busMinPrice * 0.7)),
      availabilityNote: '⚠️ Waitlist high on weekends',
      badge: '🚂 BUDGET CHOICE',
      icon: '🚂'
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

// GET /api/buses/boarding-points/:busId
router.get('/buses/boarding-points/:busId', (req, res) => {
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
      name: '🍴 Highway Food Express Plaza',
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

module.exports = router;
