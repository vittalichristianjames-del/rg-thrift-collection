const { sequelize } = require('../config/database');
const { DataTypes } = require('sequelize');

// Keep the model definitions in one place. The application deliberately stores
// a snapshot of a product on OrderItem so an admin may later edit or archive a
// listing without changing a customer's receipt.

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: { isEmail: true }
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('user', 'admin'),
    defaultValue: 'user'
  }
});

const Product = sequelize.define('Product', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: DataTypes.TEXT,
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: { min: 0 }
  },
  category: DataTypes.STRING,
  condition: DataTypes.STRING,

  // `image` remains the primary/legacy image used by older templates. `images`
  // holds optional image metadata such as { url, alt }.
  image: DataTypes.STRING,
  images: {
    type: DataTypes.JSON,
    defaultValue: []
  },

  // Measurements are intentionally individual nullable values. This makes
  // them easy to render and filter, while measurementsUnit keeps their meaning
  // unambiguous for secondhand garments.
  chestWidth: {
    type: DataTypes.DECIMAL(8, 2),
    validate: { min: 0 }
  },
  totalLength: {
    type: DataTypes.DECIMAL(8, 2),
    validate: { min: 0 }
  },
  shoulderWidth: {
    type: DataTypes.DECIMAL(8, 2),
    validate: { min: 0 }
  },
  inseam: {
    type: DataTypes.DECIMAL(8, 2),
    validate: { min: 0 }
  },
  measurementsUnit: {
    type: DataTypes.STRING,
    defaultValue: 'in'
  },

  // Thrift listings are normally one-off pieces. `stock` is retained for a
  // familiar admin experience, but checkout reserves one unit atomically.
  stock: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    validate: { min: 0 }
  },
  status: {
    type: DataTypes.ENUM('available', 'reserved', 'sold', 'archived'),
    defaultValue: 'available'
  },
  reservedUntil: DataTypes.DATE,
  reservedOrderId: DataTypes.UUID,
  featured: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  indexes: [
    { fields: ['status'] },
    { fields: ['category', 'status'] },
    { fields: ['reservedUntil'] }
  ]
});

const Cart = sequelize.define('Cart', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  }
});

const CartItem = sequelize.define('CartItem', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  quantity: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    validate: { min: 1 }
  }
}, {
  indexes: [
    { unique: true, fields: ['cartId', 'productId'] }
  ]
});

const Order = sequelize.define('Order', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  orderNumber: {
    type: DataTypes.STRING,
    unique: true
  },
  subtotal: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  shippingFee: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  total: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM(
      'pending',
      'awaiting_verification',
      'paid',
      'processing',
      'shipped',
      'delivered',
      'cancelled',
      'expired'
    ),
    defaultValue: 'pending'
  },
  paymentMethod: {
    type: DataTypes.ENUM('cod', 'gcash'),
    allowNull: false,
    defaultValue: 'cod'
  },
  paymentStatus: {
    type: DataTypes.ENUM('cod_due', 'pending_verification', 'verified', 'rejected', 'paid', 'expired'),
    allowNull: false,
    defaultValue: 'cod_due'
  },
  gcashReference: DataTypes.STRING,
  paymentReceiptPath: DataTypes.STRING,
  paymentReceiptMimeType: DataTypes.STRING,
  paymentReceiptOriginalName: DataTypes.STRING,

  contactName: DataTypes.STRING,
  contactEmail: DataTypes.STRING,
  contactPhone: DataTypes.STRING,
  shippingAddress: DataTypes.JSON,
  shippingRegion: DataTypes.STRING,
  courierName: DataTypes.STRING,
  trackingNumber: DataTypes.STRING,
  estimatedDeliveryDate: DataTypes.DATEONLY,
  fulfilledAt: DataTypes.DATE,
  deliveredAt: DataTypes.DATE,
  cancellationReason: DataTypes.TEXT,
  reservationExpiresAt: DataTypes.DATE
}, {
  indexes: [
    { fields: ['userId', 'createdAt'] },
    { fields: ['status'] },
    { fields: ['paymentStatus'] },
    { fields: ['orderNumber'] }
  ]
});

const OrderItem = sequelize.define('OrderItem', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  productName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  productCategory: DataTypes.STRING,
  productImage: DataTypes.STRING,
  productCondition: DataTypes.STRING,
  measurements: DataTypes.JSON,
  unitPrice: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  quantity: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    validate: { min: 1 }
  },
  lineTotal: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  }
});

// Reservations are append-only state records. Product.status is the fast
// catalog read model; the reservation is the traceable lock behind it.
const Reservation = sequelize.define('Reservation', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  status: {
    type: DataTypes.ENUM('active', 'released', 'converted', 'expired'),
    defaultValue: 'active'
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  releasedAt: DataTypes.DATE,
  releaseReason: DataTypes.STRING
}, {
  indexes: [
    { fields: ['status', 'expiresAt'] },
    { fields: ['productId'] },
    { fields: ['orderId'] }
  ]
});

const AuditLog = sequelize.define('AuditLog', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  actorId: DataTypes.UUID,
  action: {
    type: DataTypes.STRING,
    allowNull: false
  },
  entityType: {
    type: DataTypes.STRING,
    allowNull: false
  },
  entityId: DataTypes.UUID,
  metadata: DataTypes.JSON,
  ipAddress: DataTypes.STRING,
  userAgent: DataTypes.STRING
}, {
  indexes: [
    { fields: ['entityType', 'entityId'] },
    { fields: ['actorId', 'createdAt'] },
    { fields: ['createdAt'] }
  ]
});

// Associations
User.hasOne(Cart, { foreignKey: 'userId' });
Cart.belongsTo(User, { foreignKey: 'userId' });

Cart.hasMany(CartItem, { foreignKey: 'cartId', as: 'items', onDelete: 'CASCADE' });
CartItem.belongsTo(Cart, { foreignKey: 'cartId' });

Product.hasMany(CartItem, { foreignKey: 'productId' });
CartItem.belongsTo(Product, { foreignKey: 'productId' });

User.hasMany(Order, { foreignKey: 'userId' });
Order.belongsTo(User, { foreignKey: 'userId' });

Order.hasMany(OrderItem, { foreignKey: 'orderId', as: 'items', onDelete: 'RESTRICT' });
OrderItem.belongsTo(Order, { foreignKey: 'orderId' });
Product.hasMany(OrderItem, { foreignKey: 'productId', onDelete: 'RESTRICT' });
OrderItem.belongsTo(Product, { foreignKey: 'productId' });

Product.hasMany(Reservation, { foreignKey: 'productId', as: 'reservations', onDelete: 'RESTRICT' });
Reservation.belongsTo(Product, { foreignKey: 'productId' });
Order.hasMany(Reservation, { foreignKey: 'orderId', as: 'reservations', onDelete: 'CASCADE' });
Reservation.belongsTo(Order, { foreignKey: 'orderId' });

User.hasMany(AuditLog, { foreignKey: 'actorId', as: 'auditEntries' });
AuditLog.belongsTo(User, { foreignKey: 'actorId', as: 'actor' });

module.exports = {
  User,
  Product,
  Cart,
  CartItem,
  Order,
  OrderItem,
  Reservation,
  AuditLog,
  sequelize
};
