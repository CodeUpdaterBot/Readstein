import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { MdCheckCircle, MdError, MdSync } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import {
  getLanHomeSyncState,
  subscribeLanHomeSync,
  type LanHomeSyncState,
} from '@/services/lanHome/sync';

type StepKey = 'connect' | 'compare' | 'transfer';
type StepState = 'pending' | 'active' | 'ok' | 'fail';

const STEP_LABELS: Record<StepKey, string> = {
  connect: 'Connecting to the PC',
  compare: 'Comparing libraries',
  transfer: 'Transferring books',
};

const StepIcon: React.FC<{ state: StepState }> = ({ state }) => {
  if (state === 'ok') return <MdCheckCircle className='text-success h-5 w-5 shrink-0' />;
  if (state === 'fail') return <MdError className='text-error h-5 w-5 shrink-0' />;
  if (state === 'active')
    return <MdSync className='text-base-content/70 h-5 w-5 shrink-0 animate-spin' />;
  return <MdSync className='text-base-content/25 h-5 w-5 shrink-0' />;
};

/** Where a failure happened, inferred from the last stage the run reported. */
const failedStep = (state: LanHomeSyncState): StepKey | null => {
  if (!state.error) return null;
  const stage = state.progress?.stage;
  if (stage === 'compare') return 'compare';
  if (stage === 'transfer') return 'transfer';
  return 'connect';
};

const stepsFor = (state: LanHomeSyncState): { key: StepKey; state: StepState; note?: string }[] => {
  const stage = state.progress?.stage;
  const failed = failedStep(state);
  const reached = (target: StepKey): boolean => {
    if (state.result) return true;
    if (target === 'connect')
      return stage === 'compare' || stage === 'transfer' || stage === 'done';
    if (target === 'compare') return stage === 'transfer' || stage === 'done';
    return stage === 'done';
  };
  const stateOf = (key: StepKey): StepState => {
    if (failed === key) return 'fail';
    if (reached(key)) return 'ok';
    // Only the first unfinished step is the one running.
    const order: StepKey[] = ['connect', 'compare', 'transfer'];
    const firstPending = order.find((k) => !reached(k));
    return firstPending === key ? 'active' : 'pending';
  };

  const total = state.progress?.total ?? 0;
  return [
    { key: 'connect', state: stateOf('connect') },
    {
      key: 'compare',
      state: stateOf('compare'),
      note: total > 0 ? `${total} books to match` : undefined,
    },
    {
      key: 'transfer',
      state: stateOf('transfer'),
      note:
        state.result &&
        state.result.imported + state.result.titlesUpdated + state.result.coversUpdated === 0
          ? 'Everything is already in sync'
          : undefined,
    },
  ];
};

export type LanHomeSyncDialogProps = {
  host: string;
  port: number;
  /** Closing the window never cancels the run — it is a background job. */
  onClose: () => void;
};

/**
 * A window onto the running sync, not the thing running it.
 *
 * The job lives at module scope (`startLanHomeSync`), so this can be closed, reopened, or
 * left behind while the user reads something else, and it will still show the live state
 * when they come back.
 */
const LanHomeSyncDialog: React.FC<LanHomeSyncDialogProps> = ({ host, port, onClose }) => {
  const _ = useTranslation();
  const [state, setState] = useState<LanHomeSyncState>(() => getLanHomeSyncState());

  useEffect(() => subscribeLanHomeSync(setState), []);

  const steps = stepsFor(state);
  const total = state.progress?.total ?? 0;
  const current = state.progress?.current ?? 0;
  const percent =
    total > 0 ? Math.min(100, Math.round((current / total) * 100)) : state.result ? 100 : 0;
  const label =
    state.hostName && state.hostName !== 'localhost' ? state.hostName : `${host}:${port}`;
  const counts = state.result;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4'>
      <div
        role='dialog'
        aria-modal='true'
        aria-label={_('Syncing with your PC')}
        data-testid='lan-home-sync-dialog'
        className='bg-base-100 text-base-content w-full max-w-md overflow-hidden rounded-2xl shadow-xl'
      >
        <div className='border-base-200 border-b px-5 py-4'>
          <h3 className='text-base font-semibold'>{_('Home Library sync')}</h3>
          <p className='text-base-content/60 mt-0.5 text-[0.85em]'>{label}</p>
        </div>

        <ul className='space-y-3 px-5 py-4'>
          {steps.map((step) => (
            <li key={step.key} className='flex items-start gap-3'>
              <StepIcon state={step.state} />
              <span className='min-w-0 flex-1'>
                <span
                  className={clsx(
                    'block text-sm',
                    step.state === 'pending' && 'text-base-content/45',
                    step.state === 'fail' && 'text-error',
                  )}
                >
                  {_(STEP_LABELS[step.key])}
                </span>
                {step.note && (
                  <span className='text-base-content/55 mt-0.5 block text-[0.85em]'>
                    {step.note}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>

        {(total > 0 || state.running) && !state.error && (
          <div className='px-5 pb-4'>
            <div className='bg-base-300 h-2 w-full overflow-hidden rounded-full'>
              <div
                className='bg-primary h-full rounded-full transition-[width] duration-300'
                style={{ width: `${percent}%` }}
                data-testid='lan-home-sync-bar'
              />
            </div>
            <div className='text-base-content/60 mt-2 flex justify-between text-[0.85em]'>
              <span className='min-w-0 truncate pr-3'>{state.progress?.label ?? ''}</span>
              <span className='shrink-0 tabular-nums'>
                {total > 0 ? `${current} / ${total}` : ''}
              </span>
            </div>
          </div>
        )}

        {state.error && (
          <p
            className='text-error px-5 pb-4 text-[0.9em] leading-snug'
            data-testid='lan-home-sync-error'
          >
            {state.error}
          </p>
        )}

        {counts && (
          <div className='border-base-200 border-t px-5 py-4'>
            <p className='text-sm font-medium'>{_('Sync complete')}</p>
            <ul className='mt-2 space-y-1'>
              {[
                { label: _('imported'), value: counts.imported },
                { label: _('updated'), value: counts.titlesUpdated + counts.coversUpdated },
                { label: _('removed'), value: counts.removed },
              ].map((row) => (
                <li key={row.label} className='flex justify-between text-[0.9em]'>
                  <span className='text-base-content/70'>{row.label}</span>
                  <span className='tabular-nums'>{row.value}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className='border-base-200 flex items-center justify-between gap-3 border-t px-5 py-3'>
          <span className='text-base-content/55 text-[0.8em] leading-snug'>
            {state.running ? _('Keeps syncing if you close this window') : ''}
          </span>
          <button
            type='button'
            className='btn btn-contrast h-10 min-h-10 shrink-0 rounded-lg border-0 px-5 text-sm font-medium'
            onClick={onClose}
            data-testid='lan-home-sync-close'
          >
            {state.running ? _('Continue in background') : _('Close')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LanHomeSyncDialog;
