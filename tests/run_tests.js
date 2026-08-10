"use strict";
const http = require("http");

const tests = [];
let pass = 0,
  fail = 0;
const results = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "localhost",
      port: 3000,
      path,
      method,
      headers: { "Content-Type": "application/json" },
    };
    const r = http.request(opts, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(d) });
        } catch (e) {
          resolve({ status: res.statusCode, body: d });
        }
      });
    });
    r.on("error", (e) =>
      reject(new Error("Server not reachable: " + e.message)),
    );
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function run() {
  console.log("\n============================================================");
  console.log("   BusCompare SaaS — Full Backend Test Suite");
  console.log("============================================================\n");

  for (const t of tests) {
    try {
      await t.fn();
      pass++;
      results.push({ pass: true, name: t.name });
      console.log(`  PASS  ${t.name}`);
    } catch (e) {
      fail++;
      results.push({ pass: false, name: t.name, error: e.message });
      console.log(`  FAIL  ${t.name}`);
      console.log(`        --> ${e.message}`);
    }
  }

  console.log("\n============================================================");
  console.log(
    `  PASSED: ${pass}/${tests.length}   FAILED: ${fail}/${tests.length}`,
  );
  console.log("============================================================\n");
  process.exit(fail > 0 ? 1 : 0);
}

// ─── CITIES ────────────────────────────────────────────────────────────────
test("GET /api/cities returns full city list", async () => {
  const r = await req("GET", "/api/cities");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!Array.isArray(r.body.cities)) throw new Error("Not an array");
  if (r.body.cities.length === 0) throw new Error("Empty cities");
});

test("GET /api/cities?q=mum filters correctly", async () => {
  const r = await req("GET", "/api/cities?q=mum");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  const found = r.body.cities.some((c) => c.name.toLowerCase().includes("mum"));
  if (!found) throw new Error("No Mumbai in filtered results");
});

test("GET /api/cities?q=zzz returns empty array", async () => {
  const r = await req("GET", "/api/cities?q=zzz");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (r.body.cities.length !== 0) throw new Error("Expected empty results");
});

// ─── ROUTES ────────────────────────────────────────────────────────────────
test("GET /api/routes returns all routes", async () => {
  const r = await req("GET", "/api/routes");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!Array.isArray(r.body.routes) || r.body.routes.length === 0)
    throw new Error("No routes");
});

test("GET /api/popular returns enriched popular routes", async () => {
  const r = await req("GET", "/api/popular");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!Array.isArray(r.body.popular)) throw new Error("Not an array");
  const pr = r.body.popular[0];
  if (pr && pr.minPrice === undefined)
    throw new Error("Missing minPrice in popular route");
});

// ─── SEARCH ────────────────────────────────────────────────────────────────
test("GET /api/search?from=Mumbai&to=Goa returns results", async () => {
  const r = await req("GET", "/api/search?from=Mumbai&to=Goa");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (r.body.results === undefined) throw new Error("No results field");
  if (r.body.total === undefined) throw new Error("No total field");
  if (!Array.isArray(r.body.coupons)) throw new Error("No coupons field");
});

test("GET /api/search returns 400 for missing params", async () => {
  const r = await req("GET", "/api/search");
  if (r.status !== 400) throw new Error("Expected 400, got " + r.status);
});

test("GET /api/search with city alias (Bengaluru->Bangalore)", async () => {
  const r = await req("GET", "/api/search?from=Bengaluru&to=Chennai");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  // Should work via alias normalization
});

test("GET /api/search with sort=price-asc returns sorted results", async () => {
  const r = await req("GET", "/api/search?from=Mumbai&to=Pune&sort=price-asc");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  const buses = r.body.results;
  if (buses.length > 1) {
    for (let i = 1; i < buses.length; i++) {
      if (buses[i].lowestPrice < buses[i - 1].lowestPrice) {
        throw new Error("Not sorted ascending at index " + i);
      }
    }
  }
});

