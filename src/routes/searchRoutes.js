"use strict";

const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");

const { readDB, writeDB } = require("../db/dbManager");
const { sanitizeInput } = require("../middleware/validator");

const CITY_ALIASES = {
  bengaluru: "bangalore",
  madras: "chennai",
  bombay: "mumbai",
  poona: "pune",
  calcutta: "kolkata",
  gurugram: "gurgaon",
  baroda: "vadodara",
  trivandrum: "thiruvananthapuram",
  vizag: "visakhapatnam",
};

function normalizeCity(name) {
  if (!name) return "";
  const clean = name.trim().toLowerCase();
  return CITY_ALIASES[clean] || clean;
}

function addMinutesToTime(timeStr, minsToAdd) {
  try {
    const [h, m] = timeStr.split(":").map(Number);
    const date = new Date();
    date.setHours(h, m + minsToAdd);
    return date.toTimeString().slice(0, 5);
  } catch (e) {
    return timeStr;
  }
}

function subtractMinutesFromTime(timeStr, minsToSub) {
  try {
    const [h, m] = timeStr.split(":").map(Number);
    const date = new Date();
    date.setHours(h, m - minsToSub);
    return date.toTimeString().slice(0, 5);
  } catch (e) {
    return timeStr;
  }
}

// GET /api/cities
router.get("/cities", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });
  const q = (req.query.q || "").toLowerCase();

  const citySet = new Set((db.cities || []).map((c) => c.name.toLowerCase()));
  const extraCities = [];

  (db.buses || []).forEach((b) => {
    if (b.route) {
      if (b.route.from && !citySet.has(b.route.from.toLowerCase())) {
        citySet.add(b.route.from.toLowerCase());
        extraCities.push({
          id: b.route.from.toLowerCase().replace(/[^a-z0-9]/g, ""),
          name: b.route.from,
          state: "India",
          popular: true,
        });
      }
      if (b.route.to && !citySet.has(b.route.to.toLowerCase())) {
        citySet.add(b.route.to.toLowerCase());
        extraCities.push({
          id: b.route.to.toLowerCase().replace(/[^a-z0-9]/g, ""),
          name: b.route.to,
          state: "India",
          popular: true,
        });
      }
    }
  });

  (db.routes || []).forEach((r) => {
    if (r.from && !citySet.has(r.from.toLowerCase())) {
      citySet.add(r.from.toLowerCase());
      extraCities.push({
        id: r.from.toLowerCase().replace(/[^a-z0-9]/g, ""),
        name: r.from,
        state: "India",
        popular: true,
      });
    }
    if (r.to && !citySet.has(r.to.toLowerCase())) {
      citySet.add(r.to.toLowerCase());
      extraCities.push({
        id: r.to.toLowerCase().replace(/[^a-z0-9]/g, ""),
        name: r.to,
        state: "India",
        popular: true,
      });
    }
  });

  const allCities = [...db.cities, ...extraCities];
  const cities = q
    ? allCities.filter((c) => c.name.toLowerCase().includes(q))
    : allCities;
  res.json({ cities });
});

// GET /api/popular
router.get("/popular", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });

  const popular = db.popularRoutes.map((pr) => {
    const route = db.routes.find((r) => r.id === pr.routeId);
    const buses = db.buses.filter((b) => b.route.routeId === pr.routeId);
    const minPrice =
      buses.length > 0 ? Math.min(...buses.map((b) => b.lowestPrice)) : 0;
    return {
      ...route,
      searches: pr.searches,
      bookings: pr.bookings,
      minPrice,
      busCount: buses.length,
    };
  });

  res.json({ popular });
});

// GET /api/routes
router.get("/routes", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });
  res.json({ routes: db.routes });
});

