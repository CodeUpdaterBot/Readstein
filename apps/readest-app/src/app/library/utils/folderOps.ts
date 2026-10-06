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

/** Final segment of a path, treating `/` and `\` alike as separators. */
export const fileLeafName = (filePath: string): string => {
  const last = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return filePath.slice(last + 1);
};

/**
 * Where a book's file lands when it leaves its folder: the sibling directory one
 * level up, keeping the file's own name. Null when there is no path, or when the
 * path has no parent to move into. Separators are preserved exactly as they appear
 * in `filePath`, so a Windows path stays a Windows path.
 */
export const moveOutFileDestination = (filePath?: string): string | null => {
  if (!filePath) return null;
  const isSeparator = (char: string) => char === '/' || char === '\\';
  let last = -1;
  let previous = -1;
  for (let i = filePath.length - 1; i >= 0; i--) {
    if (!isSeparator(filePath[i]!)) continue;
    if (last === -1) last = i;
    else {
      previous = i;
      break;
    }
  }
  // `previous < 0` means the file sits at a drive or share root: nowhere to go.
  if (last <= 0 || previous < 0) return null;
  return filePath.slice(0, previous) + filePath.slice(last);
};

/**
 * The read-in-place root a path belongs to, if any. Only files under a root the
 * user reads in place have a directory tree the library mirrors, so only those may
 * be moved on disk — a copy held in the app's own storage has no folder to follow.
 */
export const inPlaceRootFor = (filePath: string, roots: string[]): string | undefined => {
  const normalized = filePath.replace(/\\/g, '/');
  return roots
    .map((root) => root.replace(/\\/g, '/').replace(/\/+$/, ''))
    .find((root) => normalized.startsWith(`${root}/`));
};

/**
 * Lift a single book one level, out of its own folder and into its parent — the
 * one-book counterpart of {@link applyFolderDissolve}.
 *
 * This is the library half of the move: it rewrites the group and leaves the file
 * to the caller, which relocates it (see `moveOutFileDestination`) so the folder
 * tree on disk keeps matching the shelf. Books the app stored itself have no such
 * file, and this alone is the whole move for them.
 *
 * Returns false when the book is not in a folder, in which case there is no
 * parent level to move it up into.
 */
export const applyBookMoveOutOfFolder = (
  book: Book,
  getGroupId: (path: string) => string,
): boolean => {
  const groupName = book.groupName || '';
  const parent = folderParentPath(groupName);
  if (!groupName || !parent) return false;
  book.groupName = parent;
  book.groupId = getGroupId(parent);
  book.updatedAt = Date.now();
  return true;
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