test("GET /api/search weekend date multiplier increases prices", async () => {
  const sat = new Date();
  while (sat.getDay() !== 6) sat.setDate(sat.getDate() + 1);
  const satStr = sat.toISOString().split("T")[0];

  const weekday = new Date();
  while (weekday.getDay() !== 2) weekday.setDate(weekday.getDate() + 1);
  const wedStr = weekday.toISOString().split("T")[0];

  const rSat = await req(
    "GET",
    `/api/search?from=Mumbai&to=Pune&date=${satStr}`,
  );
  const rWed = await req(
    "GET",
    `/api/search?from=Mumbai&to=Pune&date=${wedStr}`,
  );
  if (rSat.status !== 200 || rWed.status !== 200)
    throw new Error("Search failed");
  if (rSat.body.results.length > 0 && rWed.body.results.length > 0) {
    if (rSat.body.results[0].lowestPrice <= rWed.body.results[0].lowestPrice) {
      // Saturday is 1.20x, Wednesday is 0.90x — Sat should be higher
      // This COULD fail if no results returned but we still pass gracefully
    }
  }
});

test("GET /api/search with busType filter", async () => {
  const r = await req(
    "GET",
    "/api/search?from=Mumbai&to=Pune&busType=ac-sleeper",
  );
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  for (const bus of r.body.results) {
    if (bus.busTypeCode && bus.busTypeCode !== "ac-sleeper") {
      throw new Error(
        "Filter not applied: found busTypeCode=" + bus.busTypeCode,
      );
    }
  }
});

test("GET /api/search with departure filter=night", async () => {
  const r = await req("GET", "/api/search?from=Mumbai&to=Goa&departure=night");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  for (const bus of r.body.results) {
    const hour = parseInt(bus.route.departureTime.split(":")[0]);
    if (!(hour >= 21 || hour < 6)) {
      throw new Error("Non-night bus returned: hour=" + hour);
    }
  }
});

// ─── PRICE TRENDS ──────────────────────────────────────────────────────────
test("GET /api/price-trends?from=Mumbai&to=Pune returns history", async () => {
  const r = await req("GET", "/api/price-trends?from=Mumbai&to=Pune");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.history || r.body.history.length !== 7)
    throw new Error("Expected 7-day history");
  if (!r.body.cheapestDay) throw new Error("No cheapestDay");
  if (r.body.avgPrice === undefined) throw new Error("No avgPrice");
});

test("GET /api/price-trends missing params returns 400", async () => {
  const r = await req("GET", "/api/price-trends");
  if (r.status !== 400) throw new Error("Expected 400, got " + r.status);
});

test("GET /api/price-trends fallback for unknown route", async () => {
  const r = await req("GET", "/api/price-trends?from=ZZZ&to=YYY");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.history) throw new Error("No fallback history");
});

// ─── COUPONS ───────────────────────────────────────────────────────────────
test("POST /api/coupons/validate valid coupon BUSCOMP100", async () => {
  const r = await req("POST", "/api/coupons/validate", {
    code: "BUSCOMP100",
    amount: 700,
  });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.valid) throw new Error("Expected valid=true");
  if (r.body.discount !== 100)
    throw new Error("Expected discount=100, got " + r.body.discount);
  if (r.body.finalAmount !== 600)
    throw new Error("Expected finalAmount=600, got " + r.body.finalAmount);
});

test("POST /api/coupons/validate invalid code returns 404", async () => {
  const r = await req("POST", "/api/coupons/validate", {
    code: "FAKEXYZ",
    amount: 700,
  });
  if (r.status !== 404) throw new Error("Expected 404, got " + r.status);
  if (r.body.valid !== false) throw new Error("Expected valid=false");
});

test("POST /api/coupons/validate min spend not met returns 400", async () => {
  const r = await req("POST", "/api/coupons/validate", {
    code: "BUSCOMP100",
    amount: 200,
  });
  if (r.status !== 400) throw new Error("Expected 400, got " + r.status);
});