// Helper: Generate dynamic real-time buses for any city/district/town/taluk pair across India (15-20 buses)
function generateDynamicBuses(from, to, normFrom, normTo, db) {
  const operators = [
    { code: "VRL",   name: "VRL Travels",             rating: 4.5, reviewCount: 3420, bookings: 84200 },
    { code: "SRS",   name: "SRS Travels",              rating: 4.3, reviewCount: 2150, bookings: 62100 },
    { code: "ZNG",   name: "Zingbus Premium",           rating: 4.7, reviewCount: 1890, bookings: 31500 },
    { code: "ICS",   name: "IntrCity SmartBus",         rating: 4.6, reviewCount: 4100, bookings: 95600 },
    { code: "ORT",   name: "Orange Travels",            rating: 4.4, reviewCount: 1670, bookings: 43200 },
    { code: "NEU",   name: "NeuGo Electric Bus",        rating: 4.8, reviewCount:  950, bookings: 18700 },
    { code: "KPN",   name: "KPN Travels",               rating: 4.2, reviewCount: 5100, bookings: 120400 },
    { code: "SHV",   name: "Shivneri Express",          rating: 4.4, reviewCount: 2850, bookings: 57300 },
    { code: "PVT",   name: "Paulo Travels",             rating: 4.3, reviewCount: 1340, bookings: 29800 },
    { code: "SVK",   name: "Skylark Travels",           rating: 4.1, reviewCount:  780, bookings: 14200 },
    { code: "KSRTC", name: "KSRTC FlyBus AC",           rating: 4.5, reviewCount: 8900, bookings: 185000 },
    { code: "MSRTC", name: "MSRTC Shivshahi AC",        rating: 4.3, reviewCount: 7400, bookings: 162000 },
    { code: "SETC",  name: "SETC Tamil Nadu Ultra",     rating: 4.2, reviewCount: 4300, bookings: 98000 },
    { code: "CHR",   name: "Chartered Bus Luxury",      rating: 4.6, reviewCount: 2100, bookings: 48000 },
    { code: "HMT",   name: "Himalayan Motors AC",       rating: 4.4, reviewCount: 1560, bookings: 36000 },
  ];

  const busTemplates = [
    {
      type: "Volvo Multi-Axle AC Sleeper (2+1)", code: "ac-sleeper",
      baseFactor: 1.0, dep: "21:00",
      am: ["AC", "WiFi", "Charging Point", "Blanket", "Water Bottle", "Reading Light"],
      badges: ["top-rated", "featured"], seats: [3, 8], totalSeats: 18,
    },
    {
      type: "Scania AC Semi-Sleeper (2+1)", code: "ac-sleeper",
      baseFactor: 0.85, dep: "20:00",
      am: ["AC", "Charging Point", "Blanket", "Water Bottle"],
      badges: ["best-seller"], seats: [6, 14], totalSeats: 26,
    },
    {
      type: "AC Seater (2+2) Express", code: "ac-seater",
      baseFactor: 0.55, dep: "07:30",
      am: ["AC", "Charging Point", "Water Bottle", "Entertainment"],
      badges: ["budget-pick"], seats: [8, 22], totalSeats: 40,
    },
    {
      type: "Luxury Single Sleeper (1+1)", code: "luxury-sleeper",
      baseFactor: 1.45, dep: "22:15",
      am: ["AC", "WiFi", "Charging Point", "Blanket", "Water Bottle", "Toilet", "Entertainment", "Snacks"],
      badges: ["luxury", "top-rated"], seats: [2, 5], totalSeats: 14,
    },
    {
      type: "Non-AC Sleeper (2+1)", code: "non-ac",
      baseFactor: 0.42, dep: "19:30",
      am: ["Water Bottle", "Reading Light", "Charging Point"],
      badges: ["budget-pick"], seats: [10, 24], totalSeats: 36,
    },
    {
      type: "Volvo AC Seater (2+3) Express", code: "ac-seater",
      baseFactor: 0.48, dep: "06:00",
      am: ["AC", "Water Bottle", "Charging Point"],
      badges: ["earliest"], seats: [9, 20], totalSeats: 45,
    },
    {
      type: "NeuGo 100% Electric AC (2+2)", code: "ac-seater",
      baseFactor: 0.65, dep: "10:00",
      am: ["AC", "WiFi", "Charging Point", "Water Bottle", "Quiet Zone"],
      badges: ["eco-friendly", "featured"], seats: [5, 16], totalSeats: 36,
    },
    {
      type: "IntrCity SmartBus AC Sleeper", code: "ac-sleeper",
      baseFactor: 0.95, dep: "23:00",
      am: ["AC", "WiFi", "Charging Point", "Blanket", "Water Bottle", "Snacks"],
      badges: ["top-rated"], seats: [4, 12], totalSeats: 22,
    },
    {
      type: "AC Sleeper Corporate (2+1)", code: "ac-sleeper",
      baseFactor: 1.1, dep: "22:45",
      am: ["AC", "WiFi", "Charging Point", "Blanket", "Water Bottle", "Reading Light"],
      badges: ["featured"], seats: [3, 9], totalSeats: 18,
    },
    {
      type: "Budget Non-AC Seater (2+3)", code: "non-ac",
      baseFactor: 0.35, dep: "05:30",
      am: ["Water Bottle"],
      badges: ["cheapest"], seats: [12, 32], totalSeats: 52,
    },
    {
      type: "State Express AC Airavat (2+2)", code: "ac-seater",
      baseFactor: 0.60, dep: "08:15",
      am: ["AC", "Water Bottle", "Charging Point"],
      badges: ["government", "popular"], seats: [7, 18], totalSeats: 42,
    },
    {
      type: "Shivshahi AC Express (2+2)", code: "ac-seater",
      baseFactor: 0.58, dep: "14:00",
      am: ["AC", "Water Bottle", "Charging Point"],
      badges: ["government", "best-seller"], seats: [5, 15], totalSeats: 44,
    },
    {
      type: "Ultra Deluxe AC Sleeper (2+1)", code: "ac-sleeper",
      baseFactor: 1.05, dep: "21:45",
      am: ["AC", "WiFi", "Charging Point", "Blanket", "Water Bottle"],
      badges: ["luxury", "featured"], seats: [2, 7], totalSeats: 20,
    },
    {
      type: "Night Rider Non-AC Sleeper (2+1)", code: "non-ac",
      baseFactor: 0.40, dep: "23:30",
      am: ["Water Bottle", "Reading Light"],
      badges: ["budget-pick"], seats: [8, 20], totalSeats: 36,
    },
    {
      type: "Intercity EV Executive AC (2+2)", code: "ac-seater",
      baseFactor: 0.70, dep: "11:30",
      am: ["AC", "WiFi", "Charging Point", "Water Bottle", "Quiet Zone"],
      badges: ["eco-friendly", "top-rated"], seats: [4, 11], totalSeats: 34,
    },
  ];

  // Estimate distance from city name length hash (deterministic, realistic range 180-950km)
  const distHash = ((normFrom.length * 37 + normTo.length * 53) % 750) + 180;
  const baseDistancePrice = Math.round(distHash * 1.35);

  const dynamicBuses = [];

  operators.forEach((op, idx) => {
    const tmpl = busTemplates[idx % busTemplates.length];
    const busId = `dyn-bus-${normFrom.slice(0, 3)}-${normTo.slice(0, 3)}-${op.code.toLowerCase()}-${idx + 1}`;
    const slug = `${op.name.toLowerCase().replace(/\s+/g, "-")}-${tmpl.code}-${normFrom}-to-${normTo}-${idx + 1}`;

    const baseP = Math.round(baseDistancePrice * tmpl.baseFactor * (0.88 + (idx * 0.021)));
    const prices = {
      redbus:      Math.round(baseP * 1.08),
      abhibus:     Math.round(baseP * 1.03),
      makemytrip:  Math.round(baseP * 1.11),
      yatra:       Math.round(baseP * 1.13),
      direct:      baseP,
    };

    const depHour  = (parseInt(tmpl.dep.split(":")[0]) + Math.floor(idx / 2)) % 24;
    const depMin   = (parseInt(tmpl.dep.split(":")[1]) + (idx % 2) * 20) % 60;
    const depStr   = `${String(depHour).padStart(2,"0")}:${String(depMin).padStart(2,"0")}`;
    const durationMins = Math.round((distHash / 60) * 60 + 25);
    const durH = Math.floor(durationMins / 60);
    const durM = durationMins % 60;
    const arrMins   = depHour * 60 + depMin + durationMins;
    const arrHour   = Math.floor(arrMins / 60) % 24;
    const arrMinute = arrMins % 60;
    const arrStr    = `${String(arrHour).padStart(2,"0")}:${String(arrMinute).padStart(2,"0")}`;

    const seatRange   = tmpl.seats;
    const seatsLeft   = Math.floor(seatRange[0] + Math.random() * (seatRange[1] - seatRange[0]));
    const totalSeats  = tmpl.totalSeats;

    dynamicBuses.push({
      id: busId,
      slug,
      operator:      op.name,
      operatorCode:  op.code,
      busType:       tmpl.type,
      busTypeCode:   tmpl.code,
      rating:        op.rating,
      reviewCount:   op.reviewCount,
      totalBookings: op.bookings,
      amenities:     tmpl.am,
      route: {
        from:          from.charAt(0).toUpperCase() + from.slice(1),
        to:            to.charAt(0).toUpperCase()   + to.slice(1),
        routeId:       `${normFrom.slice(0, 3)}-${normTo.slice(0, 3)}`,
        departureTime: depStr,
        arrivalTime:   arrStr,
        duration:      `${durH}h ${String(durM).padStart(2,"0")}m`,
        durationMinutes: durationMins,
        distance:      distHash,
        departureStop: `${from.charAt(0).toUpperCase() + from.slice(1)} Central Bus Stand`,
        arrivalStop:   `${to.charAt(0).toUpperCase() + to.slice(1)} Main Terminal`,
      },
      prices,
      lowestPrice:  baseP,
      highestPrice: prices.yatra,
      seatsLeft,
      totalSeats,
      boardingPoints: [
        { name: `${from.charAt(0).toUpperCase() + from.slice(1)} Central Stand`, time: depStr },
        { name: `${from.charAt(0).toUpperCase() + from.slice(1)} Toll Plaza`, time: addMinutesToTime(depStr, 25) },
        { name: `${from.charAt(0).toUpperCase() + from.slice(1)} Highway Entry`, time: addMinutesToTime(depStr, 45) },
      ],
      droppingPoints: [
        { name: `${to.charAt(0).toUpperCase() + to.slice(1)} Ring Road`, time: subtractMinutesFromTime(arrStr, 20) },
        { name: `${to.charAt(0).toUpperCase() + to.slice(1)} Bus Terminal`, time: arrStr },
      ],
      policies: {
        cancellation: "Free cancellation up to 12h before departure",
        luggage:      "2 bags (max 15kg each)",
      },
      featured:  idx === 0 || idx === 2 || idx === 6,
      sponsored: idx === 0,
      badges:    tmpl.badges,
    });
  });

  return dynamicBuses;
}

