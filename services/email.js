const nodemailer = require('nodemailer');
const path = require('path');

let transporter;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST || 'smtp.ethereal.email';
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';

  if (!host) {
    console.warn('[Email] SMTP_HOST not configured; emails will be logged only.');
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    ...(user ? { auth: { user, pass } } : {}),
  });

  return transporter;
}

function formatPHP(value) {
  return '₱' + (Number(value) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function sendEmail({ to, subject, html, text }) {
  const transport = getTransporter();
  const mailOptions = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@rgthrift.local',
    to,
    subject,
    html,
    text,
  };

  if (!transport) {
    console.log('[Email] (skipped - no SMTP config) To:', to, 'Subject:', subject);
    console.log('[Email] Content preview:', (text || html || '').slice(0, 200));
    return { skipped: true, messageId: 'local-log' };
  }

  try {
    const info = await transport.sendMail(mailOptions);
    console.log('[Email] Sent:', info.messageId, 'to', to);
    return info;
  } catch (err) {
    console.error('[Email] Failed to send to', to, ':', err.message);
    throw err;
  }
}

async function sendOrderConfirmation({ order, customerEmail, items, shippingDetails }) {
  const subject = `RG Thrift Collection - Order Confirmation #${order.orderNumber}`;
  const itemsHtml = items
    .map(
      item => `
    <tr>
      <td style="padding:8px; border-bottom:1px solid #eee;">
        <strong>${item.productName}</strong><br>
        <small style="color:#666;">${item.productCategory || ''}${item.measurements ? ' | Measured: ' + JSON.stringify(item.measurements) : ''}</small>
      </td>
      <td style="padding:8px; border-bottom:1px solid #eee; text-align:center;">${item.quantity}</td>
      <td style="padding:8px; border-bottom:1px solid #eee; text-align:right;">${formatPHP(item.lineTotal)}</td>
    </tr>
  `
    )
    .join('');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>body{font-family:sans-serif;line-height:1.6;color:#333;}table{width:100%;border-collapse:collapse;}a{color:#263d35;text-decoration:none;} .btn{display:inline-block;background:#263d35;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;margin-top:16px;}</style></head>
<body>
  <h2>Order Confirmed - Thank You!</h2>
  <p>Hi there,</p>
  <p>Your order <strong>#${order.orderNumber}</strong> has been received and is <strong>${order.paymentStatus || order.status}</strong>.</p>
  <table>
    <thead><tr><th style="text-align:left;">Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Total</th></tr></thead>
    <tbody>${itemsHtml}</tbody>
  </table>
  <p><strong>Order total:</strong> ${formatPHP(order.total)}</p>
  <p><strong>Shipping:</strong> ${formatPHP(order.shippingFee || 0)}</p>
  <p><strong>Payment method:</strong> ${order.paymentMethod === 'cod' ? 'Cash on Delivery' : 'GCash'}</p>
  <p><strong>Shipping region:</strong> ${shippingDetails.region || 'N/A'}</p>
  ${order.paymentMethod === 'gcash' ? '<p style="color:#d9534f;"><strong>Note:</strong> Your GCash payment is pending manual verification. You will receive another email once verified.</p>' : '<p>You will pay the driver upon delivery.</p>'}
  <a href="${process.env.APP_URL || 'http://localhost:3000'}/orders/${order.id}" class="btn">Track Your Order</a>
  <p style="margin-top:24px; font-size:0.9em; color:#666;">RG Thrift Collection &mdash; Pre-loved pieces, thoughtfully rehomed.</p>
</body>
</html>`;

  const text = `Order Confirmed - Thank You!\n\nYour order #${order.orderNumber} has been received and is ${order.paymentStatus || order.status}.\n\nItems:\n${items.map(i => `- ${i.productName} x${i.quantity} = ${formatPHP(i.lineTotal)}`).join('\n')}\n\nOrder total: ${formatPHP(order.total)}\nShipping: ${formatPHP(order.shippingFee || 0)}\nPayment method: ${order.paymentMethod === 'cod' ? 'Cash on Delivery' : 'GCash'}\n\nTrack your order: ${process.env.APP_URL || 'http://localhost:3000'}/orders/${order.id}`;

  return sendEmail({ to: customerEmail, subject, html, text });
}

async function sendOrderStatusUpdate({ order, customerEmail, newStatus, items }) {
  const statusLabels = {
    pending: 'Pending',
    awaiting_verification: 'Awaiting Payment Verification',
    paid: 'Payment Verified',
    processing: 'Processing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    expired: 'Expired',
  };

  const subject = `RG Thrift Collection - Order #${order.orderNumber} Status Update`;
  const label = statusLabels[newStatus] || newStatus;

  const itemsHtml = items
    .map(
      item => `
    <tr>
      <td style="padding:8px; border-bottom:1px solid #eee;"><strong>${item.productName}</strong></td>
      <td style="padding:8px; border-bottom:1px solid #eee; text-align:center;">${item.quantity}</td>
      <td style="padding:8px; border-bottom:1px solid #eee; text-align:right;">${formatPHP(item.lineTotal)}</td>
    </tr>
  `
    )
    .join('');

  const trackingHtml = order.trackingNumber
    ? `<p><strong>Tracking Number:</strong> ${order.trackingNumber}<br><strong>Courier:</strong> ${order.courier || 'N/A'}</p>`
    : '';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>body{font-family:sans-serif;line-height:1.6;color:#333;}table{width:100%;border-collapse:collapse;}a{color:#263d35;text-decoration:none;} .btn{display:inline-block;background:#263d35;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;margin-top:16px;}</style></head>
<body>
  <h2>Order Status Update</h2>
  <p>Hi there,</p>
  <p>Your order <strong>#${order.orderNumber}</strong> status has changed to <strong>${label}</strong>.</p>
  <table>
    <thead><tr><th style="text-align:left;">Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Total</th></tr></thead>
    <tbody>${itemsHtml}</tbody>
  </table>
  <p><strong>Order total:</strong> ${formatPHP(order.total)}</p>
  ${trackingHtml}
  <a href="${process.env.APP_URL || 'http://localhost:3000'}/orders/${order.id}" class="btn">Track Your Order</a>
  <p style="margin-top:24px; font-size:0.9em; color:#666;">RG Thrift Collection &mdash; Pre-loved pieces, thoughtfully rehomed.</p>
</body>
</html>`;

  const text = `Order Status Update\n\nYour order #${order.orderNumber} status has changed to ${label}.\n\nItems:\n${items.map(i => `- ${i.productName} x${i.quantity} = ${formatPHP(i.lineTotal)}`).join('\n')}\n\nOrder total: ${formatPHP(order.total)}\n${order.trackingNumber ? `Tracking: ${order.trackingNumber} (${order.courier || 'N/A'})` : ''}\n\nTrack your order: ${process.env.APP_URL || 'http://localhost:3000'}/orders/${order.id}`;

  return sendEmail({ to: customerEmail, subject, html, text });
}

async function sendWelcomeEmail({ customerName, customerEmail }) {
  const subject = 'Welcome to RG Thrift Collection';
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>body{font-family:sans-serif;line-height:1.6;color:#333;}a{color:#263d35;text-decoration:none;} .btn{display:inline-block;background:#263d35;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;margin-top:16px;}</style></head>
<body>
  <h2>Welcome to RG Thrift Collection!</h2>
  <p>Hi ${customerName},</p>
  <p>Thank you for joining our community of thoughtful secondhand shoppers.</p>
  <p>Every piece in our collection is one-of-one, individually measured, and ready for its next chapter.</p>
  <a href="${process.env.APP_URL || 'http://localhost:3000'}/products" class="btn">Start Shopping</a>
  <p style="margin-top:24px; font-size:0.9em; color:#666;">RG Thrift Collection &mdash; Pre-loved pieces, thoughtfully rehomed.</p>
</body>
</html>`;
  const text = `Welcome to RG Thrift Collection!\n\nHi ${customerName},\n\nThank you for joining our community.\n\nStart shopping: ${process.env.APP_URL || 'http://localhost:3000'}/products`;

  return sendEmail({ to: customerEmail, subject, html, text });
}

module.exports = { sendEmail, getTransporter, sendOrderConfirmation, sendOrderStatusUpdate, sendWelcomeEmail };