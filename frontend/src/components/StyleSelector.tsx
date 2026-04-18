import { StylePreset } from '../types';

interface StyleCard {
  id: StylePreset;
  label: string;
  icon: string;
  description: string;
}

const STYLES: StyleCard[] = [
  { id: 'professional', label: 'Professional', icon: '💼', description: 'Cool studio tone' },
  { id: 'casual',       label: 'Casual',       icon: '😊', description: 'Warm golden light' },
  { id: 'fantasy',      label: 'Fantasy',      icon: '🧙', description: 'Purple mystic tone' },
  { id: 'cyberpunk',    label: 'Cyberpunk',    icon: '🤖', description: 'Neon cyan grade' },
  { id: 'watercolor',   label: 'Watercolor',   icon: '🎨', description: 'Soft pastel wash' },
  { id: 'anime',        label: 'Anime',        icon: '✨', description: 'Cell-shaded edges' },
  { id: 'oil-painting', label: 'Oil Painting', icon: '🖼️', description: 'Amber warm grade' },
];

interface Props {
  selected: StylePreset | null;
  onSelect: (style: StylePreset) => void;
  disabled?: boolean;
  aiMode?: boolean;
}

export default function StyleSelector({ selected, onSelect, disabled, aiMode = false }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {STYLES.map((s) => (
          <button
            key={s.id}
            onClick={() => !disabled && onSelect(s.id)}
            disabled={disabled}
            className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 text-center transition-all
              ${selected === s.id
                ? 'border-brand-500 bg-brand-50 shadow-md'
                : 'border-gray-200 hover:border-brand-300 hover:bg-gray-50'
              }
              ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span className="text-2xl">{s.icon}</span>
            <span className="text-xs font-bold text-gray-800">{s.label}</span>
            <span className="text-[11px] text-gray-400 leading-tight">{s.description}</span>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-gray-400">
        {aiMode
          ? '✅ AI mode — full generative style transfer active.'
          : '⚡ Colour-grade mode — add REPLICATE_API_TOKEN or HF_API_TOKEN for generative AI styles.'}
      </p>
    </div>
  );
}
