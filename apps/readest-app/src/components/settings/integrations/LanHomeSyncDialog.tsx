import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MdCheckCircle, MdError, MdSync } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import type { AppService } from '@/types/system';
import type { SystemSettings } from '@/types/settings';
import {
  syncFromLanHome,
  type LanHomeSyncCounts,
  type LanHomeSyncProgress,
  type LanHomeSyncResult,
} from '@/services/lanHome/sync';
import { LanHomeError } from '@/services/lanHome/client';

type StepKey = 'connect' | 'compare' | 'transfer';
type StepState = 'pending' | 'active' | 'ok' | 'fail';

type Step = {
  key: StepKey;
  label: string;
  state: StepState;
  note?: string;
};

const STEP_LABELS: Record<StepKey, string> = {
  connect: 'Connecting to the PC',
  compare: 'Comparing libraries',
  transfer: 'Transferring books',
};

const initialSteps = (): Step[] => [
  { key: 'connect', label: STEP_LABELS.connect, state: 'pending' },
  { key: 'compare', label: STEP_LABELS.compare, state: 'pending' },
  { key: 'transfer', label: STEP_LABELS.transfer, state: 'pending' },
];

const StepIcon: React.FC<{ state: StepState }> = ({ state }) => {
  if (state === 'ok') return <MdCheckCircle className='text-success h-5 w-5 shrink-0' />;
  if (state === 'fail') return <MdError className='text-error h-5 w-5 shrink-0' />;
  if (state === 'active')
    return <MdSync className='text-base-content/70 h-5 w-5 shrink-0 animate-spin' />;
  return <MdSync className='text-base-content/25 h-5 w-5 shrink-0' />;
};

export type LanHomeSyncDialogProps = {
  host: string;
  port: number;
  appService: AppService;
  settings: SystemSettings;
  isLoggedIn: boolean;
  /** Reports the result once the run ends; the dialog stays open to show it. */
  onFinished: (result: LanHomeSyncResult | null) => void;
  onClose: () => void;
};

/**
 * The sync, narratable. A transfer of a large shelf takes minutes, so it reports
 * what it is doing in three steps and shows a real bar — an unlabelled spinner on
 * a job this size just looks broken, which is exactly how a silent failure reads.
 */
