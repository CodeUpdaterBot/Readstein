/**
 * Parse a Google Drive share URL, open-file URL, or bare file/folder id.
 * Used to jump the Drive importer at a folder the user already has, without
 * rebasing the local library onto Drive.
 */

export type DriveShareTarget = {
  type: 'folder' | 'file';
  id: string;
};

const DRIVE_ID = /[a-zA-Z0-9_-]{10,80}/;

const takeId = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const m = raw.trim().match(DRIVE_ID);
  return m ? m[0] : null;
};

/**
 * Extract a Drive file or folder id from a share/open URL or a pasted id.
 * Returns null when the string is not a recognisable Drive pointer.
 */
export const parseDriveShareUrl = (input: string): DriveShareTarget | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed) || trimmed.includes('drive.google.com')) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    const path = url.pathname;

    const folder = path.match(/\/(?:drive\/(?:u\/\d+\/)?folders|folders)\/([a-zA-Z0-9_-]+)/i);
    if (folder?.[1]) return { type: 'folder', id: folder[1] };

    const file = path.match(/\/file\/d\/([a-zA-Z0-9_-]+)/i);
    if (file?.[1]) return { type: 'file', id: file[1] };

    const openId = takeId(url.searchParams.get('id'));
    if (openId) {
      const looksLikeFolder = /\/folders\//i.test(path) || url.searchParams.get('usp') === 'sharing';
      // `/open?id=` and `/uc?id=` are files unless the path already said folders.
      if (/\/folders\//i.test(path)) return { type: 'folder', id: openId };
      if (looksLikeFolder && /folder/i.test(url.href)) return { type: 'folder', id: openId };
      return { type: 'file', id: openId };
    }
    return null;
  }

  const id = takeId(trimmed);
  if (!id || id !== trimmed.replace(/\s/g, '')) return null;
  // Bare ids are ambiguous; treat them as folders so "open this library folder"
  // (the common paste) works. File ids still resolve via files.get on browse.
  return { type: 'folder', id };
};
