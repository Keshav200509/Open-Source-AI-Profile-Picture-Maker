import { useState, useEffect, useRef, useCallback } from 'react';
import {
  uploadImage,
  getStatus,
  triggerRemoveBg,
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
import BackgroundTool from '../components/BackgroundTool';
import StatusIndicator from '../components/StatusIndicator';
import DownloadButton from '../components/DownloadButton';

type Screen = 'upload' | 'editor';

export default function Home() {
  const [screen, setScreen] = useState<Screen>('upload');
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<StylePreset | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [mode, setMode] = useState<ProcessingMode>('sharp');

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { void fetchMode().then(setMode); }, []);

  const startPolling = useCallback((id: string) => {
    stopPolling();
    pollRef.current = setInterval(() => {
      // Detach the async work so the setInterval callback returns immediately,
      // preventing browser "long task" / Violation warnings.
      void getStatus(id).then((data) => {
        setJobStatus(data.status);
        setJobError(data.error ?? null);
        if (data.status === 'completed') {
          setResultUrl(`${getResultUrl(id)}?t=${Date.now()}`);
          stopPolling();
        } else if (data.status === 'failed') {
          stopPolling();
        }
      }).catch(() => {
        // network blip — keep polling
      });
    }, 2000);
  }, []);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => () => stopPolling(), []);

  async function handleUpload(file: File) {
    setIsUploading(true);
    setBannerError(null);
    try {
      const localUrl = URL.createObjectURL(file);
      const { jobId: id } = await uploadImage(file);
      setJobId(id);
      setOriginalUrl(localUrl);
      setJobStatus('pending');
      setResultUrl(null);
      setSelectedStyle(null);
      setJobError(null);
      setScreen('editor');
    } catch {
      setBannerError('Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
  }

  async function handleAction(action: () => Promise<void>) {
    if (!jobId) return;
    setBannerError(null);
    setJobStatus('processing');
    setResultUrl(null);
    try {
      await action();
      startPolling(jobId);
    } catch {
      setJobStatus('failed');
      setBannerError('Action failed. Please try again.');
    }
  }

  function handleRemoveBg() {
    handleAction(() => triggerRemoveBg(jobId!));
  }

  function handleEnhanceFace() {
    handleAction(() => triggerEnhanceFace(jobId!));
  }

  function handleApplyStyle() {
    if (!selectedStyle) {
      setBannerError('Please select a style preset first.');
      return;
    }
    handleAction(() => triggerApplyStyle(jobId!, selectedStyle));
  }

  function handleStartOver() {
    stopPolling();
    setScreen('upload');
    setJobId(null);
    setJobStatus(null);
    setJobError(null);
    setOriginalUrl(null);
    setResultUrl(null);
    setSelectedStyle(null);
    setBannerError(null);
  }

  const isProcessing = jobStatus === 'processing';

  const MODE_BADGE: Record<ProcessingMode, { label: string; color: string; dot: string }> = {
    replicate:    { label: 'AI · Replicate',    color: 'bg-green-50 text-green-700 border-green-200',   dot: 'bg-green-500'  },
    huggingface:  { label: 'AI · HuggingFace',  color: 'bg-yellow-50 text-yellow-700 border-yellow-200', dot: 'bg-yellow-500' },
    local:        { label: 'AI · Local GPU',     color: 'bg-blue-50 text-blue-700 border-blue-200',     dot: 'bg-blue-500'   },
    sharp:        { label: 'Enhance Mode',       color: 'bg-amber-50 text-amber-700 border-amber-200',  dot: 'bg-amber-400'  },
  };
  const badge = MODE_BADGE[mode];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🪄</span>
            <div>
              <h1 className="text-xl font-bold text-gray-900">AI Profile Picture Maker</h1>
              <p className="text-xs text-gray-500">Open-source · No account needed · Free</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`hidden sm:flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${badge.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
              {badge.label}
            </span>
            {screen === 'editor' && (
              <button onClick={handleStartOver} className="text-sm text-gray-500 hover:text-gray-700 underline">
                Start Over
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-10">
        {/* Error banner */}
        {bannerError && (
          <div className="mb-6 flex items-center justify-between gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
            <span>{bannerError}</span>
            <button onClick={() => setBannerError(null)} className="text-red-500 hover:text-red-700 shrink-0">
              ✕
            </button>
          </div>
        )}

        {screen === 'upload' && (
          <div className="flex flex-col items-center gap-8">
            <div className="text-center">
              <h2 className="text-3xl font-extrabold text-gray-900">
                Transform Your Selfie
              </h2>
              <p className="mt-2 text-gray-600 max-w-lg mx-auto">
                Upload a photo and apply professional styles, remove backgrounds, or enhance your
                face — all powered by open-source AI models running locally.
              </p>
            </div>
            <UploadArea onUpload={handleUpload} isUploading={isUploading} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center max-w-lg w-full">
              {[
                { icon: '✂️', title: 'Remove Background', desc: 'Powered by rembg' },
                { icon: '🎨', title: 'Apply Style', desc: '7 AI-generated presets' },
                { icon: '✨', title: 'Enhance Face', desc: 'GFPGAN / CodeFormer' },
              ].map((f) => (
                <div key={f.title} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                  <div className="text-2xl mb-1">{f.icon}</div>
                  <div className="font-semibold text-sm text-gray-800">{f.title}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {screen === 'editor' && originalUrl && (
          <div className="flex flex-col gap-8">
            {/* Canvas */}
            <EditorCanvas originalUrl={originalUrl} resultUrl={resultUrl} />

            {/* Status */}
            <div className="flex items-center justify-between flex-wrap gap-4">
              <StatusIndicator status={jobStatus} error={jobError} />
              {resultUrl && jobId && (
                <DownloadButton resultUrl={resultUrl} />
              )}
            </div>

            {/* Controls */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col gap-6">
              <h3 className="font-bold text-gray-800 text-lg">Transformations</h3>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleRemoveBg}
                  disabled={isProcessing}
                  className="flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200 hover:border-brand-400 hover:bg-brand-50 rounded-lg text-sm font-medium text-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ✂️ Remove Background
                </button>
                <button
                  onClick={handleEnhanceFace}
                  disabled={isProcessing}
                  className="flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200 hover:border-brand-400 hover:bg-brand-50 rounded-lg text-sm font-medium text-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ✨ Enhance Face
                </button>
              </div>

              <hr className="border-gray-100" />

              {/* Style selector */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-gray-700">Style Presets</p>
                  {selectedStyle && (
                    <button
                      onClick={handleApplyStyle}
                      disabled={isProcessing}
                      className="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      🎨 Apply Style
                    </button>
                  )}
                </div>
                <StyleSelector
                  selected={selectedStyle}
                  onSelect={setSelectedStyle}
                  disabled={isProcessing}
                />
              </div>

              <hr className="border-gray-100" />

              {/* Background tool */}
              <BackgroundTool
                onApplyColor={(color) => {
                  // Background color overlay is a client-side visual enhancement only.
                  // A full server-side bg-replace can be wired here in Phase 2.
                  console.info('Background color selected:', color);
                }}
                disabled={isProcessing}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
