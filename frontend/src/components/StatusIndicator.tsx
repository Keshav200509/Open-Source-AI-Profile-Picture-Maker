import { useEffect, useState } from 'react';
import { JobStatus } from '../types';

interface Props {
  status: JobStatus | null;
  error?: string | null;
}

const STEPS = ['Analysing image', 'Processing', 'Finishing up'];

export default function StatusIndicator({ status, error }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (status !== 'processing') { setElapsed(0); setStepIdx(0); return; }
    const start = Date.now();
    const iv = setInterval(() => {
      const sec = Math.floor((Date.now() - start) / 1000);
      setElapsed(sec);
      setStepIdx(Math.min(STEPS.length - 1, Math.floor(sec / 4)));
    }, 500);
    return () => clearInterval(iv);
  }, [status]);

  if (!status) return null;

  if (status === 'processing') {
    return (
      <div className="flex flex-col gap-1.5 min-w-[220px]">
        <div className="flex items-center gap-2">
          <svg className="animate-spin h-4 w-4 text-brand-500 shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm font-medium text-brand-700">{STEPS[stepIdx]}…</span>
          <span className="text-xs text-gray-400 ml-auto tabular-nums">{elapsed}s</span>
        </div>
        <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-brand-400 to-brand-600 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${Math.min(92, 5 + (elapsed / 25) * 87)}%` }}
          />
        </div>
      </div>
    );
  }

  if (status === 'completed') {
    return (
      <div className="flex items-center gap-2.5">
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-green-100">
          <svg className="h-3.5 w-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </span>
        <span className="text-sm font-semibold text-green-700">Done! Drag the slider to compare.</span>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="flex items-center gap-2.5">
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-red-100">
          <svg className="h-3.5 w-3.5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </span>
        <span className="text-sm font-medium text-red-600">{error ?? 'Processing failed — please try again'}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-full bg-gray-300" />
      <span className="text-sm text-gray-400">Ready</span>
    </div>
  );
}
