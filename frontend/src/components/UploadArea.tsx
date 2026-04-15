import { useRef, useState, DragEvent, ChangeEvent } from 'react';

interface Props {
  onUpload: (file: File) => void;
  isUploading: boolean;
}

const MAX_SIZE_MB = 10;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export default function UploadArea({ onUpload, isUploading }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  function validate(file: File): string | null {
    if (!ALLOWED_TYPES.includes(file.type)) return 'Only JPEG, PNG, or WebP images are accepted.';
    if (file.size > MAX_SIZE_MB * 1024 * 1024) return `File must be under ${MAX_SIZE_MB} MB.`;
    return null;
  }

  function handleFile(file: File) {
    const err = validate(file);
    if (err) {
      setFileError(err);
      return;
    }
    setFileError(null);
    onUpload(file);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !isUploading && inputRef.current?.click()}
        className={`w-full max-w-lg border-2 border-dashed rounded-2xl p-12 flex flex-col items-center gap-4 cursor-pointer transition-colors
          ${dragging ? 'border-brand-500 bg-brand-50' : 'border-gray-300 hover:border-brand-400 hover:bg-gray-50'}
          ${isUploading ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        <svg className="h-16 w-16 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-700">
            {isUploading ? 'Uploading...' : 'Drop your selfie here'}
          </p>
          <p className="text-sm text-gray-500 mt-1">or click to choose a file</p>
          <p className="text-xs text-gray-400 mt-2">JPEG, PNG, WebP — up to 10 MB</p>
        </div>
        {!isUploading && (
          <button
            type="button"
            className="px-5 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-lg font-medium text-sm transition-colors"
          >
            Choose Photo
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onFileChange}
        className="hidden"
      />
      {fileError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          {fileError}
        </p>
      )}
    </div>
  );
}
