export type CollaborationProgressRequest = {
  conversation?: string;
  recipient?: string;
  state: string;
  created?: number;
  origin_message?: string;
  verification?: string;
};

export function requestsForTurn(
  requests: CollaborationProgressRequest[],
  conversation: string | undefined,
  messageId: string | undefined,
  messageCreatedAt: number,
) {
  if (!conversation || !messageCreatedAt) return [];
  return requests.filter(request => request.conversation === conversation && (
    request.origin_message === messageId || (request.created || 0) * 1000 >= messageCreatedAt
  ));
}

export function reviewProgress(
  requests: CollaborationProgressRequest[],
  activityRunning: boolean,
  activityCompleted: boolean,
) {
  const qualityRequests = requests.filter(request => request.recipient === 'testing' || request.verification === 'end_to_end');
  const accepted = requests.filter(request => request.state === 'completed');
  const settled = requests.length > 0 && requests.every(request => ['completed', 'cancelled', 'rejected'].includes(request.state));
  const batchAccepted = settled && accepted.length > 0 && (qualityRequests.length === 0 || qualityRequests.some(request => request.state === 'completed'));
  const checking = activityRunning || requests.some(request => ['queued', 'running', 'blocked', 'review'].includes(request.state));
  return { checking, accepted: activityCompleted || batchAccepted };
}