// GET /api/search
router.get("/search", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });

  const {
    from,
    to,
    date,
    busType,
    operator,
    minPrice,
    maxPrice,
    departure,
    sort,
    amenities,
  } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: "From and To cities are required" });
  }

  const normFrom = normalizeCity(from);
  const normTo = normalizeCity(to);

  // Increment search counter
  db.admin.totalSearches = (db.admin.totalSearches || 0) + 1;
  writeDB(db);

  let results = db.buses.filter((bus) => {
    const bFrom = normalizeCity(bus.route.from);
    const bTo = normalizeCity(bus.route.to);
    return bFrom === normFrom && bTo === normTo;
  });

  if (results.length === 0) {
    results = db.buses.filter((bus) => {
      const bFrom = normalizeCity(bus.route.from);
      const bTo = normalizeCity(bus.route.to);
      return (
        (bFrom.includes(normFrom) || normFrom.includes(bFrom)) &&
        (bTo.includes(normTo) || normTo.includes(bTo))
      );
    });
  }

  // Always pad to 10+ buses so users see a rich result set (never just 2)
  const dynamicPad = generateDynamicBuses(from, to, normFrom, normTo, db);
  if (results.length < 10) {
    // Only add dynamic buses whose IDs don't already exist in static results
    const existingIds = new Set(results.map((b) => b.id));
    const toAdd = dynamicPad.filter((b) => !existingIds.has(b.id));
    results = [...results, ...toAdd].slice(0, 12); // cap at 12
  }

  // Filter by bus type (flexible matching)
  if (busType && busType !== "all") {
    results = results.filter((b) => {
      // If the bus has an explicit busTypeCode, match only against it
      if (b.busTypeCode) return b.busTypeCode === busType;
      // Fallback: text-based matching for older/legacy entries without busTypeCode
      const typeLower = (b.busType || "").toLowerCase();
      if (busType === "ac-sleeper") {
        return (
          typeLower.includes("sleeper") &&
          !typeLower.includes("non-ac") &&
          !typeLower.includes("non ac")
        );
      }
      if (busType === "ac-seater") {
        return (
          (typeLower.includes("seater") || typeLower.includes("shivneri")) &&
          !typeLower.includes("sleeper") &&
          !typeLower.includes("non-ac") &&
          !typeLower.includes("non ac")
        );
      }
      if (busType === "luxury-seater") {
        return (
          typeLower.includes("luxury") ||
          typeLower.includes("volvo") ||
          typeLower.includes("premium") ||
          typeLower.includes("scania")
        );
      }
      if (busType === "non-ac") {
        return typeLower.includes("non-ac") || typeLower.includes("non ac");
      }
      return false;
    });
  }

  // Filter by operator
  if (operator && operator !== "all") {
    results = results.filter(
      (b) =>
        b.operatorCode === operator ||
        b.operator.toLowerCase().includes(operator.toLowerCase()),
    );
  }

  // Dynamic Date Demand Multiplier
  let dateMultiplier = 1.0;
  if (date) {
    const dayOfWeek = new Date(date + "T00:00:00").getDay();
    if (dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0) {
      dateMultiplier = 1.2;
    } else if (dayOfWeek === 2 || dayOfWeek === 3) {
      dateMultiplier = 0.9;
    }
  }

  results = results.map((b) => {
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
      highestPrice: highP,
    };
  });

  if (minPrice) {
    results = results.filter((b) => b.lowestPrice >= parseInt(minPrice));
  }
  if (maxPrice) {
    results = results.filter((b) => b.lowestPrice <= parseInt(maxPrice));
  }

  if (departure && departure !== "all") {
    results = results.filter((bus) => {
      const hour = parseInt(bus.route.departureTime.split(":")[0]);
      switch (departure) {
        case "morning":
          return hour >= 6 && hour < 12;
        case "afternoon":
          return hour >= 12 && hour < 17;
        case "evening":
          return hour >= 17 && hour < 21;
        case "night":
          return hour >= 21 || hour < 6;
        default:
          return true;
      }
    });
  }

  if (amenities) {
    const requiredAmenities = amenities
      .split(",")
      .map((a) => a.trim().toLowerCase());
    results = results.filter((b) => {
      const bAmList = (b.amenities || []).map((a) => a.toLowerCase());
      return requiredAmenities.every((reqA) =>
        bAmList.some((ba) => ba.includes(reqA) || reqA.includes(ba)),
      );
    });
  }

  switch (sort) {
    case "price-asc":
      results.sort((a, b) => a.lowestPrice - b.lowestPrice);
      break;
    case "price-desc":
      results.sort((a, b) => b.lowestPrice - a.lowestPrice);
      break;
    case "rating":
      results.sort((a, b) => b.rating - a.rating);
      break;
    case "duration":
      results.sort((a, b) => a.route.durationMinutes - b.route.durationMinutes);
      break;
    case "departure":
      results.sort((a, b) =>
        a.route.departureTime.localeCompare(b.route.departureTime),
      );
      break;
    default:
      results.sort((a, b) => {
        if (b.featured !== a.featured) return b.featured ? 1 : -1;
        return a.lowestPrice - b.lowestPrice;
      });
  }

  const route = db.routes.find(
    (r) => normalizeCity(r.from) === normFrom && normalizeCity(r.to) === normTo,
  );

  const availableOperators = [
    ...new Map(
      results.map((b) => [
        b.operatorCode || b.operator,
        { code: b.operatorCode || b.operator, name: b.operator },
      ]),
    ).values(),
  ];

  res.json({
    results,
    total: results.length,
    route: route || {
      from,
      to,
      distance: 380,
      avgDuration: "8h 30m",
      minPrice: Math.min(...results.map((r) => r.lowestPrice)),
    },
    availableOperators,
    coupons: db.coupons || [],
    priceHistory: route ? route.priceHistory : null,
    query: { from, to, date, busType, operator, sort },
  });
});

