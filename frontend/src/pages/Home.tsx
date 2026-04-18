import { useState, useEffect, useRef, useCallback } from 'react';
import {
  uploadImage,
  getStatus,
  triggerRemoveBg,
  triggerApplyStyle,
  triggerEnhanceFace,
  triggerApplyBg,
  getResultUrl,
  fetchMode,
  ProcessingMode,
} from '../api';
import { JobStatus, StylePreset } from '../types';
import UploadArea from '../components/UploadArea';
import EditorCanvas from '../components/EditorCanvas';
import StyleSelector from '../components/StyleSelector';
import BackgroundTool from '../components/BackgroundTool';
import StatusIndicator from '../components/StatusIndicator';
import DownloadButton from '../components/DownloadButton';

type Screen = 'upload' | 'editor';

export default function Home() {
  const [screen, setScreen]           = useState<Screen>('upload');
  const [jobId, setJobId]             = useState<string | null>(null);
  const [jobStatus, setJobStatus]     = useState<JobStatus | null>(null);
  const [jobError, setJobError]       = useState<string | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl]     = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<StylePreset | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [mode, setMode]               = useState<ProcessingMode>('sharp');

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { void fetchMode().then(setMode); }, []);

  const startPolling = useCallback((id: string) => {
    stopPolling();
    pollRef.current = setInterval(() => {
      void getStatus(id).then((data) => {
        setJobStatus(data.status);
        setJobError(data.error ?? null);
        if (data.status === 'completed') {
          setResultUrl(`${getResultUrl(id)}?t=${Date.now()}`);
          stopPolling();
        } else if (data.status === 'failed') {
          stopPolling();
        }
      }).catch(() => {});
    }, 2000);
  }, []);

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  useEffect(() => () => stopPolling(), []);

  async function handleUpload(file: File) {
    setIsUploading(true); setBannerError(null);
    try {
      const localUrl = URL.createObjectURL(file);
      const { jobId: id } = await uploadImage(file);
      setJobId(id); setOriginalUrl(localUrl);
      setJobStatus('pending'); setResultUrl(null);
      setSelectedStyle(null); setJobError(null);
      setScreen('editor');
    } catch {
      setBannerError('Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
  }

  async function handleAction(action: () => Promise<void>) {
    if (!jobId) return;
    setBannerError(null); setJobStatus('processing'); setResultUrl(null);
    try {
      await action();
      startPolling(jobId);
    } catch {
      setJobStatus('failed');
      setBannerError('Action failed. Please try again.');
    }
  }

  const handleRemoveBg    = () => void handleAction(() => triggerRemoveBg(jobId!));
  const handleEnhanceFace = () => void handleAction(() => triggerEnhanceFace(jobId!));
  const handleApplyBg     = (color: string) => void handleAction(() => triggerApplyBg(jobId!, color));

  function handleApplyStyle() {
    if (!selectedStyle) { setBannerError('Please select a style preset first.'); return; }
    void handleAction(() => triggerApplyStyle(jobId!, selectedStyle));
  }

  function handleStartOver() {
    stopPolling();
    setScreen('upload'); setJobId(null); setJobStatus(null); setJobError(null);
    setOriginalUrl(null); setResultUrl(null); setSelectedStyle(null); setBannerError(null);
  }

  const isProcessing = jobStatus === 'processing';

  const MODE_BADGE: Record<ProcessingMode, { label: string; color: string; dot: string }> = {
    replicate:   { label: 'AI · Replicate',   color: 'bg-green-50 text-green-700 border-green-200',    dot: 'bg-green-500'  },
    huggingface: { label: 'AI · HuggingFace', color: 'bg-yellow-50 text-yellow-700 border-yellow-200', dot: 'bg-yellow-400' },
    local:       { label: 'AI · Local GPU',   color: 'bg-blue-50 text-blue-700 border-blue-200',       dot: 'bg-blue-500'   },
    sharp:       { label: 'Enhance Mode',     color: 'bg-amber-50 text-amber-700 border-amber-200',    dot: 'bg-amber-400'  },
  };
  const badge = MODE_BADGE[mode];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">

      {/* ── Header ── */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-gray-100 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl leading-none">🪄</span>
            <span className="text-base font-bold text-gray-900 tracking-tight">AI Profile Maker</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`hidden sm:flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${badge.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${badge.dot}`} />
              {badge.label}
            </span>
            {screen === 'editor' && (
              <button
                onClick={handleStartOver}
                className="text-xs font-medium text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg transition-colors"
              >
                ← New photo
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">

        {/* ── Error banner ── */}
        {bannerError && (
          <div className="mb-5 flex items-center justify-between gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
            <span>{bannerError}</span>
            <button onClick={() => setBannerError(null)} className="text-red-400 hover:text-red-600 shrink-0 text-lg leading-none">×</button>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════ */}
        {/* Upload screen                                              */}
        {/* ══════════════════════════════════════════════════════════ */}
        {screen === 'upload' && (
          <div className="flex flex-col items-center gap-10 pt-6">

            {/* Hero */}
            <div className="text-center max-w-xl">
              <h2 className="text-4xl font-extrabold tracking-tight text-gray-900 leading-tight">
                Turn any photo into a{' '}
                <span className="bg-gradient-to-r from-brand-500 to-blue-600 bg-clip-text text-transparent">
                  professional portrait
                </span>
              </h2>
              <p className="mt-3 text-base text-gray-500 leading-relaxed">
                Remove backgrounds, apply cinematic styles, and enhance face quality
                — all powered by open-source AI. No account required.
              </p>
            </div>

            <UploadArea onUpload={handleUpload} isUploading={isUploading} />

            {/* Feature pills */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-xl">
              {[
                { icon: '✂️', title: 'Remove Background', desc: 'Powered by rembg AI' },
                { icon: '🎨', title: '7 Style Presets',   desc: 'Cyberpunk · Anime · Oil' },
                { icon: '✨', title: 'Face Enhance',      desc: 'GFPGAN super-resolution' },
              ].map((f) => (
                <div key={f.title} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex flex-col items-center text-center gap-1">
                  <span className="text-2xl">{f.icon}</span>
                  <span className="font-semibold text-sm text-gray-800">{f.title}</span>
                  <span className="text-xs text-gray-400">{f.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════ */}
        {/* Editor screen                                             */}
        {/* ══════════════════════════════════════════════════════════ */}
        {screen === 'editor' && originalUrl && (
          <div className="flex flex-col gap-6">

            {/* Canvas + status row */}
            <EditorCanvas originalUrl={originalUrl} resultUrl={resultUrl} />

            <div className="flex items-center justify-between flex-wrap gap-4">
              <StatusIndicator status={jobStatus} error={jobError} />
              {resultUrl && jobId && <DownloadButton resultUrl={resultUrl} />}
            </div>

            {/* Controls card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-100">

              {/* Section: Quick actions */}
              <div className="p-5 flex flex-col gap-3">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Quick Actions</p>
                <div className="flex flex-wrap gap-2.5">
                  <ActionBtn onClick={handleRemoveBg} disabled={isProcessing} icon="✂️" label="Remove Background" />
                  <ActionBtn onClick={handleEnhanceFace} disabled={isProcessing} icon="✨" label="Enhance Face" />
                </div>
                {mode === 'sharp' && (
                  <p className="text-[11px] text-amber-600">
                    ⚡ Background removal needs HF_API_TOKEN or REPLICATE_API_TOKEN. Enhance Face applies sharpening + 1.5× upscale.
                  </p>
                )}
              </div>

              {/* Section: Style presets */}
              <div className="p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Style Presets</p>
                  {selectedStyle && (
                    <button
                      onClick={handleApplyStyle}
                      disabled={isProcessing}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      🎨 Apply Style
                    </button>
                  )}
                </div>
                <StyleSelector selected={selectedStyle} onSelect={setSelectedStyle} disabled={isProcessing} aiMode={mode !== 'sharp'} />
              </div>

              {/* Section: Background fill */}
              <div className="p-5 flex flex-col gap-3">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Background Fill</p>
                <p className="text-xs text-gray-400 -mt-1">Best used after removing the background first.</p>
                <BackgroundTool onApplyColor={handleApplyBg} disabled={isProcessing} />
              </div>

            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* Shared action button used in the controls card */
function ActionBtn({ onClick, disabled, icon, label }: {
  onClick: () => void; disabled: boolean; icon: string; label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 hover:border-brand-400 hover:bg-brand-50 rounded-lg text-sm font-medium text-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
    >
      {icon} {label}
    </button>
  );
}
