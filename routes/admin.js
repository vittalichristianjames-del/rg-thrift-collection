const express = require('express');
const router = express.Router();
const { Product, Order, User } = require('../models');

// Admin middleware
const isAdmin = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/');
  }
  next();
};

router.get('/', isAdmin, async (req, res) => {
  try {
    const products = await Product.findAll();
    const orders = await Order.findAll({ include: [User], order: [['createdAt', 'DESC']] });
    res.render('admin/dashboard', { title: 'Admin Dashboard', products, orders });
  } catch (err) {
    res.render('admin/dashboard', { title: 'Admin Dashboard', products: [], orders: [] });
  }
});

router.get('/products/new', isAdmin, (req, res) => {
  res.render('admin/product-form', { title: 'Add Product', product: null });
});

router.post('/products', isAdmin, async (req, res) => {
  try {
    const { name, description, price, category, image, stock, featured } = req.body;
    await Product.create({ name, description, price, category, image, stock: parseInt(stock) || 0, featured: featured === 'on' });
    res.redirect('/admin');
  } catch (err) {
    res.redirect('/admin');
  }
});

router.get('/products/:id/edit', isAdmin, async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    res.render('admin/product-form', { title: 'Edit Product', product });
  } catch (err) {
    res.redirect('/admin');
  }
});

router.post('/products/:id', isAdmin, async (req, res) => {
  try {
    const { name, description, price, category, image, stock, featured } = req.body;
    await Product.update({ name, description, price, category, image, stock: parseInt(stock) || 0, featured: featured === 'on' }, { where: { id: req.params.id } });
    res.redirect('/admin');
  } catch (err) {
    res.redirect('/admin');
  }
});

router.post('/products/:id/delete', isAdmin, async (req, res) => {
  try {
    await Product.destroy({ where: { id: req.params.id } });
    res.redirect('/admin');
  } catch (err) {
    res.redirect('/admin');
  }
});

module.exports = router;