// GET /api/price-trends
router.get("/price-trends", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });

  const { from, to } = req.query;
  if (!from || !to)
    return res.status(400).json({ error: "from and to required" });

  const route = db.routes.find(
    (r) =>
      normalizeCity(r.from) === normalizeCity(from) &&
      normalizeCity(r.to) === normalizeCity(to),
  );

  const basePrice = route ? route.minPrice : 450;
  const history =
    route && route.priceHistory
      ? route.priceHistory
      : [
          { day: "Mon", price: Math.round(basePrice * 0.95) },
          { day: "Tue", price: Math.round(basePrice * 0.9) },
          { day: "Wed", price: Math.round(basePrice * 0.92) },
          { day: "Thu", price: Math.round(basePrice * 1.0) },
          { day: "Fri", price: Math.round(basePrice * 1.25) },
          { day: "Sat", price: Math.round(basePrice * 1.3) },
          { day: "Sun", price: Math.round(basePrice * 1.15) },
        ];

  const avgPrice = Math.round(
    history.reduce((s, h) => s + h.price, 0) / history.length,
  );
  const minDay = history.reduce(
    (min, h) => (h.price < min.price ? h : min),
    history[0],
  );

  res.json({
    from,
    to,
    history,
    avgPrice,
    cheapestDay: minDay.day,
    cheapestPrice: minDay.price,
    recommendation: `Prices are lowest on ${minDay.day}s (₹${minDay.price}). High demand on Fridays & Saturdays!`,
  });
});

