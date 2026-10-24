require('dotenv').config();

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const { sequelize } = require('./models');

const app = express();

// View engine with layouts
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Session
app.use(session({
  secret: process.env.JWT_SECRET || 'rgthrift-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 24 * 60 * 60 * 1000 }
}));

// Flash messages middleware
app.use((req, res, next) => {
  res.locals.flash = req.session.flash || null;
  req.session.flash = null;
  next();
});

// Make user available in templates
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.recaptchaSiteKey = process.env.RECAPTCHA_SITE_KEY || '';
  res.locals.formatPHP = value => '₱' + (Number(value) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  next();
});

// Routes
app.use('/', require('./routes/index'));
app.use('/auth', require('./routes/auth'));
app.use('/products', require('./routes/products'));
app.use('/cart', require('./routes/cart'));
app.use('/checkout', require('./routes/checkout'));
app.use('/orders', require('./routes/orders'));
app.use('/admin', require('./routes/admin'));

// 404 handler
app.use((req, res) => {
  res.status(404).render('404', { title: 'Page Not Found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { title: 'Server Error', message: err.message });
});

// Start server
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'test') {
  sequelize.sync({ alter: false }).then(() => {
    console.log('Database connected and synced');
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  }).catch(err => {
    console.error('Unable to connect to database:', err);
  });
}

module.exports = app;