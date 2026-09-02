import type { Book, BooksGroup } from '@/types/book';
import { BOOK_UNGROUPED_ID, BOOK_UNGROUPED_NAME } from '@/services/constants';
import { md5Fingerprint } from '@/utils/md5';

export const folderLeafName = (fullPath: string): string => {
  const parts = fullPath.split('/').filter(Boolean);
  return parts[parts.length - 1] || fullPath;
};

export const folderParentPath = (fullPath: string): string => {
  const lastSlash = fullPath.lastIndexOf('/');
  return lastSlash === -1 ? '' : fullPath.slice(0, lastSlash);
};

/** Reject path separators so a rename cannot accidentally nest. */
export const sanitizeFolderSegment = (name: string): string =>
  name
    .replaceAll(/[/\\]+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();

export const joinFolderPath = (parent: string, segment: string): string => {
  const leaf = sanitizeFolderSegment(segment);
  if (!leaf) return '';
  return parent ? `${parent}/${leaf}` : leaf;
};

export const nextUntitledFolderPath = (
  existingPaths: string[],
  parent: string,
  baseName: string,
): string => {
  const prefix = joinFolderPath(parent, baseName) || baseName;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}(?:\\s+(\\d+))?$`);
  const numbers = existingPaths
    .map((path) => {
      const match = path.match(re);
      return match ? parseInt(match[1] || '1', 10) : null;
    })
    .filter((n): n is number => n !== null);
  const next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  return `${prefix} ${next}`;
};

export const remapFolderPaths = (
  paths: string[],
  oldName: string,
  newName: string | null,
): string[] => {
  const parent = folderParentPath(oldName);
  const next: string[] = [];
  for (const path of paths) {
    if (path === oldName) {
      if (newName) next.push(newName);
    } else if (path.startsWith(`${oldName}/`)) {
      const rest = path.slice(oldName.length + 1);
      if (newName) next.push(`${newName}/${rest}`);
      else next.push(parent ? `${parent}/${rest}` : rest);
    } else {
      next.push(path);
    }
  }
  return [...new Set(next.filter(Boolean))];
};

export const applyFolderRename = (
  books: Book[],
  oldName: string,
  newName: string,
  getGroupId: (path: string) => string,
): Book[] => {
  const now = Date.now();
  for (const book of books) {
    if (book.deletedAt || !book.groupName) continue;
    if (book.groupName === oldName) {
      book.groupName = newName;
      book.groupId = getGroupId(newName);
      book.updatedAt = now;
    } else if (book.groupName.startsWith(`${oldName}/`)) {
      book.groupName = newName + book.groupName.slice(oldName.length);
      book.groupId = getGroupId(book.groupName);
      book.updatedAt = now;
    }
  }
  return books;
};

/** Lift this folder’s books and nested folders one level (remove the folder, keep contents). */
export const applyFolderDissolve = (
  books: Book[],
  groupName: string,
  getGroupId: (path: string) => string,
): Book[] => {
  const parent = folderParentPath(groupName);
  const now = Date.now();
  for (const book of books) {
    if (book.deletedAt || !book.groupName) continue;
    if (book.groupName === groupName) {
      if (parent) {
        book.groupName = parent;
        book.groupId = getGroupId(parent);
      } else {
        book.groupName = undefined;
        book.groupId = undefined;
      }
      book.updatedAt = now;
    } else if (book.groupName.startsWith(`${groupName}/`)) {
      const rest = book.groupName.slice(groupName.length + 1);
      book.groupName = parent ? `${parent}/${rest}` : rest;
      book.groupId = getGroupId(book.groupName);
      book.updatedAt = now;
    }
  }
  return books;
};

export const emptyFolderAsGroup = (id: string, fullPath: string): BooksGroup => ({
  id,
  name: fullPath,
  displayName: folderLeafName(fullPath),
  books: [],
  updatedAt: Date.now(),
});

export const isImmediateChildFolder = (fullPath: string, parentPath: string): boolean => {
  if (!fullPath || fullPath === BOOK_UNGROUPED_NAME) return false;
  if (!parentPath) return !fullPath.includes('/');
  if (!fullPath.startsWith(`${parentPath}/`)) return false;
  const rest = fullPath.slice(parentPath.length + 1);
  return rest.length > 0 && !rest.includes('/');
};

export const ungroupedId = BOOK_UNGROUPED_ID;
export const ungroupedName = BOOK_UNGROUPED_NAME;
export const folderIdForPath = (path: string): string => md5Fingerprint(path);
