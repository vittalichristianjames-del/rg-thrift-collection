const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { adminMiddleware } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

const uploadsRoot = process.env.UPLOADS_PATH || path.join(__dirname, '../public/uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadsRoot, 'products');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'product-' + unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, and WebP images are allowed.'));
    }
    cb(null, true);
  },
});

const formatPHP = value => '₱' + (Number(value) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

router.get('/', adminMiddleware, async (req, res) => {
  try {
    const { Product, Order, User } = require('../models');
    const products = await Product.findAll({ order: [['createdAt', 'DESC']] });
    const orders = await Order.findAll({ include: [User], order: [['createdAt', 'DESC']] });
    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      products,
      orders,
      formatPHP,
    });
  } catch (err) {
    res.render('admin/dashboard', { title: 'Admin Dashboard', products: [], orders: [], formatPHP });
  }
});

router.get('/products/new', adminMiddleware, (req, res) => {
  res.render('admin/product-form', { title: 'Add Product', product: null, formatPHP });
});

router.post('/products', adminMiddleware, upload.single('image'), async (req, res) => {
  try {
    const { Product } = require('../models');
    const { name, description, price, category, condition, stock, chestWidth, totalLength, shoulderWidth, inseam, measurementsUnit, featured } = req.body;
    const image = req.file ? '/uploads/products/' + req.file.filename : (req.body.image || '');
    await Product.create({
      name, description, price, category, condition: condition || 'good',
      image, stock: parseInt(stock) || 1, status: 'available',
      chestWidth: chestWidth || null, totalLength: totalLength || null,
      shoulderWidth: shoulderWidth || null, inseam: inseam || null,
      measurementsUnit: measurementsUnit || 'in', featured: featured === 'on',
    });
    logAudit({ actorId: req.session.user.id, action: 'create_product', entityType: 'Product', metadata: { name }, req });
    res.redirect('/admin');
  } catch (err) {
    res.redirect('/admin?error=create_failed');
  }
});

router.get('/products/:id/edit', adminMiddleware, async (req, res) => {
  try {
    const { Product } = require('../models');
    const product = await Product.findByPk(req.params.id);
    res.render('admin/product-form', { title: 'Edit Product', product, formatPHP });
  } catch (err) {
    res.redirect('/admin');
  }
});

router.post('/products/:id', adminMiddleware, upload.single('image'), async (req, res) => {
  try {
    const { Product } = require('../models');
    const { name, description, price, category, condition, stock, chestWidth, totalLength, shoulderWidth, inseam, measurementsUnit, featured, status } = req.body;
    const updates = {
      name, description, price, category, condition: condition || 'good',
      stock: parseInt(stock) || 1, status: status || 'available',
      chestWidth: chestWidth || null, totalLength: totalLength || null,
      shoulderWidth: shoulderWidth || null, inseam: inseam || null,
      measurementsUnit: measurementsUnit || 'in', featured: featured === 'on',
    };
    if (req.file) updates.image = '/uploads/products/' + req.file.filename;
    await Product.update(updates, { where: { id: req.params.id } });
    logAudit({ actorId: req.session.user.id, action: 'update_product', entityType: 'Product', entityId: req.params.id, metadata: { name, status }, req });
    res.redirect('/admin');
  } catch (err) {
    res.redirect('/admin');
  }
});

router.post('/products/:id/delete', adminMiddleware, async (req, res) => {
  try {
    const { Product } = require('../models');
    await Product.destroy({ where: { id: req.params.id } });
    logAudit({ actorId: req.session.user.id, action: 'delete_product', entityType: 'Product', entityId: req.params.id, req });
    res.redirect('/admin');
  } catch (err) {
    res.redirect('/admin');
  }
});

router.get('/orders', adminMiddleware, async (req, res) => {
  try {
    const { Order, User, OrderItem } = require('../models');
    const orders = await Order.findAll({
      include: [User, { model: OrderItem, as: 'items' }],
      order: [['createdAt', 'DESC']],
    });
    res.render('admin/orders', {
      title: 'Order Management', orders, formatPHP,
      ORDER_STATUSES: { PENDING: 'pending', AWAITING_VERIFICATION: 'awaiting_verification', PAID: 'paid', PROCESSING: 'processing', SHIPPED: 'shipped', DELIVERED: 'delivered', CANCELLED: 'cancelled', EXPIRED: 'expired' },
      PAYMENT_METHODS: { COD: 'cod', GCASH: 'gcash' },
    });
  } catch (err) {
    res.render('admin/orders', { title: 'Order Management', orders: [], formatPHP, ORDER_STATUSES: {}, PAYMENT_METHODS: { COD: 'cod', GCASH: 'gcash' } });
  }
});

