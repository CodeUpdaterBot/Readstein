import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import type { HouseholdMember } from '@/types/settings';
import {
  MEMBER_FILTER_EVERYONE,
  MEMBER_FILTER_UNASSIGNED,
  assignMembersToBook,
  bookIsUnassigned,
  bookMatchesMember,
  bookMatchesMemberFilter,
  bookMemberIds,
  createHouseholdMember,
  displayMembersForBook,
  packHouseholdIntoMetadata,
  parseMemberFilter,
  stampBookWithMember,
  stripMemberFromBook,
  unpackHouseholdFromMetadata,
} from '@/services/household';

const book = (over: Partial<Book> = {}): Book => ({
  hash: 'h1',
  format: 'EPUB',
  title: 'T',
  author: 'A',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const alex: HouseholdMember = {
  id: 'alex',
  name: 'Alex',
  color: 'rose',
  createdAt: 1,
};
const sam: HouseholdMember = {
  id: 'sam',
  name: 'Sam',
  color: 'sky',
  createdAt: 2,
};

describe('household filter', () => {
  it('treats books with no member fields as unassigned (legacy migration)', () => {
    const legacy = book();
    expect(bookIsUnassigned(legacy)).toBe(true);
    expect(bookMemberIds(legacy)).toEqual([]);
    expect(bookMatchesMemberFilter(legacy, MEMBER_FILTER_EVERYONE)).toBe(true);
    expect(bookMatchesMemberFilter(legacy, MEMBER_FILTER_UNASSIGNED)).toBe(true);
    expect(bookMatchesMemberFilter(legacy, 'alex')).toBe(false);
  });

  it('matches a person on addedBy or memberIds', () => {
    const added = book({ addedByMemberId: 'alex' });
    const assigned = book({ memberIds: ['sam'] });
    const both = book({ addedByMemberId: 'alex', memberIds: ['sam'] });
    expect(bookMatchesMember(added, 'alex')).toBe(true);
    expect(bookMatchesMember(assigned, 'sam')).toBe(true);
    expect(bookMatchesMember(both, 'alex')).toBe(true);
    expect(bookMatchesMember(both, 'sam')).toBe(true);
    expect(bookMatchesMemberFilter(assigned, 'alex')).toBe(false);
  });

  it('Everyone is a no-op predicate', () => {
    expect(bookMatchesMemberFilter(book({ memberIds: ['alex'] }), MEMBER_FILTER_EVERYONE)).toBe(
      true,
    );
  });
});

describe('household assign + import stamp', () => {
  it('stamps a new book with the current member and skips books that already have one', () => {
    const stamped = stampBookWithMember(book(), 'alex');
    expect(stamped.addedByMemberId).toBe('alex');
    expect(stamped.memberIds).toEqual(['alex']);
    expect(stamped.membersUpdatedAt).toBeGreaterThan(0);

    const already = book({ addedByMemberId: 'sam', memberIds: ['sam'] });
    expect(stampBookWithMember(already, 'alex')).toBe(already);
    expect(stampBookWithMember(book(), null)).toEqual(book());
  });

  it('assigns one book to several people without duplicating the file', () => {
    const shared = assignMembersToBook(book({ addedByMemberId: 'alex' }), ['alex', 'sam']);
    expect(shared.memberIds).toEqual(['alex', 'sam']);
    expect(shared.addedByMemberId).toBe('alex');
    expect(bookMatchesMember(shared, 'alex')).toBe(true);
    expect(bookMatchesMember(shared, 'sam')).toBe(true);
  });

  it('strips a removed member and leaves the book unassigned when they were the last owner', () => {
    const onlyAlex = stripMemberFromBook(
      book({ addedByMemberId: 'alex', memberIds: ['alex'] }),
      'alex',
    );
    expect(onlyAlex.memberIds).toEqual([]);
    expect(onlyAlex.addedByMemberId).toBeUndefined();
    expect(bookIsUnassigned(onlyAlex)).toBe(true);

    const shared = stripMemberFromBook(
      book({ addedByMemberId: 'alex', memberIds: ['alex', 'sam'] }),
      'alex',
    );
    expect(shared.memberIds).toEqual(['sam']);
    expect(shared.addedByMemberId).toBe('sam');
  });
});

describe('household helpers', () => {
  it('parses the URL member filter', () => {
    expect(parseMemberFilter(null)).toBe(MEMBER_FILTER_EVERYONE);
    expect(parseMemberFilter('everyone')).toBe(MEMBER_FILTER_EVERYONE);
    expect(parseMemberFilter('unassigned')).toBe(MEMBER_FILTER_UNASSIGNED);
    expect(parseMemberFilter('alex')).toBe('alex');
  });

  it('creates a member with a stable id and an unused color', () => {
    const member = createHouseholdMember(' Pat ', 'amber', [alex]);
    expect(member.name).toBe('Pat');
    expect(member.color).toBe('amber');
    expect(member.id).toBeTruthy();
  });

  it('resolves living members for a book cover badge', () => {
    const assigned = book({ memberIds: ['alex', 'gone'] });
    expect(displayMembersForBook(assigned, [alex, sam])).toEqual([alex]);
  });

  it('round-trips assignment through the metadata embed used by cloud rows', () => {
    const packed = packHouseholdIntoMetadata(
      { title: 'T', author: 'A', language: 'en' },
      { addedByMemberId: 'alex', memberIds: ['alex'], membersUpdatedAt: 9 },
    );
    expect(packed?.__household?.addedByMemberId).toBe('alex');
    const unpacked = unpackHouseholdFromMetadata(packed);
    expect(unpacked.fields.memberIds).toEqual(['alex']);
    expect(unpacked.metadata?.__household).toBeUndefined();
    expect(unpacked.metadata?.title).toBe('T');
  });

  it('does not invent metadata when unpacking a household-only stub', () => {
    const packed = packHouseholdIntoMetadata(null, {
      addedByMemberId: 'alex',
      memberIds: ['alex'],
      membersUpdatedAt: 1,
    });
    const unpacked = unpackHouseholdFromMetadata(packed);
    expect(unpacked.fields.addedByMemberId).toBe('alex');
    expect(unpacked.metadata).toBeNull();
  });
});
