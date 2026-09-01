import type { Book } from '@/types/book';
import type { HouseholdMember, HouseholdMemberColor } from '@/types/settings';

export const HOUSEHOLD_COLORS: readonly HouseholdMemberColor[] = [
  'rose',
  'sky',
  'amber',
  'emerald',
  'violet',
  'orange',
  'teal',
  'slate',
];

export const MEMBER_FILTER_EVERYONE = 'everyone';
export const MEMBER_FILTER_UNASSIGNED = 'unassigned';

export type MemberFilterValue = typeof MEMBER_FILTER_EVERYONE | typeof MEMBER_FILTER_UNASSIGNED | string;

export const HOUSEHOLD_COLOR_CLASSES: Record<
  HouseholdMemberColor,
  { bg: string; text: string; ring: string }
> = {
  rose: { bg: 'bg-rose-200 dark:bg-rose-900/80', text: 'text-rose-800 dark:text-rose-200', ring: 'ring-rose-300/70' },
  sky: { bg: 'bg-sky-200 dark:bg-sky-900/80', text: 'text-sky-800 dark:text-sky-200', ring: 'ring-sky-300/70' },
  amber: {
    bg: 'bg-amber-200 dark:bg-amber-900/80',
    text: 'text-amber-800 dark:text-amber-200',
    ring: 'ring-amber-300/70',
  },
  emerald: {
    bg: 'bg-emerald-200 dark:bg-emerald-900/80',
    text: 'text-emerald-800 dark:text-emerald-200',
    ring: 'ring-emerald-300/70',
  },
  violet: {
    bg: 'bg-violet-200 dark:bg-violet-900/80',
    text: 'text-violet-800 dark:text-violet-200',
    ring: 'ring-violet-300/70',
  },
  orange: {
    bg: 'bg-orange-200 dark:bg-orange-900/80',
    text: 'text-orange-800 dark:text-orange-200',
    ring: 'ring-orange-300/70',
  },
  teal: { bg: 'bg-teal-200 dark:bg-teal-900/80', text: 'text-teal-800 dark:text-teal-200', ring: 'ring-teal-300/70' },
  slate: {
    bg: 'bg-slate-200 dark:bg-slate-800/80',
    text: 'text-slate-800 dark:text-slate-200',
    ring: 'ring-slate-300/70',
  },
};

export const createHouseholdMember = (
  name: string,
  color?: HouseholdMemberColor,
  existing: readonly HouseholdMember[] = [],
): HouseholdMember => {
  const used = new Set(existing.map((member) => member.color));
  const nextColor =
    color ?? HOUSEHOLD_COLORS.find((token) => !used.has(token)) ?? HOUSEHOLD_COLORS[existing.length % HOUSEHOLD_COLORS.length]!;
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    color: nextColor,
    createdAt: Date.now(),
  };
};

export const memberInitial = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed.charAt(0).toUpperCase();
};

export const bookMemberIds = (book: Book): string[] => {
  const assigned = book.memberIds?.filter(Boolean) ?? [];
  if (assigned.length > 0) return assigned;
  return book.addedByMemberId ? [book.addedByMemberId] : [];
};

export const bookIsUnassigned = (book: Book): boolean => bookMemberIds(book).length === 0;

export const bookMatchesMember = (book: Book, memberId: string): boolean => {
  if (book.addedByMemberId === memberId) return true;
  return (book.memberIds ?? []).includes(memberId);
};

export const parseMemberFilter = (value: string | null | undefined): MemberFilterValue => {
  if (!value || value === MEMBER_FILTER_EVERYONE) return MEMBER_FILTER_EVERYONE;
  if (value === MEMBER_FILTER_UNASSIGNED) return MEMBER_FILTER_UNASSIGNED;
  return value;
};

export const bookMatchesMemberFilter = (book: Book, filter: MemberFilterValue): boolean => {
  if (filter === MEMBER_FILTER_EVERYONE) return true;
  if (filter === MEMBER_FILTER_UNASSIGNED) return bookIsUnassigned(book);
  return bookMatchesMember(book, filter);
};

export const stampBookWithMember = (book: Book, memberId: string | null | undefined): Book => {
  if (!memberId) return book;
  if (book.addedByMemberId || (book.memberIds && book.memberIds.length > 0)) return book;
  const now = Date.now();
  return {
    ...book,
    addedByMemberId: memberId,
    memberIds: [memberId],
    membersUpdatedAt: now,
    updatedAt: now,
  };
};

export const assignMembersToBook = (
  book: Book,
  memberIds: string[],
  addedByMemberId?: string | null,
): Book => {
  const now = Date.now();
  const unique = Array.from(new Set(memberIds.filter(Boolean)));
  return {
    ...book,
    memberIds: unique,
    addedByMemberId: addedByMemberId === undefined ? book.addedByMemberId : addedByMemberId || undefined,
    membersUpdatedAt: now,
    updatedAt: now,
  };
};

export const displayMembersForBook = (
  book: Book,
  household: readonly HouseholdMember[],
): HouseholdMember[] => {
  const ids = bookMemberIds(book);
  return ids
    .map((id) => household.find((member) => member.id === id))
    .filter((member): member is HouseholdMember => !!member);
};

export const householdHasMembers = (household: readonly HouseholdMember[] | undefined | null): boolean =>
  (household?.length ?? 0) > 0;

export type HouseholdBookFields = {
  addedByMemberId?: string;
  memberIds?: string[];
  membersUpdatedAt?: number | null;
};

const hasHouseholdFields = (fields: HouseholdBookFields): boolean =>
  !!fields.addedByMemberId ||
  (fields.memberIds !== undefined && fields.memberIds.length > 0) ||
  fields.membersUpdatedAt != null;

/** Embed assignment in metadata JSON so cloud rows without columns still keep it. */
export const packHouseholdIntoMetadata = (
  metadata: Book['metadata'] | null | undefined,
  fields: HouseholdBookFields,
): Book['metadata'] | null | undefined => {
  if (!hasHouseholdFields(fields)) {
    if (!metadata) return metadata;
    if (!metadata.__household) return metadata;
    const { __household: _drop, ...rest } = metadata;
    return rest;
  }
  return {
    ...(metadata ?? { title: '', author: '', language: '' }),
    __household: {
      addedByMemberId: fields.addedByMemberId,
      memberIds: fields.memberIds,
      membersUpdatedAt: fields.membersUpdatedAt,
    },
  };
};

/** Lift assignment off metadata after a cloud pull and strip the private key. */
export const unpackHouseholdFromMetadata = (
  metadata: Book['metadata'] | null | undefined,
): { fields: HouseholdBookFields; metadata: Book['metadata'] | null } => {
  if (!metadata) return { fields: {}, metadata: null };
  const { __household, ...rest } = metadata;
  const leftover = rest as Book['metadata'];
  const injectedStub =
    leftover &&
    !leftover.title &&
    !leftover.author &&
    !leftover.language &&
    !leftover.identifier &&
    !leftover.description;
  return { fields: __household ?? {}, metadata: injectedStub ? null : leftover };
};

export const stripMemberFromBook = (book: Book, memberId: string): Book => {
  const hadAddedBy = book.addedByMemberId === memberId;
  const hadAssigned = (book.memberIds ?? []).includes(memberId);
  if (!hadAddedBy && !hadAssigned) return book;
  const remaining = (book.memberIds ?? []).filter((id) => id !== memberId);
  const now = Date.now();
  return {
    ...book,
    memberIds: remaining,
    addedByMemberId: hadAddedBy ? remaining[0] : book.addedByMemberId,
    membersUpdatedAt: now,
    updatedAt: now,
  };
};
