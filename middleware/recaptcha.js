const axios = require('axios');

const verifyRecaptcha = async (req, res, next) => {
  const recaptchaSecret = process.env.RECAPTCHA_SECRET_KEY;
  
  // Skip verification if no secret key (development mode)
  if (!recaptchaSecret || recaptchaSecret === 'value') {
    return next();
  }
  
  const recaptchaResponse = req.body['g-recaptcha-response'];
  
  if (!recaptchaResponse) {
    return res.status(400).json({ error: 'reCAPTCHA verification required' });
  }
  
  try {
    const response = await axios.post('https://www.google.com/recaptcha/api/siteverify', null, {
      params: {
        secret: recaptchaSecret,
        response: recaptchaResponse
      }
    });
    
    if (response.data.success) {
      next();
    } else {
      res.status(400).json({ error: 'reCAPTCHA verification failed' });
    }
  } catch (err) {
    console.error('reCAPTCHA verification error:', err);
    next(); // Allow in case of network error
  }
};

module.exports = { verifyRecaptcha };