import clsx from 'clsx';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import ModalPortal from '@/components/ModalPortal';

interface FolderNameDialogProps {
  title: string;
  initialName: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}

const FolderNameDialog: React.FC<FolderNameDialogProps> = ({
  title,
  initialName,
  confirmLabel,
  onCancel,
  onConfirm,
}) => {
  const _ = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = React.useState(initialName);
  const divRef = useKeyDownActions({ onCancel });

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const submit = () => {
    const next = value.trim();
    if (!next) return;
    onConfirm(next);
  };

  return (
    <ModalPortal>
      <div className='fixed inset-0 z-50 flex items-center justify-center'>
        <button
          type='button'
          className='absolute inset-0 bg-black/50'
          aria-label={_('Cancel')}
          onClick={onCancel}
        />
        <div
          ref={divRef}
          role='dialog'
          aria-labelledby='folder-name-dialog-title'
          className={clsx(
            'modal-box bg-base-100 relative z-10 overflow-hidden rounded-2xl shadow-xl',
            'w-[92%] min-w-64 max-w-[400px] p-6',
          )}
        >
          <h2 id='folder-name-dialog-title' className='text-center text-lg font-bold'>
            {title}
          </h2>
          <input
            ref={inputRef}
            type='text'
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') onCancel();
              e.stopPropagation();
            }}
            className='input input-bordered bg-base-200 mt-5 w-full text-base sm:text-sm'
          />
          <div className='mt-5 flex justify-end gap-2'>
            <button type='button' className='btn btn-ghost h-10 min-h-10' onClick={onCancel}>
              {_('Cancel')}
            </button>
            <button
              type='button'
              className='btn btn-ghost h-10 min-h-10 text-blue-500'
              disabled={!value.trim()}
              onClick={submit}
            >
              {confirmLabel || _('Save')}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};

export default FolderNameDialog;