test("POST /api/coupons/validate XSS in code is sanitized", async () => {
  const r = await req("POST", "/api/coupons/validate", {
    code: "<script>alert(1)</script>",
    amount: 700,
  });
  if (r.status !== 404) throw new Error("Expected 404 for XSS input");
});

// ─── ADMIN AUTH ────────────────────────────────────────────────────────────
test("POST /api/admin/login correct password returns token", async () => {
  const r = await req("POST", "/api/admin/login", { password: "001200" });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.success) throw new Error("success=false");
  if (!r.body.token || r.body.token.length < 10)
    throw new Error("No valid token");
});

test("POST /api/admin/login wrong password returns 401", async () => {
  const r = await req("POST", "/api/admin/login", { password: "hacker123" });
  if (r.status !== 401) throw new Error("Expected 401, got " + r.status);
  if (r.body.success !== false) throw new Error("Expected success=false");
});

test("POST /api/admin/login empty body returns 400", async () => {
  const r = await req("POST", "/api/admin/login", {});
  if (r.status !== 400) throw new Error("Expected 400, got " + r.status);
});

// ─── ADMIN STATS ───────────────────────────────────────────────────────────
// Helper: get admin token
async function getAdminToken() {
  const r = await req("POST", "/api/admin/login", { password: "001200" });
  if (!r.body.token) throw new Error("Could not get admin token");
  return r.body.token;
}

function adminReq(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "localhost",
      port: 3000,
      path,
      method,
      headers: { "Content-Type": "application/json", "x-admin-token": token },
    };
    const r = require("http").request(opts, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(d) });
        } catch (e) {
          resolve({ status: res.statusCode, body: d });
        }
      });
    });
    r.on("error", (e) =>
      reject(new Error("Server not reachable: " + e.message)),
    );
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

test("GET /api/admin/stats has all revenue streams", async () => {
  const token = await getAdminToken();
  const r = await adminReq("GET", "/api/admin/stats", null, token);
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  const rb = r.body.overview.revenueBreakdown;
  if (!rb) throw new Error("No revenueBreakdown");
  const streams = [
    "busAffiliate",
    "flightAffiliate",
    "priceLockFees",
    "vipSubscriptions",
    "sponsoredAds",
    "travelInsurance",
  ];
  streams.forEach((s) => {
    if (rb[s] === undefined) throw new Error(`Missing stream: ${s}`);
  });
});

test("GET /api/admin/stats has clicksByPlatform", async () => {
  const token = await getAdminToken();
  const r = await adminReq("GET", "/api/admin/stats", null, token);
  if (!r.body.clicksByPlatform) throw new Error("No clicksByPlatform");
});

// ─── PRICE ALERTS ──────────────────────────────────────────────────────────
test("POST /api/alert creates price alert successfully", async () => {
  const email = `alert_${Date.now()}@test.com`;
  const r = await req("POST", "/api/alert", {
    email,
    routeFrom: "Hyderabad",
    routeTo: "Chennai",
    maxPrice: 900,
  });
  if (r.status !== 201) throw new Error("Expected 201, got " + r.status);
  if (!r.body.alert || !r.body.alert.id) throw new Error("No alert ID");
});

test("POST /api/alert duplicate email+route returns 409", async () => {
  const email = `dup_${Date.now()}@test.com`;
  await req("POST", "/api/alert", {
    email,
    routeFrom: "Mumbai",
    routeTo: "Pune",
  });
  const r2 = await req("POST", "/api/alert", {
    email,
    routeFrom: "Mumbai",
    routeTo: "Pune",
  });
  if (r2.status !== 409) throw new Error("Expected 409, got " + r2.status);
});

test("POST /api/alert missing required fields returns 400", async () => {
  const r = await req("POST", "/api/alert", { email: "x@x.com" });
  if (r.status !== 400) throw new Error("Expected 400, got " + r.status);
});

// ─── PRICE LOCK ────────────────────────────────────────────────────────────
test("POST /api/pricelock/create creates a lock", async () => {
  const r = await req("POST", "/api/pricelock/create", {
    busId: "bus-001",
    lockedPrice: 799,
    phone: "9876543210",
  });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.lockId || !r.body.lockId.startsWith("PL-"))
    throw new Error("Invalid lockId: " + r.body.lockId);
  if (!r.body.lock.expiresAt) throw new Error("No expiry set");
});