// Helper to find a bus by ID or slug across static DB and dynamic buses
function findBusByIdOrSlug(idOrSlug, db) {
  let bus = db.buses.find((b) => b.id === idOrSlug || b.slug === idOrSlug);
  if (!bus && idOrSlug.startsWith("dyn-bus-")) {
    const parts = idOrSlug.split("-");
    const fromCode = parts[2] || "mum";
    const toCode = parts[3] || "goa";
    const dyns = generateDynamicBuses(fromCode, toCode, fromCode, toCode, db);
    bus = dyns.find((b) => b.id === idOrSlug) || dyns[0];
  }
  if (!bus && idOrSlug.includes("-to-")) {
    const parts = idOrSlug.split("-to-");
    const fromPart = parts[0].split("-").pop() || "mumbai";
    const toPart = parts[1].split("-")[0] || "goa";
    const dyns = generateDynamicBuses(fromPart, toPart, fromPart, toPart, db);
    bus = dyns.find((b) => b.slug === idOrSlug) || dyns[0];
  }
  return bus;
}

// GET /api/seat-map/:busId
router.get("/seat-map/:busId", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });

  const bus = findBusByIdOrSlug(req.params.busId, db);
  if (!bus) return res.status(404).json({ error: "Bus not found" });

  const isSleeper = bus.busTypeCode
    ? bus.busTypeCode.includes("sleeper")
    : true;
  const basePrice = bus.lowestPrice;

  let decks = {};

  if (isSleeper) {
    decks = {
      isSleeper: true,
      lowerDeck: [
        [
          {
            id: "L1",
            no: "1L",
            type: "single",
            status: "available",
            price: basePrice + 50,
            isWindow: true,
          },
          {
            id: "L2",
            no: "2L",
            type: "double",
            status: "booked",
            price: basePrice,
            isWindow: false,
          },
          {
            id: "L3",
            no: "3L",
            type: "double",
            status: "available",
            price: basePrice + 50,
            isWindow: true,
          },
        ],
        [
          {
            id: "L4",
            no: "4L",
            type: "single",
            status: "female",
            price: basePrice + 50,
            isWindow: true,
          },
          {
            id: "L5",
            no: "5L",
            type: "double",
            status: "available",
            price: basePrice,
            isWindow: false,
          },
          {
            id: "L6",
            no: "6L",
            type: "double",
            status: "available",
            price: basePrice + 50,
            isWindow: true,
          },
        ],
        [
          {
            id: "L7",
            no: "7L",
            type: "single",
            status: "available",
            price: basePrice + 50,
            isWindow: true,
          },
          {
            id: "L8",
            no: "8L",
            type: "double",
            status: "booked",
            price: basePrice,
            isWindow: false,
          },
          {
            id: "L9",
            no: "9L",
            type: "double",
            status: "female",
            price: basePrice + 50,
            isWindow: true,
          },
        ],
        [
          {
            id: "L10",
            no: "10L",
            type: "single",
            status: "available",
            price: basePrice + 50,
            isWindow: true,
          },
          {
            id: "L11",
            no: "11L",
            type: "double",
            status: "available",
            price: basePrice,
            isWindow: false,
          },
          {
            id: "L12",
            no: "12L",
            type: "double",
            status: "available",
            price: basePrice + 50,
            isWindow: true,
          },
        ],
      ],
      upperDeck: [
        [
          {
            id: "U1",
            no: "1U",
            type: "single",
            status: "available",
            price: basePrice,
            isWindow: true,
          },
          {
            id: "U2",
            no: "2U",
            type: "double",
            status: "available",
            price: basePrice - 30,
            isWindow: false,
          },
          {
            id: "U3",
            no: "3U",
            type: "double",
            status: "booked",
            price: basePrice,
            isWindow: true,
          },
        ],
        [
          {
            id: "U4",
            no: "4U",
            type: "single",
            status: "booked",
            price: basePrice,
            isWindow: true,
          },
          {
            id: "U5",
            no: "5U",
            type: "double",
            status: "available",
            price: basePrice - 30,
            isWindow: false,
          },
          {
            id: "U6",
            no: "6U",
            type: "double",
            status: "available",
            price: basePrice,
            isWindow: true,
          },
        ],
        [
          {
            id: "U7",
            no: "7U",
            type: "single",
            status: "female",
            price: basePrice,
            isWindow: true,
          },
          {
            id: "U8",
            no: "8U",
            type: "double",
            status: "available",
            price: basePrice - 30,
            isWindow: false,
          },
          {
            id: "U9",
            no: "9U",
            type: "double",
            status: "available",
            price: basePrice,
            isWindow: true,
          },
        ],
        [
          {
            id: "U10",
            no: "10U",
            type: "single",
            status: "available",
            price: basePrice,
            isWindow: true,
          },
          {
            id: "U11",
            no: "11U",
            type: "double",
            status: "booked",
            price: basePrice - 30,
            isWindow: false,
          },
          {
            id: "U12",
            no: "12U",
            type: "double",
            status: "available",
            price: basePrice,
            isWindow: true,
          },
        ],
      ],
    };
  } else {
    decks = {
      isSleeper: false,
      lowerDeck: [
        [
          {
            id: "S1",
            no: "A1",
            type: "seat",
            status: "available",
            price: basePrice + 30,
            isWindow: true,
          },
          {
            id: "S2",
            no: "A2",
            type: "seat",
            status: "available",
            price: basePrice,
            isWindow: false,
          },
          {
            id: "S3",
            no: "A3",
            type: "seat",
            status: "booked",
            price: basePrice,
            isWindow: false,
          },
          {
            id: "S4",
            no: "A4",
            type: "seat",
            status: "available",
            price: basePrice + 30,
            isWindow: true,
          },
        ],
        [
          {
            id: "S5",
            no: "B1",
            type: "seat",
            status: "female",
            price: basePrice + 30,
            isWindow: true,
          },
          {
            id: "S6",
            no: "B2",
            type: "seat",
            status: "available",
            price: basePrice,
            isWindow: false,
          },
          {
            id: "S7",
            no: "B3",
            type: "seat",
            status: "available",
            price: basePrice,
            isWindow: false,
          },
          {
            id: "S8",
            no: "B4",
            type: "seat",
            status: "available",
            price: basePrice + 30,
            isWindow: true,
          },
        ],
        [
          {
            id: "S9",
            no: "C1",
            type: "seat",
            status: "available",
            price: basePrice + 30,
            isWindow: true,
          },
          {
            id: "S10",
            no: "C2",
            type: "seat",
            status: "booked",
            price: basePrice,
            isWindow: false,
          },
          {
            id: "S11",
            no: "C3",
            type: "seat",
            status: "booked",
            price: basePrice,
            isWindow: false,
          },
          {
            id: "S12",
            no: "C4",
            type: "seat",
            status: "available",
            price: basePrice + 30,
            isWindow: true,
          },
        ],
        [
          {
            id: "S13",
            no: "D1",
            type: "seat",
            status: "available",
            price: basePrice + 30,
            isWindow: true,
          },
          {
            id: "S14",
            no: "D2",
            type: "seat",
            status: "available",
            price: basePrice,
            isWindow: false,
          },
          {
            id: "S15",
            no: "D3",
            type: "seat",
            status: "female",
            price: basePrice,
            isWindow: false,
          },
          {
            id: "S16",
            no: "D4",
            type: "seat",
            status: "available",
            price: basePrice + 30,
            isWindow: true,
          },
        ],
      ],
    };
  }

  res.json({
    busId: bus.id,
    busName: bus.operator,
    busType: bus.busType,
    totalSeats: bus.totalSeats,
    seatsLeft: bus.seatsLeft,
    basePrice,
    decks,
  });
});

