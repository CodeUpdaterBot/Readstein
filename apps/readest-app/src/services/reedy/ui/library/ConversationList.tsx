'use client';

import { useState } from 'react';
import { Check, MessageSquarePlus, Pencil, Trash2, X } from 'lucide-react';
import type { ConversationSummary } from '../../db/ReedyDb';

/**
 * Stored library conversations: pick one to resume it, start a new one, rename
 * or delete. Matches the app's language — the same `/60` muted text, `base-200`
 * hover and small ghost icon buttons the rest of the chat pane uses, with the
 * row actions revealed on hover so the list stays quiet at rest.
 */
export function ConversationList({
  conversations,
  currentId,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: {
  conversations: ConversationSummary[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const commit = (id: string) => {
    onRename(id, draft.trim() || 'Untitled');
    setEditingId(null);
  };

  return (
    <div className='border-base-content/10 bg-base-100 flex h-full w-60 shrink-0 flex-col border-e'>
      <div className='flex shrink-0 items-center justify-between px-3 py-2'>
        <span className='text-base-content/50 text-[11px] uppercase'>Conversations</span>
        <button
          type='button'
          onClick={onNew}
          aria-label='New chat'
          title='New chat'
          className='text-base-content/60 hover:text-base-content flex size-6 items-center justify-center rounded-full'
        >
          <MessageSquarePlus className='size-4' />
        </button>
      </div>

      <div className='min-h-0 flex-1 overflow-auto px-1.5 pb-2'>
        {conversations.length === 0 ? (
          <p className='text-base-content/45 px-1.5 py-2 text-[11px]'>No conversations yet.</p>
        ) : (
          conversations.map((c) => (
            <div
              key={c.id}
              className={`group hover:bg-base-200/60 flex items-center gap-1 rounded-md px-1.5 py-1 ${
                c.id === currentId ? 'bg-base-200/60' : ''
              }`}
            >
              {editingId === c.id ? (
                <>
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commit(c.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className='bg-base-100 text-base-content min-w-0 flex-1 rounded px-1 text-xs'
                  />
                  <button
                    type='button'
                    aria-label='Save name'
                    onClick={() => commit(c.id)}
                    className='text-base-content/60 hover:text-base-content flex size-5 items-center justify-center'
                  >
                    <Check className='size-3.5' />
                  </button>
                  <button
                    type='button'
                    aria-label='Cancel rename'
                    onClick={() => setEditingId(null)}
                    className='text-base-content/60 hover:text-base-content flex size-5 items-center justify-center'
                  >
                    <X className='size-3.5' />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type='button'
                    onClick={() => onSelect(c.id)}
                    title={c.title ?? 'Untitled'}
                    className='text-base-content min-w-0 flex-1 truncate text-start text-xs'
                  >
                    {c.title ?? 'Untitled'}
                  </button>
                  <button
                    type='button'
                    aria-label='Rename conversation'
                    title='Rename'
                    onClick={() => {
                      setEditingId(c.id);
                      setDraft(c.title ?? '');
                    }}
                    className='text-base-content/40 hover:text-base-content flex size-5 items-center justify-center opacity-0 group-hover:opacity-100'
                  >
                    <Pencil className='size-3' />
                  </button>
                  <button
                    type='button'
                    aria-label='Delete conversation'
                    title='Delete'
                    onClick={() => onDelete(c.id)}
                    className='text-base-content/40 flex size-5 items-center justify-center opacity-0 group-hover:text-red-500 group-hover:opacity-100'
                  >
                    <Trash2 className='size-3' />
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