const LanHomeSyncDialog: React.FC<LanHomeSyncDialogProps> = ({
  host,
  port,
  appService,
  settings,
  isLoggedIn,
  onFinished,
  onClose,
}) => {
  const _ = useTranslation();
  const [steps, setSteps] = useState<Step[]>(initialSteps);
  const [progress, setProgress] = useState<LanHomeSyncProgress | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [counts, setCounts] = useState<LanHomeSyncCounts | null>(null);
  const [hostName, setHostName] = useState('');
  const started = useRef(false);

  const setStep = useCallback((key: StepKey, state: StepState, note?: string) => {
    setSteps((prev) =>
      prev.map((s) => (s.key === key ? { ...s, state, note: note ?? s.note } : s)),
    );
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const run = async () => {
      try {
        const result = await syncFromLanHome({
          host,
          port,
          token: settings.lanHome?.clientToken || settings.lanHome?.token || '',
          appService,
          settings,
          isLoggedIn,
          onProgress: (p) => {
            setProgress(p);
            if (p.hostName) setHostName(p.hostName);
            if (p.stage === 'connect') {
              setStep('connect', 'active');
            } else if (p.stage === 'compare') {
              setStep('connect', 'ok');
              setStep('compare', 'active');
            } else if (p.stage === 'transfer') {
              setStep('connect', 'ok');
              setStep(
                'compare',
                'ok',
                p.total ? _('{{n}} books to match', { n: p.total }) : undefined,
              );
              setStep('transfer', 'active');
            } else if (p.stage === 'done') {
              setStep('transfer', 'ok');
            }
          },
        });
        setCounts({
          imported: result.imported,
          skipped: result.skipped,
          progressPulled: result.progressPulled,
          progressPushed: result.progressPushed,
          titlesUpdated: result.titlesUpdated,
          coversUpdated: result.coversUpdated,
          removed: result.removed,
        });
        const empty =
          result.imported === 0 &&
          result.titlesUpdated === 0 &&
          result.coversUpdated === 0 &&
          result.removed === 0;
        setProgress((p) => ({ ...(p ?? { stage: 'done' }), stage: 'done' }));
        if (empty) setStep('transfer', 'ok', _('Everything is already in sync'));
        else setStep('transfer', 'ok');
        onFinished(result);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setFailure(message);
        // Attribute the failure to the step that was running.
        const where: StepKey =
          progress?.stage === 'compare'
            ? 'compare'
            : progress?.stage === 'transfer'
              ? 'transfer'
              : 'connect';
        if (where === 'connect') {
          setStep('connect', 'fail', message);
        } else if (where === 'compare') {
          setStep('connect', 'ok');
          setStep('compare', 'fail', message);
        } else {
          setStep('transfer', 'fail', message);
        }
        onFinished(null);
      }
    };
    void run();
    // Intentionally runs once per opened dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = progress?.total ?? 0;
  const current = progress?.current ?? 0;
  const percent =
    total > 0 ? Math.min(100, Math.round((current / total) * 100)) : failure ? 0 : 100;
  const running = !counts && !failure;

  const summary = counts
    ? [
        { label: _('imported'), value: counts.imported },
        { label: _('updated'), value: counts.titlesUpdated + counts.coversUpdated },
        { label: _('removed'), value: counts.removed },
      ]
    : [];

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
          <p className='text-base-content/60 mt-0.5 text-[0.85em]'>
            {hostName && hostName !== 'localhost' ? hostName : `${host}:${port}`}
          </p>
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
                  {_(step.label)}
                </span>
                {step.note && (
                  <span
                    className={clsx(
                      'mt-0.5 block text-[0.85em]',
                      step.state === 'fail' ? 'text-error/90' : 'text-base-content/55',
                    )}
                  >
                    {step.note}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>

        {!failure && (total > 0 || running) && (
          <div className='px-5 pb-4'>
            <div className='bg-base-300 h-2 w-full overflow-hidden rounded-full'>
              <div
                className='bg-primary h-full rounded-full transition-[width] duration-300'
                style={{ width: `${percent}%` }}
                data-testid='lan-home-sync-bar'
              />
            </div>
            <div className='text-base-content/60 mt-2 flex justify-between text-[0.85em]'>
              <span className='min-w-0 truncate pr-3'>{progress?.label ?? ''}</span>
              <span className='shrink-0 tabular-nums'>
                {total > 0 ? `${current} / ${total}` : ''}
              </span>
            </div>
          </div>
        )}

        {failure && (
          <p
            className='text-error px-5 pb-4 text-[0.9em] leading-snug'
            data-testid='lan-home-sync-error'
          >
            {failure}
          </p>
        )}

        {counts && (
          <div className='border-base-200 border-t px-5 py-4'>
            <p className='text-sm font-medium'>{_('Sync complete')}</p>
            <ul className='mt-2 space-y-1'>
              {summary.map((s) => (
                <li key={s.label} className='flex justify-between text-[0.9em]'>
                  <span className='text-base-content/70'>{s.label}</span>
                  <span className='tabular-nums'>{s.value}</span>
                </li>
              ))}
              {counts.progressPulled + counts.progressPushed > 0 && (
                <li className='flex justify-between text-[0.9em]'>
                  <span className='text-base-content/70'>{_('reading progress')}</span>
                  <span className='tabular-nums'>
                    {counts.progressPulled + counts.progressPushed}
                  </span>
                </li>
              )}
            </ul>
          </div>
        )}

        <div className='border-base-200 flex justify-end border-t px-5 py-3'>
          <button
            type='button'
            className='btn btn-contrast h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium'
            disabled={running}
            onClick={onClose}
          >
            {running ? _('Syncing…') : _('Close')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LanHomeSyncDialog;

export const isLanHomeSyncFailure = (e: unknown): e is LanHomeError => e instanceof LanHomeError;
