"use strict";

function sanitizeInput(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .trim();
}

function isValidEmail(email) {
  if (typeof email !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidPhone(phone) {
  if (typeof phone !== "string") return false;
  return /^[6-9]\d{9}$/.test(phone.trim().replace(/\D/g, ""));
}

module.exports = {
  sanitizeInput,
  isValidEmail,
  isValidPhone,
};
