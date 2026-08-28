import { CheckCheck, MessageSquare, User, Hash, FolderKanban, MessageCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn, initials, isClientRole } from '../lib/utils';
import type { ChatMessage, Conversation, Profile, TrackerData } from '../lib/types';
import { Button, IconButton } from './ui';

function timeAgo(value: string) {
  const createdAt = new Date(value).getTime();
  const now = Date.now();
  const diffMinutes = Math.max(Math.floor((now - createdAt) / 60000), 0);

  if (diffMinutes < 1) {
    return 'Just now';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

export interface UnreadConversationItem {
  conversationId: string;
  conversationName: string;
  conversationType: string;
  lastMessage: ChatMessage;
  senderName: string;
  unreadCount: number;
}

export function getUnreadMessagesInfo(
  currentProfile: Profile,
  data: TrackerData,
) {
  const conversations = data.conversations || [];
  const conversationMembers = data.conversationMembers || [];
  const messages = data.messages || [];
  const profiles = data.profiles || [];
  const projects = data.projects || [];
  const isClient = isClientRole(currentProfile.role);

  const accessibleConvs = conversations.filter((c) => {
    if (isClient) return c.type === 'project_client';
    return true;
  });

  const unreadItems: UnreadConversationItem[] = [];
  let totalUnreadCount = 0;

  accessibleConvs.forEach((conv) => {
    const member = conversationMembers.find(
      (m) => m.conversation_id === conv.id && m.user_id === currentProfile.id,
    );
    const lastReadAt = member?.last_read_at ? new Date(member.last_read_at).getTime() : 0;

    const unreadMsgs = messages.filter(
      (m) =>
        m.conversation_id === conv.id &&
        m.sender_id !== currentProfile.id &&
        new Date(m.created_at).getTime() > lastReadAt,
    );

    if (unreadMsgs.length > 0) {
      totalUnreadCount += unreadMsgs.length;
      const lastMsg = unreadMsgs[unreadMsgs.length - 1];
      const sender = profiles.find((p) => p.id === lastMsg.sender_id);

      let name = conv.name ? `#${conv.name}` : 'Conversation';
      if (conv.type === 'dm') {
        const otherMember = conversationMembers.find(
          (m) => m.conversation_id === conv.id && m.user_id !== currentProfile.id,
        );
        const otherUser = profiles.find((p) => p.id === otherMember?.user_id);
        name = otherUser ? `@${otherUser.full_name}` : 'Direct Message';
      } else if (conv.project_id) {
        const proj = projects.find((p) => p.id === conv.project_id);
        name = proj ? `${proj.project_title} (${conv.type === 'project_internal' ? 'Internal' : 'Client'})` : 'Project Discussion';
      }

      unreadItems.push({
        conversationId: conv.id,
        conversationName: name,
        conversationType: conv.type,
        lastMessage: lastMsg,
        senderName: sender?.full_name || 'Team Member',
        unreadCount: unreadMsgs.length,
      });
    }
  });

  unreadItems.sort((a, b) => new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime());

  return { totalUnreadCount, unreadItems };
}

export function MessageNotificationBell({
  currentProfile,
  data,
  onMarkRead,
  onOpenConversation,
  onViewAllMessages,
}: {
  currentProfile: Profile;
  data: TrackerData;
  onMarkRead: (conversationId: string) => void;
  onOpenConversation: (conversationId: string) => void;
  onViewAllMessages: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { totalUnreadCount, unreadItems } = useMemo(
    () => getUnreadMessagesInfo(currentProfile, data),
    [currentProfile, data],
  );

  useEffect(() => {
    if (!isOpen) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [isOpen]);

  const handleItemClick = (item: UnreadConversationItem) => {
    onMarkRead(item.conversationId);
    onOpenConversation(item.conversationId);
    setIsOpen(false);
  };

  const handleMarkAllRead = () => {
    unreadItems.forEach((item) => {
      onMarkRead(item.conversationId);
    });
  };

  return (
    <div ref={containerRef} className="relative">
      <IconButton
        title={`${totalUnreadCount} unread message notifications`}
        className="relative"
        onClick={() => setIsOpen((open) => !open)}
      >
        <MessageSquare className="h-4 w-4" />
        {totalUnreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-gold px-1.5 py-0.5 text-[10px] font-bold leading-none text-ink shadow-sm">
            {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
          </span>
        ) : null}
      </IconButton>

      {isOpen ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-white shadow-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 bg-linen/30">
            <div>
              <p className="font-display text-lg font-semibold text-ink">Messages</p>
              <p className="text-xs text-muted">{totalUnreadCount} unread message{totalUnreadCount === 1 ? '' : 's'}</p>
            </div>
            {totalUnreadCount > 0 ? (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="flex items-center gap-1 text-xs font-semibold text-gold hover:underline"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-border/60">
            {unreadItems.length > 0 ? (
              unreadItems.map((item) => (
                <button
                  key={item.conversationId}
                  type="button"
                  onClick={() => handleItemClick(item)}
                  className="flex w-full items-start gap-3 p-3.5 text-left transition hover:bg-ivory/60"
                >
                  <div className="relative shrink-0 mt-0.5">
                    <div className="grid h-8 w-8 place-items-center rounded-full bg-gold/20 text-xs font-bold text-ink">
                      {initials(item.senderName)}
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-gold ring-2 ring-white" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-bold text-ink">{item.conversationName}</p>
                      <span className="shrink-0 text-[10px] text-muted">{timeAgo(item.lastMessage.created_at)}</span>
                    </div>

                    <p className="truncate text-xs text-ink/80 mt-0.5">
                      <span className="font-semibold text-ink">{item.senderName}: </span>
                      {item.lastMessage.body}
                    </p>

                    {item.unreadCount > 1 ? (
                      <span className="mt-1 inline-block rounded bg-gold/15 px-1.5 py-0.5 text-[10px] font-bold text-ink">
                        {item.unreadCount} new messages
                      </span>
                    ) : null}
                  </div>
                </button>
              ))
            ) : (
              <div className="p-8 text-center">
                <MessageCircle className="mx-auto h-8 w-8 text-muted/40" />
                <p className="mt-2 text-sm font-semibold text-ink">No unread messages</p>
                <p className="text-xs text-muted mt-1">All your team and client conversations are up to date.</p>
              </div>
            )}
          </div>

          <div className="border-t border-border p-2 bg-linen/20">
            <Button
              variant="ghost"
              className="w-full text-xs font-bold text-ink hover:text-gold"
              onClick={() => {
                onViewAllMessages();
                setIsOpen(false);
              }}
            >
              Open Messages
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
