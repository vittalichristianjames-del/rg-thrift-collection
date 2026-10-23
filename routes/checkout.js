const express = require('express');
const router = express.Router();
const { Cart, CartItem, Product, Order } = require('../models');
const { verifyRecaptcha } = require('../middleware/recaptcha');

router.get('/', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/auth/login');
    const cart = await Cart.findOne({ where: { userId: req.session.user.id }, include: [{ model: CartItem, as: 'items', include: [Product] }] });
    res.render('checkout', { title: 'Checkout', cart: cart || { items: [] } });
  } catch (err) {
    res.redirect('/cart');
  }
});

router.post('/', verifyRecaptcha, async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/auth/login');
    const { shippingAddress } = req.body;
    const cart = await Cart.findOne({ where: { userId: req.session.user.id }, include: [{ model: CartItem, as: 'items', include: [Product] }] });
    if (!cart || !cart.items || cart.items.length === 0) {
      return res.redirect('/cart');
    }
    const total = cart.items.reduce((sum, item) => sum + (parseFloat(item.Product.price) * item.quantity), 0);
    const order = await Order.create({
      userId: req.session.user.id,
      total,
      shippingAddress: JSON.parse(shippingAddress || '{}'),
      status: 'pending'
    });
    await CartItem.destroy({ where: { cartId: cart.id } });
    res.render('order-confirmation', { title: 'Order Confirmed', order });
  } catch (err) {
    res.redirect('/checkout');
  }
});

module.exports = router;