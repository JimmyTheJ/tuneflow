import { dbToLinear } from "@/lib/eqBands";
import type { EqBand } from "@/types";

const FILTER_Q = 1.4;

type MediaGraph = {
  source: MediaElementAudioSourceNode;
  filters: BiquadFilterNode[];
  gain: GainNode;
};

let audioContext: AudioContext | null = null;
const graphs = new WeakMap<HTMLMediaElement, MediaGraph>();

function getContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

async function resumeContext(): Promise<void> {
  const context = getContext();
  if (context.state === "suspended") {
    await context.resume();
  }
}

function buildGraph(media: HTMLMediaElement): MediaGraph {
  const context = getContext();
  const source = context.createMediaElementSource(media);
  const filters = Array.from({ length: 10 }, () => {
    const filter = context.createBiquadFilter();
    filter.type = "peaking";
    filter.Q.value = FILTER_Q;
    return filter;
  });
  const gain = context.createGain();

  source.connect(filters[0]!);
  for (let index = 0; index < filters.length - 1; index += 1) {
    filters[index]!.connect(filters[index + 1]!);
  }
  filters[filters.length - 1]!.connect(gain);
  gain.connect(context.destination);

  return { source, filters, gain };
}

export function disconnectEq(media: HTMLMediaElement | null): void {
  if (!media) return;
  const graph = graphs.get(media);
  if (!graph) return;

  try {
    graph.source.disconnect();
    for (const filter of graph.filters) {
      filter.disconnect();
    }
    graph.gain.disconnect();
  } catch {
    /* already disconnected */
  }

  graphs.delete(media);
  media.volume = 1;
}

export async function connectEq(
  media: HTMLMediaElement,
  volume: number,
  bands: EqBand[],
  preampDb: number,
  enabled: boolean,
): Promise<void> {
  await resumeContext();

  if (!enabled) {
    disconnectEq(media);
    media.volume = volume;
    return;
  }

  let graph = graphs.get(media);
  if (!graph) {
    graph = buildGraph(media);
    graphs.set(media, graph);
    media.volume = 1;
  }

  graph.filters.forEach((filter, index) => {
    const band = bands[index];
    if (!band) return;
    filter.frequency.value = band.freq;
    filter.gain.value = band.gainDb;
  });

  const output = Math.max(0, Math.min(1, volume * dbToLinear(preampDb)));
  graph.gain.gain.value = output;
}

export async function setEqVolume(media: HTMLMediaElement | null, volume: number, preampDb: number): Promise<void> {
  if (!media) return;
  const graph = graphs.get(media);
  if (!graph) {
    media.volume = volume;
    return;
  }
  graph.gain.gain.value = Math.max(0, Math.min(1, volume * dbToLinear(preampDb)));
}

export function disposeEqContext(): void {
  if (!audioContext) return;
  void audioContext.close();
  audioContext = null;
}
