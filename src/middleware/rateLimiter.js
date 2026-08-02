"use strict";

const rateLimit = require("express-rate-limit");

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
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
