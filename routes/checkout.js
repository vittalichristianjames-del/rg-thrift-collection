const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { verifyRecaptcha } = require('../middleware/recaptcha');
const { authMiddleware } = require('../middleware/auth');
const {
  createCheckoutOrder,
  calculateShipping,
  gcashConfig,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  CommerceError,
} = require('../services/commerce');
const { sendOrderConfirmation } = require('../services/email');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../public/uploads/receipts');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'receipt-' + unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new CommerceError('Only JPEG and PNG receipts are allowed.', 422, 'INVALID_RECEIPT_TYPE'));
    }
    cb(null, true);
  },
});

const formatPHP = value => '₱' + (Number(value) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { Cart, CartItem, Product } = require('../models');
    const cart = await Cart.findOne({ where: { userId: req.session.user.id }, include: [{ model: CartItem, as: 'items', include: [Product] }] });
    if (!cart || !cart.items || cart.items.length === 0) {
      return res.render('checkout', { title: 'Checkout', cart: { items: [] }, total: 0, shippingRegions: [], gcash: gcashConfig(), formatPHP, error: null });
    }
    const total = cart.items.reduce((sum, item) => sum + (Number(item.Product.price) * item.quantity), 0);
    const shippingRegions = Object.entries(require('../services/commerce').SHIPPING_RATES).map(([key, val]) => ({ key, ...val }));
    res.render('checkout', {
      title: 'Checkout',
      cart,
      total,
      shippingRegions,
      gcash: gcashConfig(),
      formatPHP,
      error: null,
    });
  } catch (err) {
    res.redirect('/cart');
  }
});

router.post('/', authMiddleware, verifyRecaptcha, upload.single('receipt'), async (req, res) => {
  try {
    const { Cart, CartItem, Product, Order, User } = require('../models');
    const cart = await Cart.findOne({ where: { userId: req.session.user.id }, include: [{ model: CartItem, as: 'items', include: [Product] }] });
    if (!cart || !cart.items || cart.items.length === 0) {
      return res.redirect('/cart');
    }

    const {
      paymentMethod,
      shippingRegion,
      contactName,
      contactPhone,
      contactEmail,
      shippingAddress,
      gcashReferenceNumber,
    } = req.body;

    const receiptFile = req.file || null;

    const result = await createCheckoutOrder({
      userId: req.session.user.id,
      cart,
      paymentMethod,
      shippingRegion,
      contactName,
      contactPhone,
      contactEmail,
      shippingAddress: shippingAddress ? JSON.parse(shippingAddress) : {},
      receiptFile,
      gcashReferenceNumber,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });

    const user = await User.findByPk(req.session.user.id);
    const orderWithItems = await Order.findByPk(result.order.id, { include: [{ model: require('../models').OrderItem, as: 'items' }] });

    await sendOrderConfirmation({
      order: result.order,
      customerEmail: user.email,
      items: orderWithItems.items,
      shippingDetails: { region: shippingRegion },
    });

    await CartItem.destroy({ where: { cartId: cart.id } });

    if (paymentMethod === PAYMENT_METHODS.COD) {
      res.render('order-confirmation', {
        title: 'Order Confirmed',
        order: result.order,
        paymentMethod: 'COD',
        message: 'Your order has been placed. Pay the driver upon delivery.',
      });
    } else {
      res.render('order-confirmation', {
        title: 'Payment Pending Verification',
        order: result.order,
        paymentMethod: 'GCash',
        message: 'Please wait while we verify your GCash payment. You will receive an email confirmation once verified.',
        gcash: gcashConfig(),
      });
    }
  } catch (err) {
    const { Cart, CartItem, Product } = require('../models');
    const cart = await Cart.findOne({ where: { userId: req.session.user.id }, include: [{ model: CartItem, as: 'items', include: [Product] }] });
    const total = cart ? cart.items.reduce((sum, item) => sum + (Number(item.Product.price) * item.quantity), 0) : 0;
    const shippingRegions = Object.entries(require('../services/commerce').SHIPPING_RATES).map(([key, val]) => ({ key, ...val }));
    res.render('checkout', {
      title: 'Checkout',
      cart: cart || { items: [] },
      total,
      shippingRegions,
      gcash: gcashConfig(),
      formatPHP,
      error: err.message || 'Checkout failed. Please try again.',
    });
  }
});

module.exports = router;