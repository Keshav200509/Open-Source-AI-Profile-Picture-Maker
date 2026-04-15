import { StylePreset } from '../types';

interface StyleCard {
  id: StylePreset;
  label: string;
  icon: string;
  description: string;
}

const STYLES: StyleCard[] = [
  { id: 'professional', label: 'Professional', icon: '💼', description: 'Corporate headshot' },
  { id: 'casual', label: 'Casual', icon: '😊', description: 'Natural & relaxed' },
  { id: 'fantasy', label: 'Fantasy', icon: '🧙', description: 'Epic & magical' },
  { id: 'cyberpunk', label: 'Cyberpunk', icon: '🤖', description: 'Neon futuristic' },
  { id: 'watercolor', label: 'Watercolor', icon: '🎨', description: 'Soft artistic' },
  { id: 'anime', label: 'Anime', icon: '✨', description: 'Cell-shaded' },
  { id: 'oil-painting', label: 'Oil Painting', icon: '🖼️', description: 'Classical art' },
];

interface Props {
  selected: StylePreset | null;
  onSelect: (style: StylePreset) => void;
  disabled?: boolean;
}

export default function StyleSelector({ selected, onSelect, disabled }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
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
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <span className="text-2xl">{s.icon}</span>
          <span className="text-sm font-semibold text-gray-800">{s.label}</span>
          <span className="text-xs text-gray-500">{s.description}</span>
        </button>
      ))}
    </div>
  );
}
