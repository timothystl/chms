// Relay for connect.finance-access-roles.v1 (Accounts & Data → Access & roles). Connect
// re-verifies the caller's Access identity and decides whether names are included. Never throws.
import { callConnectContract } from './connect-giving-batch-client.js';

export function fetchAccessRoles(env, accessJwt) {
  return callConnectContract(env, accessJwt, 'finance-access-roles-v1');
}
