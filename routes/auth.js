const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Cart } = require('../models');
const { verifyRecaptcha } = require('../middleware/recaptcha');

router.get('/login', (req, res) => {
  res.render('login', { title: 'Login' });
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.render('login', { title: 'Login', error: 'Invalid email or password' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.render('login', { title: 'Login', error: 'Invalid email or password' });
    }
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    res.redirect('/');
  } catch (err) {
    res.render('login', { title: 'Login', error: 'Server error' });
  }
});

router.get('/register', (req, res) => {
  res.render('register', { title: 'Register' });
});

router.post('/register', verifyRecaptcha, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.render('register', { title: 'Register', error: 'Email already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashedPassword });
    const cart = await Cart.create({ userId: user.id });
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    res.redirect('/');
  } catch (err) {
    res.render('register', { title: 'Register', error: 'Server error' });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;