import { acceptConnectGivingSummaryV1 } from './connect-giving-consumer.js';

const OUTCOMES = new Set(['temporary_failure', 'permanent_failure', 'delivered']);

export function reconcileSyntheticGivingDelivery({
  deliveryId,
  payload,
  attemptedOutcomes,
  processedDeliveryIds = [],
  maxAttempts = 3,
}) {
  const accepted = acceptConnectGivingSummaryV1(payload);
  if (typeof deliveryId !== 'string' || !/^[a-z0-9][a-z0-9._:-]{7,127}$/.test(deliveryId)) {
    throw new TypeError('Synthetic Giving deliveryId invalid');
  }
  if (!Array.isArray(processedDeliveryIds) || processedDeliveryIds.some((id) => typeof id !== 'string')) {
    throw new TypeError('Synthetic Giving receipt set invalid');
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new TypeError('Synthetic Giving maxAttempts must be 1-5');
  }
  if (!Array.isArray(attemptedOutcomes) || attemptedOutcomes.length < 1 || attemptedOutcomes.length > maxAttempts
    || attemptedOutcomes.some((outcome) => !OUTCOMES.has(outcome))) {
    throw new TypeError('Synthetic Giving attempt sequence invalid');
  }
  const terminalIndex = attemptedOutcomes.findIndex((outcome) => outcome !== 'temporary_failure');
  if (terminalIndex !== -1 && terminalIndex !== attemptedOutcomes.length - 1) {
    throw new TypeError('Synthetic Giving attempt sequence continues after terminal outcome');
  }

  if (processedDeliveryIds.includes(deliveryId)) {
    return {
      deliveryId,
      status: 'duplicate_ignored',
      attemptsUsed: 0,
      maxAttempts,
      retryable: false,
      receiptAction: 'retain_existing',
      totals: { ...accepted.totals },
      reconciliation: { ...accepted.reconciliation },
    };
  }

  const finalOutcome = attemptedOutcomes.at(-1);
  const status = finalOutcome === 'delivered'
    ? 'accepted'
    : finalOutcome === 'permanent_failure'
      ? 'rejected'
      : attemptedOutcomes.length === maxAttempts ? 'retry_exhausted' : 'retry_pending';
  return {
    deliveryId,
    status,
    attemptsUsed: attemptedOutcomes.length,
    maxAttempts,
    retryable: status === 'retry_pending',
    receiptAction: status === 'accepted' ? 'record_once' : 'none',
    totals: { ...accepted.totals },
    reconciliation: { ...accepted.reconciliation },
  };
}
