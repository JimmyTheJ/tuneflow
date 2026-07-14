import { createFlatBands, dbToLinear } from "@/lib/eqBands";
import type { EqBand } from "@/types";

const FILTER_Q = 1.4;

type MediaGraph = {
  source: MediaElementAudioSourceNode;
  filters: BiquadFilterNode[];
  gain: GainNode;
};

let audioContext: AudioContext | null = null;
const graphs = new WeakMap<HTMLMediaElement, MediaGraph>();
const elementSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

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

function getOrCreateSource(media: HTMLMediaElement): MediaElementAudioSourceNode {
  const existing = elementSources.get(media);
  if (existing) return existing;

  const source = getContext().createMediaElementSource(media);
  elementSources.set(media, source);
  return source;
}

function wireGraph(graph: MediaGraph): void {
  const context = getContext();
  graph.source.connect(graph.filters[0]!);
  for (let index = 0; index < graph.filters.length - 1; index += 1) {
    graph.filters[index]!.connect(graph.filters[index + 1]!);
  }
  graph.filters[graph.filters.length - 1]!.connect(graph.gain);
  graph.gain.connect(context.destination);
}

function createGraph(media: HTMLMediaElement): MediaGraph {
  const context = getContext();
  const source = getOrCreateSource(media);
  const filters = Array.from({ length: 10 }, () => {
    const filter = context.createBiquadFilter();
    filter.type = "peaking";
    filter.Q.value = FILTER_Q;
    return filter;
  });
  const gain = context.createGain();
  const graph = { source, filters, gain };
  wireGraph(graph);
  return graph;
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

  let graph = graphs.get(media);
  if (!enabled && !graph) {
    media.volume = volume;
    return;
  }

  if (!graph) {
    graph = createGraph(media);
    graphs.set(media, graph);
  }

  media.volume = 1;

  const effectiveBands = enabled ? bands : createFlatBands();
  const effectivePreamp = enabled ? preampDb : 0;

  graph.filters.forEach((filter, index) => {
    const band = effectiveBands[index];
    if (!band) return;
    filter.frequency.value = band.freq;
    filter.gain.value = band.gainDb;
  });

  const output = Math.max(0, Math.min(1, volume * dbToLinear(effectivePreamp)));
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
