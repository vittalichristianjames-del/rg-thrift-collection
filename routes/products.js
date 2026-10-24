const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const { Product } = require('../models');

const formatPHP = value => '₱' + (Number(value) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

router.get('/', async (req, res) => {
  try {
    const { category, search } = req.query;
    const where = { status: 'available' };
    if (category) where.category = category;
    if (search) where.name = { [Op.like]: `%${search}%` };
    const products = await Product.findAll({ where, order: [['createdAt', 'DESC']] });
    const categories = await Product.findAll({ attributes: ['category'], group: ['category'], where: { status: 'available' } });
    res.render('products', {
      title: 'Products',
      products,
      categories: categories.map(c => c.category),
      formatPHP,
      selectedCategory: category || '',
      selectedSearch: search || '',
    });
  } catch (err) {
    res.render('products', { title: 'Products', products: [], categories: [], formatPHP, selectedCategory: '', selectedSearch: '' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.redirect('/products');

    const measurements = {};
    if (product.chestWidth !== null) measurements.chestWidth = product.chestWidth;
    if (product.totalLength !== null) measurements.totalLength = product.totalLength;
    if (product.shoulderWidth !== null) measurements.shoulderWidth = product.shoulderWidth;
    if (product.inseam !== null) measurements.inseam = product.inseam;

    res.render('product', {
      title: product.name,
      product,
      measurements,
      formatPHP,
      isAvailable: product.status === 'available',
    });
  } catch (err) {
    res.redirect('/products');
  }
});

module.exports = router;