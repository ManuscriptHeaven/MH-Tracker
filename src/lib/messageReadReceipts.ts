/**
 * Read receipts are independent: one inaccessible/stale conversation should
 * never block the rest. Confirm the server result before clearing UI badges.
 */
export async function markUnreadConversationsRead(
  conversationIds: string[],
  onMarkRead: (conversationId: string) => Promise<void>,
): Promise<{ succeeded: string[]; failed: string[] }> {
  const uniqueIds = [...new Set(conversationIds.filter(Boolean))];
  const settled = await Promise.allSettled(uniqueIds.map(id => onMarkRead(id)));
  return {
    succeeded: uniqueIds.filter((_, index) => settled[index].status === 'fulfilled'),
    failed: uniqueIds.filter((_, index) => settled[index].status === 'rejected'),
  };
}
