import { useState, useEffect, useRef, useCallback } from 'react';
import {
  uploadImage,
  getStatus,
  triggerApplyStyle,
  triggerEnhanceFace,
  getResultUrl,
  fetchMode,
  ProcessingMode,
} from '../api';
import { JobStatus, StylePreset } from '../types';
import UploadArea from '../components/UploadArea';
import EditorCanvas from '../components/EditorCanvas';
import StyleSelector from '../components/StyleSelector';
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

  const handleEnhanceFace = () => void handleAction(() => triggerEnhanceFace(jobId!));

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
                Transform your photo into{' '}
                <span className="bg-gradient-to-r from-brand-500 to-violet-600 bg-clip-text text-transparent">
                  stunning AI portraits
                </span>
              </h2>
              <p className="mt-3 text-base text-gray-500 leading-relaxed">
                Professional, Fantasy, Cyberpunk, Anime — four signature styles, powered by
                open-source AI. No account required.
              </p>
            </div>

            <UploadArea onUpload={handleUpload} isUploading={isUploading} />

            {/* Style preview pills */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-2xl">
              {[
                { icon: '💼', label: 'Professional', color: 'from-slate-100 to-blue-100',   border: 'border-slate-200' },
                { icon: '🔮', label: 'Fantasy',      color: 'from-purple-100 to-violet-100', border: 'border-purple-200' },
                { icon: '⚡', label: 'Cyberpunk',    color: 'from-cyan-100 to-slate-100',    border: 'border-cyan-200' },
                { icon: '✨', label: 'Anime',        color: 'from-pink-100 to-orange-100',   border: 'border-pink-200' },
              ].map((f) => (
                <div key={f.label} className={`bg-gradient-to-br ${f.color} rounded-2xl p-4 border ${f.border} flex flex-col items-center text-center gap-1`}>
                  <span className="text-3xl">{f.icon}</span>
                  <span className="font-bold text-sm text-gray-800">{f.label}</span>
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

            <EditorCanvas originalUrl={originalUrl} resultUrl={resultUrl} />

            <div className="flex items-center justify-between flex-wrap gap-4">
              <StatusIndicator status={jobStatus} error={jobError} />
              {resultUrl && jobId && <DownloadButton resultUrl={resultUrl} />}
            </div>

            {/* Controls card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-100">

              {/* Section: Style presets */}
              <div className="p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-gray-800">Choose a Style</p>
                    <p className="text-xs text-gray-400 mt-0.5">Select a style then tap Apply</p>
                  </div>
                  {selectedStyle && (
                    <button
                      onClick={handleApplyStyle}
                      disabled={isProcessing}
                      className="flex items-center gap-2 px-5 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                    >
                      🎨 Apply Style
                    </button>
                  )}
                </div>
                <StyleSelector selected={selectedStyle} onSelect={setSelectedStyle} disabled={isProcessing} aiMode={mode !== 'sharp'} />
              </div>

              {/* Section: Enhance */}
              <div className="p-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-gray-800">Enhance Portrait</p>
                  <p className="text-xs text-gray-400 mt-0.5">Sharpen details, upscale resolution, correct tone</p>
                </div>
                <button
                  onClick={handleEnhanceFace}
                  disabled={isProcessing}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 hover:border-brand-400 hover:bg-brand-50 rounded-xl text-sm font-semibold text-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm shrink-0"
                >
                  ✨ Enhance
                </button>
              </div>

            </div>
          </div>
        )}
      </main>
    </div>
  );
}
