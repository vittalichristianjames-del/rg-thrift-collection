const express = require('express');
const router = express.Router();
const { Cart, CartItem, Product } = require('../models');

router.get('/', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/auth/login');
    const cart = await Cart.findOne({ where: { userId: req.session.user.id }, include: [{ model: CartItem, as: 'items', include: [Product] }] });
    res.render('cart', { title: 'Shopping Cart', cart: cart || { items: [] } });
  } catch (err) {
    res.render('cart', { title: 'Shopping Cart', cart: { items: [] } });
  }
});

router.post('/add', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/auth/login');
    const { productId, quantity } = req.body;
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