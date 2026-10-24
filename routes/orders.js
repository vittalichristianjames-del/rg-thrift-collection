const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { ORDER_STATUSES } = require('../services/commerce');

const formatPHP = value => '₱' + (Number(value) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { Order, OrderItem } = require('../models');
    const orders = await Order.findAll({
      where: { userId: req.session.user.id },
      include: [{ model: OrderItem, as: 'items' }],
      order: [['createdAt', 'DESC']],
    });
    res.render('orders', {
      title: 'Order History', orders, formatPHP, ORDER_STATUSES,
    });
  } catch (err) {
    res.render('orders', { title: 'Order History', orders: [], formatPHP, ORDER_STATUSES });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { Order, OrderItem } = require('../models');
    const order = await Order.findOne({
      where: { id: req.params.id, userId: req.session.user.id },
      include: [{ model: OrderItem, as: 'items' }],
    });
    if (!order) return res.redirect('/orders');
    res.render('order-detail', {
      title: 'Order #' + order.orderNumber, order, formatPHP, ORDER_STATUSES,
    });
  } catch (err) {
    res.redirect('/orders');
  }
});

module.exports = router;