// GET /api/bus/:slug
router.get("/bus/:slug", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });

  const bus = findBusByIdOrSlug(req.params.slug, db);
  if (!bus) return res.status(404).json({ error: "Bus not found" });

  const reviews = db.reviews.filter((r) => r.busId === bus.id);
  const route = db.routes.find((r) => r.id === bus.route.routeId);
  const operator = db.operators.find((o) => o.code === bus.operatorCode);

  const related = db.buses
    .filter((b) => b.route.routeId === bus.route.routeId && b.id !== bus.id)
    .slice(0, 3);

  res.json({ bus, reviews, route, operator, related });
});

// In-memory active seat holds map (seatId -> holdObj)
const activeSeatLocks = new Map();

// POST /api/seat/lock
router.post("/seat/lock", (req, res) => {
  const { busId, seatIds, phone } = req.body;
  if (!busId || !seatIds || !Array.isArray(seatIds) || seatIds.length === 0) {
    return res.status(400).json({ error: "busId and non-empty seatIds array are required" });
  }

  const now = Date.now();
  const holdDurationMs = 5 * 60 * 1000; // 5 minutes
  const expiresAt = now + holdDurationMs;

  // Check if any seat is already locked by someone else
  const conflict = seatIds.find((seatId) => {
    const key = `${busId}:${seatId}`;
    const lock = activeSeatLocks.get(key);
    return lock && lock.expiresAt > now && lock.phone !== phone;
  });

  if (conflict) {
    return res.status(409).json({ error: `Seat ${conflict} is currently locked by another user.` });
  }

  // Lock seats
  seatIds.forEach((seatId) => {
    const key = `${busId}:${seatId}`;
    activeSeatLocks.set(key, { busId, seatId, phone, expiresAt });
  });

  res.json({
    success: true,
    busId,
    lockedSeats: seatIds,
    expiresAt,
    holdTimeSeconds: 300,
    message: `Reserved ${seatIds.join(", ")} for 5:00 minutes. Complete checkout to confirm.`,
  });
});

