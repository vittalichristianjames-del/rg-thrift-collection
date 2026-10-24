const express = require('express');
const router = express.Router();
const { Cart, CartItem, Product } = require('../models');

const formatPHP = value => '₱' + (Number(value) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

router.get('/', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/auth/login');
    const cart = await Cart.findOne({ where: { userId: req.session.user.id }, include: [{ model: CartItem, as: 'items', include: [Product] }] });
    const cartData = cart || { items: [] };
    const total = cartData.items ? cartData.items.reduce((sum, item) => sum + (Number(item.Product.price) * item.quantity), 0) : 0;
    res.render('cart', {
      title: 'Shopping Cart',
      cart: cartData,
      total,
      formatPHP,
    });
  } catch (err) {
    res.render('cart', { title: 'Shopping Cart', cart: { items: [] }, total: 0, formatPHP });
  }
});

router.post('/add', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/auth/login');
    const { productId, quantity } = req.body;
    const product = await Product.findByPk(productId);
    if (!product || product.status !== 'available') {
      return res.redirect('/products?msg=Item+unavailable');
    }
    let cart = await Cart.findOne({ where: { userId: req.session.user.id } });
    if (!cart) cart = await Cart.create({ userId: req.session.user.id });
    const existingItem = await CartItem.findOne({ where: { cartId: cart.id, productId } });
    if (existingItem) {
      existingItem.quantity += parseInt(quantity) || 1;
      await existingItem.save();
    } else {
      await CartItem.create({ cartId: cart.id, productId, quantity: parseInt(quantity) || 1 });
    }
    res.redirect('/cart');
  } catch (err) {
    res.redirect('/products');
  }
});

router.post('/remove/:id', async (req, res) => {
  try {
    await CartItem.destroy({ where: { id: req.params.id } });
    res.redirect('/cart');
  } catch (err) {
    res.redirect('/cart');
  }
});

module.exports = router;