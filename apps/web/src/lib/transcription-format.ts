export type TranscribedWord = {
  start?: number;
  end?: number;
  text?: string;
};

export type TranscribedSegment = {
  start?: number;
  end?: number;
  text?: string;
  words?: TranscribedWord[];
  firstWordStart?: number;
  lastWordEnd?: number;
};

export type CaptionChunk = {
  text: string;
  startTime: number;
  duration: number;
};

type BuildOptions = {
  initialEndTime?: number;
  minDuration?: number;
  wordsPerChunk?: number;
};

const DEFAULT_MIN_DURATION = 0.8;
const DEFAULT_WORDS_PER_CHUNK = 3;

const toNumber = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

export function buildCaptionChunksFromSegments(
  segments: TranscribedSegment[] | undefined,
  options?: BuildOptions
): CaptionChunk[] {
  const minDuration = Math.max(options?.minDuration ?? DEFAULT_MIN_DURATION, 0);
  const wordsPerChunk = Math.max(
    1,
    Math.floor(options?.wordsPerChunk ?? DEFAULT_WORDS_PER_CHUNK)
  );
  let globalEndTime = Math.max(0, options?.initialEndTime ?? 0);

  const chunks: CaptionChunk[] = [];

  const pushChunk = (text: string, naturalStart: number, naturalEnd: number) => {
    const sanitized = text.replace(/\s+/g, " ").trim();
    if (!sanitized) return;

    let startTime = Math.max(naturalStart, globalEndTime);
    let endTime = Math.max(startTime, naturalEnd);
    if (startTime > naturalStart) {
      const shift = startTime - naturalStart;
      endTime = Math.max(endTime, naturalEnd + shift);
    }
    const duration = Math.max(minDuration, endTime - startTime);
    chunks.push({ text: sanitized, startTime, duration });
    globalEndTime = startTime + duration;
  };

  for (const segment of segments ?? []) {
    const fallbackStart = toNumber(
      segment.firstWordStart ?? segment.start,
      globalEndTime
    );
    const fallbackEnd = Math.max(
      fallbackStart,
      toNumber(segment.lastWordEnd ?? segment.end, fallbackStart + minDuration)
    );

    const words = (segment.words ?? [])
      .map((word) => {
        const start = toNumber(word.start, fallbackStart);
        const end = Math.max(start, toNumber(word.end, fallbackEnd));
        const text = String(word.text ?? "").trim();
        return { start, end, text };
      })
      .filter((word) => word.text.length > 0)
      .sort((a, b) => a.start - b.start);

    if (words.length === 0) {
      const fallbackText = String(segment.text ?? "");
      const tokens = fallbackText
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);

      if (tokens.length === 0) {
        continue;
      }

      const span = Math.max(fallbackEnd - fallbackStart, minDuration);
      for (let i = 0; i < tokens.length; i += wordsPerChunk) {
        const chunkTokens = tokens.slice(i, i + wordsPerChunk);
        const startRatio = i / tokens.length;
        const endRatio = Math.min(tokens.length, i + chunkTokens.length) / tokens.length;
        const chunkStart = fallbackStart + span * startRatio;
        const chunkEnd = fallbackStart + span * endRatio;
        pushChunk(chunkTokens.join(" "), chunkStart, chunkEnd);
      }
      continue;
    }

    for (let i = 0; i < words.length; i += wordsPerChunk) {
      const chunkWords = words.slice(i, i + wordsPerChunk);
      const chunkStart = chunkWords[0].start;
      const chunkEnd = chunkWords[chunkWords.length - 1].end;
      const chunkText = chunkWords.map((word) => word.text).join(" ");
      pushChunk(chunkText, chunkStart, chunkEnd);
    }
  }

  return chunks;
}