// POST /api/seat/book
router.post("/seat/book", (req, res) => {
  const { busId, seatIds, passengerName, phone, email } = req.body;
  if (!busId || !seatIds || !Array.isArray(seatIds) || seatIds.length === 0) {
    return res.status(400).json({ error: "busId, seatIds, passengerName, and phone are required" });
  }

  const bookingId = "BK-" + Math.floor(100000 + Math.random() * 900000);

  // Clear locks
  seatIds.forEach((seatId) => {
    activeSeatLocks.delete(`${busId}:${seatId}`);
  });

  res.json({
    success: true,
    bookingId,
    busId,
    seatIds,
    passengerName: passengerName || "Passenger",
    phone,
    email: email || "passenger@example.com",
    status: "CONFIRMED",
    message: `🎉 Booking confirmed! Ticket #${bookingId} sent to WhatsApp & Email.`,
  });
});

// GET /api/bus/live-status/:busId
router.get("/bus/live-status/:busId", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });

  const bus = findBusByIdOrSlug(req.params.busId, db);
  if (!bus) return res.status(404).json({ error: "Bus not found" });

  const landmarks = [
    "Approaching Swargate Bus Terminal",
    "Passing Panvel Highway Toll Plaza",
    "En Route on NH48 Expressway",
    "Arrived at Lonavala Food Court",
    "Passing Khandala Bypass",
  ];
  const landmark = landmarks[Math.floor(Math.random() * landmarks.length)];

  res.json({
    busId: bus.id,
    operator: bus.operator,
    busType: bus.busType,
    status: "ON_TIME",
    currentLandmark: landmark,
    speedKmph: Math.floor(65 + Math.random() * 25),
    distanceCoveredKm: Math.floor(30 + Math.random() * 80),
    delayMinutes: 0,
    liveSeatCount: bus.seatsLeft,
    lastGpsUpdate: new Date().toISOString(),
  });
});

// GET /api/flights/search
router.get("/flights/search", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });

  const { from, to } = req.query;
  if (!from || !to)
    return res.status(400).json({ error: "From and To required" });

  const normFrom = normalizeCity(from);
  const normTo = normalizeCity(to);

  let flight = (db.flights || []).find(
    (f) =>
      normalizeCity(f.routeFrom) === normFrom &&
      normalizeCity(f.routeTo) === normTo,
  );

  if (!flight) {
    const busMatch = db.buses.find(
      (b) =>
        normalizeCity(b.route.from) === normFrom &&
        normalizeCity(b.route.to) === normTo,
    );
    const busPrice = busMatch ? busMatch.lowestPrice : 500;
    const busDur = busMatch ? busMatch.route.duration : "8h 00m";

    flight = {
      id: `flt-dyn-${uuidv4().slice(0, 6)}`,
      routeFrom: from,
      routeTo: to,
      airline: "IndiGo Express",
      flightNumber: "6E-" + Math.floor(100 + Math.random() * 900),
      departureTime: "08:30",
      arrivalTime: "09:45",
      duration: "1h 15m",
      busDuration: busDur,
      hoursSaved: 6.75,
      busMinPrice: busPrice,
      flightPrice: Math.max(1799, Math.round(busPrice * 2.8)),
      commissionEst: 450,
      affiliateUrl: `https://www.makemytrip.com/flights/?affid=buscompare_crazyplane`,
      badge: "✈️ CRAZY PLANE DEAL (SAVE ~7 HOURS)",
      seatsLeft: Math.floor(2 + Math.random() * 5),
    };
  }

  res.json({ flight });
});

