import clsx from 'clsx';
import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { saveSysSettings } from '@/helpers/settings';
import { navigateToLibrary } from '@/utils/nav';
import {
  HOUSEHOLD_COLOR_CLASSES,
  MEMBER_FILTER_EVERYONE,
  MEMBER_FILTER_UNASSIGNED,
  memberInitial,
  parseMemberFilter,
  type MemberFilterValue,
} from '@/services/household';

const pillClass = (active: boolean) =>
  clsx(
    'max-w-[60%] flex-shrink-0 whitespace-nowrap rounded-full px-3 py-0.5 text-xs',
    active
      ? 'bg-base-content/15 text-base-content'
      : 'bg-base-300/45 hover:bg-base-300/70 text-base-content/70',
  );

/**
 * Everyone / person / Unassigned pills under the library header.
 * Invisible until the household has at least one member.
 */
const LibraryMemberFilter: React.FC = () => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const members = settings.householdMembers ?? [];

  const urlFilter = searchParams?.get('member');
  const active = parseMemberFilter(urlFilter ?? settings.libraryHouseholdFilter);

  const applyFilter = useCallback(
    async (value: MemberFilterValue) => {
      const params = new URLSearchParams(window.location.search);
      if (value === MEMBER_FILTER_EVERYONE) {
        params.delete('member');
      } else {
        params.set('member', value);
      }
      navigateToLibrary(router, params.toString());
      await saveSysSettings(envConfig, 'libraryHouseholdFilter', value);
      if (value !== MEMBER_FILTER_EVERYONE && value !== MEMBER_FILTER_UNASSIGNED) {
        await saveSysSettings(envConfig, 'currentHouseholdMemberId', value);
      }
    },
    [envConfig, router],
  );

  const openManage = () => {
    const { setRequestedPanel, setActiveSettingsItemId, setSettingsDialogOpen } =
      useSettingsStore.getState();
    setRequestedPanel('Theme');
    setActiveSettingsItemId('settings.library.household');
    setSettingsDialogOpen(true);
  };

  if (members.length === 0) return null;

  return (
    <div className='relative my-1 flex shrink-0 items-center px-4 sm:px-6'>
      <div
        className='no-scrollbar not-eink:[mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%_-_12px),transparent)] flex flex-1 gap-1.5 overflow-x-auto'
        role='tablist'
        aria-label={_('Household')}
      >
        <button
          type='button'
          role='tab'
          aria-selected={active === MEMBER_FILTER_EVERYONE}
          className={pillClass(active === MEMBER_FILTER_EVERYONE)}
          onClick={() => void applyFilter(MEMBER_FILTER_EVERYONE)}
        >
          {_('Everyone')}
        </button>
        {members.map((member) => {
          const colors = HOUSEHOLD_COLOR_CLASSES[member.color];
          const selected = active === member.id;
          return (
            <button
              key={member.id}
              type='button'
              role='tab'
              aria-selected={selected}
              className={clsx(pillClass(selected), 'inline-flex items-center gap-1.5')}
              onClick={() => void applyFilter(member.id)}
            >
              <span
                className={clsx(
                  'inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold uppercase',
                  colors.bg,
                  colors.text,
                )}
                aria-hidden
              >
                {memberInitial(member.name)}
              </span>
              <span className='truncate'>{member.name}</span>
            </button>
          );
        })}
        <button
          type='button'
          role='tab'
          aria-selected={active === MEMBER_FILTER_UNASSIGNED}
          className={pillClass(active === MEMBER_FILTER_UNASSIGNED)}
          onClick={() => void applyFilter(MEMBER_FILTER_UNASSIGNED)}
        >
          {_('Unassigned')}
        </button>
        <button type='button' className={pillClass(false)} onClick={openManage}>
          {_('Manage')}
        </button>
      </div>
    </div>
  );
};

export default LibraryMemberFilter;