router.post('/orders/:id/verify', adminMiddleware, async (req, res) => {
  try {
    const { Order, User, OrderItem } = require('../models');
    const order = await Order.findByPk(req.params.id, { include: [{ model: OrderItem, as: 'items' }] });
    if (!order) return res.status(404).send('Order not found');
    if (order.paymentMethod !== 'gcash') {
      return res.status(400).send('Only GCash orders can be verified');
    }
    const { verifyGcashPayment } = require('../services/commerce');
    await verifyGcashPayment(order.id, {
      actorId: req.session.user.id, ip: req.ip, userAgent: req.get('User-Agent'),
    });
    const updated = await Order.findByPk(order.id, { include: [User, { model: OrderItem, as: 'items' }] });
    logAudit({ actorId: req.session.user.id, action: 'verify_order', entityType: 'Order', entityId: order.id, metadata: { verified: true }, req });
    if (updated.User) {
      const { sendOrderStatusUpdate } = require('../services/email');
      await sendOrderStatusUpdate({ order: updated, customerEmail: updated.User.email, newStatus: updated.paymentStatus, items: updated.items });
    }
    res.redirect('/admin/orders?verified=1');
  } catch (err) {
    res.redirect('/admin/orders?error=' + encodeURIComponent(err.message));
  }
});

router.post('/orders/:id/cancel', adminMiddleware, async (req, res) => {
  try {
    const { Order, User, OrderItem } = require('../models');
    const order = await Order.findByPk(req.params.id, { include: [{ model: OrderItem, as: 'items' }] });
    if (!order) return res.status(404).send('Order not found');
    const { cancelOrder } = require('../services/commerce');
    await cancelOrder(order.id, {
      actorId: req.session.user.id, reason: req.body.reason || 'Cancelled by admin', ip: req.ip, userAgent: req.get('User-Agent'),
    });
    const updated = await Order.findByPk(order.id, { include: [User, { model: OrderItem, as: 'items' }] });
    logAudit({ actorId: req.session.user.id, action: 'cancel_order', entityType: 'Order', entityId: order.id, metadata: { reason: req.body.reason }, req });
    if (updated.User) {
      const { sendOrderStatusUpdate } = require('../services/email');
      await sendOrderStatusUpdate({ order: updated, customerEmail: updated.User.email, newStatus: updated.status, items: updated.items });
    }
    res.redirect('/admin/orders?cancelled=1');
  } catch (err) {
    res.redirect('/admin/orders?error=' + encodeURIComponent(err.message));
  }
});

router.post('/orders/:id/fulfill', adminMiddleware, async (req, res) => {
  try {
    const { Order, User, OrderItem } = require('../models');
    const { status, courier, trackingNumber, estimatedDelivery } = req.body;
    const { updateFulfillment } = require('../services/commerce');
    await updateFulfillment(req.params.id, {
      status, courier, trackingNumber, estimatedDelivery: estimatedDelivery || null,
      actorId: req.session.user.id, ip: req.ip, userAgent: req.get('User-Agent'),
    });
    const updated = await Order.findByPk(req.params.id, { include: [User, { model: OrderItem, as: 'items' }] });
    logAudit({ actorId: req.session.user.id, action: 'fulfill_order', entityType: 'Order', entityId: req.params.id, metadata: { status, courier, trackingNumber }, req });
    if (updated.User) {
      const { sendOrderStatusUpdate } = require('../services/email');
      await sendOrderStatusUpdate({ order: updated, customerEmail: updated.User.email, newStatus: updated.status, items: updated.items });
    }
    res.redirect('/admin/orders?fulfilled=1');
  } catch (err) {
    res.redirect('/admin/orders?error=' + encodeURIComponent(err.message));
  }
});

router.get('/audit', adminMiddleware, async (req, res) => {
  try {
    const { AuditLog, User } = require('../models');
    const logs = await AuditLog.findAll({
      include: [{ model: User, as: 'actor', attributes: ['name', 'email'] }],
      order: [['createdAt', 'DESC']],
      limit: 100,
    });
    res.render('admin/audit', { title: 'Audit Log', logs, formatPHP });
  } catch (err) {
    res.render('admin/audit', { title: 'Audit Log', logs: [], formatPHP });
  }
});

router.get('/reporting', adminMiddleware, async (req, res) => {
  try {
    const { buildSalesReport } = require('../services/commerce');
    const { startDate, endDate } = req.query;
    const report = await buildSalesReport({ startDate, endDate });
    res.render('admin/reporting', {
      title: 'Sales Reporting', report, formatPHP,
      startDate: startDate || '', endDate: endDate || '',
    });
  } catch (err) {
    res.render('admin/reporting', {
      title: 'Sales Reporting',
      report: { rows: [], totals: { orders: 0, items: 0, revenue: 0, shipping: 0 } },
      formatPHP, startDate: '', endDate: '', error: err.message,
    });
  }
});

module.exports = router;