import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useSettingsStore } from '@/store/settingsStore';
import { bookMemberIds } from '@/services/household';
import { HOUSEHOLD_COLOR_CLASSES, memberInitial } from '@/services/household';
import type { Book } from '@/types/book';
import ModalPortal from '@/components/ModalPortal';

interface AssignHouseholdModalProps {
  books: Book[];
  onCancel: () => void;
  onConfirm: (memberIds: string[]) => void;
}

const AssignHouseholdModal: React.FC<AssignHouseholdModalProps> = ({
  books,
  onCancel,
  onConfirm,
}) => {
  const _ = useTranslation();
  const members = useSettingsStore((s) => s.settings.householdMembers) ?? [];
  const initial = useMemo(() => {
    if (books.length === 1) return bookMemberIds(books[0]!);
    const counts = new Map<string, number>();
    for (const book of books) {
      for (const id of bookMemberIds(book)) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return members.filter((member) => counts.get(member.id) === books.length).map((m) => m.id);
  }, [books, members]);
  const [selected, setSelected] = useState<string[]>(initial);
  const divRef = useKeyDownActions({ onCancel, onConfirm: () => onConfirm(selected) });

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  return (
    <ModalPortal>
      <div className='fixed inset-0 z-50 flex items-center justify-center'>
        <button
          type='button'
          className='absolute inset-0 bg-black/50'
          aria-label={_('Cancel')}
          onClick={onCancel}
        />
        <div
          ref={divRef}
          role='dialog'
          aria-labelledby='assign-household-title'
          className={clsx(
            'modal-box bg-base-100 relative z-10 overflow-hidden rounded-2xl shadow-xl',
            'w-[92%] min-w-64 max-w-[400px] p-6',
          )}
        >
          <h2 id='assign-household-title' className='text-center text-lg font-bold'>
            {_('Assign to…')}
          </h2>
          <p className='text-base-content/60 mt-1 text-center text-xs'>
            {_('{{count}} book(s)', { count: books.length })}
          </p>
          <ul className='mt-4 flex flex-col gap-1'>
            {members.map((member) => {
              const colors = HOUSEHOLD_COLOR_CLASSES[member.color];
              const checked = selected.includes(member.id);
              return (
                <li key={member.id}>
                  <label className='hover:bg-base-200 flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2'>
                    <input
                      type='checkbox'
                      className='checkbox checkbox-sm'
                      checked={checked}
                      onChange={() => toggle(member.id)}
                    />
                    <span
                      className={clsx(
                        'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold uppercase',
                        colors.bg,
                        colors.text,
                      )}
                    >
                      {memberInitial(member.name)}
                    </span>
                    <span className='min-w-0 flex-1 truncate'>{member.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className='mt-6 flex justify-end gap-3'>
            <button type='button' className='hover:bg-base-200 rounded-md px-4 py-2' onClick={onCancel}>
              {_('Cancel')}
            </button>
            <button
              type='button'
              className='rounded-md bg-green-500 px-4 py-2 text-white hover:bg-green-600'
              onClick={() => onConfirm(selected)}
            >
              {_('Save')}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};

export default AssignHouseholdModal;
