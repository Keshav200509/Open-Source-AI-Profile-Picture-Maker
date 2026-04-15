import { useState } from 'react';

interface Props {
  onApplyColor: (color: string) => void;
  disabled?: boolean;
}

export default function BackgroundTool({ onApplyColor, disabled }: Props) {
  const [color, setColor] = useState('#ffffff');

  const PRESETS = ['#ffffff', '#1e293b', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-gray-700">Background Color</p>
      <div className="flex items-center gap-2 flex-wrap">
        {PRESETS.map((c) => (
          <button
            key={c}
            disabled={disabled}
            onClick={() => { setColor(c); onApplyColor(c); }}
            style={{ backgroundColor: c }}
            className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110
              ${color === c ? 'border-brand-500 scale-110' : 'border-gray-300'}`}
            title={c}
          />
        ))}
        <input
          type="color"
          value={color}
          disabled={disabled}
          onChange={(e) => setColor(e.target.value)}
          onBlur={() => onApplyColor(color)}
          className="h-8 w-8 rounded-full border border-gray-300 cursor-pointer"
          title="Custom color"
        />
      </div>
    </div>
  );
}
