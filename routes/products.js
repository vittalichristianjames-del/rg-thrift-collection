const express = require('express');
const router = express.Router();
const { Product } = require('../models');

router.get('/', async (req, res) => {
  try {
    const { category, search } = req.query;
    const where = {};
    if (category) where.category = category;
    if (search) where.name = { [require('sequelize').Op.like]: `%${search}%` };
    const products = await Product.findAll({ where, order: [['createdAt', 'DESC']] });
    const categories = await Product.findAll({ attributes: ['category'], group: ['category'] });
    res.render('products', { title: 'Products', products, categories: categories.map(c => c.category) });
  } catch (err) {
    res.render('products', { title: 'Products', products: [], categories: [] });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.redirect('/products');
    res.render('product', { title: product.name, product });
  } catch (err) {
    res.redirect('/products');
  }
});

module.exports = router;