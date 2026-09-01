import clsx from 'clsx';
import type { HouseholdMember } from '@/types/settings';
import { HOUSEHOLD_COLOR_CLASSES, memberInitial } from '@/services/household';

interface HouseholdMemberBadgeProps {
  members: readonly HouseholdMember[];
  /** Compact cover-corner badge vs. title-panel initial. */
  size?: 'cover' | 'title';
  className?: string;
}

/**
 * Tiny initial (or stacked dots) for a book's household assignment.
 * Hidden when there are no living members to display.
 */
const HouseholdMemberBadge: React.FC<HouseholdMemberBadgeProps> = ({
  members,
  size = 'cover',
  className,
}) => {
  if (members.length === 0) return null;

  const cover = size === 'cover';
  const visible = members.slice(0, 2);
  const overflow = members.length - visible.length;

  if (members.length === 1) {
    const member = members[0]!;
    const colors = HOUSEHOLD_COLOR_CLASSES[member.color];
    return (
      <span
        title={member.name}
        className={clsx(
          'inline-flex items-center justify-center rounded-full font-bold uppercase leading-none',
          cover ? 'h-3.5 w-3.5 text-[8px]' : 'h-4 w-4 text-[9px]',
          colors.bg,
          colors.text,
          className,
        )}
        aria-label={member.name}
      >
        {memberInitial(member.name)}
      </span>
    );
  }

  return (
    <span
      className={clsx('inline-flex items-center', className)}
      title={members.map((member) => member.name).join(', ')}
    >
      {visible.map((member, index) => {
        const colors = HOUSEHOLD_COLOR_CLASSES[member.color];
        return (
          <span
            key={member.id}
            className={clsx(
              'inline-block rounded-full ring-1 ring-base-100',
              cover ? 'h-2 w-2' : 'h-2.5 w-2.5',
              colors.bg,
              index > 0 && '-ms-0.5',
            )}
            aria-hidden
          />
        );
      })}
      {overflow > 0 && (
        <span className='text-base-content/70 ms-0.5 text-[8px] font-bold leading-none'>
          +{overflow}
        </span>
      )}
    </span>
  );
};

export default HouseholdMemberBadge;