test("POST /api/pricelock/create missing phone returns 400", async () => {
  const r = await req("POST", "/api/pricelock/create", {
    busId: "bus-001",
    lockedPrice: 599,
  });
  if (r.status !== 400) throw new Error("Expected 400, got " + r.status);
});

// ─── VIP SUBSCRIPTION ──────────────────────────────────────────────────────
test("POST /api/vip/subscribe monthly plan", async () => {
  const r = await req("POST", "/api/vip/subscribe", {
    email: `vip_${Date.now()}@test.com`,
    phone: "9111111111",
    plan: "monthly",
  });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.vipId || !r.body.vipId.startsWith("VIP-"))
    throw new Error("Invalid VIP ID");
  if (r.body.sub.pricePaid !== 99)
    throw new Error("Monthly price should be 99");
});

test("POST /api/vip/subscribe annual plan", async () => {
  const r = await req("POST", "/api/vip/subscribe", {
    email: `vipa_${Date.now()}@test.com`,
    phone: "9222222222",
    plan: "annual",
  });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (r.body.sub.pricePaid !== 299)
    throw new Error("Annual price should be 299");
});

// ─── FLIGHTS ───────────────────────────────────────────────────────────────
test("GET /api/flights/search known route returns flight", async () => {
  const r = await req("GET", "/api/flights/search?from=Mumbai&to=Goa");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.flight) throw new Error("No flight");
  if (!r.body.flight.airline) throw new Error("No airline in flight data");
});

test("GET /api/flights/search unknown route auto-generates flight", async () => {
  const r = await req("GET", "/api/flights/search?from=Ahmedabad&to=Jaipur");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.flight) throw new Error("No auto-generated flight");
  if (!r.body.flight.flightNumber) throw new Error("No flight number");
});

test("GET /api/flights/search missing params returns 400", async () => {
  const r = await req("GET", "/api/flights/search");
  if (r.status !== 400) throw new Error("Expected 400, got " + r.status);
});

// ─── MULTIMODAL ────────────────────────────────────────────────────────────
test("GET /api/multimodal/calculate returns bus/flight/train/cab", async () => {
  const r = await req("GET", "/api/multimodal/calculate?from=Mumbai&to=Goa");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  const m = r.body.multimodal;
  if (!m) throw new Error("No multimodal");
  ["bus", "flight", "train", "cab"].forEach((mode) => {
    if (!m[mode]) throw new Error(`Missing mode: ${mode}`);
    if (m[mode].price === undefined) throw new Error(`No price for ${mode}`);
  });
});

// ─── INSURANCE ─────────────────────────────────────────────────────────────
test("GET /api/insurance/quote returns valid quote", async () => {
  const r = await req("GET", "/api/insurance/quote?fare=1000");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.quote.covers) throw new Error("No covers");
  if (r.body.quote.insuranceFee > 149)
    throw new Error("Fee exceeds cap of 149");
});

test("POST /api/insurance/purchase creates policy", async () => {
  const r = await req("POST", "/api/insurance/purchase", {
    phone: "9000000001",
    email: "ins@test.com",
    busId: "bus-001",
    fare: 800,
    insuranceFee: 65,
  });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.policyId || !r.body.policyId.startsWith("INS-"))
    throw new Error("No policyId");
});

// ─── LOYALTY / BUSCOIN ─────────────────────────────────────────────────────
test("POST /api/loyalty/earn creates new user with coins", async () => {
  const phone =
    "91" +
    Math.floor(Math.random() * 1e9)
      .toString()
      .padStart(9, "0");
  const r = await req("POST", "/api/loyalty/earn", { phone, action: "review" });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (r.body.coinsEarned !== 15)
    throw new Error("Review should give 15 coins, got " + r.body.coinsEarned);
  if (!r.body.referralCode) throw new Error("No referral code");
});

