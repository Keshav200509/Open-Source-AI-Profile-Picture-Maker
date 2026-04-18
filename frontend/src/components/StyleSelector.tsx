import { StylePreset } from '../types';

interface StyleCard {
  id: StylePreset;
  label: string;
  icon: string;
  description: string;
  accent: string;
  bg: string;
}

const STYLES: StyleCard[] = [
  {
    id: 'professional',
    label: 'Professional',
    icon: '💼',
    description: 'Studio-lit corporate headshot',
    accent: 'border-slate-400 ring-slate-300',
    bg: 'bg-gradient-to-br from-slate-50 to-blue-50',
  },
  {
    id: 'fantasy',
    label: 'Fantasy',
    icon: '🔮',
    description: 'Mystical purple & gold portrait',
    accent: 'border-purple-400 ring-purple-300',
    bg: 'bg-gradient-to-br from-purple-50 to-violet-100',
  },
  {
    id: 'cyberpunk',
    label: 'Cyberpunk',
    icon: '⚡',
    description: 'Neon teal night-city portrait',
    accent: 'border-cyan-400 ring-cyan-300',
    bg: 'bg-gradient-to-br from-cyan-50 to-slate-100',
  },
  {
    id: 'anime',
    label: 'Anime',
    icon: '✨',
    description: 'Cell-shaded vibrant anime art',
    accent: 'border-pink-400 ring-pink-300',
    bg: 'bg-gradient-to-br from-pink-50 to-orange-50',
  },
];

interface Props {
  selected: StylePreset | null;
  onSelect: (style: StylePreset) => void;
  disabled?: boolean;
  aiMode?: boolean;
}

export default function StyleSelector({ selected, onSelect, disabled, aiMode = false }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        {STYLES.map((s) => {
          const isSelected = selected === s.id;
          return (
            <button
              key={s.id}
              onClick={() => !disabled && onSelect(s.id)}
              disabled={disabled}
              className={`relative flex flex-col items-center gap-2 p-4 rounded-2xl border-2 text-center transition-all duration-150
                ${isSelected
                  ? `${s.accent} ${s.bg} ring-2 shadow-lg scale-[1.02]`
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-md hover:scale-[1.01]'
                }
                ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {isSelected && (
                <span className="absolute top-2 right-2 w-4 h-4 bg-brand-500 rounded-full flex items-center justify-center">
                  <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                    <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
              )}
              <span className="text-3xl">{s.icon}</span>
              <div>
                <p className="text-sm font-bold text-gray-900">{s.label}</p>
                <p className="text-[11px] text-gray-500 leading-snug mt-0.5">{s.description}</p>
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-400 text-center">
        {aiMode
          ? '✅ Generative AI active — full style transformation enabled.'
          : '⚡ Colour-grade mode — add REPLICATE_API_TOKEN or HF_API_TOKEN for generative transforms.'}
      </p>
    </div>
  );
}
