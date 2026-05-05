import { Audio } from "expo-av";

interface NowPlayingMeta {
  title: string;
  artist: string;
  album?: string;
  artworkUri?: string;
  positionMs: number;
  durationMs: number;
  isPlaying: boolean;
}

export async function updateNowPlayingInfo(meta: NowPlayingMeta): Promise<void> {
  try {
    await (Audio as any).setNowPlayingAsync({
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      artwork: meta.artworkUri ? { uri: meta.artworkUri } : undefined,
      duration: meta.durationMs / 1000,
      elapsedPlayback: meta.positionMs / 1000,
      playbackRate: meta.isPlaying ? 1.0 : 0.0,
    });
  } catch {
    // no-op on Android / unsupported platforms
  }
}

interface RemoteControlHandlers {
  onPlay: () => void;
  onPause: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onSeek: (ms: number) => void;
}

export function registerRemoteControls(handlers: RemoteControlHandlers): () => void {
  try {
    const sub = (Audio as any).addListener("remoteCommand", (event: any) => {
      switch (event.type) {
        case "play":
          handlers.onPlay();
          break;
        case "pause":
          handlers.onPause();
          break;
        case "next":
          handlers.onNext?.();
          break;
        case "previous":
          handlers.onPrev?.();
          break;
        case "seek":
          // event.positionSeconds is already in seconds — convert to ms
          handlers.onSeek(event.positionSeconds * 1000);
          break;
      }
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}
