const authMiddleware = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  next();
};

const adminMiddleware = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/');
  }
  next();
};

module.exports = { authMiddleware, adminMiddleware };