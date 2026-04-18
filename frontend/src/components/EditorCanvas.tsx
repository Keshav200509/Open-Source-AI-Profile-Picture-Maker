import { useState, useRef, useCallback, useEffect } from 'react';

interface Props {
  originalUrl: string;
  resultUrl: string | null;
}

export default function EditorCanvas({ originalUrl, resultUrl }: Props) {
  const [sliderPct, setSliderPct] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updateFromClientX = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setSliderPct(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  useEffect(() => {
    const stop = () => { dragging.current = false; };
    window.addEventListener('mouseup', stop);
    window.addEventListener('touchend', stop);
    return () => { window.removeEventListener('mouseup', stop); window.removeEventListener('touchend', stop); };
  }, []);

  if (!resultUrl) {
    return (
      <div className="relative rounded-2xl overflow-hidden border border-gray-200 bg-gray-50 aspect-[4/3] flex items-center justify-center">
        <img src={originalUrl} alt="Original" className="absolute inset-0 w-full h-full object-cover opacity-40" draggable={false} />
        <div className="relative bg-white/90 backdrop-blur-sm rounded-xl px-6 py-4 shadow text-center">
          <p className="text-sm font-semibold text-gray-700">Apply a transformation to see the result</p>
          <p className="text-xs text-gray-400 mt-1">Then drag the slider to compare before &amp; after</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative rounded-2xl overflow-hidden border border-gray-200 aspect-[4/3] cursor-col-resize select-none touch-none"
      onMouseDown={(e) => { dragging.current = true; updateFromClientX(e.clientX); }}
      onMouseMove={(e) => { if (dragging.current) updateFromClientX(e.clientX); }}
      onTouchStart={(e) => { dragging.current = true; updateFromClientX(e.touches[0].clientX); }}
      onTouchMove={(e) => { if (dragging.current) updateFromClientX(e.touches[0].clientX); }}
    >
      {/* After — full frame */}
      <img src={resultUrl} alt="After" className="absolute inset-0 w-full h-full object-cover" draggable={false} />

      {/* Before — clipped to the left of the slider */}
      <div
        className="absolute inset-0 overflow-hidden pointer-events-none"
        style={{ width: `${sliderPct}%` }}
      >
        <img
          src={originalUrl}
          alt="Before"
          className="absolute inset-0 h-full object-cover"
          style={{ width: containerRef.current?.offsetWidth ?? 800 }}
          draggable={false}
        />
      </div>

      {/* Divider line + handle */}
      <div className="absolute top-0 bottom-0 z-10 pointer-events-none" style={{ left: `${sliderPct}%` }}>
        <div className="absolute inset-y-0 -translate-x-px w-0.5 bg-white/90 shadow-[0_0_8px_rgba(0,0,0,0.5)]" />
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-white shadow-xl flex items-center justify-center border border-gray-200 ring-2 ring-white">
          <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
            <path d="M5 1L1 7L5 13M13 1L17 7L13 13" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>

      {/* Labels */}
      <span className="absolute top-3 left-3 z-10 bg-black/55 text-white text-xs font-bold px-2.5 py-1 rounded-full pointer-events-none tracking-wide">BEFORE</span>
      <span className="absolute top-3 right-3 z-10 bg-brand-500/85 text-white text-xs font-bold px-2.5 py-1 rounded-full pointer-events-none tracking-wide">AFTER</span>
    </div>
  );
}
