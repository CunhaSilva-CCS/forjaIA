const crypto = require('crypto');
const config = require('./config');

/** Papéis da célula de produção */
const ROLES = ['admin', 'lead', 'qa', 'sre', 'member'];

/** Quem pode aprovar cada etapa do pipeline */
const STAGE_ROLES = {
  coder: ['admin', 'lead'],
  qa: ['admin', 'qa', 'lead'],
  security: ['admin', 'qa', 'lead'],
  debugger: ['admin', 'lead'],
  healer: ['admin', 'lead'],
  devops: ['admin', 'sre', 'lead'],
  deploy: ['admin', 'sre', 'lead'],
  human: ['admin', 'qa', 'lead'],
  userFix: ['admin', 'lead'],
  prodReady: ['admin', 'sre', 'lead'],
  report: ['admin', 'sre', 'lead']
};

function normalizeRole(role) {
  const r = String(role || 'member').toLowerCase();
  return ROLES.includes(r) ? r : 'member';
}

function adminIdentity() {
  return {
    id: 'admin',
    name: 'Admin',
    role: 'admin',
    isAdmin: true,
    token: config.apiToken
  };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function canApproveStage(member, stage) {
  if (!member) return false;
  if (member.role === 'admin' || member.isAdmin) return true;
  const allowed = STAGE_ROLES[stage] || ['admin', 'lead'];
  return allowed.includes(member.role);
}

function assertCanApprove(member, stage) {
  if (canApproveStage(member, stage)) return;
  const allowed = (STAGE_ROLES[stage] || ['admin']).join(', ');
  const err = new Error(
    `Papel "${member?.role || 'desconhecido'}" não pode aprovar a etapa "${stage}". Requer: ${allowed}.`
  );
  err.status = 403;
  throw err;
}

function canStartRun(member) {
  return Boolean(member);
}

function canManageServices(member) {
  if (!member) return false;
  if (member.role === 'admin' || member.isAdmin) return true;
  return member.role === 'sre' || member.role === 'lead';
}

module.exports = {
  ROLES,
  STAGE_ROLES,
  normalizeRole,
  adminIdentity,
  hashToken,
  canApproveStage,
  assertCanApprove,
  canStartRun,
  canManageServices
};
