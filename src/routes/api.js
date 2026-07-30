'use strict';

const express = require('express');
const router  = express.Router();

const searchRoutes   = require('./searchRoutes');
const adminRoutes    = require('./adminRoutes');
const alertRoutes    = require('./alertRoutes');
const promoRoutes    = require('./promoRoutes');
const businessRoutes = require('./businessRoutes');

// Mount sub-routers
router.use('/', searchRoutes);
router.use('/admin', adminRoutes);
router.use('/', alertRoutes);
router.use('/', promoRoutes);
router.use('/', businessRoutes);

module.exports = router;