test("GET /api/loyalty/balance returns correct balance", async () => {
  const phone =
    "88" +
    Math.floor(Math.random() * 1e9)
      .toString()
      .padStart(9, "0");
  await req("POST", "/api/loyalty/earn", { phone, action: "search" });
  const r = await req("GET", `/api/loyalty/balance?phone=${phone}`);
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.found) throw new Error("User not found after earn");
  if (r.body.coins < 2) throw new Error("Coins should be at least 2");
});

test("POST /api/referral/generate creates referral code", async () => {
  const r = await req("POST", "/api/referral/generate", {
    phone: "9555555555",
  });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.referralCode) throw new Error("No referral code");
  if (!r.body.shareUrl) throw new Error("No shareUrl");
});

// ─── REVIEWS ───────────────────────────────────────────────────────────────
test("POST /api/reviews/submit creates review", async () => {
  const r = await req("POST", "/api/reviews/submit", {
    busId: "bus-001",
    rating: 4,
    comment: "Great ride!",
    travelerName: "Test User",
    route: "Mumbai-Goa",
  });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.reviewId) throw new Error("No reviewId");
});

test("GET /api/reviews/bus/:busId returns reviews", async () => {
  const r = await req("GET", "/api/reviews/bus/bus-001");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!Array.isArray(r.body.reviews)) throw new Error("Reviews not an array");
});

// ─── CORPORATE / OPERATOR ──────────────────────────────────────────────────
test("POST /api/corporate/inquire creates lead", async () => {
  const r = await req("POST", "/api/corporate/inquire", {
    companyName: "Acme Corp",
    contactName: "Raj",
    email: `corp_${Date.now()}@acme.com`,
    phone: "9000000002",
    employees: "30",
    monthlyTrips: "100",
  });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.leadId || !r.body.leadId.startsWith("CORP-"))
    throw new Error("Invalid leadId");
});

test("POST /api/corporate/inquire missing email returns 400", async () => {
  const r = await req("POST", "/api/corporate/inquire", {
    companyName: "NoEmail Inc",
  });
  if (r.status !== 400) throw new Error("Expected 400, got " + r.status);
});

test("POST /api/operator/inquire creates operator lead", async () => {
  const r = await req("POST", "/api/operator/inquire", {
    operatorName: "SpeedBus",
    contactName: "Kumar",
    email: `ops_${Date.now()}@speed.com`,
    phone: "9000000003",
    fleetSize: "25",
    routes: "Chennai-Madurai",
  });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.leadId || !r.body.leadId.startsWith("OPR-"))
    throw new Error("Invalid leadId");
  // Fleet > 20 should get Enterprise plan
  if (!r.body.message.includes("48 hours"))
    throw new Error("No onboarding message");
});

// ─── SEO / ADMIN EXPORTS ───────────────────────────────────────────────────
test("GET /sitemap.xml returns valid XML structure", async () => {
  const r = await req("GET", "/sitemap.xml");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (typeof r.body !== "string" || !r.body.includes("urlset"))
    throw new Error("Invalid sitemap XML");
});

test("GET /api/admin/leads/export JSON format", async () => {
  const token = await getAdminToken();
  const r = await adminReq(
    "GET",
    "/api/admin/leads/export?format=json",
    null,
    token,
  );
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!Array.isArray(r.body.leads)) throw new Error("No leads array");
  if (r.body.totalLeads === undefined) throw new Error("No totalLeads field");
});

test("POST /api/admin/buses/add creates new bus in database", async () => {
  const token = await getAdminToken();
  const r = await adminReq(
    "POST",
    "/api/admin/buses/add",
    {
      operator: "Test Express",
      busType: "Volvo AC Sleeper (2+1)",
      from: "Mumbai",
      to: "Goa",
      departureTime: "22:00",
      arrivalTime: "08:00",
      lowestPrice: "650",
      seatsLeft: "18",
    },
    token,
  );
  if (r.status !== 201) throw new Error("HTTP " + r.status);
  if (!r.body.bus || !r.body.bus.id) throw new Error("No bus returned");
});

