import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { HouseholdMember } from '@/types/settings';
import HouseholdMemberBadge from '@/app/library/components/HouseholdMemberBadge';

const alex: HouseholdMember = { id: 'alex', name: 'Alex', color: 'rose', createdAt: 1 };
const sam: HouseholdMember = { id: 'sam', name: 'Sam', color: 'sky', createdAt: 2 };
const pat: HouseholdMember = { id: 'pat', name: 'Pat', color: 'amber', createdAt: 3 };

afterEach(() => cleanup());

describe('HouseholdMemberBadge', () => {
  it('renders nothing when no members are assigned', () => {
    const { container } = render(<HouseholdMemberBadge members={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the initial for a single member', () => {
    render(<HouseholdMemberBadge members={[alex]} />);
    expect(screen.getByLabelText('Alex').textContent).toBe('A');
  });

  it('stacks dots and a plus for more than two members', () => {
    const { container } = render(<HouseholdMemberBadge members={[alex, sam, pat]} />);
    expect(container.textContent).toContain('+1');
  });
});