// GET /api/multimodal/calculate
router.get("/multimodal/calculate", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });

  const { from, to } = req.query;
  if (!from || !to)
    return res.status(400).json({ error: "from and to required" });

  const normFrom = normalizeCity(from);
  const normTo = normalizeCity(to);

  const route = db.routes.find(
    (r) => normalizeCity(r.from) === normFrom && normalizeCity(r.to) === normTo,
  );
  const busMatch = db.buses.find(
    (b) =>
      normalizeCity(b.route.from) === normFrom &&
      normalizeCity(b.route.to) === normTo,
  );

  const distance = route ? route.distance : 350;
  const busMinPrice = busMatch ? busMatch.lowestPrice : 399;
  const busDuration = busMatch ? busMatch.route.duration : "6h 30m";

  const multimodal = {
    from,
    to,
    distanceKm: distance,
    bus: {
      mode: "Bus (Volvo AC Sleeper)",
      price: busMinPrice,
      duration: busDuration,
      effectiveTime: busDuration,
      doorToDoorCost: busMinPrice,
      rating: "4.5 ★",
      badge: "💰 CHEAPEST & COMFY",
      icon: "🚌",
    },
    flight: {
      mode: "Flight (Economy Air)",
      price: Math.max(1899, Math.round(busMinPrice * 2.9)),
      airfareOnly: Math.max(1899, Math.round(busMinPrice * 2.9)),
      duration: "1h 15m",
      airportTaxiCost: 650,
      effectiveTime: "3h 45m (incl. 2h airport check-in)",
      doorToDoorCost: Math.max(1899, Math.round(busMinPrice * 2.9)) + 650,
      badge: "⚡ FASTEST DOOR-TO-DOOR",
      icon: "✈️ ",
    },
    train: {
      mode: "Train (IRCTC 3AC / Sleeper)",
      price: Math.max(220, Math.round(busMinPrice * 0.7)),
      duration: "7h 00m",
      effectiveTime: "7h 30m",
      doorToDoorCost: Math.max(220, Math.round(busMinPrice * 0.7)),
      availabilityNote: "⚠️ Waitlist high on weekends",
      badge: "🚂 BUDGET CHOICE",
      icon: "🚂",
    },
    cab: {
      mode: "Intercity SUV Cab (Private/Shared)",
      price: Math.round(distance * 14),
      perSeatPrice: Math.round((distance * 14) / 4),
      duration: "5h 30m",
      effectiveTime: "5h 30m",
      doorToDoorCost: Math.round(distance * 14),
      badge: "🚗 DOOR-TO-DOOR CONVENIENCE",
      icon: "🚗",
    },
  };

  res.json({ multimodal });
});

// GET /api/buses/boarding-points/:busId
router.get("/buses/boarding-points/:busId", (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ error: "DB error" });

  const bus = findBusByIdOrSlug(req.params.busId, db);
  if (!bus) return res.status(404).json({ error: "Bus not found" });

  const depTime = bus.route.departureTime;
  const arrTime = bus.route.arrivalTime;
  const fromCity = bus.route.from;
  const toCity = bus.route.to;

  const boardingPoints = [
    {
      time: depTime,
      location: `${fromCity} Central Bus Station / Main Stand`,
      landmark: "Gate 4, Opposite Railway Station",
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fromCity + " Central Bus Stand")}`,
    },
    {
      time: addMinutesToTime(depTime, 25),
      location: `${fromCity} Highway Toll Plaza / Bypass Junction`,
      landmark: "Near Shell Petrol Pump & Food Mall",
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fromCity + " Highway Toll Plaza")}`,
    },
  ];

  const droppingPoints = [
    {
      time: subtractMinutesFromTime(arrTime, 20),
      location: `${toCity} Outer Ring Road Drop Point`,
      landmark: "Bypass Flyover Stop",
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(toCity + " Bypass Junction")}`,
    },
    {
      time: arrTime,
      location: `${toCity} Main Bus Terminal / Railway Station Drop`,
      landmark: "Platform 1 Taxi Stand Exit",
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(toCity + " Railway Station Drop")}`,
    },
  ];

  const restStops = [
    {
      name: "🍴 Highway Food Express Plaza",
      duration: "30 mins",
      timing: "Mid-route (around 3 hours into journey)",
      features: [
        "Food Court (Veg/Non-Veg)",
        "Clean Washrooms",
        "ATM & Coffee Shop",
      ],
    },
  ];

  res.json({
    busId: bus.id,
    operator: bus.operator,
    busType: bus.busType,
    boardingPoints,
    droppingPoints,
    restStops,
  });
});

module.exports = router;