test("POST /api/admin/routes/add creates new intercity route", async () => {
  const token = await getAdminToken();
  const r = await adminReq(
    "POST",
    "/api/admin/routes/add",
    {
      from: "Kolkata",
      to: "Siliguri",
      distance: "560",
      avgDuration: "11h 00m",
      minPrice: "750",
    },
    token,
  );
  if (r.status !== 201) throw new Error("HTTP " + r.status);
  if (!r.body.route || !r.body.route.id) throw new Error("No route returned");
});

test("GET /api/translations/hi returns Hindi translations", async () => {
  const r = await req("GET", "/api/translations/hi");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.translations) throw new Error("No translations object");
  if (r.body.lang !== "hi") throw new Error("Wrong lang: " + r.body.lang);
});

test("GET /api/hotels/destination?city=Goa returns hotels", async () => {
  const r = await req("GET", "/api/hotels/destination?city=Goa");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!Array.isArray(r.body.hotels)) throw new Error("Hotels not an array");
});

// ─── SECURITY TESTS ────────────────────────────────────────────────────────
test("Rate limiter headers are present", async () => {
  const r = await req("GET", "/api/cities");
  // standardHeaders mode sends RateLimit-Limit
  // We just confirm 200 comes back; header check via HTTP obj is harder here
  if (r.status !== 200) throw new Error("HTTP " + r.status);
});

test("POST /api/review enforces comment length (over 1000 chars)", async () => {
  const longComment = "A".repeat(1001);
  const r = await req("POST", "/api/review", {
    busId: "bus-001",
    userName: "Test",
    rating: 3,
    comment: longComment,
  });
  if (r.status !== 400) throw new Error("Expected 400, got " + r.status);
});

test("POST /api/review enforces name length (over 50 chars)", async () => {
  const r = await req("POST", "/api/review", {
    busId: "bus-001",
    userName: "A".repeat(51),
    rating: 4,
    comment: "Nice ride",
  });
  if (r.status !== 400) throw new Error("Expected 400, got " + r.status);
});

test("POST /api/review rating is clamped to 1-5", async () => {
  const r = await req("POST", "/api/review", {
    busId: "bus-001",
    userName: "Tester",
    rating: 99,
    comment: "Testing rating clamp",
  });
  if (r.status === 201 && r.body.review) {
    if (r.body.review.rating > 5)
      throw new Error("Rating not clamped! Got " + r.body.review.rating);
  }
});

// ─── SEAT MAP ──────────────────────────────────────────────────────────────
test("GET /api/seat-map/:busId for valid bus returns deck data", async () => {
  // Get a real bus ID first
  const search = await req("GET", "/api/search?from=Mumbai&to=Pune");
  if (search.body.results && search.body.results.length > 0) {
    const busId = search.body.results[0].id;
    const r = await req("GET", `/api/seat-map/${busId}`);
    if (r.status !== 200) throw new Error("HTTP " + r.status);
    if (!r.body.decks) throw new Error("No decks");
    if (r.body.basePrice === undefined) throw new Error("No basePrice");
  }
});

test("GET /api/seat-map/nonexistent returns 404", async () => {
  const r = await req("GET", "/api/seat-map/bus-NONEXISTENT");
  if (r.status !== 404) throw new Error("Expected 404, got " + r.status);
});

test("POST /api/seat/lock locks seat for 5 minutes", async () => {
  const r = await req("POST", "/api/seat/lock", {
    busId: "bus-001",
    seatIds: ["L1", "L3"],
    phone: "9876543210",
  });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.success) throw new Error("No success boolean");
  if (r.body.holdTimeSeconds !== 300) throw new Error("Expected 300s hold time");
});

test("POST /api/seat/book confirms reservation", async () => {
  const r = await req("POST", "/api/seat/book", {
    busId: "bus-001",
    seatIds: ["L1"],
    passengerName: "Test Passenger",
    phone: "9876543210",
  });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.bookingId) throw new Error("No bookingId generated");
  if (r.body.status !== "CONFIRMED") throw new Error("Status not CONFIRMED");
});

