import { JobStatus } from '../types';

interface Props {
  status: JobStatus | null;
  error?: string | null;
}

const STATUS_MESSAGES: Record<JobStatus, string> = {
  pending: 'Ready',
  processing: 'Processing your image...',
  completed: 'Done!',
  failed: 'Something went wrong',
};

export default function StatusIndicator({ status, error }: Props) {
  if (!status) return null;

  return (
    <div className="flex items-center gap-3">
      {status === 'processing' && (
        <svg
          className="animate-spin h-5 w-5 text-brand-500"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {status === 'completed' && (
        <svg className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )}
      {status === 'failed' && (
        <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      )}
      <span
        className={`text-sm font-medium ${
          status === 'completed'
            ? 'text-green-600'
            : status === 'failed'
            ? 'text-red-600'
            : status === 'processing'
            ? 'text-brand-600'
            : 'text-gray-500'
        }`}
      >
        {error && status === 'failed' ? error : STATUS_MESSAGES[status]}
      </span>
    </div>
  );
}
