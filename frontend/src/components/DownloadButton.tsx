import { useState } from 'react';

interface Platform {
  label: string;
  w: number;
  h: number;
  circle: boolean;
  icon: string;
  note: string;
}

const PLATFORMS: Platform[] = [
  { label: 'Original',    w: 0,   h: 0,   circle: false, icon: '⬇️', note: 'Full resolution' },
  { label: 'LinkedIn',    w: 400, h: 400, circle: false, icon: '💼', note: '400×400 px' },
  { label: 'Twitter / X', w: 400, h: 400, circle: true,  icon: '𝕏',  note: '400×400 · circle' },
  { label: 'GitHub',      w: 460, h: 460, circle: true,  icon: '🐙', note: '460×460 · circle' },
  { label: 'Passport',    w: 600, h: 800, circle: false, icon: '🪪', note: '600×800 px' },
];

interface Props {
  resultUrl: string;
}

export default function DownloadButton({ resultUrl }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function downloadOriginal() {
    setLoading(true);
    try {
      const res = await fetch(resultUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'profile.jpg'; a.click();
      URL.revokeObjectURL(url);
    } finally { setLoading(false); }
  }

  async function downloadForPlatform(p: Platform) {
    if (p.w === 0) { void downloadOriginal(); setOpen(false); return; }
    setLoading(true);
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = resultUrl; });

      const canvas = document.createElement('canvas');
      canvas.width = p.w; canvas.height = p.h;
      const ctx = canvas.getContext('2d')!;

      if (p.circle) {
        ctx.beginPath();
        ctx.arc(p.w / 2, p.h / 2, Math.min(p.w, p.h) / 2, 0, Math.PI * 2);
        ctx.clip();
      }

      const tgt = p.w / p.h;
      const src = img.naturalWidth / img.naturalHeight;
      let sx: number, sy: number, sw: number, sh: number;
      if (src > tgt) { sh = img.naturalHeight; sw = sh * tgt; sx = (img.naturalWidth - sw) / 2; sy = 0; }
      else           { sw = img.naturalWidth;  sh = sw / tgt; sx = 0; sy = (img.naturalHeight - sh) / 2; }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, p.w, p.h);

      await new Promise<void>((res) => {
        canvas.toBlob((blob) => {
          const url = URL.createObjectURL(blob!);
          const a = document.createElement('a');
          a.href = url; a.download = `profile-${p.label.toLowerCase().replace(/[\s/𝕏]+/g, '-')}.png`; a.click();
          URL.revokeObjectURL(url); res();
        }, 'image/png');
      });
    } finally { setLoading(false); setOpen(false); }
  }

  return (
    <div className="relative">
      <div className="flex items-stretch rounded-lg overflow-hidden shadow-sm border border-green-600">
        <button
          onClick={() => void downloadOriginal()}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm transition-colors disabled:opacity-60"
        >
          {loading
            ? <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            : <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          }
          Download
        </button>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center px-2.5 bg-green-600 hover:bg-green-700 text-white border-l border-green-500 transition-colors"
          title="Export for specific platform"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 z-20 bg-white border border-gray-200 rounded-xl shadow-xl py-1.5 min-w-[200px]">
            <p className="px-3 pt-0.5 pb-2 text-[11px] font-bold text-gray-400 uppercase tracking-widest">Export for</p>
            {PLATFORMS.map((p) => (
              <button
                key={p.label}
                onClick={() => void downloadForPlatform(p)}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 text-left transition-colors"
              >
                <span className="text-lg w-6 text-center">{p.icon}</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">{p.label}</p>
                  <p className="text-xs text-gray-400">{p.note}</p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
