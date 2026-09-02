import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import {
  applyFolderDissolve,
  applyFolderRename,
  folderLeafName,
  folderParentPath,
  isImmediateChildFolder,
  joinFolderPath,
  nextUntitledFolderPath,
  remapFolderPaths,
  sanitizeFolderSegment,
} from '@/app/library/utils/folderOps';

const book = (overrides: Partial<Book> = {}): Book =>
  ({
    hash: 'h1',
    format: 'EPUB',
    title: 'A',
    author: 'B',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }) as Book;

const idFor = (path: string) => `id:${path}`;

describe('folderOps', () => {
  it('joins and sanitizes folder segments', () => {
    expect(sanitizeFolderSegment('Twyman / Notes')).toBe('Twyman Notes');
    expect(joinFolderPath('Books', 'Twyman')).toBe('Books/Twyman');
    expect(joinFolderPath('', 'Books')).toBe('Books');
    expect(folderLeafName('Books/Twyman')).toBe('Twyman');
    expect(folderParentPath('Books/Twyman')).toBe('Books');
  });

  it('picks the next untitled folder name', () => {
    expect(nextUntitledFolderPath([], '', 'Untitled Folder')).toBe('Untitled Folder 1');
    expect(
      nextUntitledFolderPath(['Untitled Folder 1', 'Untitled Folder 2'], '', 'Untitled Folder'),
    ).toBe('Untitled Folder 3');
    expect(nextUntitledFolderPath(['Books/Untitled Folder 1'], 'Books', 'Untitled Folder')).toBe(
      'Books/Untitled Folder 2',
    );
  });

  it('renames a folder and its nested paths on books', () => {
    const books = [
      book({ hash: 'a', groupName: 'Books/Twyman', groupId: 'old' }),
      book({ hash: 'b', groupName: 'Books/Twyman/Notes', groupId: 'old2' }),
      book({ hash: 'c', groupName: 'Other', groupId: 'x' }),
    ];
    applyFolderRename(books, 'Books/Twyman', 'Books/Jim', idFor);
    expect(books[0]!.groupName).toBe('Books/Jim');
    expect(books[0]!.groupId).toBe('id:Books/Jim');
    expect(books[1]!.groupName).toBe('Books/Jim/Notes');
    expect(books[2]!.groupName).toBe('Other');
  });

  it('dissolves a nested folder into its parent', () => {
    const books = [
      book({ hash: 'a', groupName: 'Books/Twyman', groupId: 'old' }),
      book({ hash: 'b', groupName: 'Books/Twyman/Notes', groupId: 'old2' }),
    ];
    applyFolderDissolve(books, 'Books/Twyman', idFor);
    expect(books[0]!.groupName).toBe('Books');
    expect(books[0]!.groupId).toBe('id:Books');
    expect(books[1]!.groupName).toBe('Books/Notes');
  });

  it('dissolves a root folder back onto the shelf', () => {
    const books = [book({ hash: 'a', groupName: 'Books', groupId: 'old' })];
    applyFolderDissolve(books, 'Books', idFor);
    expect(books[0]!.groupName).toBeUndefined();
    expect(books[0]!.groupId).toBeUndefined();
  });

  it('remaps persisted empty-folder paths', () => {
    expect(
      remapFolderPaths(['Books', 'Books/Twyman', 'Other'], 'Books/Twyman', 'Books/Jim'),
    ).toEqual(['Books', 'Books/Jim', 'Other']);
    expect(remapFolderPaths(['Books', 'Books/Twyman'], 'Books/Twyman', null)).toEqual(['Books']);
    expect(remapFolderPaths(['Books', 'Books/Twyman'], 'Books', null)).toEqual(['Twyman']);
  });

  it('detects immediate child folders', () => {
    expect(isImmediateChildFolder('Books', '')).toBe(true);
    expect(isImmediateChildFolder('Books/Twyman', 'Books')).toBe(true);
    expect(isImmediateChildFolder('Books/Twyman/Notes', 'Books')).toBe(false);
    expect(isImmediateChildFolder('Books/Twyman', '')).toBe(false);
  });
});
