'use strict';
// Only known error codes/names are exposed: raw exception messages may contain credentials.
const CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH',
  'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ECONNABORTED', 'ENETDOWN', 'EHOSTDOWN', 'ENOBUFS', 'EMFILE',
  'ENFILE', 'EACCES', 'EPERM', 'ABORT_ERR', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_ABORTED', 'UND_ERR_DESTROYED', 'UND_ERR_CLOSED',
  'UND_ERR_RES_CONTENT_LENGTH_MISMATCH', 'UND_ERR_RESPONSE_STATUS_CODE', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
const NAMES = new Set(['Error', 'TypeError', 'SyntaxError', 'TimeoutError', 'AbortError', 'AggregateError']);
function causes(error) {
  const found = [], seen = new Set(), pending = [error];
  while (pending.length && seen.size < 16) {
    const item = pending.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item); found.push(item);
    if (item.cause) pending.push(item.cause);
    if (Array.isArray(item.errors)) pending.push(...item.errors.slice(0, 8));
  }
  return found;
}
function diagnosedError(error, context, signal) {
  const chain = causes(error);
  const codes = [...new Set(chain.map(e => e.code).filter(code => CODES.has(code)))];
  const timedOut = (signal?.aborted && signal.reason?.name === 'TimeoutError') ||
    chain.some(e => e.name === 'TimeoutError') || codes.some(c => c === 'ETIMEDOUT' || c.endsWith('_TIMEOUT'));
  const own = error?.shellyFailure === true;
  const category = own ? error.failureCategory : timedOut ? 'timeout' :
    context.phase === 'response-body' && error?.name === 'SyntaxError' ? 'invalid-response' : 'network';
  const message = own ? error.message : category === 'timeout' ? 'Shelly-Anfrage: Zeitlimit überschritten.' :
    category === 'invalid-response' ? 'Shelly-Antwort ist kein gültiges JSON.' : 'Shelly-Anfrage: Verbindungsfehler.';
  const result = new Error(message);
  result.code = own ? error.code : category === 'timeout' ? 'SHELLY_TIMEOUT' :
    category === 'invalid-response' ? 'SHELLY_INVALID_RESPONSE' : 'SHELLY_NETWORK_ERROR';
  result.rpcDiagnostic = { ...context, category, errorType: NAMES.has(error?.name) ? error.name : 'Error', causeCodes: codes };
  if (category === 'timeout') result.rpcDiagnostic.timeoutSource =
    signal?.aborted && signal.reason?.name === 'TimeoutError' ? 'request-deadline' :
      codes.some(c => c === 'ETIMEDOUT' || c.endsWith('_TIMEOUT')) ? 'transport' : 'reported-timeout';
  if (Number.isInteger(error?.rpcCode)) result.rpcDiagnostic.rpcCode = error.rpcCode;
  return result;
}
function rpcFailure(message, category, code, rpcCode) {
  return Object.assign(new Error(message), { shellyFailure: true, failureCategory: category, code, rpcCode });
}
function diagnosticKey(error) {
  if (!error.rpcDiagnostic) return '';
  const { elapsedMs, attempt, ...stable } = error.rpcDiagnostic;
  return JSON.stringify(stable);
}
module.exports = { diagnosedError, rpcFailure, diagnosticKey };
