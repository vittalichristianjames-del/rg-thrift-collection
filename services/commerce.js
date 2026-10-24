const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { Op } = require('sequelize');
const {
  sequelize,
  Product,
  Cart,
  CartItem,
  Order,
  OrderItem,
  Reservation,
  AuditLog
} = require('../models');

const PRODUCT_STATUSES = Object.freeze({
  AVAILABLE: 'available',
  RESERVED: 'reserved',
  SOLD: 'sold',
  ARCHIVED: 'archived'
});

const ORDER_STATUSES = Object.freeze({
  PENDING: 'pending',
  AWAITING_VERIFICATION: 'awaiting_verification',
  PAID: 'paid',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired'
});

const PAYMENT_METHODS = Object.freeze({ COD: 'cod', GCASH: 'gcash' });

const SHIPPING_RATES = Object.freeze({
  'metro-manila': { label: 'Metro Manila', fee: 80 },
  luzon: { label: 'Luzon', fee: 130 },
  visayas: { label: 'Visayas', fee: 180 },
  mindanao: { label: 'Mindanao', fee: 220 }
});

class CommerceError extends Error {
  constructor(message, statusCode = 400, code = 'COMMERCE_ERROR') {
    super(message);
    this.name = 'CommerceError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new CommerceError('A valid price is required.');
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeShippingRegion(region) {
  const value = stringValue(region).toLowerCase().replace(/[^a-z]/g, '');
  if (['metro', 'metromanila', 'ncr', 'nationalcapitalregion'].includes(value)) return 'metro-manila';
  if (value.includes('luzon')) return 'luzon';
  if (value.includes('visayas')) return 'visayas';
  if (value.includes('mindanao')) return 'mindanao';
  return null;
}

function calculateShipping(shippingRegion) {
  const key = normalizeShippingRegion(shippingRegion);
  if (!key) {
    throw new CommerceError('Please choose a valid Philippine delivery region.', 422, 'INVALID_SHIPPING_REGION');
  }
  return { key, ...SHIPPING_RATES[key] };
}

function parsePositiveEnv(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function reservationMinutes(paymentMethod) {
  return paymentMethod === PAYMENT_METHODS.COD
    ? parsePositiveEnv('COD_RESERVATION_MINUTES', 24 * 60)
    : parsePositiveEnv('RESERVATION_MINUTES', 30);
}

function gcashConfig() {
  return {
    accountName: process.env.GCASH_ACCOUNT_NAME || '',
    mobileNumber: process.env.GCASH_MOBILE_NUMBER || '',
    qrCodeUrl: process.env.GCASH_QR_CODE_URL || ''
  };
}

function orderNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `RGT-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function productMeasurementSnapshot(product) {
  return {
    chestWidth: product.chestWidth === null ? null : product.chestWidth,
    totalLength: product.totalLength === null ? null : product.totalLength,
    shoulderWidth: product.shoulderWidth === null ? null : product.shoulderWidth,
    inseam: product.inseam === null ? null : product.inseam,
    unit: product.measurementsUnit || 'in'
  };
}

function legacyAddress(body) {
  if (!body || typeof body.shippingAddress !== 'string') return {};
  try {
    const parsed = JSON.parse(body.shippingAddress);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function normalizeCheckoutDetails(body = {}, user = {}) {
  const legacy = legacyAddress(body);
  const paymentMethod = stringValue(body.paymentMethod || PAYMENT_METHODS.COD).toLowerCase();
  if (!Object.values(PAYMENT_METHODS).includes(paymentMethod)) {
    throw new CommerceError('Choose Cash on Delivery or GCash.', 422, 'INVALID_PAYMENT_METHOD');
  }

  const details = {
    paymentMethod,
    contactName: stringValue(body.contactName || user.name),
    contactEmail: stringValue(body.contactEmail || user.email).toLowerCase(),
    contactPhone: stringValue(body.contactPhone),
    addressLine1: stringValue(body.addressLine1 || legacy.addressLine1 || legacy.street),
    addressLine2: stringValue(body.addressLine2 || legacy.addressLine2),
    city: stringValue(body.city || legacy.city),
    province: stringValue(body.province || legacy.province || legacy.state),
    postalCode: stringValue(body.postalCode || legacy.postalCode || legacy.zip),
    shippingRegion: stringValue(body.shippingRegion || legacy.shippingRegion || legacy.region),
    gcashReference: stringValue(body.gcashReference)
  };

  const required = ['contactName', 'contactEmail', 'contactPhone', 'addressLine1', 'city', 'province', 'shippingRegion'];
  const missing = required.filter((key) => !details[key]);
  if (missing.length) {
    throw new CommerceError('Please complete your contact and delivery details.', 422, 'MISSING_CHECKOUT_DETAILS');
  }
  if (!/^\S+@\S+\.\S+$/.test(details.contactEmail)) {
    throw new CommerceError('Please provide a valid contact email.', 422, 'INVALID_EMAIL');
  }
  if (paymentMethod === PAYMENT_METHODS.GCASH && !details.gcashReference) {
    throw new CommerceError('A GCash transaction reference is required.', 422, 'MISSING_GCASH_REFERENCE');
  }

  const shipping = calculateShipping(details.shippingRegion);
  details.shippingRegion = shipping.label;
  details.shippingFee = shipping.fee;
  details.shippingAddress = {
    addressLine1: details.addressLine1,
    addressLine2: details.addressLine2,
    city: details.city,
    province: details.province,
    postalCode: details.postalCode,
    country: 'Philippines'
  };
  return details;
}

function addFlash(req, type, message) {
  if (!req) return;
  if (typeof req.flash === 'function') {
    req.flash(type, message);
    return;
  }
  if (req.session) req.session.commerceNotice = { type, message };
}

async function logAudit({ actorId = null, action, entityType, entityId = null, metadata = {}, req, transaction }) {
  return AuditLog.create({
    actorId,
    action,
    entityType,
    entityId,
    metadata,
    ipAddress: req ? req.ip : null,
    userAgent: req ? req.get('user-agent') : null
  }, { transaction });
}

async function findOrCreateCart(userId, transaction) {
  const [cart] = await Cart.findOrCreate({
    where: { userId },
    defaults: { userId },
    transaction
  });
  return cart;
}

async function releaseExpiredReservations({ now = new Date(), transaction } = {}) {
  const release = async (activeTransaction) => {
    const reservations = await Reservation.findAll({
      where: {
        status: 'active',
        expiresAt: { [Op.lte]: now }
      },
      transaction: activeTransaction,
      lock: activeTransaction.LOCK.UPDATE
    });

    const releasedOrderIds = [];
    for (const reservation of reservations) {
      const [changed] = await Reservation.update({
        status: 'expired',
        releasedAt: now,
        releaseReason: 'checkout_expired'
      }, {
        where: { id: reservation.id, status: 'active' },
        transaction: activeTransaction
      });
      if (!changed) continue;

      await Product.update({
        status: PRODUCT_STATUSES.AVAILABLE,
        stock: 1,
        reservedUntil: null,
        reservedOrderId: null
      }, {
        where: {
          id: reservation.productId,
          status: PRODUCT_STATUSES.RESERVED,
          reservedOrderId: reservation.orderId
        },
        transaction: activeTransaction
      });

      const [orderChanged] = await Order.update({
        status: ORDER_STATUSES.EXPIRED,
        paymentStatus: 'expired',
        cancellationReason: 'Reservation expired before payment or fulfillment.'
      }, {
        where: {
          id: reservation.orderId,
          status: { [Op.in]: [ORDER_STATUSES.PENDING, ORDER_STATUSES.AWAITING_VERIFICATION] }
        },
        transaction: activeTransaction
      });
      if (orderChanged) {
        releasedOrderIds.push(reservation.orderId);
        await logAudit({
          action: 'reservation.expired',
          entityType: 'Order',
          entityId: reservation.orderId,
          metadata: { productId: reservation.productId },
          transaction: activeTransaction
        });
      }
    }
    return { releasedCount: releasedOrderIds.length, orderIds: releasedOrderIds };
  };

  return transaction ? release(transaction) : sequelize.transaction(release);
}

async function releaseOrderReservations(order, { reason, actorId = null, req, transaction }) {
  const reservations = await Reservation.findAll({
    where: { orderId: order.id, status: 'active' },
    transaction,
    lock: transaction.LOCK.UPDATE
  });

  for (const reservation of reservations) {
    const [changed] = await Reservation.update({
      status: 'released',
      releasedAt: new Date(),
      releaseReason: reason
    }, {
      where: { id: reservation.id, status: 'active' },
      transaction
    });
    if (!changed) continue;

    await Product.update({
      status: PRODUCT_STATUSES.AVAILABLE,
      stock: 1,
      reservedUntil: null,
      reservedOrderId: null
    }, {
      where: {
        id: reservation.productId,
        status: PRODUCT_STATUSES.RESERVED,
        reservedOrderId: order.id
      },
      transaction
    });
  }

  await logAudit({
    actorId,
    action: 'reservation.released',
    entityType: 'Order',
    entityId: order.id,
    metadata: { reason, reservationCount: reservations.length },
    req,
    transaction
  });
  return reservations.length;
}

async function convertOrderReservations(order, { actorId = null, req, transaction }) {
  const reservations = await Reservation.findAll({
    where: { orderId: order.id, status: 'active' },
    transaction,
    lock: transaction.LOCK.UPDATE
  });

  for (const reservation of reservations) {
    const [changed] = await Reservation.update({ status: 'converted' }, {
      where: { id: reservation.id, status: 'active' },
      transaction
    });
    if (!changed) continue;
    await Product.update({
      status: PRODUCT_STATUSES.SOLD,
      stock: 0,
      reservedUntil: null,
      reservedOrderId: order.id
    }, {
      where: {
        id: reservation.productId,
        status: PRODUCT_STATUSES.RESERVED,
        reservedOrderId: order.id
      },
      transaction
    });
  }

  await logAudit({
    actorId,
    action: 'reservation.converted_to_sale',
    entityType: 'Order',
    entityId: order.id,
    metadata: { reservationCount: reservations.length },
    req,
    transaction
  });
  return reservations.length;
}

function snapshotOrderItem(product, quantity = 1) {
  const unitPrice = money(product.price);
  return {
    productId: product.id,
    productName: product.name,
    productCategory: product.category,
    productImage: product.image,
    productCondition: product.condition,
    measurements: productMeasurementSnapshot(product),
    unitPrice,
    quantity,
    lineTotal: money(unitPrice * quantity)
  };
}

async function createCheckoutOrder({ user, body, paymentReceipt, req }) {
  if (!user || !user.id) throw new CommerceError('Sign in before checking out.', 401, 'AUTH_REQUIRED');
  const details = normalizeCheckoutDetails(body, user);
  if (details.paymentMethod === PAYMENT_METHODS.GCASH && !paymentReceipt) {
    throw new CommerceError('Upload a JPEG or PNG GCash receipt.', 422, 'MISSING_PAYMENT_RECEIPT');
  }

  return sequelize.transaction(async (transaction) => {
    await releaseExpiredReservations({ transaction });

    const cart = await Cart.findOne({
      where: { userId: user.id },
      include: [{ model: CartItem, as: 'items' }],
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!cart || !cart.items.length) {
      throw new CommerceError('Your cart is empty.', 422, 'EMPTY_CART');
    }

    // A secondhand listing represents a single physical garment. Reject old or
    // manipulated cart rows that attempt to buy more than one of it.
    const productIds = new Set();
    for (const item of cart.items) {
      if (item.quantity !== 1 || productIds.has(item.productId)) {
        throw new CommerceError('Each thrift listing can only be reserved once.', 422, 'INVALID_CART_QUANTITY');
      }
      productIds.add(item.productId);
    }

    const products = [];
    for (const item of cart.items) {
      const product = await Product.findByPk(item.productId, {
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!product || product.status !== PRODUCT_STATUSES.AVAILABLE || product.stock < 1) {
        throw new CommerceError('One of the items in your cart is no longer available.', 409, 'PRODUCT_UNAVAILABLE');
      }
      products.push(product);
    }

    const items = products.map((product) => snapshotOrderItem(product));
    const subtotal = money(items.reduce((sum, item) => sum + item.lineTotal, 0));
    const expiresAt = new Date(Date.now() + reservationMinutes(details.paymentMethod) * 60 * 1000);
    const isGcash = details.paymentMethod === PAYMENT_METHODS.GCASH;

    const order = await Order.create({
      userId: user.id,
      orderNumber: orderNumber(),
      subtotal,
      shippingFee: details.shippingFee,
      total: money(subtotal + details.shippingFee),
      status: isGcash ? ORDER_STATUSES.AWAITING_VERIFICATION : ORDER_STATUSES.PENDING,
      paymentMethod: details.paymentMethod,
      paymentStatus: isGcash ? 'pending_verification' : 'cod_due',
      gcashReference: isGcash ? details.gcashReference : null,
      paymentReceiptPath: paymentReceipt ? paymentReceipt.relativePath : null,
      paymentReceiptMimeType: paymentReceipt ? paymentReceipt.mimetype : null,
      paymentReceiptOriginalName: paymentReceipt ? paymentReceipt.originalname : null,
      contactName: details.contactName,
      contactEmail: details.contactEmail,
      contactPhone: details.contactPhone,
      shippingAddress: details.shippingAddress,
      shippingRegion: details.shippingRegion,
      reservationExpiresAt: expiresAt
    }, { transaction });

    for (const product of products) {
      // The conditional update is the final lock. Under concurrent checkout
      // requests, exactly one request can change an available product to
      // reserved, even if a database adapter does not expose row locks.
      const [reserved] = await Product.update({
        status: PRODUCT_STATUSES.RESERVED,
        stock: 0,
        reservedUntil: expiresAt,
        reservedOrderId: order.id
      }, {
        where: {
          id: product.id,
          status: PRODUCT_STATUSES.AVAILABLE,
          stock: { [Op.gte]: 1 }
        },
        transaction
      });
      if (reserved !== 1) {
        throw new CommerceError('An item was just reserved by another customer. Please review your cart.', 409, 'RESERVATION_CONFLICT');
      }
      await Reservation.create({
        productId: product.id,
        orderId: order.id,
        expiresAt
      }, { transaction });
    }

    await OrderItem.bulkCreate(items.map((item) => ({ ...item, orderId: order.id })), { transaction });
    await CartItem.destroy({ where: { cartId: cart.id }, transaction });
    await logAudit({
      actorId: user.id,
      action: 'order.created',
      entityType: 'Order',
      entityId: order.id,
      metadata: {
        orderNumber: order.orderNumber,
        paymentMethod: order.paymentMethod,
        productIds: products.map((product) => product.id),
        total: order.total
      },
      req,
      transaction
    });
    return order;
  });
}

async function verifyGcashPayment({ orderId, actorId, req }) {
  return sequelize.transaction(async (transaction) => {
    await releaseExpiredReservations({ transaction });
    const order = await Order.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!order) throw new CommerceError('Order not found.', 404, 'ORDER_NOT_FOUND');
    if (order.paymentMethod !== PAYMENT_METHODS.GCASH) {
      throw new CommerceError('Only GCash orders require manual verification.', 422, 'NOT_GCASH_ORDER');
    }
    if (order.status === ORDER_STATUSES.EXPIRED || order.status === ORDER_STATUSES.CANCELLED) {
      throw new CommerceError('This order is no longer active.', 409, 'INACTIVE_ORDER');
    }
    if (!['pending_verification'].includes(order.paymentStatus)) {
      throw new CommerceError('This payment has already been reviewed.', 409, 'PAYMENT_ALREADY_REVIEWED');
    }

    await convertOrderReservations(order, { actorId, req, transaction });
    order.status = ORDER_STATUSES.PAID;
    order.paymentStatus = 'verified';
    await order.save({ transaction });
    await logAudit({
      actorId,
      action: 'payment.gcash_verified',
      entityType: 'Order',
      entityId: order.id,
      metadata: { reference: order.gcashReference },
      req,
      transaction
    });
    return order;
  });
}

async function cancelOrder({ orderId, actorId, reason = 'Cancelled by store.', rejection = false, req }) {
  return sequelize.transaction(async (transaction) => {
    const order = await Order.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!order) throw new CommerceError('Order not found.', 404, 'ORDER_NOT_FOUND');
    if ([ORDER_STATUSES.CANCELLED, ORDER_STATUSES.EXPIRED, ORDER_STATUSES.DELIVERED].includes(order.status)) {
      throw new CommerceError('This order can no longer be cancelled.', 409, 'INVALID_ORDER_STATE');
    }

    await releaseOrderReservations(order, { reason, actorId, req, transaction });
    order.status = ORDER_STATUSES.CANCELLED;
    order.paymentStatus = rejection && order.paymentMethod === PAYMENT_METHODS.GCASH ? 'rejected' : 'cancelled';
    order.cancellationReason = stringValue(reason) || 'Cancelled by store.';
    await order.save({ transaction });
    await logAudit({
      actorId,
      action: rejection ? 'payment.gcash_rejected' : 'order.cancelled',
      entityType: 'Order',
      entityId: order.id,
      metadata: { reason: order.cancellationReason },
      req,
      transaction
    });
    return order;
  });
}

async function updateFulfillment({ orderId, actorId, status, courierName, trackingNumber, estimatedDeliveryDate, req }) {
  const targetStatus = stringValue(status).toLowerCase();
  if (![ORDER_STATUSES.PROCESSING, ORDER_STATUSES.SHIPPED, ORDER_STATUSES.DELIVERED].includes(targetStatus)) {
    throw new CommerceError('Choose processing, shipped, or delivered.', 422, 'INVALID_FULFILLMENT_STATUS');
  }

  return sequelize.transaction(async (transaction) => {
    await releaseExpiredReservations({ transaction });
    const order = await Order.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!order) throw new CommerceError('Order not found.', 404, 'ORDER_NOT_FOUND');
    if ([ORDER_STATUSES.CANCELLED, ORDER_STATUSES.EXPIRED, ORDER_STATUSES.DELIVERED].includes(order.status)) {
      throw new CommerceError('This order is no longer eligible for fulfillment updates.', 409, 'INVALID_ORDER_STATE');
    }

    if (targetStatus === ORDER_STATUSES.PROCESSING) {
      if (order.paymentMethod === PAYMENT_METHODS.GCASH && order.paymentStatus !== 'verified') {
        throw new CommerceError('Verify the GCash payment before fulfillment.', 409, 'PAYMENT_NOT_VERIFIED');
      }
      if (![ORDER_STATUSES.PAID, ORDER_STATUSES.PENDING, ORDER_STATUSES.PROCESSING].includes(order.status)) {
        throw new CommerceError('Move this order through verification before processing it.', 409, 'INVALID_ORDER_TRANSITION');
      }
      if (order.paymentMethod === PAYMENT_METHODS.COD) {
        await convertOrderReservations(order, { actorId, req, transaction });
      }
      order.status = ORDER_STATUSES.PROCESSING;
      order.fulfilledAt = order.fulfilledAt || new Date();
    }

    if (targetStatus === ORDER_STATUSES.SHIPPED) {
      if (order.status !== ORDER_STATUSES.PROCESSING && order.status !== ORDER_STATUSES.SHIPPED) {
        throw new CommerceError('Mark the order as processing before shipping it.', 409, 'INVALID_ORDER_TRANSITION');
      }
      order.status = ORDER_STATUSES.SHIPPED;
    }

    if (targetStatus === ORDER_STATUSES.DELIVERED) {
      if (order.status !== ORDER_STATUSES.SHIPPED && order.status !== ORDER_STATUSES.DELIVERED) {
        throw new CommerceError('Mark the order as shipped before delivery.', 409, 'INVALID_ORDER_TRANSITION');
      }
      order.status = ORDER_STATUSES.DELIVERED;
      order.deliveredAt = order.deliveredAt || new Date();
      if (order.paymentMethod === PAYMENT_METHODS.COD) order.paymentStatus = 'paid';
    }

    if (courierName !== undefined) order.courierName = stringValue(courierName) || null;
    if (trackingNumber !== undefined) order.trackingNumber = stringValue(trackingNumber) || null;
    if (estimatedDeliveryDate !== undefined) {
      const parsedDate = stringValue(estimatedDeliveryDate);
      if (parsedDate && Number.isNaN(new Date(parsedDate).getTime())) {
        throw new CommerceError('Use a valid estimated delivery date.', 422, 'INVALID_DELIVERY_DATE');
      }
      order.estimatedDeliveryDate = parsedDate || null;
    }
    await order.save({ transaction });
    await logAudit({
      actorId,
      action: `order.${targetStatus}`,
      entityType: 'Order',
      entityId: order.id,
      metadata: {
        courierName: order.courierName,
        trackingNumber: order.trackingNumber,
        estimatedDeliveryDate: order.estimatedDeliveryDate
      },
      req,
      transaction
    });
    return order;
  });
}

function receiptAbsolutePath(order) {
  if (!order || !order.paymentReceiptPath) return null;
  const root = path.resolve(process.cwd(), 'uploads', 'payment-receipts');
  const candidate = path.resolve(process.cwd(), 'uploads', order.paymentReceiptPath);
  if (!candidate.startsWith(`${root}${path.sep}`)) {
    throw new CommerceError('The receipt path is invalid.', 400, 'INVALID_RECEIPT_PATH');
  }
  return candidate;
}

async function validateReceiptFile(file) {
  if (!file) return null;
  const allowedTypes = ['image/jpeg', 'image/png'];
  if (!allowedTypes.includes(file.mimetype)) {
    throw new CommerceError('Payment receipts must be JPEG or PNG images.', 422, 'INVALID_RECEIPT_TYPE');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new CommerceError('Payment receipts must be 5 MB or smaller.', 422, 'RECEIPT_TOO_LARGE');
  }

  const handle = await fs.open(file.path, 'r');
  try {
    const header = Buffer.alloc(8);
    await handle.read(header, 0, 8, 0);
    const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    const png = header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!jpeg && !png) {
      throw new CommerceError('The uploaded receipt is not a valid JPEG or PNG image.', 422, 'INVALID_RECEIPT_CONTENT');
    }
  } finally {
    await handle.close();
  }
  return file;
}

async function removeUploadedFile(file) {
  if (!file || !file.path) return;
  try {
    await fs.unlink(file.path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function buildSalesReport({ startDate, endDate } = {}) {
  const where = {
    status: { [Op.notIn]: [ORDER_STATUSES.CANCELLED, ORDER_STATUSES.EXPIRED] }
  };
  const start = startDate ? new Date(`${startDate}T00:00:00.000`) : null;
  const end = endDate ? new Date(`${endDate}T23:59:59.999`) : null;
  if (start && Number.isNaN(start.getTime())) throw new CommerceError('Invalid report start date.', 422, 'INVALID_START_DATE');
  if (end && Number.isNaN(end.getTime())) throw new CommerceError('Invalid report end date.', 422, 'INVALID_END_DATE');
  if (start || end) where.createdAt = {};
  if (start) where.createdAt[Op.gte] = start;
  if (end) where.createdAt[Op.lte] = end;

  const orders = await Order.findAll({
    where,
    include: [{ model: OrderItem, as: 'items' }],
    order: [['createdAt', 'ASC']]
  });
  const daily = new Map();
  for (const order of orders) {
    const date = order.createdAt.toISOString().slice(0, 10);
    const row = daily.get(date) || { date, orders: 0, items: 0, revenue: 0, shipping: 0 };
    row.orders += 1;
    row.items += order.items.reduce((sum, item) => sum + item.quantity, 0);
    row.revenue = money(row.revenue + Number(order.total));
    row.shipping = money(row.shipping + Number(order.shippingFee));
    daily.set(date, row);
  }
  const rows = [...daily.values()];
  return {
    rows,
    totals: rows.reduce((summary, row) => ({
      orders: summary.orders + row.orders,
      items: summary.items + row.items,
      revenue: money(summary.revenue + row.revenue),
      shipping: money(summary.shipping + row.shipping)
    }), { orders: 0, items: 0, revenue: 0, shipping: 0 })
  };
}

module.exports = {
  PRODUCT_STATUSES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  SHIPPING_RATES,
  CommerceError,
  addFlash,
  buildSalesReport,
  calculateShipping,
  createCheckoutOrder,
  findOrCreateCart,
  gcashConfig,
  logAudit,
  normalizeCheckoutDetails,
  positiveInteger,
  receiptAbsolutePath,
  releaseExpiredReservations,
  cancelOrder,
  updateFulfillment,
  validateReceiptFile,
  removeUploadedFile,
  verifyGcashPayment
};