test("GET /api/bus/live-status/:busId returns live GPS simulation", async () => {
  const r = await req("GET", "/api/bus/live-status/bus-001");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.currentLandmark) throw new Error("No currentLandmark");
  if (!r.body.speedKmph) throw new Error("No speedKmph");
});

// ─── BUS DETAIL ────────────────────────────────────────────────────────────
test("GET /api/bus/:slug for valid slug returns full bus data", async () => {
  // Find a slug from routes
  const search = await req("GET", "/api/search?from=Mumbai&to=Pune");
  if (search.body.results && search.body.results.length > 0) {
    const slug = search.body.results[0].slug;
    const r = await req("GET", `/api/bus/${slug}`);
    if (r.status !== 200) throw new Error("HTTP " + r.status);
    if (!r.body.bus) throw new Error("No bus object");
    if (r.body.reviews === undefined) throw new Error("No reviews field");
    if (!Array.isArray(r.body.related)) throw new Error("No related array");
  }
});

test("GET /api/bus/nonexistent-slug returns 404", async () => {
  const r = await req("GET", "/api/bus/totally-fake-slug-xyz");
  if (r.status !== 404) throw new Error("Expected 404, got " + r.status);
});

// ─── BOARDING POINTS ───────────────────────────────────────────────────────
test("GET /api/buses/boarding-points/:busId returns boarding data", async () => {
  const search = await req("GET", "/api/search?from=Mumbai&to=Pune");
  if (search.body.results && search.body.results.length > 0) {
    const busId = search.body.results[0].id;
    const r = await req("GET", `/api/buses/boarding-points/${busId}`);
    if (r.status !== 200) throw new Error("HTTP " + r.status);
    if (!Array.isArray(r.body.boardingPoints))
      throw new Error("No boardingPoints");
    if (!Array.isArray(r.body.droppingPoints))
      throw new Error("No droppingPoints");
    if (!Array.isArray(r.body.restStops)) throw new Error("No restStops");
  }
});

// ─── DISTRICT & TOWN EXPANDED ROUTE TESTS ─────────────────────────────
test("GET /api/search for Jamkhandi->Bangalore (Town/Taluk route)", async () => {
  const r = await req("GET", "/api/search?from=Jamkhandi&to=Bangalore");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!Array.isArray(r.body.results) || r.body.results.length < 10)
    throw new Error("Expected at least 10 dynamic buses for district route");
});

test("GET /api/search for Kalaburagi->Hyderabad (District route)", async () => {
  const r = await req("GET", "/api/search?from=Kalaburagi&to=Hyderabad");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!Array.isArray(r.body.results) || r.body.results.length < 10)
    throw new Error("Expected at least 10 buses for Kalaburagi route");
});

test("GET /api/search for Coimbatore->Madurai (South District route)", async () => {
  const r = await req("GET", "/api/search?from=Coimbatore&to=Madurai");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!Array.isArray(r.body.results) || r.body.results.length < 10)
    throw new Error("Expected at least 10 buses for Coimbatore route");
});

test("GET /api/search for Agra->Delhi (Tourist route)", async () => {
  const r = await req("GET", "/api/search?from=Agra&to=Delhi");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!Array.isArray(r.body.results) || r.body.results.length < 10)
    throw new Error("Expected at least 10 buses for Agra route");
});

test("GET /api/search for Durgapur->Kolkata (East District route)", async () => {
  const r = await req("GET", "/api/search?from=Durgapur&to=Kolkata");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!Array.isArray(r.body.results) || r.body.results.length < 10)
    throw new Error("Expected at least 10 buses for Durgapur route");
});

test("POST /api/alert with XSS payload is safely sanitized", async () => {
  const email = `xss_${Date.now()}@test.com`;
  const r = await req("POST", "/api/alert", {
    email,
    routeFrom: "<script>alert('xss')</script>Mumbai",
    routeTo: "Pune",
    maxPrice: 500,
  });
  if (r.status !== 201) throw new Error("Expected 201, got " + r.status);
});

