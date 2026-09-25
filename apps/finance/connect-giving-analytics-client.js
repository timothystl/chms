// Relay for the v3 Giving pages. Connect computes everything from its own giving tables
// (src/api-giving-analytics-contracts.js) and decides, from the caller's Access identity, what
// they may see: totals for any Giving access, named statements and nudges only for Giving view.
// Finance stores nothing. Never throws.
import { callConnectContract } from './connect-giving-batch-client.js';

export function fetchGivingAnalytics(env, accessJwt, { asOf } = {}) {
  return callConnectContract(env, accessJwt, 'giving-analytics-v1', asOf ? { query: { as_of: asOf } } : {});
}

export function fetchGivingAnalyticsPeople(env, accessJwt, { asOf } = {}) {
  return callConnectContract(env, accessJwt, 'giving-analytics-people-v1', asOf ? { query: { as_of: asOf } } : {});
}

export function postGivingFollowupWrite(env, accessJwt, body) {
  return callConnectContract(env, accessJwt, 'giving-followup-write-v1', { method: 'POST', body });
}
