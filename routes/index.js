const express = require('express');
const router = express.Router();
const { Product } = require('../models');

router.get('/', async (req, res) => {
  try {
    const products = await Product.findAll({ limit: 12, order: [['createdAt', 'DESC']] });
    const featured = await Product.findAll({ where: { featured: true }, limit: 4 });
    res.render('index', { title: 'RG Thrift Collection', products, featured });
  } catch (err) {
    res.render('index', { title: 'RG Thrift Collection', products: [], featured: [] });
  }
});

module.exports = router;