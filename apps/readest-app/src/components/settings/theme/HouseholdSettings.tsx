import clsx from 'clsx';
import { useState } from 'react';
import { MdAdd, MdClose } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { saveSysSettings } from '@/helpers/settings';
import {
  HOUSEHOLD_COLOR_CLASSES,
  HOUSEHOLD_COLORS,
  createHouseholdMember,
  memberInitial,
  stripMemberFromBook,
} from '@/services/household';
import type { HouseholdMember, HouseholdMemberColor } from '@/types/settings';
import { BoxedList, SettingsInput, SettingsRow, Tips } from '../primitives';

interface HouseholdSettingsProps {
  'data-setting-id'?: string;
}

const HouseholdSettings: React.FC<HouseholdSettingsProps> = ({
  'data-setting-id': dataSettingId,
}) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const members = settings.householdMembers ?? [];
  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState<HouseholdMemberColor | undefined>(undefined);

  const persistMembers = async (next: HouseholdMember[]) => {
    await saveSysSettings(envConfig, 'householdMembers', next);
    const current = useSettingsStore.getState().settings.currentHouseholdMemberId;
    if (current && !next.some((member) => member.id === current)) {
      await saveSysSettings(envConfig, 'currentHouseholdMemberId', next[0]?.id ?? null);
    }
    const filter = useSettingsStore.getState().settings.libraryHouseholdFilter;
    if (filter && filter !== 'everyone' && filter !== 'unassigned') {
      if (!next.some((member) => member.id === filter)) {
        await saveSysSettings(envConfig, 'libraryHouseholdFilter', 'everyone');
      }
    }
  };

  const handleAdd = async () => {
    const name = draftName.trim();
    if (!name) return;
    const member = createHouseholdMember(name, draftColor, members);
    await persistMembers([...members, member]);
    if (!settings.currentHouseholdMemberId) {
      await saveSysSettings(envConfig, 'currentHouseholdMemberId', member.id);
    }
    setDraftName('');
    setDraftColor(undefined);
  };

  const handleRename = async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await persistMembers(
      members.map((member) => (member.id === id ? { ...member, name: trimmed } : member)),
    );
  };

  const handleColor = async (id: string, color: HouseholdMemberColor) => {
    await persistMembers(
      members.map((member) => (member.id === id ? { ...member, color } : member)),
    );
  };

  const handleRemove = async (id: string) => {
    await persistMembers(members.filter((member) => member.id !== id));
    const { library, updateBooks } = useLibraryStore.getState();
    const changed = library.filter(
      (book) => book.addedByMemberId === id || (book.memberIds ?? []).includes(id),
    );
    if (changed.length > 0) {
      const next = library.map((book) => stripMemberFromBook(book, id));
      await updateBooks(envConfig, next);
    }
  };

  return (
    <BoxedList title={_('Household')} data-setting-id={dataSettingId}>
      <SettingsRow
        label={_('People')}
        description={_('One library on this PC. Filter by who added or owns a book.')}
        align='start'
        asLabel={false}
      >
        <span className='text-base-content/50 text-xs'>{members.length}</span>
      </SettingsRow>
      {members.map((member) => {
        const colors = HOUSEHOLD_COLOR_CLASSES[member.color];
        return (
          <div key={member.id} className='flex flex-col gap-2 px-4 py-2'>
            <div className='flex items-center gap-2'>
              <span
                className={clsx(
                  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold uppercase',
                  colors.bg,
                  colors.text,
                )}
              >
                {memberInitial(member.name)}
              </span>
              <SettingsInput
                defaultValue={member.name}
                aria-label={_('Name')}
                className='!max-w-none !flex-1 !text-start'
                onBlur={(event) => void handleRename(member.id, event.target.value)}
              />
              <button
                type='button'
                className='text-base-content/50 hover:text-error btn btn-ghost btn-xs'
                aria-label={_('Remove {{name}}', { name: member.name })}
                onClick={() => void handleRemove(member.id)}
              >
                <MdClose className='h-4 w-4' />
              </button>
            </div>
            <div className='flex flex-wrap gap-1.5 ps-9'>
              {HOUSEHOLD_COLORS.map((token) => (
                <button
                  key={token}
                  type='button'
                  title={token}
                  aria-label={token}
                  aria-pressed={member.color === token}
                  className={clsx(
                    'h-5 w-5 rounded-full',
                    HOUSEHOLD_COLOR_CLASSES[token].bg,
                    member.color === token && 'ring-base-content/40 ring-2',
                  )}
                  onClick={() => void handleColor(member.id, token)}
                />
              ))}
            </div>
          </div>
        );
      })}
      <div className='flex flex-col gap-2 px-4 py-3'>
        <div className='flex items-center gap-2'>
          <SettingsInput
            value={draftName}
            placeholder={_('Add a person')}
            aria-label={_('Add a person')}
            className='!max-w-none !flex-1 !text-start'
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleAdd();
            }}
          />
          <button
            type='button'
            className='btn btn-ghost btn-sm'
            disabled={!draftName.trim()}
            onClick={() => void handleAdd()}
          >
            <MdAdd className='h-4 w-4' />
            {_('Add')}
          </button>
        </div>
        <div className='flex flex-wrap gap-1.5'>
          {HOUSEHOLD_COLORS.map((token) => (
            <button
              key={token}
              type='button'
              title={token}
              aria-label={token}
              aria-pressed={draftColor === token}
              className={clsx(
                'h-5 w-5 rounded-full',
                HOUSEHOLD_COLOR_CLASSES[token].bg,
                draftColor === token && 'ring-base-content/40 ring-2',
              )}
              onClick={() => setDraftColor(token)}
            />
          ))}
        </div>
      </div>
      {members.length === 0 && (
        <div className='px-4 pb-4'>
          <Tips>
            <li>
              {_(
                'Add names, then new imports attach to the selected person. Filter the shelf with the pills under the header.',
              )}
            </li>
          </Tips>
        </div>
      )}
    </BoxedList>
  );
};

export default HouseholdSettings;