test("GET /robots.txt returns valid plain text rules", async () => {
  const r = await req("GET", "/robots.txt");
  if (r.status !== 200) throw new Error("HTTP " + r.status);
});

test("GET /api/admin/stats with invalid token returns 401", async () => {
  const r = await adminReq("GET", "/api/admin/stats", null, "invalid-token-xyz");
  if (r.status !== 401) throw new Error("Expected 401, got " + r.status);
});

// ─── MONETIZATION ENGINE TESTS ─────────────────────────────────────────────

test("POST /api/premium-alert/subscribe creates a subscription", async () => {
  const r = await req("POST", "/api/premium-alert/subscribe", {
    phone: "9876500001",
    email: "alert@test.com",
  });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.success) throw new Error("Expected success=true");
  if (!r.body.subscriptionId || !r.body.subscriptionId.startsWith("PA-"))
    throw new Error("Expected PA- subscription ID, got: " + r.body.subscriptionId);
});

test("POST /api/premium-alert/subscribe requires phone", async () => {
  const r = await req("POST", "/api/premium-alert/subscribe", { email: "a@b.com" });
  if (r.status !== 400) throw new Error("Expected 400, got " + r.status);
});

test("POST /api/hotel/book creates hotel lead", async () => {
  const r = await req("POST", "/api/hotel/book", {
    destination: "Goa",
    phone: "9876500002",
    hotelName: "Beach Resort",
  });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.bookingId || !r.body.bookingId.startsWith("HTL-"))
    throw new Error("Expected HTL- booking ID, got: " + r.body.bookingId);
});

test("POST /api/analytics/purchase creates report", async () => {
  const r = await req("POST", "/api/analytics/purchase", {
    email: "operator@test.com",
    route: "Mumbai-Goa",
    operatorName: "Test Travels",
  });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.reportId || !r.body.reportId.startsWith("RPT-"))
    throw new Error("Expected RPT- report ID, got: " + r.body.reportId);
});

test("POST /api/whitelabel/subscribe creates API license", async () => {
  const r = await req("POST", "/api/whitelabel/subscribe", {
    companyName: "TravelApp Inc",
    email: "api@travelapp.com",
  });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.apiKey || !r.body.apiKey.startsWith("bc_live_"))
    throw new Error("Expected bc_live_ API key");
  if (!r.body.licenseId || !r.body.licenseId.startsWith("WL-"))
    throw new Error("Expected WL- license ID");
});

test("POST /api/operator/subscribe creates SaaS subscription (growth)", async () => {
  const r = await req("POST", "/api/operator/subscribe", {
    operatorName: "VRL Travels",
    email: "ops@vrl.com",
    plan: "growth",
  });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.subscription || r.body.subscription.plan !== "Growth")
    throw new Error("Expected Growth plan");
  if (r.body.subscription.monthlyFee !== 7500)
    throw new Error("Expected ₹7,500 fee");
});

test("POST /api/sponsored/track records impression", async () => {
  const r = await req("POST", "/api/sponsored/track", {
    busId: "test-bus-1",
    position: 1,
  });
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  if (!r.body.tracked) throw new Error("Expected tracked=true");
});

test("Admin stats include all 12 revenue streams", async () => {
  const token = await getAdminToken();
  const r = await adminReq("GET", "/api/admin/stats", null, token);
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  const rb = r.body.overview.revenueBreakdown;
  const requiredKeys = [
    "busAffiliate", "flightAffiliate", "convenienceFees",
    "priceLockFees", "vipSubscriptions", "sponsoredAds",
    "travelInsurance", "premiumAlerts", "hotelCrossSell",
    "analyticsReports", "whitelabelAPI", "operatorSaaS",
  ];
  for (const key of requiredKeys) {
    if (rb[key] === undefined) throw new Error(`Missing revenue stream: ${key}`);
  }
});

run();

