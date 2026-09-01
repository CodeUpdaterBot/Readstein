import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import {
  applyHostCatalogTitle,
  applyHostLibraryMetadata,
  filenameStem,
  isUnreliableTitle,
  preferFilenameOverMetadata,
  repairStoredBookTitle,
  resolveImportTitle,
  stripTempImportPrefix,
} from '@/utils/bookTitle';

describe('bookTitle', () => {
  it('strips Home Library / Drive cache prefixes', () => {
    expect(stripTempImportPrefix('lan-1787729199808-Dying for the Truth - R. Roy Blake')).toBe(
      'Dying for the Truth - R. Roy Blake',
    );
    expect(filenameStem('C:\\Cache\\lan-1787729148240-The Real History.pdf')).toBe(
      'The Real History',
    );
    expect(filenameStem('gdrive-99-Report.pdf')).toBe('Report');
  });

  it('flags scanner / Word / timestamp PDF titles as junk', () => {
    expect(isUnreliableTitle('Microsoft Word - index.doc')).toBe(true);
    expect(isUnreliableTitle('Convert JPG to PDF online')).toBe(true);
    expect(isUnreliableTitle('2021-11-15 23:17')).toBe(true);
    expect(isUnreliableTitle('Chaos: Charles Manson')).toBe(false);
  });

  it('prefers a filename over a last-name PDF title', () => {
    expect(
      preferFilenameOverMetadata('Twyman', 'GENUFLECT Secret Statues of the Templars', 'PDF'),
    ).toBe(true);
    expect(preferFilenameOverMetadata('The Conquest of the World', 'The Conquest of the World', 'EPUB')).toBe(
      false,
    );
  });

  it('resolves import titles from the original filename, not the cache path', () => {
    expect(
      resolveImportTitle({
        metadataTitle: '',
        sourceFileName: 'Dying for the Truth - R. Roy Blake.pdf',
        filePath: 'C:/tmp/lan-1787729199808-Dying for the Truth - R. Roy Blake.pdf',
        format: 'PDF',
      }),
    ).toBe('Dying for the Truth - R. Roy Blake');
  });

  it('repairs a stored lan- title from the in-place file path', () => {
    const book = {
      hash: 'abc',
      format: 'PDF',
      title: 'lan-1787729199808-Dying for the Truth - R. Roy Blake',
      sourceTitle: 'lan-1787729199808-Dying for the Truth - R. Roy Blake',
      author: 'Unknown',
      createdAt: 1,
      updatedAt: 1,
      filePath: 'C:\\Users\\PC\\Downloads\\YouTube\\Books\\Dying for the Truth - R. Roy Blake.pdf',
      metadata: { title: 'lan-1787729199808-Dying for the Truth - R. Roy Blake' },
    } as Book;

    expect(repairStoredBookTitle(book)).toBe(true);
    expect(book.title).toBe('Dying for the Truth - R. Roy Blake');
    expect(book.metadata?.title).toBe('Dying for the Truth - R. Roy Blake');
  });

  it('repairs junk PDF metadata when the filename is better', () => {
    const book = {
      hash: 'abc',
      format: 'PDF',
      title: 'Microsoft Word - index.doc',
      author: 'Unknown',
      createdAt: 1,
      updatedAt: 1,
      filePath: 'C:\\Books\\The Hoax of the Twentieth Century.pdf',
      metadata: { title: 'Microsoft Word - index.doc' },
    } as Book;

    expect(repairStoredBookTitle(book)).toBe(true);
    expect(book.title).toBe('The Hoax of the Twentieth Century');
  });

  it('leaves a good title alone', () => {
    const book = {
      hash: 'abc',
      format: 'EPUB',
      title: 'Chaos: Charles Manson',
      author: 'Tom ONeill',
      createdAt: 1,
      updatedAt: 1,
      metadata: { title: 'Chaos: Charles Manson' },
    } as Book;

    expect(repairStoredBookTitle(book)).toBe(false);
    expect(book.title).toBe('Chaos: Charles Manson');
  });

  it('overlays Home Library host titles onto a phone copy with a lan- name', () => {
    const book = {
      hash: 'abc',
      format: 'PDF',
      title: 'lan-1787729199808-Dying for the Truth - R. Roy Blake',
      author: 'Unknown',
      createdAt: 1,
      updatedAt: 1,
      metadata: { title: 'lan-1787729199808-Dying for the Truth - R. Roy Blake' },
    } as Book;

    expect(
      applyHostCatalogTitle(book, {
        title: 'Dying for the Truth - R. Roy Blake',
        filename: 'Dying for the Truth - R. Roy Blake.pdf',
        format: 'PDF',
      }),
    ).toBe(true);
    expect(book.title).toBe('Dying for the Truth - R. Roy Blake');
    expect(book.metadata?.title).toBe('Dying for the Truth - R. Roy Blake');
  });

  it('overlays a junk PDF last-name title from the host filename', () => {
    const book = {
      hash: 'def',
      format: 'PDF',
      title: 'Twyman',
      author: 'Unknown',
      createdAt: 1,
      updatedAt: 1,
      metadata: { title: 'Twyman' },
    } as Book;

    expect(
      applyHostCatalogTitle(book, {
        title: 'GENUFLECT Secret Statues of the Templars',
        filename: 'GENUFLECT Secret Statues of the Templars.pdf',
        format: 'PDF',
      }),
    ).toBe(true);
    expect(book.title).toBe('GENUFLECT Secret Statues of the Templars');
  });

  it('leaves a matching host title alone', () => {
    const book = {
      hash: 'abc',
      format: 'EPUB',
      title: 'Chaos: Charles Manson',
      author: 'Tom ONeill',
      createdAt: 1,
      updatedAt: 1,
      metadata: { title: 'Chaos: Charles Manson' },
    } as Book;

    expect(
      applyHostCatalogTitle(book, {
        title: 'Chaos: Charles Manson',
        filename: 'Chaos - Charles Manson.epub',
        format: 'EPUB',
      }),
    ).toBe(false);
    expect(book.title).toBe('Chaos: Charles Manson');
  });

  it('mirrors a user-edited host title even when the filename is longer', () => {
    const book = {
      hash: 'abc',
      format: 'PDF',
      title: 'Some Long Original Filename',
      author: 'Unknown',
      createdAt: 1,
      updatedAt: 1,
      metadata: { title: 'Some Long Original Filename', author: 'Unknown' },
    } as Book;

    expect(
      applyHostLibraryMetadata(book, {
        title: 'Short Name',
        author: 'Jane Doe',
        tags: ['history'],
      }),
    ).toBe(true);
    expect(book.title).toBe('Short Name');
    expect(book.author).toBe('Jane Doe');
    expect(book.tags).toEqual(['history']);
    expect(book.metadata?.title).toBe('Short Name');
  });

  it('does not re-stamp matching host metadata', () => {
    const book = {
      hash: 'abc',
      format: 'EPUB',
      title: 'Chaos: Charles Manson',
      author: 'Tom ONeill',
      createdAt: 1,
      updatedAt: 1,
      metadata: { title: 'Chaos: Charles Manson' },
    } as Book;

    expect(
      applyHostLibraryMetadata(book, {
        title: 'Chaos: Charles Manson',
        author: 'Tom ONeill',
      }),
    ).toBe(false);
  });
});
