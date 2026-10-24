const { AuditLog } = require('../models');

function logAudit({ actorId, action, entityType, entityId, metadata, req }) {
  return AuditLog.create({
    actorId: actorId || null,
    action,
    entityType,
    entityId: entityId || null,
    metadata: metadata || null,
    ipAddress: req ? (req.ip || req.connection.remoteAddress || null) : null,
    userAgent: req ? req.get('User-Agent') || null : null,
  }).catch(err => {
    console.error('[AuditLog] Failed to write audit entry:', err.message);
  });
}

function auditMiddleware(action, entityType) {
  return (req, res, next) => {
    const originalSend = res.send;
    res.send = function (body) {
      const actorId = req.session && req.session.user ? req.session.user.id : null;
      const entityId = req.params && req.params.id ? req.params.id : null;
      logAudit({
        actorId,
        action,
        entityType,
        entityId,
        metadata: { method: req.method, path: req.path, body: req.body || {} },
        req,
      });
      return originalSend.call(this, body);
    };
    next();
  };
}

module.exports = { logAudit, auditMiddleware };