interface Props {
  originalUrl: string;
  resultUrl: string | null;
}

export default function EditorCanvas({ originalUrl, resultUrl }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Original</p>
        <div className="rounded-xl overflow-hidden border border-gray-200 bg-gray-50 aspect-square">
          <img
            src={originalUrl}
            alt="Original"
            className="w-full h-full object-cover"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Result</p>
        <div className="rounded-xl overflow-hidden border border-gray-200 bg-gray-50 aspect-square flex items-center justify-center">
          {resultUrl ? (
            <img
              src={resultUrl}
              alt="Result"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-gray-400">
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              <p className="text-sm">Result will appear here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
