"use strict";

const rateLimit = require("express-rate-limit");

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const ip = req.ip || req.socket?.remoteAddress || "";
    return ip === "127.0.0.1" || ip === "::1" || ip.endsWith("127.0.0.1");
  },
  message: { error: "Too many requests from this IP. Please try again later." },
});

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: {
    error:
      "Submission limit reached. Please wait an hour before submitting again.",
  },
});

module.exports = {
  globalLimiter,
  submitLimiter,
};
